"""Checks the signed release bundle without a hub: the file set matches the hub's, the limits hold,
the version is recorded where the hub reads it, and the signature verifies (and fails when it should)."""
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

sys.path.insert(0, str(Path(__file__).resolve().parent))
import release_bundle as rb

ROOT = rb.ROOT
# The names the hub will accept, read from the C source so the two can't drift apart.
header = (ROOT / "payload/source/local_update.h").read_text()
table = header[header.index("local_release_files[] = {"):]
hub_names = re.findall(r'\{"([^"]+)", [A-Z_]+', table[:table.index("};")])
assert sorted(rb.FILES) == sorted(hub_names), (sorted(set(rb.FILES) ^ set(hub_names)))

with tempfile.TemporaryDirectory() as directory:
    work = Path(directory)
    # Stand-ins for the five native programs, so this runs without a MIPS compiler.
    for name in rb.NATIVE:
        (work / name).write_bytes(name.encode() * 100)
    files = dict(rb.FILES)
    files.update({name: work / name for name in rb.NATIVE})
    for path in files.values():
        assert path.exists(), path
    key = Ed25519PrivateKey.generate()
    release = rb.bundle(key, "1.2.3", files)
    manifest = rb.verify(release, rb.public_key_hex(key))
    assert manifest["version"] == "1.2.3" and manifest["platform"] == "pimento-4.15.600" and manifest["schemaVersion"] == 1
    assert sorted(e["name"] for e in manifest["files"]) == sorted(hub_names)
    sizes = {e["name"]: e["size"] for e in manifest["files"]}
    assert max(sizes.values()) <= 1_500_000 and sum(sizes.values()) <= 2_500_000, "inside the hub's size limits"
    # The version is in the migrations.json that gets installed, next to the unchanged migration range.
    installed = json.loads(__import__("base64").b64decode(release["files"]["migrations.json"]))
    assert installed == {**json.loads(rb.FILES["migrations.json"].read_text()), "version": "1.2.3"}
    assert installed["from"] == 1 and installed["to"] == 1
    assert len(release["files"]["migrations.json"]) < 4096, "inside the hub's read limit for migrations.json"
    # Tampering or a different key is caught.
    other = Ed25519PrivateKey.generate()
    for bad in (lambda: rb.verify(release, rb.public_key_hex(other)),
                lambda: rb.verify({**release, "files": {**release["files"], "go.js": release["files"]["app.js"]}}, rb.public_key_hex(key)),
                lambda: rb.verify({**release, "manifest": release["manifest"].replace("1.2.3", "9.9.9")}, rb.public_key_hex(key))):
        try:
            bad()
        except Exception:
            continue
        raise AssertionError("a bad bundle verified")
    # The command line writes a bundle that verifies and refuses missing native programs.
    pem = work / "key.pem"
    pem.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    out = work / "release.json"
    run = lambda *extra: subprocess.run([sys.executable, str(ROOT / "tools/release_bundle.py"), "--key", str(pem), "--version", "2.0.0", "--out", str(out), *extra],
                                         capture_output=True, text=True)
    assert run("--bin-dir", str(work)).returncode == 0
    assert rb.verify(json.loads(out.read_text()), rb.public_key_hex(key))["version"] == "2.0.0"
    empty = work / "empty"; empty.mkdir()
    refused = run("--bin-dir", str(empty))
    assert refused.returncode != 0 and "Missing release files" in refused.stderr + refused.stdout
print("Release bundle: the hub's file set, size limits, recorded version, signature checks and the command line passed")
