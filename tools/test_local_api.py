"""Disposable Linux integration tests; never connect to a physical hub."""
import base64
import hashlib
import http.client
import http.server
import threading
import json
import os
from pathlib import Path
import signal
import socket
import struct
import subprocess
import sys
import tempfile
import termios
import time
import fcntl

ROOT = Path(__file__).resolve().parents[1]

def check_resources(request, cookie, csrf, resources):
    devices_path = resources / "DeviceList.json"
    protocols_path = resources / "ProtocolList.json"
    stock_command = {"Id-": 40, "Name": "Old", "KeyCode": "original", "Raw": None,
                     "ProtocolId": 20, "StockExtension": {"keep": [1, "quoted\\\" value"]}}
    target = {"Device": {"Id-": 12, "Name": "Stock", "Manufacturer": "LG", "Model": "C5",
                         "DeviceTypeDisplayName": "Television", "StockField": {"keep": True}},
              "Commands": [stock_command], "DeviceFeatures": [{"keep": True}]}
    neighbor = {"Device": {"Id-": 123, "Name": "Other", "Manufacturer": "LG", "Model": "Other",
                           "DeviceTypeDisplayName": "Television"},
                "Commands": [{"Id-": 400, "Name": "Other"}]}
    fixture = {"UnknownTopLevel": {"keep": "Device and Commands are not delimiters"}, "DevicesWithFeatures": [neighbor, target]}
    devices_path.write_text(json.dumps(fixture, indent=2))
    protocols_path.write_text(json.dumps({"Metadata": {"keep": True}, "Protocols": [{"Id-": 20, "Name": "Other"}]}, indent=2))

    def mutate(path, **body):
        revision = request("configuration", cookie=cookie)[1]["revision"]
        return request(path, dict(body, revision=revision), cookie, csrf)

    def saved():
        return json.loads(devices_path.read_text())

    def command(**values):
        return mutate("commands/save", deviceId="12", **values)

    result = request("devices", cookie=cookie)[1]
    assert result["deviceCount"] == 2 and result["totalCommandCount"] == 2
    assert {item["id"] for item in result["devices"]} == {"12", "123"}
    assert mutate("devices", action="update", deviceId="12", name="Renamed", manufacturer="LG", model="C5", type="Television")[0] == 200
    current = saved()
    assert current["DevicesWithFeatures"][0] == neighbor, "ID 12 must not match 123"
    assert current["DevicesWithFeatures"][1]["Device"]["StockField"] == {"keep": True}
    assert current["UnknownTopLevel"] == fixture["UnknownTopLevel"]
    assert command(oldName="Old", name="Off", mode="nec", protocol="2", nec="20DFA35C")[0] == 200
    current = saved()
    updated = current["DevicesWithFeatures"][1]["Commands"][0]
    assert updated["Id-"] == 40 and updated["StockExtension"] == stock_command["StockExtension"]
    assert updated["ProtocolId"] == 2
    protocols = json.loads(protocols_path.read_text())
    assert sorted(p["Id-"] for p in protocols["Protocols"]) == [2, 20], "protocol 20 must not satisfy protocol 2"
    assert protocols["Metadata"] == {"keep": True}
    assert command(name="Off", mode="raw", raw="F9470P100S100P100S100")[0] == 400
    assert mutate("commands/import", deviceId="12", payload="Off|raw|F9470P100S100P100S100\nNew|raw|F9470P100S100P100S100\nNew|raw|F9470P100S100P100S100")[0] == 200
    commands = saved()["DevicesWithFeatures"][1]["Commands"]
    assert [c["Name"] for c in commands] == ["Off", "New"]
    assert commands[1]["Id-"] > 400
    before = devices_path.read_bytes()
    assert command(oldName="Off", name="New", mode="nec", nec="20DF10EF")[0] == 400
    assert devices_path.read_bytes() == before
    assert command(action="delete", name="Off")[0] == 200
    assert [c["Name"] for c in saved()["DevicesWithFeatures"][1]["Commands"]] == ["New"]

    # Escapes, whitespace, reordered fields and unknown nested values survive a rewrite.
    current = saved()
    current["DevicesWithFeatures"][1]["Commands"][0]["Name"] = 'Quoted "name" \\ path'
    current["DevicesWithFeatures"][1]["Commands"][0]["StockExtension"] = {"keep": [1, 2]}
    devices_path.write_text(json.dumps(current, indent=4, sort_keys=True))
    inventory = request("devices", cookie=cookie)[1]
    assert inventory["devices"][1]["commands"][0]["name"] == 'Quoted "name" \\ path'
    assert mutate("devices", action="update", deviceId="12", name="TV", manufacturer="LG", model="C5", type="Television")[0] == 200
    assert saved()["DevicesWithFeatures"][1]["Commands"] == current["DevicesWithFeatures"][1]["Commands"]

    # Invalid resource files are rejected without silently starting a replacement configuration.
    for invalid in ['{"DevicesWithFeatures":[],"DevicesWithFeatures":[]}', '{"DevicesWithFeatures":{}}', '{broken']:
        devices_path.write_text(invalid)
        assert request("devices", cookie=cookie)[1]["ok"] is False
        assert mutate("devices", action="create", transport="ir", name="New", manufacturer="LG", model="C5", type="Television")[0] == 400
        assert devices_path.read_text() == invalid

    current["DevicesWithFeatures"][1]["Commands"] = [{"Id-": n+1, "Name": f"C{n}"} for n in range(2048)]
    devices_path.write_text(json.dumps(current))
    before = devices_path.read_bytes()
    assert command(name="Too many", mode="raw", raw="F9470P100S100P100S100")[0] == 400
    assert devices_path.read_bytes() == before
    # A near-limit file must not grow past the resource budget on write.
    current["DevicesWithFeatures"][1]["Commands"] = []
    raw = json.dumps(current)
    current["Padding"] = "x" * (2 * 1024 * 1024 - len(raw) - 64)
    devices_path.write_text(json.dumps(current))
    assert devices_path.stat().st_size < 2 * 1024 * 1024
    before = devices_path.read_bytes()
    assert command(name="Too large", mode="raw", raw="F9470P100S100P100S100")[0] == 400
    assert devices_path.read_bytes() == before
    devices_path.write_text(json.dumps(fixture))
    assert mutate("devices", action="delete", deviceId="12")[0] == 200
    assert saved()["DevicesWithFeatures"] == [neighbor]
    assert mutate("devices", action="create", transport="bluetooth", name="Keyboard", type="btkeyboard", bdaddr="01:23:45:67:89:AB")[0] == 200
    bt_id = request("bluetooth/devices", cookie=cookie)[1]["devices"][0]["id"]
    script = 'TEXT "quoted" \\ path\nKEY ENTER'
    assert mutate("commands/save", transport="bluetooth", deviceId=bt_id, name="Text", script=script, delayMs=50)[0] == 200
    bt = request("bluetooth/devices", cookie=cookie)[1]["devices"][0]
    assert bt["commands"] == [{"name": "Text", "script": script, "delayMs": 50}]
    assert mutate("devices", action="delete", transport="bluetooth", deviceId=bt_id)[0] == 200
    assert request("bluetooth/devices", cookie=cookie)[1]["devices"] == []
    # Guided setup is one recoverable transaction, not three independent writes.
    before = saved()
    setup = dict(action="create-profile", transport="ir", name="Receiver", manufacturer="Pioneer", model="VSX-LX52", type="Audio",
                 source="Pioneer/VSX-52.ir", payload="VOL+|raw|F9470P100S100P100S100\nVOL-|raw|F9470P100S100P100S100",
                 layout=[{"slot": "volumeup", "label": "Volume up", "command": "VOL+"}])
    for invalid in [dict(payload="broken"), dict(payload=setup["payload"]+"\nVOL+|raw|F9470P100S100P100S100"),
                    dict(layout=[{"slot": "volumeup", "command": "missing"}])]:
        config_before = request("configuration", cookie=cookie)[1]
        assert mutate("devices", **dict(setup, **invalid))[0] == 400
        assert saved() == before, "failed setup left an empty or partial device"
        assert request("configuration", cookie=cookie)[1] == config_before
    status, created, _ = mutate("devices", **setup)
    assert status == 200, created
    new_id = created["deviceId"]
    config = request("configuration", cookie=cookie)[1]
    assert config["layouts"][new_id] == setup["layout"]
    assert config["deviceSetup"][new_id] == {"status": "untested", "source": setup["source"], "testedCommand": ""}
    assert saved()["DevicesWithFeatures"][:-1] == before["DevicesWithFeatures"]
    assert len(saved()["DevicesWithFeatures"][-1]["Commands"]) == 2
    assert mutate("devices", action="delete", deviceId=new_id)[0] == 200
    assert new_id not in request("configuration", cookie=cookie)[1]["deviceSetup"]
    assert new_id not in request("configuration", cookie=cookie)[1]["layouts"]
    assert saved() == before
    print("Guided setup: atomic device/commands/layout, untested provenance and failed-import rollback passed")
    for invalid in [{"action": "connect", "type": "unknown"}, {"action": "connect", "type": "btkeyboard", "bdaddr": "invalid"}]:
        assert request("bluetooth/pair", invalid, cookie, csrf)[1]["ok"] is False
    print("Stock resources: exact IDs, JSON formatting/escapes, preserved fields, CRUD/import, malformed files and storage limits passed")


def run():
    with tempfile.TemporaryDirectory(prefix="harmony-local-") as directory:
        base = Path(directory)
        local, ops, resources, www = [base / n for n in ("local", "operations", "resources", "www")]
        for path in (local, ops, resources, www):
            path.mkdir()
        button_path = base / "input-events"
        os.mkfifo(button_path)
        button_fd = os.open(button_path, os.O_RDWR | os.O_NONBLOCK)
        fixtures = {"DeviceList": {"DevicesWithFeatures": []}, "FunctionList": {"FunctionMaps": []},
                    "ProtocolList": {"Protocols": []}, "ActivityList": {"Activities": []}, "MapList": {"ButtonMaps": []}}
        for name, value in fixtures.items():
            (resources / (name + ".json")).write_text(json.dumps(value))
        (base / "hub_id").write_text("19111956")
        (www / "index.html").write_text("<!doctype html><title>test</title>")
        defs = {"LOCAL_ROOT": local, "LOCAL_OPS": ops, "LOCAL_WWW": www, "LOCAL_BUTTON_DEVICE": button_path,
                "DEVICE_LIST": resources / "DeviceList.json", "FUNCTION_LIST": resources / "FunctionList.json",
                "PROTOCOL_LIST": resources / "ProtocolList.json", "ACTIVITY_LIST": resources / "ActivityList.json",
                "MAP_LIST": resources / "MapList.json", "BT_DEVICE_STORE": resources / "bt-devices.json",
                "MQTT_CONFIG": base / "mqtt.json", "WPA_CONFIG": base / "wifi.conf", "HUB_ID_FILE": base / "hub_id",
                "RESOURCE_RELOAD_FLAG": base / "reload", "CODEX_BIN_DIR": base / "absent-helpers",
                "IR_SEND_LOCK": base / "ir.lock",
                "LOCAL_WPA_STATUS_CMD": f"cat {base}/wpa-status.txt 2>/dev/null", "LOCAL_UPDATE_STAGE": base / "update", "LOCAL_UPDATE_BACKUP": base / "rollback", "LOCAL_UPDATE_VOLUME": base,
                "LOCAL_CORE_FILE": base / "localcore.lua", "LOCAL_MQTT_FILE": base / "codexmqtt.lua",
                "LOCAL_INIT_FILE": base / "init.sh", "LOCAL_MAINTENANCE_FILE": base / "maintenance.sh"}
        source = ROOT / "payload/source"
        binary = base / "webui"
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0)); roku_port = probe.getsockname()[1]
        subprocess.run([os.environ.get("CC", "gcc"), "-Os", "-DCJSON_NESTING_LIMIT=32", "-DLOCAL_TEST_NO_REBOOT=1",
                        f"-DLOCAL_ROKU_PORT={roku_port}", "-DLOCAL_TEST_ROKU_LOOPBACK=1"] +
                       [f'-D{k}="{v}"' for k, v in defs.items()] +
                       [str(source / p) for p in ("codex_webui.c", "vendor/cJSON.c", "vendor/monocypher.c", "vendor/monocypher-ed25519.c")] +
                       ["-o", str(binary)], check=True)
        code = subprocess.check_output([binary, "--claim-code"], text=True).strip()
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0)); port = sock.getsockname()[1]
        log = (base / "log").open("w")
        server = subprocess.Popen([binary, str(port)], stdout=log, stderr=log, start_new_session=True)
        coordinator = None

        # Config writes fsync a journal plus every resource file and then sync() the
        # whole filesystem, which a shared CI disk can stretch past a few seconds.
        # The limit only has to tell "slow" from "hung".
        def request(path, body=None, cookie="", csrf="", extra=None, raw=None):
            conn = http.client.HTTPConnection("127.0.0.1", port, timeout=30)
            headers = {"Host": f"127.0.0.1:{port}", "Cookie": cookie, "X-Harmony-CSRF": csrf}
            headers.update(extra or {})
            text = raw if raw is not None else json.dumps(body) if body is not None else None
            conn.request("POST" if text is not None else "GET", "/api/v1/" + path, text, headers)
            response = conn.getresponse()
            data = response.read(); result = json.loads(data)
            pair_cookie = response.getheader("Set-Cookie", "").split(";")[0]
            status = response.status; conn.close()
            return status, result, pair_cookie

        def button_event(value, code=30, stamp=None, event_type=1):
            stamp = time.time() if stamp is None else stamp
            os.write(button_fd, struct.pack("llHHi", int(stamp), int(stamp % 1 * 1000000), event_type, code, value))
            # The server reads these asynchronously. Wait until it has taken them off
            # the FIFO, then a beat for it to finish handling the last one, so that
            # "this press must NOT change anything" assertions can't pass just because
            # the event hadn't been processed yet.
            deadline = time.time() + 5
            while struct.unpack("i", fcntl.ioctl(button_fd, termios.FIONREAD, b"\0\0\0\0"))[0] and time.time() < deadline:
                time.sleep(.005)
            time.sleep(.05)

        def press(duration=.15):
            # The hub only counts a press stamped strictly after the pairing window
            # opened, at millisecond resolution. A press sent straight after the
            # request that opened the window can land in the same millisecond and be
            # (correctly) ignored, so step past it first.
            try: opened = json.loads((ops / "pair-window").read_text())["wall"] / 1000
            except (OSError, ValueError, KeyError): opened = 0
            time.sleep(max(0, opened + .01 - time.time()))
            stamp = time.time()
            button_event(1, stamp=stamp)
            button_event(0, stamp=stamp + duration)

        def role(cookie):
            return request("session", cookie=cookie)[1]["role"]

        def wait_role(cookie, expected, timeout=5):
            # For assertions that a press DID change the role: poll rather than race the server.
            deadline = time.time() + timeout
            while role(cookie) != expected and time.time() < deadline:
                time.sleep(.05)
            return role(cookie)

        try:
            for _ in range(100):
                try:
                    if request("session")[0] == 200: break
                except OSError: time.sleep(.05)
            else: raise AssertionError("server failed to start")
            assert request("devices")[0] == 401
            assert request("session", extra={"Host": "attacker.example"})[0] == 403
            # The /go daily-use UI is served same-origin with the same CSP as the original UI.
            for name, body in (("go.html", b"<!doctype html>go"), ("go.js", b"//go"), ("go.css", b"/*go*/")):
                (www / name).write_bytes(body)
            for route, body, kind in (("/go", b"<!doctype html>go", "text/html"), ("/go/", b"<!doctype html>go", "text/html"),
                                      ("/go/go.js", b"//go", "text/javascript"), ("/go/go.css", b"/*go*/", "text/css")):
                conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
                conn.request("GET", route, headers={"Host": f"127.0.0.1:{port}"}); response = conn.getresponse()
                assert response.status == 200 and response.read() == body and response.getheader("Content-Type").startswith(kind), route
                assert "script-src 'self'" in response.getheader("Content-Security-Policy"), route
                conn.close()
            conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
            conn.request("GET", "/go/other.js", headers={"Host": f"127.0.0.1:{port}"})
            status = conn.getresponse().status; assert status in (401, 404), status; conn.close()
            assert request("activities/state")[0] == 401
            assert request("session")[1]["buttonAvailable"]
            status, first, first_cookie = request("controllers/request", {"name": "Physical owner", "button": True})
            assert status == 200 and role(first_cookie) == "pending"
            assert not request("session")[1]["claimed"]
            press()
            assert wait_role(first_cookie, "owner") == "owner"
            assert not (local / "claim.hash").exists()
            # Only disposable state: reset the test registry to exercise code claiming too.
            (local / "controllers.json").unlink()
            code = subprocess.check_output([binary, "--claim-code"], text=True).strip()
            status, owner, cookie = request("controllers/claim", {"name": "Owner", "code": code})
            assert status == 200 and owner["role"] == "owner"
            csrf = owner["csrf"]
            bearer = {"Authorization": "Bearer " + cookie.split("=", 1)[1], "Origin": f"http://127.0.0.1:{port}"}
            assert request("session", extra=bearer)[1]["role"] == "owner"
            assert request("activities/state", extra=bearer)[0] == 200
            assert request("controllers/cancel", {}, csrf=csrf, extra=bearer)[0] == 200
            status, physical, physical_cookie = request("controllers/request", {"name": "Button phone", "button": True})
            assert status == 200 and role(physical_cookie) == "pending"
            assert request("controllers/request", {"name": "Competing phone", "button": True})[0] == 409
            assert request("controllers/cancel", {}, physical_cookie, "wrong")[0] == 403
            button_event(0)  # Release without a fresh press.
            button_event(1, code=31); button_event(0, code=31)
            button_event(2); button_event(0)  # Autorepeat is not a fresh press.
            old = time.time() - 10
            button_event(1, stamp=old); button_event(0, stamp=old + .15)
            press(3)  # Long holds must never approve.
            assert role(physical_cookie) == "pending"
            button_event(1); button_event(0, code=3, event_type=0)  # SYN_DROPPED
            button_event(1); button_event(0); button_event(0, code=0, event_type=0)
            assert role(physical_cookie) == "pending"
            window_path = ops / "pair-window"
            window = json.loads(window_path.read_text()); window["created"] -= 90000
            window_path.write_text(json.dumps(window))
            press(); assert role(physical_cookie) == "pending"
            assert request("controllers/cancel", {}, physical_cookie, physical["csrf"])[0] == 200
            assert role(physical_cookie) == "unpaired"
            status, physical, physical_cookie = request("controllers/request", {"name": "Button phone", "button": True})
            assert status == 200
            button_event(1)
            assert request("controllers/cancel", {}, physical_cookie, physical["csrf"])[0] == 200
            status, physical, physical_cookie = request("controllers/request", {"name": "Replacement phone", "button": True})
            button_event(0, stamp=time.time() + .15)
            assert role(physical_cookie) == "pending", "an old press must not approve a new request"
            press()
            assert wait_role(physical_cookie, "owner") == "owner"
            assert request("controllers", cookie=physical_cookie)[0] == 200
            assert request("backups/full", cookie=physical_cookie)[0] == 200
            assert request("controllers", {"id": physical["id"], "action": "revoke"}, cookie, csrf)[0] == 200
            press(); assert wait_role(physical_cookie, "unpaired") == "unpaired"
            print("Physical pairing: full ownership, one request, expiry, cancel, stale/long/wrong/dropped events and revocation passed")
            # The computer-side installer pairs the way a phone does (the Pair button), keeps the pairing for
            # next time, and pairs again once the hub has forgotten it.
            sys.path.insert(0, str(ROOT / "tools"))
            import push_release
            quiet = lambda *_a, **_k: None
            def pressing(message):
                if "Pair button" in message: press()
            def must_not_pair(message): raise AssertionError("it should have reused the saved pairing: " + message)
            with tempfile.TemporaryDirectory() as pair_dir:
                first = push_release.connect("127.0.0.1", port, state_dir=pair_dir, say=pressing)
                assert request("controllers", cookie="harmony=" + first.token)[0] == 200, "paired as an owner"
                assert push_release.credentials_path("127.0.0.1", port, pair_dir).exists()
                assert push_release.connect("127.0.0.1", port, state_dir=pair_dir, say=must_not_pair).token == first.token
                mine = [c for c in request("controllers", cookie=cookie)[1] if c["name"] == "push_release"]
                assert len(mine) == 1
                assert request("controllers", {"id": mine[0]["id"], "action": "revoke"}, cookie, csrf)[0] == 200
                second = push_release.connect("127.0.0.1", port, state_dir=pair_dir, say=pressing)
                assert second.token != first.token and request("controllers", cookie="harmony=" + second.token)[0] == 200, "a forgotten pairing is redone"
                mine = [c for c in request("controllers", cookie=cookie)[1] if c["name"] == "push_release"]
                assert request("controllers", {"id": mine[0]["id"], "action": "revoke"}, cookie, csrf)[0] == 200
            print("push_release pairing: owner via the Pair button, saved and reused, redone after a revoke passed")
            assert request("controllers/claim", {"name": "Second", "code": code})[0] == 409
            status, pending, second = request("controllers/request", {"name": "Phone"})
            assert status == 200 and pending["role"] == "pending"
            assert request("devices", cookie=second)[0] == 401
            assert request("controllers", {"id": pending["id"], "action": "approve"}, cookie, csrf)[0] == 200
            assert request("devices", cookie=second)[0] == 200
            assert request("backups/full", cookie=second)[0] == 403
            # Existing control-only browsers can gain ownership only after a fresh physical press.
            status, upgrade, upgrade_cookie = request("controllers/request", {"name": "Upgradeable"})
            assert request("controllers", {"id": upgrade["id"], "action": "approve"}, cookie, csrf)[0] == 200
            assert request("controllers/upgrade", {}, upgrade_cookie, "wrong")[0] == 403
            assert request("controllers/upgrade", {}, upgrade_cookie, upgrade["csrf"])[0] == 200
            assert role(upgrade_cookie) == "control" and request("session", cookie=upgrade_cookie)[1]["buttonPending"]
            status, activity, _ = request("activities/state", cookie=upgrade_cookie)
            assert status == 200 and activity == {"activityId": "", "estimated": True}
            assert request("controllers/cancel", {}, upgrade_cookie, upgrade["csrf"])[0] == 200
            press(); assert role(upgrade_cookie) == "control"
            assert request("controllers/upgrade", {}, upgrade_cookie, upgrade["csrf"])[0] == 200
            press(); assert wait_role(upgrade_cookie, "owner") == "owner"
            assert request("controllers", cookie=upgrade_cookie)[0] == 200
            assert request("controllers", {"id": upgrade["id"], "action": "revoke"}, cookie, csrf)[0] == 200
            assert request("setup", {"revision": 1, "mode": "keep"}, cookie)[0] == 403
            assert request("setup", {"revision": 1, "mode": "keep"}, cookie, csrf, {"Origin": "http://attacker.example"})[0] == 403
            assert request("setup", cookie=cookie, csrf=csrf, raw='{"revision":1,"revision":1}')[0] == 400
            assert request("setup", {"revision": 1, "mode": "keep"}, cookie, csrf)[0] == 200
            assert request("setup", {"revision": 1, "mode": "keep"}, cookie, csrf)[0] == 409
            assert request("configuration", cookie=cookie)[1]["revision"] == 2
            backup = request("backups/portable", cookie=cookie)[1]
            assert request("backups/restore", {"revision": 2, "backup": backup}, cookie, csrf)[0] == 200
            assert request("configuration", cookie=cookie)[1]["revision"] == 3
            with (base / "ir.lock").open("w") as held:
                fcntl.flock(held, fcntl.LOCK_EX)
                assert request("setup", {"revision": 3, "mode": "keep"}, cookie, csrf)[0] == 409
            configuration = request("configuration", cookie=cookie)[1]
            broken_revision = dict(configuration); broken_revision["revision"] = 3.5
            assert request("configuration", {"revision": 3, "configuration": broken_revision}, cookie, csrf)[0] == 400
            assert request("configuration", cookie=cookie)[1]["revision"] == 3
            invalid = dict(backup); invalid["resources"] = {"DeviceList.json": []}
            assert request("backups/restore", {"revision": 3, "backup": invalid}, cookie, csrf)[0] == 400
            assert request("configuration", cookie=cookie)[1]["revision"] == 3
            # Queue cancellation and revocation cannot be bypassed by another controller.
            status, created, _ = request("devices", {"revision": 3, "action": "create", "transport": "ir", "name": "Test TV", "manufacturer": "LG", "model": "Test", "type": "Television"}, cookie, csrf)
            assert status == 200, created
            device_id = created["deviceId"]
            assert request("commands/save", {"revision": 4, "deviceId": device_id, "name": "PowerOff", "mode": "nec", "protocol": "2", "nec": "20DFA35C"}, cookie, csrf)[0] == 200
            assert request("commands/import", {"revision": 5, "deviceId": device_id, "payload": "VolumeUp|raw|F9470P100S100P100S100"}, cookie, csrf)[0] == 200
            assert request("devices", cookie=cookie)[1]["devices"][0]["commands"][0]["name"] == "PowerOff"
            configuration = request("configuration", cookie=cookie)[1]
            configuration["layouts"][device_id] = [{"slot": "volumeup", "label": "Volume", "command": "VolumeUp"}]
            configuration["activities"] = [{"id": "watch", "name": "Watch TV", "steps": [], "exitSteps": [], "screen": {"columns": 2, "cells": [{"deviceId": device_id, "command": "VolumeUp", "label": "Volume"}]}}]
            assert request("configuration", {"revision": 6, "configuration": configuration}, cookie, csrf)[0] == 200
            # The custom-screen field is validated server-side, not just by the client UI.
            bad_columns = json.loads(json.dumps(configuration)); bad_columns["activities"][0]["screen"]["columns"] = 0
            assert request("configuration", {"revision": 7, "configuration": bad_columns}, cookie, csrf)[0] == 400
            # `pinned` holds at most `columns` cells of the same shape as `cells`.
            pinned_cell = {"deviceId": device_id, "command": "VolumeUp"}
            too_many_pinned = json.loads(json.dumps(configuration)); too_many_pinned["activities"][0]["screen"]["pinned"] = [pinned_cell] * 3
            assert request("configuration", {"revision": 7, "configuration": too_many_pinned}, cookie, csrf)[0] == 400
            bad_pinned = json.loads(json.dumps(configuration)); bad_pinned["activities"][0]["screen"]["pinned"] = "nope"
            assert request("configuration", {"revision": 7, "configuration": bad_pinned}, cookie, csrf)[0] == 400
            too_many_cells = json.loads(json.dumps(configuration)); too_many_cells["activities"][0]["screen"]["cells"] = [{"deviceId": device_id, "command": "VolumeUp"}] * 33
            assert request("configuration", {"revision": 7, "configuration": too_many_cells}, cookie, csrf)[0] == 400
            # Each individual cell is within the per-field length limits and the array
            # is within the 32-cell cap, but 32 cells this large still serialize past
            # the runtime 7000-byte limit activities/run enforces - the whole-activity
            # size check must catch what the per-field/array checks alone would miss.
            oversized_cells = json.loads(json.dumps(configuration))
            oversized_cells["activities"][0]["screen"]["cells"] = [
                {"deviceId": "d" * 64, "command": "c" * 127, "label": "l" * 64} for _ in range(32)]
            assert len(json.dumps(oversized_cells["activities"][0])) > 7000
            assert request("configuration", {"revision": 7, "configuration": oversized_cells}, cookie, csrf)[0] == 400
            assert request("configuration", cookie=cookie)[1]["revision"] == 7
            # A full pinned row (plus legacy label/wide on cells) saves and round-trips.
            with_pinned = json.loads(json.dumps(configuration)); with_pinned["activities"][0]["screen"]["pinned"] = [pinned_cell] * 2
            with_pinned["activities"][0]["screen"]["cells"][0]["wide"] = True
            assert request("configuration", {"revision": 7, "configuration": with_pinned}, cookie, csrf)[0] == 200
            assert request("configuration", cookie=cookie)[1]["activities"][0]["screen"]["pinned"] == [pinned_cell] * 2
            assert request("commands/save", {"revision": 8, "deviceId": device_id, "oldName": "PowerOff", "name": "Off", "mode": "nec", "protocol": "2", "nec": "20DFA35C"}, cookie, csrf)[0] == 200
            assert request("devices", {"revision": 9, "deviceId": device_id, "action": "delete"}, cookie, csrf)[0] == 200
            assert request("devices", cookie=cookie)[1]["devices"] == []
            assert request("backups/restore", {"revision": 10, "backup": backup}, cookie, csrf)[0] == 200
            command = {"deviceId": "123", "command": "VolumeUp", "mode": "hold", "transport": "ir"}
            status, op, _ = request("commands/send", command, second, pending["csrf"])
            assert status == 202
            assert request("operations", {"id": op["id"], "action": "cancel"}, cookie, csrf)[0] == 200
            assert request("controllers", {"id": pending["id"], "action": "revoke"}, cookie, csrf)[0] == 200
            assert request("commands/send", command, second, pending["csrf"])[0] == 401
            coordinator = subprocess.Popen([binary, "--coordinator"], stdout=log, stderr=log, start_new_session=True)
            for _ in range(100):
                result = request("operations?id=" + op["id"], cookie=cookie)[1]
                if result["state"] == "cancelled": break
                time.sleep(.05)
            else: raise AssertionError("revoked operation did not cancel")
            # Roku over the network, against a fake that records what it is sent.
            seen = []
            apps_xml = [b'<apps><app id="12" type="appl" version="4.2">Netflix</app><app id="2285" type="appl" version="2.1">Hulu &amp; More</app>'
                        b'<app id="tvinput.hdmi1" type="tvin" version="1.0.0">HDMI 1</app><app id="bad id" type="appl" version="1">Spaced</app>'
                        b'<app id="13" type="appl" version="1">Quote "x"</app><app id="12" type="appl" version="9">Netflix again</app>'
                        b'<app id="20" type="appl" version="1"/><app id="21" type="appl" version="1">Caf&#233; &#x26; Bar</app></apps>']
            icons = {}   # channel id -> (status, body) for /query/icon/<id>
            class FakeRoku(http.server.BaseHTTPRequestHandler):
                def log_message(self, *args): pass
                def reply(self, status, body=b""):
                    self.send_response(status); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
                def do_GET(self):
                    seen.append(("GET", self.path))
                    if self.path == "/query/apps": return self.reply(200, apps_xml[0])
                    if self.path.startswith("/query/icon/"): return self.reply(*icons.get(self.path.rsplit("/", 1)[1], (404, b"")))
                    self.reply(200, b"<device-info><friendly-device-name>Fake Roku</friendly-device-name></device-info>" if self.path == "/query/device-info" else b"")
                def do_POST(self):
                    seen.append(("POST", self.path))
                    self.reply(403 if self.path in ("/keypress/Search", "/keypress/Lit_Z") else 404 if self.path == "/launch/404" else 200)
            fake = http.server.ThreadingHTTPServer(("127.0.0.1", roku_port), FakeRoku)
            threading.Thread(target=fake.serve_forever, daemon=True).start()
            def roku_config(devices):
                current = request("configuration", cookie=cookie)[1]
                current["networkDevices"] = devices
                return request("configuration", {"revision": current["revision"], "configuration": current}, cookie, csrf)[0]
            tv = {"id": "roku_tv", "name": "Living Room TV", "kind": "roku", "model": "tv", "host": "127.0.0.1"}
            box = {"id": "roku_box", "name": "Bedroom box", "kind": "roku", "model": "player", "host": "127.0.0.1"}
            for bad in ({**tv, "host": "8.8.8.8"}, {**tv, "host": "localhost"}, {**tv, "host": "10.0.0.1:80"}, {**tv, "host": "300.1.1.1"}, {**tv, "host": "010.1.2.3"},
                        {**tv, "model": "stick"}, {**tv, "kind": "other"}, {**tv, "name": ""}, {**tv, "id": "bad id"}):
                assert roku_config([bad]) == 400, bad
            assert roku_config([tv, dict(box, id="roku_tv")]) == 400, "duplicate ids"
            assert roku_config([dict(tv, id=f"r{i}") for i in range(9)]) == 400, "at most 8"
            assert roku_config([tv, box]) == 200
            assert request("network/devices")[0] == 401
            listed = {d["id"]: d for d in request("network/devices", cookie=cookie)[1]["devices"]}
            names = lambda d: [c["name"] for c in d["commands"]]
            assert set(listed) == {"roku_tv", "roku_box"} and "host" not in listed["roku_tv"]
            assert {"Volume up", "Power", "HDMI 1", "Home", "OK"} <= set(names(listed["roku_tv"]))
            assert "Home" in names(listed["roku_box"]) and not {"Volume up", "Power", "HDMI 1"} & set(names(listed["roku_box"])), "players have no TV commands"
            assert "Enter" not in names(listed["roku_tv"]) and len(set(names(listed["roku_tv"]))) == len(names(listed["roku_tv"]))
            def roku_send(device, command):
                status, op, _ = request("commands/send", {"deviceId": device, "command": command, "transport": "roku", "mode": "tap"}, cookie, csrf)
                assert status == 202, (status, op)
                for _ in range(100):
                    result = request("operations?id=" + op["id"], cookie=cookie)[1]
                    if result["state"] in ("completed", "failed", "cancelled"): return result
                    time.sleep(.05)
                raise AssertionError("Roku operation did not finish")
            result = roku_send("roku_tv", "Volume up")
            assert result["state"] == "completed" and ("POST", "/keypress/VolumeUp") in seen, result
            assert roku_send("roku_tv", "OK")["state"] == "completed" and ("POST", "/keypress/Select") in seen
            result = roku_send("roku_box", "Volume up")
            assert result["state"] == "failed" and "no such command" in result["result"]["error"], result
            result = roku_send("roku_tv", "DeviceInfo")
            assert result["state"] == "completed" and result["result"]["reply"] == "Fake Roku" and ("GET", "/query/device-info") in seen, result
            result = roku_send("roku_box", "Search")
            assert result["state"] == "failed" and "network control" in result["result"]["error"], result
            assert roku_send("roku_gone", "Home")["state"] == "failed"
            # Typing: one key press per character, in order; Backspace and Enter are keys too.
            def roku_type(device, text, expect=202):
                status, op, _ = request("commands/type", {"deviceId": device, "text": text}, cookie, csrf)
                assert status == expect, (status, op)
                if expect != 202: return None
                for _ in range(200):
                    result = request("operations?id=" + op["id"], cookie=cookie)[1]
                    if result["state"] in ("completed", "failed", "cancelled"): return result
                    time.sleep(.05)
                raise AssertionError("typing did not finish")
            assert request("commands/type", {"deviceId": "roku_tv", "text": "a"})[0] == 401
            assert request("network/devices", cookie=cookie)[1]["devices"][0]["keyboard"] is True
            for bad in ("", "tab\there", "cr\rhere", "del\x7fhere", "x" * 65, "c1\u0085here", "sep\u2028here"):
                roku_type("roku_tv", bad, 400)
            assert request("commands/type", {"deviceId": "bad id", "text": "a"}, cookie, csrf)[0] == 400
            assert request("commands/type", {"deviceId": "roku_tv"}, cookie, csrf)[0] == 400
            assert request("commands/type", cookie=cookie, csrf=csrf, raw='{"deviceId":"roku_tv","text":"ab\\u0000cd"}')[0] == 400, "an embedded NUL must not silently cut the text"
            del seen[:]
            result = roku_type("roku_tv", "Hi \u20ac!\b\n")
            assert result["state"] == "completed", result
            assert [p for m, p in seen if m == "POST"] == ["/keypress/Lit_H", "/keypress/Lit_i", "/keypress/Lit_%20", "/keypress/Lit_%E2%82%AC",
                                                           "/keypress/Lit_%21", "/keypress/Backspace", "/keypress/Enter"], seen
            # Characters that are special in a URL are percent-encoded.
            del seen[:]
            assert roku_type("roku_tv", "100% a+b/c?")["state"] == "completed"
            assert [p for m, p in seen] == ["/keypress/Lit_1", "/keypress/Lit_0", "/keypress/Lit_0", "/keypress/Lit_%25", "/keypress/Lit_%20", "/keypress/Lit_a",
                                           "/keypress/Lit_%2B", "/keypress/Lit_b", "/keypress/Lit_%2F", "/keypress/Lit_c", "/keypress/Lit_%3F"], seen
            # A key the Roku refuses stops the rest, and the result says how far it got.
            del seen[:]
            result = roku_type("roku_tv", "abZd")
            assert result["state"] == "failed" and result["result"]["error"].startswith("Typed 2 of 4 characters. The Roku refused a key"), result
            assert result["result"]["typed"] == 2 and result["result"]["total"] == 4
            assert [p for m, p in seen] == ["/keypress/Lit_a", "/keypress/Lit_b", "/keypress/Lit_Z"], seen
            # What was typed (a password, say) is not kept once the operation has ended.
            done = roku_type("roku_tv", "hunter2")
            assert done["state"] == "completed" and done["request"] == {"deviceId": "roku_tv", "characters": 7} and "hunter2" not in json.dumps(done), done
            assert "hunter2" not in json.dumps(result) and result["request"].get("characters") == 4, result
            del seen[:]
            assert roku_type("roku_box", "x" * 64)["state"] == "completed" and len(seen) == 64, "players can type too"
            result = roku_type("roku_gone", "a")
            assert result["state"] == "failed" and "no longer set up" in result["result"]["error"], result
            # Two requests in a row are typed in the order they were sent.
            del seen[:]
            first = request("commands/type", {"deviceId": "roku_tv", "text": "ab"}, cookie, csrf)[1]["id"]
            last = request("commands/type", {"deviceId": "roku_tv", "text": "cd"}, cookie, csrf)[1]["id"]
            for op_id in (first, last):
                for _ in range(200):
                    if request("operations?id=" + op_id, cookie=cookie)[1]["state"] == "completed": break
                    time.sleep(.05)
            assert [p for m, p in seen] == ["/keypress/Lit_a", "/keypress/Lit_b", "/keypress/Lit_c", "/keypress/Lit_d"], seen
            assert roku_config([tv, dict(box, host="127.0.0.2")]) == 200
            result = roku_send("roku_box", "Home")
            assert result["state"] == "failed" and "reach the Roku" in result["result"]["error"], result
            result = roku_type("roku_box", "abc")
            assert result["state"] == "failed" and result["result"]["error"].startswith("Typed 0 of 3 characters. Could not reach the Roku"), result
            # Favourite channels: saved on the Roku, listed as commands, launched by id.
            channels = [{"id": "12", "name": "Netflix"}, {"id": "2285", "name": "Hulu"}]
            assert roku_config([dict(tv, channels=channels), box]) == 200
            for bad in ("nope", {"id": "12"}, [{"id": "bad id", "name": "X"}], [{"id": "../x", "name": "X"}], [{"id": "", "name": "X"}], [{"id": "1", "name": ""}],
                        [{"id": "1", "name": " Lead"}], [{"id": "1", "name": "Trail "}], [{"id": "1", "name": 'Quo"te'}], [{"id": "1", "name": "x" * 41}],
                        [{"id": "1", "name": "Home"}], [{"id": "1", "name": "volume UP"}], [{"id": "1", "name": "ListApps"}], [{"id": "1", "name": "DeviceInfo"}],
                        [{"id": "1", "name": "Hulu"}, {"id": "2", "name": "hulu"}], [{"id": "1", "name": "A"}, {"id": "1", "name": "B"}],
                        [{"id": str(i), "name": f"C{i}"} for i in range(13)]):
                assert roku_config([dict(tv, channels=bad), box]) == 400, bad
            assert request("configuration", cookie=cookie)[1]["networkDevices"][0]["channels"] == channels, "a refused save changes nothing"
            listed = {d["id"]: d for d in request("network/devices", cookie=cookie)[1]["devices"]}
            assert names(listed["roku_tv"])[-2:] == ["Netflix", "Hulu"] and "Netflix" not in names(listed["roku_box"]), "favourites follow the built-in commands, per Roku"
            del seen[:]
            result = roku_send("roku_tv", "Netflix")
            assert result["state"] == "completed" and seen == [("POST", "/launch/12")], (result, seen)
            assert roku_send("roku_tv", "Hulu")["state"] == "completed" and seen[-1] == ("POST", "/launch/2285")
            result = roku_send("roku_box", "Netflix")
            assert result["state"] == "failed" and "no such command" in result["result"]["error"], "favourites belong to one Roku"
            assert roku_config([dict(tv, channels=[{"id": "404", "name": "Gone"}]), box]) == 200
            result = roku_send("roku_tv", "Gone")
            assert result["state"] == "failed" and "still installed" in result["result"]["error"], result
            # Asking the Roku what is installed: real channels only, tidy names, no repeats.
            result = roku_send("roku_tv", "ListApps")
            assert result["state"] == "completed" and result["result"]["reply"] == "3 channels", result
            assert result["result"]["apps"] == [{"id": "12", "name": "Netflix"}, {"id": "2285", "name": "Hulu & More"}, {"id": "21", "name": "Caf\u00e9 & Bar"}], result["result"]["apps"]
            assert result["result"]["skipped"] == 2, "an unusable id and a name with a quote are counted, not silently lost"
            # A self-closing <app/> has no name and must not swallow the app after it.
            apps_xml[0] = b'<apps><app id="1" type="appl" version="1"/><app id="2" type="appl" version="1">Two</app></apps>'
            assert roku_send("roku_tv", "ListApps")["result"]["apps"] == [{"id": "2", "name": "Two"}]
            apps_xml[0] = b'<apps><app id="1" type="appl" version="1">Un<app id="2" type="appl" version="1">Two</app></apps>'
            assert roku_send("roku_tv", "ListApps")["result"]["apps"] == [{"id": "2", "name": "Two"}], "a broken tag is not read into the next one"
            apps_xml[0] = ("<apps>" + "".join(f'<app id="{1000 + i}" type="appl" version="1">Channel {i}</app>' for i in range(60)) + "</apps>").encode()
            result = roku_send("roku_tv", "ListApps")
            assert result["state"] == "completed" and len(result["result"]["apps"]) == 40, "at most 40, and the result still fits the operation record"
            assert roku_config([tv, box]) == 200
            assert roku_send("roku_tv", "Netflix")["state"] == "failed", "removing the favourite removes the command"
            # A Roku command can be an activity step; an unknown transport still cannot.
            current = request("configuration", cookie=cookie)[1]
            current["activities"] = [{"id": "watch", "name": "Watch", "steps": [{"deviceId": "roku_tv", "command": "Home", "transport": "roku"}], "exitSteps": []}]
            assert request("configuration", {"revision": current["revision"], "configuration": current}, cookie, csrf)[0] == 200
            # An activity may name the device whose keyboard the remote types into.
            for keyboard, expected in (({"deviceId": "roku_tv"}, 200), ("roku_tv", 400), ({}, 400), ({"deviceId": ""}, 400), ({"deviceId": "Living Room"}, 400), ({"deviceId": "x" * 65}, 400)):
                current = request("configuration", cookie=cookie)[1]; current["activities"][0]["keyboard"] = keyboard
                assert request("configuration", {"revision": current["revision"], "configuration": current}, cookie, csrf)[0] == expected, keyboard
            assert request("configuration", cookie=cookie)[1]["activities"][0]["keyboard"] == {"deviceId": "roku_tv"}
            current = request("configuration", cookie=cookie)[1]
            current["activities"][0]["steps"][0]["transport"] = "carrier-pigeon"
            assert request("configuration", {"revision": current["revision"], "configuration": current}, cookie, csrf)[0] == 400
            current = request("configuration", cookie=cookie)[1]; current["activities"] = []
            assert request("configuration", {"revision": current["revision"], "configuration": current}, cookie, csrf)[0] == 200
            # Channel icons: fetched from the Roku once, kept on the hub, served from the hub's own address.
            def raw_get(path, cookie=""):
                conn = http.client.HTTPConnection("127.0.0.1", port, timeout=30)
                conn.request("GET", path, headers={"Host": f"127.0.0.1:{port}", "Cookie": cookie})
                response = conn.getresponse(); body = response.read(); headers = dict(response.getheaders()); status = response.status; conn.close()
                return status, headers, body
            png = b"\x89PNG\r\n\x1a\n" + bytes(range(256)) + b"\x00\x00end"
            jpg = b"\xff\xd8\xff\xe0" + bytes(range(256)) + b"\x00tail"
            icons.update({"12": (200, png), "2285": (200, jpg), "13": (200, b"<html>not a picture</html>"), "14": (200, png + b"x" * 200000)})
            favorites = [{"id": i, "name": n} for i, n in (("12", "Netflix"), ("2285", "Hulu"), ("13", "Fake"), ("14", "Huge"), ("15", "Offline"))]
            assert roku_config([dict(tv, channels=favorites), box]) == 200
            commands = {c["name"]: c for c in request("network/devices", cookie=cookie)[1]["devices"][0]["commands"]}
            assert commands["Netflix"]["channel"] == "12" and "channel" not in commands["Home"], "channel commands carry the id the page asks for"
            icon_dir = local / "roku-icons"; before = len([x for x in seen if x[1].startswith("/query/icon/")])
            assert raw_get("/api/v1/roku/icon?deviceId=roku_tv&id=12")[0] == 401, "a paired controller is needed"
            status, headers, body = raw_get("/api/v1/roku/icon?deviceId=roku_tv&id=12", cookie)
            assert status == 200 and body == png and headers["Content-Type"] == "image/png" and headers["Content-Length"] == str(len(png)), (status, headers)
            assert headers["X-Content-Type-Options"] == "nosniff" and "max-age" in headers["Cache-Control"]
            status, headers, body = raw_get("/api/v1/roku/icon?deviceId=roku_tv&id=2285", cookie)
            assert status == 200 and body == jpg and headers["Content-Type"] == "image/jpeg"
            icons["12"] = (404, b"")   # the Roku is now off or has changed its mind: the kept copy answers
            assert raw_get("/api/v1/roku/icon?deviceId=roku_tv&id=12", cookie)[2] == png
            assert len([x for x in seen if x[1].startswith("/query/icon/")]) - before == 2, "one fetch per channel, the second request came from the hub"
            for query, expect in (("deviceId=roku_tv&id=99", 404), ("deviceId=nobody&id=12", 404), ("deviceId=roku_box&id=12", 404), ("deviceId=roku_tv&id=..%2Fx", 400),
                                  ("deviceId=roku_tv", 400), ("id=12", 400), ("deviceId=bad%2Fid&id=12", 400)):
                assert raw_get("/api/v1/roku/icon?" + query, cookie)[0] == expect, query
            assert raw_get("/api/v1/roku/icon?deviceId=roku_tv&id=13", cookie)[0] == 404, "a reply that is not a picture is not kept or served"
            assert raw_get("/api/v1/roku/icon?deviceId=roku_tv&id=14", cookie)[0] == 404, "a picture over the size limit is refused"
            assert raw_get("/api/v1/roku/icon?deviceId=roku_tv&id=15", cookie)[0] == 404, "a Roku with no such icon and no kept copy"
            assert sorted(x.name for x in icon_dir.iterdir()) == ["roku_tv-12.img", "roku_tv-2285.img"], "only good pictures are kept"
            # A copy older than a week is fetched again, but a stale one still answers when the Roku does not.
            old = time.time() - 8 * 24 * 3600
            os.utime(icon_dir / "roku_tv-12.img", (old, old))
            assert raw_get("/api/v1/roku/icon?deviceId=roku_tv&id=12", cookie)[2] == png, "stale copy served while the Roku says no"
            png2 = b"\x89PNG\r\n\x1a\n" + b"\x00new picture"
            icons["12"] = (200, png2)
            assert raw_get("/api/v1/roku/icon?deviceId=roku_tv&id=12", cookie)[2] == png2 and (icon_dir / "roku_tv-12.img").read_bytes() == png2, "refreshed"
            # The kept pictures never grow without bound: the oldest go first.
            for i in range(60):
                path = icon_dir / f"filler-{i}.img"; path.write_bytes(png); os.utime(path, (old - i, old - i))
            icons["2285"] = (200, jpg); os.utime(icon_dir / "roku_tv-2285.img", (old, old))
            assert raw_get("/api/v1/roku/icon?deviceId=roku_tv&id=2285", cookie)[2] == jpg
            kept = sorted(x.name for x in icon_dir.iterdir())
            assert len(kept) == 48 and "roku_tv-12.img" in kept and "roku_tv-2285.img" in kept, len(kept)
            assert "filler-0.img" in kept and "filler-59.img" not in kept and sum(n.startswith("filler-") for n in kept) == 46, "the oldest pictures were the ones removed"
            print("Roku icons: fetched once and kept, served as the right type, refused when not a picture or too big, refreshed after a week, bounded in number, and only for saved favorites passed")
            assert roku_config([]) == 200 and request("network/devices", cookie=cookie)[1]["devices"] == []
            fake.shutdown()
            print("Roku: validation, private-address rule, command catalog, key sends, test query, refusals and activity steps passed")
            # Wi-Fi status: the network the hub is on, read from wpa_supplicant's own output; owner only.
            assert request("network/status")[0] == 401
            status, net, _ = request("network/status", cookie=cookie)
            assert status == 200 and net["available"] is False and (net["ssid"], net["state"], net["ip"]) == ("", "", ""), net
            (base / "wpa-status.txt").write_text("bssid=aa:bb:cc:dd:ee:ff\nssid=Home WiFi\nid=0\nwpa_state=COMPLETED\nip_address=192.168.1.50\n")
            net = request("network/status", cookie=cookie)[1]
            assert (net["available"], net["ssid"], net["state"], net["ip"]) == (True, "Home WiFi", "COMPLETED", "192.168.1.50"), net
            (base / "wpa-status.txt").write_bytes(b"ssid=Caf\xc3\xa9\x01\"x\nwpa_state=ASSOCIATING\n")
            net = request("network/status", cookie=cookie)[1]
            assert (net["available"], net["state"], net["ip"]) == (True, "ASSOCIATING", "") and net["ssid"] == 'Caf???"x', net
            (base / "wpa-status.txt").write_text("")
            assert request("network/status", cookie=cookie)[1]["available"] is False
            print("Wi-Fi status: owner only, the connected network and address, odd bytes made safe, nothing reported when wpa_cli says nothing passed")
            # Valid signature accepted; changed signature/platform/manifest rejected before staging.
            from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
            from cryptography.hazmat.primitives import serialization
            key = Ed25519PrivateKey.generate()
            (local / "release.pub").write_text(key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw).hex())
            names = ["codex_webui", "codex_hbus", "codex_hal_ltcp", "codex_bthid_keyboard", "codex_portal", "localcore.lua", "codexmqtt.lua", "index.html", "app.css", "app.js", "icons.svg", "profiles.js", "go.html", "go.css", "go.js", "init.sh", "maintenance.sh", "migrations.json"]
            manifest = json.dumps({"schemaVersion": 1, "platform": "pimento-4.15.600", "version": "test-1", "files": [{"name": n, "size": 1, "sha512": hashlib.sha512(b"x").hexdigest()} for n in names]}, separators=(",", ":"))
            signature = key.sign(manifest.encode()).hex()
            assert request("updates/begin", {"manifest": manifest, "signature": "00" * 64}, cookie, csrf)[0] == 403
            assert request("updates/begin", {"manifest": manifest + " ", "signature": signature}, cookie, csrf)[0] == 403
            assert request("updates/begin", {"manifest": manifest, "signature": signature}, cookie, csrf)[0] == 200
            assert request("updates/chunk", {"name": "../../escape", "offset": 0, "hex": "78"}, cookie, csrf)[0] == 400
            assert request("updates/chunk", {"name": "app.js", "offset": 5, "hex": "78"}, cookie, csrf)[0] == 409
            assert request("updates/apply", {}, cookie, csrf)[0] == 403
            contents = {name: b"signed test asset" for name in names}
            contents["migrations.json"] = b'{"from":1,"to":1,"version":"test-2"}'
            release = json.dumps({"schemaVersion": 1, "platform": "pimento-4.15.600", "version": "test-2", "files": [{"name": n, "size": len(raw), "sha512": hashlib.sha512(raw).hexdigest()} for n, raw in contents.items()]}, separators=(",", ":"))
            assert request("updates/begin", {"manifest": release, "signature": key.sign(release.encode()).hex()}, cookie, csrf)[0] == 200
            installed = {}
            # Before anything is installed the hub reports no version (and only the owner may ask).
            assert request("updates/status")[0] == 401
            assert request("updates/status", cookie=cookie)[1] == {"ok": True, "version": "", "pending": False, "result": ""}
            for name, raw in contents.items():
                assert request("updates/chunk", {"name": name, "offset": 0, "hex": raw.hex()}, cookie, csrf)[0] == 200
                path = defs["CODEX_BIN_DIR"] / name if name.startswith("codex_") and name != "codexmqtt.lua" else www / name if name in ["index.html", "app.css", "app.js", "icons.svg", "profiles.js", "go.html", "go.css", "go.js"] else local / name if name == "migrations.json" else base / name
                path.parent.mkdir(exist_ok=True); path.write_bytes(b"previous version")
                installed[path] = b"previous version"
            (defs["LOCAL_UPDATE_STAGE"] / "app.js").write_bytes(b"tampered")
            assert request("updates/apply", {}, cookie, csrf)[0] == 403
            (defs["LOCAL_UPDATE_STAGE"] / "app.js").write_bytes(contents["app.js"])
            assert request("updates/apply", {}, cookie, csrf)[0] == 200
            assert all(path.read_bytes() != raw for path, raw in installed.items())
            # The version rides in the installed migrations.json, so it is what is running, and it is
            # pending until the startup health check passes.
            assert request("updates/status", cookie=cookie)[1] == {"ok": True, "version": "test-2", "pending": True, "result": ""}
            subprocess.run([binary, "--rollback"], check=True)
            assert all(path.read_bytes() == raw for path, raw in installed.items())
            assert not (local / "update.pending").exists()
            # A rollback takes the version back with the rest of the release and says why.
            assert request("updates/status", cookie=cookie)[1] == {"ok": True, "version": "", "pending": False, "result": "Rolled back after a failed health check"}
            # An unprintable or over-long version in a bad file is not echoed.
            (local / "migrations.json").write_text('{"from":1,"to":1,"version":"' + "x" * 40 + '"}')
            assert request("updates/status", cookie=cookie)[1]["version"] == ""
            (local / "update.result").write_text("Release passed startup health checks\n")
            assert request("updates/status", cookie=cookie)[1]["result"] == "Release passed startup health checks"
            (local / "migrations.json").write_bytes(contents["migrations.json"]); (local / "update.result").unlink()
            assert request("updates/status", cookie=cookie)[1]["version"] == "test-2"
            (local / "migrations.json").write_bytes(b"previous version")
            # The computer-side installer drives the same API: a bad signature is refused with the hub's own
            # words, and a good bundle is staged, verified and activated.
            hub = push_release.Hub("127.0.0.1", port, cookie.split("=", 1)[1], csrf)
            bundle_file = base / "pushed.json"
            bundle_file.write_text(json.dumps({"manifest": release, "signature": key.sign(release.encode()).hex(),
                                               "files": {n: base64.b64encode(raw).decode() for n, raw in contents.items()}}))
            parsed, parsed_manifest = push_release.load_release(bundle_file)
            try:
                push_release.upload(hub, {**parsed, "signature": "00" * 64}, parsed_manifest, say=quiet)
            except push_release.HubError as error:
                assert "signature" in str(error).lower(), error
            else:
                raise AssertionError("a bad signature must be refused")
            push_release.upload(hub, parsed, parsed_manifest, say=quiet)
            assert hub.call("updates/status") == {"ok": True, "version": "test-2", "pending": True, "result": ""}
            assert all(path.read_bytes() != raw for path, raw in installed.items())
            subprocess.run([binary, "--rollback"], check=True)
            assert hub.call("updates/status")["version"] == "" and all(path.read_bytes() == raw for path, raw in installed.items())
            print("push_release upload: refused a bad signature, staged and activated a signed bundle, rolled back cleanly passed")
            # The hub's display name is optional, short and printable.
            named = request("configuration", cookie=cookie)[1]
            for bad in (7, "x" * 41, "tab\there", 'quote"d'):
                broken_name = dict(named); broken_name["hubName"] = bad
                assert request("configuration", {"revision": named["revision"], "configuration": broken_name}, cookie, csrf)[0] == 400, bad
            named["hubName"] = "Living Room"
            assert request("configuration", {"revision": named["revision"], "configuration": named}, cookie, csrf)[0] == 200
            assert request("configuration", cookie=cookie)[1]["hubName"] == "Living Room"
            # Duplicate framing, embedded NUL and oversize requests are bounded.
            for headers, body in [("Content-Length: 2\r\nContent-Length: 2\r\n", b"{}"), ("Content-Length: 3\r\n", b"{\0}"), ("Transfer-Encoding: chunked\r\n", b"0\r\n\r\n")]:
                with socket.create_connection(("127.0.0.1", port)) as sock:
                    sock.sendall((f"POST /api/v1/setup HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n" + headers + "\r\n").encode() + body)
                    assert not sock.recv(1024)
            with socket.create_connection(("127.0.0.1", port)) as sock:
                sock.sendall((f"POST /api/v1/setup HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Length: 524289\r\n\r\n").encode())
                assert b"413 Payload Too Large" in sock.recv(4096)
            # Simulate a crash after native files changed but before transaction commit.
            journal = local / "transaction"
            for i, path in enumerate([local / "config.json", resources / "DeviceList.json", resources / "FunctionList.json", resources / "ProtocolList.json", resources / "bt-devices.json", resources / "ActivityList.json", resources / "MapList.json"]):
                if path.exists(): (journal / str(i)).write_bytes(path.read_bytes())
                else: (journal / (str(i) + ".absent")).write_text("")
            (journal / "pending").write_text("1")
            (resources / "DeviceList.json").write_text("broken")
            subprocess.run([binary, "--internal-key"], check=True)
            assert json.loads((resources / "DeviceList.json").read_text()) == fixtures["DeviceList"]
            assert not (journal / "pending").exists()
            check_resources(request, cookie, csrf, resources)
            print("Local API: pairing, approval/revocation, ownership, origin/CSRF, revisions, backups, cancellation, signature/framing validation and crash recovery passed")
        finally:
            for process in (coordinator, server):
                if process:
                    os.killpg(process.pid, signal.SIGTERM); process.wait(timeout=5)
            log.close()
            os.close(button_fd)


if __name__ == "__main__":
    run()
