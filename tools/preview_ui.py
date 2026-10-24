"""Disposable browser fixture: memory-only setup, no hub connection or IR output."""
import argparse
import json
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1] / "payload/www"
configuration = {"schemaVersion": 1, "revision": 1, "setupMode": "keep", "layouts": {}, "deviceSetup": {}, "activities": [
    {"id": "watch", "name": "Watch TV", "steps": [{"deviceId": "1", "command": "PowerOn", "transport": "ir"}], "exitSteps": [{"deviceId": "1", "command": "PowerOff", "transport": "ir"}],
     # Deliberately scrambled so the remote view has to find the dpad cross.
     "screen": {"columns": 4, "cells": [{"deviceId": "1", "command": c} for c in ["Right", "Back", "Up", "Input", "OK", "Mute", "Down", "HDMI 1", "Left"]],
                "pinned": [{"deviceId": "1", "command": c} for c in ["Home", "Rewind", "Play", "FastForward"]]}},
    {"id": "music", "name": "Listen to Music", "steps": [{"deviceId": "2", "command": "PowerOn", "transport": "ir"}], "exitSteps": []}]}
devices = [{"id": "1", "name": "LG C5", "manufacturer": "LG", "model": "C5", "type": "Television",
            "commands": [{"name": name} for name in ["PowerOn", "PowerOff", "VolumeUp", "VolumeDown", "Mute", "Up", "Down", "Left", "Right", "OK",
                                                      "Back", "Input", "Home", "Rewind", "Play", "FastForward", "HDMI 1"]]},
           {"id": "2", "name": "Receiver", "manufacturer": "Denon", "model": "X", "type": "Audio",
            "commands": [{"name": name} for name in ["PowerOn", "PowerOff", "VolumeUp", "VolumeDown", "Mute"]]}]


ROKU_COMMANDS = ["Home", "Back", "Up", "Down", "Left", "Right", "OK", "Menu", "Replay", "Rewind", "Play", "Fast forward", "Search"]
ROKU_TV_COMMANDS = ["Power", "Power on", "Power off", "Volume up", "Volume down", "Mute", "Channel up", "Channel down", "TV tuner", "HDMI 1", "HDMI 2", "HDMI 3", "HDMI 4", "AV"]


FIXTURE_APPS = [{"id": "12", "name": "Netflix"}, {"id": "2285", "name": "Hulu"}, {"id": "13535", "name": "Plex"}, {"id": "837", "name": "YouTube"},
                {"id": "291097", "name": "Disney Plus"}, {"id": "31440", "name": "Home"}]


def network_devices():
    """Rokus saved in the fixture's configuration, in the shape the hub lists them (no address)."""
    return [{"id": d["id"], "name": d["name"], "type": "Roku", "model": d["model"], "keyboard": True,
             "commands": [{"name": n} for n in ROKU_COMMANDS + (ROKU_TV_COMMANDS if d["model"] == "tv" else []) + [c["name"] for c in d.get("channels", [])]]}
            for d in configuration.get("networkDevices", [])]


installed = {"version": "0.1.0", "result": ""}


class Preview(BaseHTTPRequestHandler):
    def reply(self, value, status=200):
        body = json.dumps(value).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urlsplit(self.path).path
        responses = {"/api/v1/updates/status": {"ok": True, "version": installed["version"], "pending": False, "result": installed["result"]},
                     "/api/v1/session": {"role": "owner", "id": "fixture", "csrf": "fixture"},
                     "/api/v1/configuration": configuration, "/api/v1/devices": {"devices": devices},
                     "/api/v1/bluetooth/devices": {"devices": []}, "/api/v1/network/devices": {"devices": network_devices()},
                     "/api/v1/operations": {"state": "completed", "result": {"ok": True, "reply": "Fixture Roku", "apps": FIXTURE_APPS}}}
        if path in responses:
            return self.reply(responses[path])
        name = {"/": "index.html", "/go": "go.html", "/go/": "go.html"}.get(path) or (path[4:] if path.startswith("/go/") else path[1:])
        if name not in {"index.html", "app.js", "app.css", "profiles.js", "icons.svg", "go.html", "go.js", "go.css"}:
            return self.reply({"error": "Fixture route not implemented"}, 404)
        body = (ROOT / name).read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", {".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml"}[Path(name).suffix])
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        if not 0 < length <= 512000:
            return self.reply({"error": "Invalid request size"}, 400)
        body = json.loads(self.rfile.read(length))
        if self.path == "/api/v1/commands/send":
            sys.stderr.write("SENT %s\n" % json.dumps(body, sort_keys=True))  # so a run can show what was pressed
            return self.reply({"id": "fixture-no-transmission"})
        if self.path == "/api/v1/commands/type":
            sys.stderr.write("TYPED %r\n" % body.get("text"))  # so a run can show what the UI sent
            return self.reply({"id": "fixture-typed"}, 202)
        if self.path.startswith("/api/v1/updates/"):  # an update is accepted and "installed" without touching anything
            if self.path.endswith("/begin"):
                installed["next"] = json.loads(body.get("manifest", "{}")).get("version", "")
            if self.path.endswith("/apply"):
                installed.update(version=installed.get("next", installed["version"]), result="Release passed startup health checks (fixture)")
            return self.reply({"ok": True})
        if self.path == "/api/v1/activities/run":
            return self.reply({"id": "fixture-activity", "state": "completed"}, 202)
        if body.get("revision") != configuration["revision"]:
            return self.reply({"error": "Configuration changed in another browser. Reload before saving."}, 409)
        if self.path == "/api/v1/devices" and body.get("action") == "create-profile":
            device_id = str(max(int(d["id"]) for d in devices) + 1)
            devices.append(dict(id=device_id, **{k: body[k] for k in ("name", "manufacturer", "model", "type")},
                                commands=[{"name": row.split("|")[0]} for row in body["payload"].splitlines()]))
            configuration["layouts"][device_id] = body["layout"]
            configuration["deviceSetup"][device_id] = {"status": "untested", "source": body["source"], "testedCommand": ""}
            configuration["revision"] += 1
            return self.reply({"ok": True, "deviceId": device_id})
        if self.path == "/api/v1/configuration":
            configuration.update(body["configuration"])
            configuration["revision"] += 1
            return self.reply({"ok": True})
        self.reply({"error": "Fixture action not implemented"}, 400)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8097)
    parser.add_argument("--host", default="127.0.0.1",
                         help="Bind address. Anything other than 127.0.0.1 requires --allow-lan, "
                              "since it exposes this unauthenticated fixture (every request is "
                              "treated as the owner, no login) to your whole network.")
    parser.add_argument("--allow-lan", action="store_true",
                         help="Required to use --host with anything other than 127.0.0.1/localhost. "
                              "Only pass this on a trusted LAN, for a real device/emulator to reach "
                              "this fixture, and stop it when you're done.")
    args = parser.parse_args()
    if args.host not in ("127.0.0.1", "localhost") and not args.allow_lan:
        parser.error(f"binding to {args.host} exposes this unauthenticated fixture to your "
                      f"network - pass --allow-lan to confirm that's intended.")
    print(f"Memory-only UI fixture: http://{args.host}:{args.port}/", flush=True)
    HTTPServer((args.host, args.port), Preview).serve_forever()
