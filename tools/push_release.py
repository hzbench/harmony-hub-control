#!/usr/bin/env python3
"""Install a signed release on a hub from this computer.

    python3 tools/push_release.py --hub 192.168.1.50 --latest
    python3 tools/push_release.py --hub 192.168.1.50 --bundle hub-release-0.2.0.json

It does what Setup > Software update does: uploads the bundle through the hub's update API, lets the
hub verify it and restart, then waits for the startup health check and says whether the new software
is running or the hub went back to the old one. The hub only accepts a bundle signed with the release
key it was given, so this script needs no key.

The first time, it pairs with the hub as an owner: press the hub's Pair button when asked. The pairing
is kept (owner-only file) in ~/.config/harmony-hub/ so later runs just work.
"""
import argparse
import base64
import binascii
import hashlib
import http.client
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

DEFAULT_PORT = 8080
CHUNK_BYTES = 8192   # sent as hex, so twice as long; the hub takes up to 32768 hex characters per request
REPO = "hzbench/harmony-hub-control"
NETWORK_ERRORS = (OSError, http.client.HTTPException)   # includes refused connections and timeouts


class HubError(Exception):
    """Something the person running this needs to know, in plain words."""


class Hub:
    def __init__(self, host, port=DEFAULT_PORT, token="", csrf=""):
        # The hub checks the Host header against its own numeric address, so names are resolved here.
        try:
            self.ip = socket.gethostbyname(host)
        except OSError as error:
            raise HubError(f"Can't find the hub '{host}' ({error}).")
        self.port = port
        self.token = token
        self.csrf = csrf

    def request(self, path, body=None, timeout=15):
        """(status, parsed JSON, Set-Cookie). Network trouble raises the usual OSError family."""
        headers = {"Host": f"{self.ip}:{self.port}"}
        if self.token:
            headers["Cookie"] = f"harmony={self.token}"
        text = None
        if body is not None:
            text = json.dumps(body)
            headers.update({"Content-Type": "application/json", "X-Harmony-CSRF": self.csrf})
        conn = http.client.HTTPConnection(self.ip, self.port, timeout=timeout)
        try:
            conn.request("POST" if body is not None else "GET", "/api/v1/" + path, text, headers)
            response = conn.getresponse()
            data = response.read()
            try:
                payload = json.loads(data)
            except ValueError:
                payload = {}
            return response.status, payload, response.getheader("Set-Cookie", "")
        finally:
            conn.close()

    def call(self, path, body=None, timeout=15):
        status, payload, _ = self.request(path, body, timeout)
        if status != 200:
            raise HubError(payload.get("error") or f"The hub answered {status} to {path}.")
        return payload


# ---- Who we are on the hub ----

def credentials_path(ip, port, state_dir=None):
    base = Path(state_dir or os.environ.get("HARMONY_HUB_CONFIG") or "~/.config/harmony-hub").expanduser()
    return base / f"owner-{ip}-{port}.json"


def save_credentials(path, token, csrf):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump({"token": token, "csrf": csrf}, f)
    os.chmod(path, 0o600)   # in case the file already existed with other permissions


def role(hub):
    try:
        status, payload, _ = hub.request("session")
    except NETWORK_ERRORS as error:
        raise HubError(f"Can't reach the hub at {hub.ip}:{hub.port} ({error}).")
    return payload.get("role", "") if status == 200 else ""


def pair(hub, name="push_release", wait=90, say=print, sleep=time.sleep, now=time.monotonic):
    """Become an owner with the hub's Pair button, the way a phone does."""
    status, reply, cookie = hub.request("controllers/request", {"name": name, "button": True})
    if status != 200:
        raise HubError(reply.get("error") or f"The hub would not start pairing ({status}).")
    hub.token = cookie.split(";")[0].partition("=")[2]
    hub.csrf = reply.get("csrf", "")
    say("Press the Pair button on the hub now.")
    deadline = now() + wait
    while now() < deadline:
        try:
            if role(hub) == "owner":
                return
        except HubError:
            pass   # a dropped answer while waiting for the button is not the end of pairing
        sleep(1)
    raise HubError("The Pair button was not pressed in time. Run this again and press it when asked.")


def claim(hub, code, name="push_release"):
    """Become the owner of a hub that has none yet, with the claim code from its SSH tool."""
    status, reply, cookie = hub.request("controllers/claim", {"name": name, "code": code})
    if status != 200:
        raise HubError(reply.get("error") or f"The hub refused the claim code ({status}).")
    hub.token = cookie.split(";")[0].partition("=")[2]
    hub.csrf = reply.get("csrf", "")


def connect(host, port=DEFAULT_PORT, state_dir=None, claim_code="", say=print, **pairing):
    """A Hub we are the owner of: from the saved pairing if it still works, otherwise by pairing."""
    hub = Hub(host, port)
    path = credentials_path(hub.ip, port, state_dir)
    if path.exists():
        try:
            saved = json.loads(path.read_text())
            hub.token, hub.csrf = saved["token"], saved["csrf"]
        except (OSError, ValueError, KeyError, TypeError):
            hub.token = hub.csrf = ""
            say(f"The saved pairing in {path} is unreadable; pairing again.")
        else:
            if role(hub) == "owner":
                return hub
            say("The saved pairing no longer works; pairing again.")
    if claim_code:
        claim(hub, claim_code)
    else:
        pair(hub, say=say, **pairing)
    if role(hub) != "owner":
        raise HubError("This computer is paired with the hub but is not its owner, so it can't install software.")
    save_credentials(path, hub.token, hub.csrf)
    say(f"Paired. Saved to {path}.")
    return hub


# ---- The release ----

def load_release(path):
    try:
        release = json.loads(Path(path).read_text())
    except OSError as error:
        raise HubError(f"Can't read {path} ({error.strerror or error}).")
    except ValueError:
        raise HubError(f"{path} is not a release bundle (not JSON; was the download cut short?).")
    try:
        if not all(isinstance(release.get(k), t) for k, t in (("manifest", str), ("signature", str), ("files", dict))):
            raise ValueError
        manifest = json.loads(release["manifest"])
        names = [entry["name"] for entry in manifest["files"]]
        manifest["version"]
    except (ValueError, KeyError, TypeError, AttributeError):
        raise HubError(f"{path} is not a release bundle (damaged manifest or file list).")
    missing = [name for name in names if not isinstance(release["files"].get(name), str)]
    if missing:
        raise HubError("The bundle is missing files it lists: " + ", ".join(missing))
    return release, manifest


def upload(hub, release, manifest, say=print):
    """Stage the bundle on the hub and ask it to activate it. The hub restarts about two seconds later."""
    blobs = []
    for entry in manifest["files"]:   # decode everything first, so a damaged file is found before the hub is told anything
        try:
            blobs.append((entry["name"], base64.b64decode(release["files"][entry["name"]], validate=True)))
        except binascii.Error:
            raise HubError(f"{entry['name']} in the bundle is damaged.")
    hub.call("updates/begin", {"manifest": release["manifest"], "signature": release["signature"]})
    for name, raw in blobs:
        for offset in range(0, len(raw), CHUNK_BYTES):
            hub.call("updates/chunk", {"name": name, "offset": offset, "hex": raw[offset:offset + CHUNK_BYTES].hex()})
        say(f"  uploaded {name} ({len(raw):,} bytes)")
    hub.call("updates/apply", {})


def wait_for_hub(hub, version, say=print, sleep=time.sleep, now=time.monotonic, down_for=60, up_within=300, check_within=180):
    """After activation: the hub goes down, comes back, and runs its startup health check.
    Returns (outcome, installed version, the hub's last result); outcome is 'ok', 'rolled-back' or 'unclear'."""
    def answers():
        try:
            return hub.request("session", timeout=5)[0] == 200
        except NETWORK_ERRORS:
            return False

    say("Waiting for the hub to restart...")
    deadline = now() + down_for
    while now() < deadline and answers():
        sleep(1)
    deadline = now() + up_within
    while not answers():
        if now() > deadline:
            raise HubError(f"The hub has not come back after {up_within // 60} minutes. It restores its previous software "
                           "by itself if the new one fails to start; check it, and its SSH access if it stays down.")
        sleep(2)
    say("The hub is back. Waiting for its startup health check...")
    deadline = now() + check_within
    status = {}
    while True:
        try:
            status = hub.call("updates/status", timeout=10)
        except (HubError, *NETWORK_ERRORS):
            status = {}
        if status and not status.get("pending"):
            break
        if now() > deadline:
            raise HubError("The hub is running but its health check has not finished. Run this again later to see the result.")
        sleep(2)
    installed, result = status.get("version", ""), status.get("result", "")
    if result.startswith("Rolled back"):
        return "rolled-back", installed, result
    return ("ok" if installed == version else "unclear"), installed, result


# ---- Getting the file ----

def download_release(tag="", repo=REPO, say=print):
    """Fetch a release's bundle with the GitHub CLI and check it against its published checksum."""
    folder = Path(tempfile.mkdtemp(prefix="hub-release-"))
    command = ["gh", "release", "download"] + ([tag] if tag else []) + ["--repo", repo, "--pattern", "hub-release-*", "--dir", str(folder)]
    try:
        subprocess.run(command, check=True, capture_output=True, text=True)
    except FileNotFoundError:
        raise HubError("The GitHub CLI (gh) is needed for --latest/--tag. Install it, or download the bundle yourself and use --bundle.")
    except subprocess.CalledProcessError as error:
        raise HubError("Could not download the release: " + (error.stderr.strip() or "gh failed"))
    bundles = sorted(p for p in folder.glob("hub-release-*.json"))
    if len(bundles) != 1:
        raise HubError(f"Expected one hub-release-*.json in the release, found {len(bundles)}.")
    checksum = Path(str(bundles[0]) + ".sha256")
    if checksum.exists():
        words = checksum.read_text().split()
        if not words:
            raise HubError("The release's checksum file is empty. Not installing it.")
        if hashlib.sha256(bundles[0].read_bytes()).hexdigest() != words[0]:
            raise HubError("The downloaded bundle does not match its published checksum. Not installing it.")
    else:
        say("Warning: this release has no published checksum, so the download was not checked.")
    say(f"Downloaded {bundles[0].name}")
    return bundles[0]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--hub", required=True, help="the hub's IP address or name")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--bundle", type=Path, help="a hub-release-*.json file")
    source.add_argument("--latest", action="store_true", help="the newest GitHub release (needs the gh CLI)")
    source.add_argument("--tag", help="a specific GitHub release, such as v0.2.0 (needs the gh CLI)")
    parser.add_argument("--repo", default=REPO)
    parser.add_argument("--public-key", type=Path, help="a file with the release public key; verify the bundle here before sending it")
    parser.add_argument("--claim-code", default="", help="claim a hub that has no owner yet with the code from its SSH tool, instead of the Pair button")
    parser.add_argument("--force", action="store_true", help="install even if this version is already installed")
    parser.add_argument("--no-wait", action="store_true", help="return as soon as the hub accepts the update")
    parser.add_argument("--dry-run", action="store_true", help="check the bundle and the hub, but install nothing")
    args = parser.parse_args(argv)
    try:
        path = args.bundle or download_release("" if args.latest else args.tag, args.repo)
        release, manifest = load_release(path)
        version = manifest["version"]
        if args.public_key:
            import release_bundle
            release_bundle.verify(release, args.public_key.read_text().strip())
            print("Signature checks out against the given public key.")
        print(f"Bundle: {Path(path).name} (version {version}, {len(manifest['files'])} files)")
        hub = connect(args.hub, args.port, claim_code=args.claim_code)
        status = hub.call("updates/status")
        print(f"The hub has version {status.get('version') or '(not recorded)'} installed.")
        if status.get("pending"):
            raise HubError("An earlier update is still waiting for its health check. Try again in a few minutes.")
        if status.get("version") == version and not args.force:
            print("That version is already installed. Use --force to install it again.")
            return 0
        if args.dry_run:
            print("Dry run: the bundle is readable and the hub is ready. Nothing was installed.")
            return 0
        print("Uploading...")
        upload(hub, release, manifest)
        if args.no_wait:
            print("Accepted. The hub is restarting.")
            return 0
        outcome, installed, result = wait_for_hub(hub, version)
        if outcome == "ok":
            print(f"Done: the hub is running {installed}. ({result})")
            return 0
        if outcome == "rolled-back":
            print(f"The hub went back to {installed or 'its previous software'}: {result}.", file=sys.stderr)
            return 2
        print(f"The hub reports version '{installed}' ({result or 'no result'}), not {version}.", file=sys.stderr)
        return 2
    except HubError as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1
    except NETWORK_ERRORS as error:
        print(f"Error: lost contact with the hub ({error}).", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    sys.exit(main())
