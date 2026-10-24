"""Checks push_release.py without a hub: pairing and saved credentials, waiting for the restart and
the health check (down, back, pending, done, rolled back, never back), reading and downloading
bundles, and the command line. Talking to a real backend is covered in test_local_api.py."""
import base64
import contextlib
import hashlib
import io
import json
import os
import stat
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import push_release as pr


class Clock:
    """Time that only moves when something sleeps, so waits cost nothing."""
    def __init__(self): self.t = 0.0
    def now(self): return self.t
    def sleep(self, seconds): self.t += seconds


class FakeHub:
    """Answers like a hub going through an update: `script` is what each poll of 'session' does."""
    def __init__(self, session_script, statuses=(), role="owner"):
        self.ip, self.port, self.token, self.csrf = "10.0.0.5", 8080, "", ""
        self.session_script = list(session_script); self.statuses = list(statuses); self.role = role
        self.calls = []
    def request(self, path, body=None, timeout=15):
        self.calls.append((path, body))
        if path == "session":
            step = self.session_script.pop(0) if len(self.session_script) > 1 else self.session_script[0]
            if step == "down": raise ConnectionRefusedError("down")
            return 200, {"role": self.role if step == "up" else step}, ""
        if path == "controllers/request": return 200, {"csrf": "csrf-1", "role": "pending"}, "harmony=tok-1; Path=/"
        if path == "controllers/claim": return 200, {"csrf": "csrf-2"}, "harmony=tok-2; Path=/"
        raise AssertionError(path)
    def call(self, path, body=None, timeout=15):
        self.calls.append((path, body))
        if path == "updates/status":
            status = self.statuses.pop(0) if len(self.statuses) > 1 else self.statuses[0]
            if isinstance(status, Exception): raise status
            return status
        return {"ok": True}


def quiet(): return lambda *_a, **_k: None


# ---- waiting for the hub ----
def wait(hub, version="0.2.0", **limits):
    clock = Clock()
    return pr.wait_for_hub(hub, version, say=quiet(), sleep=clock.sleep, now=clock.now, **limits)

ok = {"version": "0.2.0", "pending": False, "result": "Release passed startup health checks"}
pending = {"version": "0.2.0", "pending": True, "result": ""}
assert wait(FakeHub(["up", "up", "down", "down", "up"], [pending, pending, ok])) == ("ok", "0.2.0", "Release passed startup health checks")
rolled = {"version": "0.1.0", "pending": False, "result": "Rolled back after a failed health check"}
assert wait(FakeHub(["up", "down", "up"], [pending, rolled]))[0] == "rolled-back"
assert wait(FakeHub(["up", "down", "up"], [{"version": "0.1.5", "pending": False, "result": ""}]))[0] == "unclear", "an unexpected version is reported, not assumed good"
# A hub that never went down (or came back before the first look) but is already finished is fine.
assert wait(FakeHub(["up"], [ok]), down_for=5)[0] == "ok"
# A status request that fails while the hub is still starting is retried.
assert wait(FakeHub(["up", "down", "up"], [pr.HubError("not ready"), ConnectionResetError(), ok]))[0] == "ok"
for hub, limits, words in ((FakeHub(["up", "down"], [ok]), {"up_within": 120}, "has not come back"),
                           (FakeHub(["up", "down", "up"], [pending]), {"check_within": 60}, "health check has not finished")):
    try:
        wait(hub, **limits)
    except pr.HubError as error:
        assert words in str(error), error
    else:
        raise AssertionError("expected a timeout: " + words)

# ---- pairing and saved credentials ----
with tempfile.TemporaryDirectory() as directory:
    state = Path(directory) / "config"
    hub = FakeHub(["pending", "pending", "up"])
    clock, said = Clock(), []
    pr.pair(hub, say=said.append, sleep=clock.sleep, now=clock.now)
    assert (hub.token, hub.csrf) == ("tok-1", "csrf-1") and "Pair button" in said[0]
    hub = FakeHub(["pending"]); clock = Clock()
    try:
        pr.pair(hub, wait=5, say=quiet(), sleep=clock.sleep, now=clock.now)
    except pr.HubError as error:
        assert "not pressed in time" in str(error)
    else:
        raise AssertionError("pairing without a press should time out")
    # One dropped answer while waiting for the button does not end pairing.
    hub = FakeHub(["pending", "down", "up"]); clock = Clock()
    pr.pair(hub, say=quiet(), sleep=clock.sleep, now=clock.now); assert (hub.token, hub.csrf) == ("tok-1", "csrf-1")
    # A claim code works for a hub with no owner, and a phone-only (control) pairing is not enough.
    hub = FakeHub(["up"]); pr.claim(hub, "123456"); assert (hub.token, hub.csrf) == ("tok-2", "csrf-2")
    path = pr.credentials_path("10.0.0.5", 8080, state)
    pr.save_credentials(path, "tok-1", "csrf-1")
    assert stat.S_IMODE(path.stat().st_mode) == 0o600 and json.loads(path.read_text()) == {"token": "tok-1", "csrf": "csrf-1"}
    path.chmod(0o644); pr.save_credentials(path, "tok-9", "csrf-9"); assert stat.S_IMODE(path.stat().st_mode) == 0o600, "rewritten files are private again"
    assert path.name == "owner-10.0.0.5-8080.json" and path.parent == state

# ---- reading a bundle ----
with tempfile.TemporaryDirectory() as directory:
    d = Path(directory)
    raw = b"hello"
    manifest = json.dumps({"version": "0.2.0", "files": [{"name": "a", "size": 5, "sha512": hashlib.sha512(raw).hexdigest()}]}, separators=(",", ":"))
    good = {"manifest": manifest, "signature": "00", "files": {"a": base64.b64encode(raw).decode()}}
    (d / "good.json").write_text(json.dumps(good))
    release, parsed = pr.load_release(d / "good.json")
    assert parsed["version"] == "0.2.0" and release["signature"] == "00"
    bad = (("no-sig.json", json.dumps({"manifest": manifest, "files": {}}), "damaged manifest"),
           ("missing.json", json.dumps({**good, "files": {}}), "missing files"),
           ("junk.json", "not json", "not JSON"),
           ("truncated.json", json.dumps(good)[:40], "not JSON"),
           ("list.json", "[]", "damaged manifest"),
           ("null-files.json", json.dumps({**good, "files": None}), "damaged manifest"),
           ("no-files-key.json", json.dumps({**good, "manifest": json.dumps({"version": "1"})}), "damaged manifest"),
           ("no-version.json", json.dumps({**good, "manifest": json.dumps({"files": []})}), "damaged manifest"),
           ("bad-entry.json", json.dumps({**good, "manifest": json.dumps({"version": "1", "files": [None]})}), "damaged manifest"),
           ("manifest-null.json", json.dumps({**good, "manifest": "null"}), "damaged manifest"))
    for name, text, words in bad:
        (d / name).write_text(text)
        try:
            pr.load_release(d / name)
        except pr.HubError as error:   # a clean message, never a traceback
            assert words in str(error), (name, str(error))
        else:
            raise AssertionError(name)
    try:
        pr.load_release(d / "does-not-exist.json")
    except pr.HubError as error:
        assert "Can't read" in str(error) and "lost contact" not in str(error)
    else:
        raise AssertionError("a missing file is explained")
    # A damaged file in a bundle is refused before anything is sent.
    hub = FakeHub(["up"])
    try:
        pr.upload(hub, {**good, "files": {"a": "***"}}, json.loads(manifest), say=quiet())
    except pr.HubError as error:
        assert "damaged" in str(error) and hub.calls == [], "nothing is sent for a damaged bundle"
    else:
        raise AssertionError("damaged base64")
    # The upload sends exactly the signed bytes, in order, in chunks the hub accepts.
    big = bytes(range(256)) * 100   # 25,600 bytes: four chunks (three full, one partial)
    manifest = json.dumps({"version": "0.2.0", "files": [{"name": "big", "size": len(big), "sha512": hashlib.sha512(big).hexdigest()}, {"name": "a", "size": 5, "sha512": ""}]})
    release = {"manifest": manifest, "signature": "ab", "files": {"big": base64.b64encode(big).decode(), "a": base64.b64encode(raw).decode()}}
    hub = FakeHub(["up"]); pr.upload(hub, release, json.loads(manifest), say=quiet())
    paths = [c[0] for c in hub.calls]
    assert paths == ["updates/begin"] + ["updates/chunk"] * 5 + ["updates/apply"], paths
    assert hub.calls[0][1] == {"manifest": manifest, "signature": "ab"}
    sent = [c[1] for c in hub.calls if c[0] == "updates/chunk"]
    assert [(c["name"], c["offset"]) for c in sent] == [("big", 0), ("big", 8192), ("big", 16384), ("big", 24576), ("a", 0)]
    assert all(len(c["hex"]) <= 32768 and len(c["hex"]) % 2 == 0 for c in sent)
    assert bytes.fromhex("".join(c["hex"] for c in sent if c["name"] == "big")) == big

    # ---- downloading with a fake gh ----
    bin_dir = d / "bin"; bin_dir.mkdir()
    payload = json.dumps(good).encode()
    gh = bin_dir / "gh"
    gh.write_text(f"""#!/bin/sh
dir=""; while [ $# -gt 0 ]; do [ "$1" = "--dir" ] && dir="$2"; shift; done
printf '%s' '{payload.decode()}' > "$dir/hub-release-0.2.0.json"
echo "$GH_CHECKSUM  hub-release-0.2.0.json" > "$dir/hub-release-0.2.0.json.sha256"
""")
    gh.chmod(0o755)
    old = os.environ.copy()
    try:
        os.environ["PATH"] = f"{bin_dir}:{old['PATH']}"
        os.environ["GH_CHECKSUM"] = hashlib.sha256(payload).hexdigest()
        assert pr.download_release("v0.2.0", say=quiet()).name == "hub-release-0.2.0.json"
        os.environ["GH_CHECKSUM"] = "0" * 64
        try:
            pr.download_release("", say=quiet())
        except pr.HubError as error:
            assert "does not match its published checksum" in str(error)
        else:
            raise AssertionError("a bundle with the wrong checksum must not be used")
        os.environ["PATH"] = str(d / "nothing-here")   # no gh anywhere: must not fall through to a real one
        gh.rename(d / "gh-moved")
        try:
            pr.download_release("", say=quiet())
        except pr.HubError as error:
            assert "GitHub CLI" in str(error)
        else:
            raise AssertionError("a missing gh should be explained")
    finally:
        os.environ.clear(); os.environ.update(old)

# ---- the command line ----
out, err = io.StringIO(), io.StringIO()
with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
    try:
        pr.main(["--hub", "10.0.0.5"])
    except SystemExit as exit:
        assert exit.code == 2, "a source (--bundle, --latest or --tag) is required"
print("push_release: waiting for the restart and health check, pairing, saved credentials, the upload, downloading and the command line passed")
