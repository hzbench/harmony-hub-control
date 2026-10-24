"""Build a signed userspace release. The signing key must stay off the hub."""
import argparse
import base64
import hashlib
import json
import re
from pathlib import Path
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

ROOT = Path(__file__).resolve().parents[1]
NATIVE = ("codex_webui", "codex_hbus", "codex_hal_ltcp", "codex_bthid_keyboard", "codex_portal")
FILES = {name: ROOT / "payload" / "bin" / name for name in NATIVE}
FILES.update({name: ROOT / "payload" / "www" / name for name in
              ("index.html", "app.css", "app.js", "icons.svg", "profiles.js", "go.html", "go.css", "go.js")})
FILES.update({"localcore.lua": ROOT / "payload/core/localcore.lua",
              "codexmqtt.lua": ROOT / "payload/mqtt/codexmqtt.lua",
              "init.sh": ROOT / "payload/scripts/init.sh",
              "maintenance.sh": ROOT / "payload/scripts/maintenance.sh",
              "migrations.json": ROOT / "payload/core/migrations.json"})


# What the hub's updater accepts (payload/source/local_update.h); a bundle outside them is only refused at install time.
MAX_FILE_BYTES, MAX_TOTAL_BYTES, MAX_MIGRATIONS_BYTES = 1_500_000, 2_500_000, 4096
VERSION = re.compile(r"[0-9A-Za-z._+-]{1,32}")   # the hub shows at most 32 characters of safe text


def migrations(path, version):
    """The installed migrations.json is replaced and rolled back with each release, so the version
    is recorded in it (the hub reports it from there); the migration range itself is untouched."""
    data = json.loads(path.read_text())
    data["version"] = version
    raw = json.dumps(data, separators=(",", ":")).encode()
    if len(raw) >= MAX_MIGRATIONS_BYTES:
        raise ValueError("migrations.json is too large for the hub to read its version")
    return raw


def bundle(key, version, files):
    if not VERSION.fullmatch(version):
        raise ValueError(f"The version must be 1-32 letters, digits or . _ + - (got {version!r})")
    data = {name: path.read_bytes() for name, path in files.items()}
    data["migrations.json"] = migrations(files["migrations.json"], version)
    too_big = [f"{name} ({len(raw):,} bytes)" for name, raw in data.items() if len(raw) > MAX_FILE_BYTES]
    if too_big:
        raise ValueError(f"Over the hub's {MAX_FILE_BYTES:,}-byte file limit: " + ", ".join(too_big))
    total = sum(len(raw) for raw in data.values())
    if total > MAX_TOTAL_BYTES:
        raise ValueError(f"The release is {total:,} bytes; the hub accepts at most {MAX_TOTAL_BYTES:,}")
    manifest = json.dumps({"schemaVersion": 1, "version": version, "platform": "pimento-4.15.600",
        "files": [{"name": name, "size": len(raw), "sha512": hashlib.sha512(raw).hexdigest()}
                  for name, raw in data.items()]}, separators=(",", ":"))
    return {"manifest": manifest, "signature": key.sign(manifest.encode()).hex(),
            "files": {name: base64.b64encode(raw).decode() for name, raw in data.items()}}


def verify(release, public_key_hex):
    """Raise unless `release` (a parsed bundle) is signed by the key and every file matches its manifest."""
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    Ed25519PublicKey.from_public_bytes(bytes.fromhex(public_key_hex)).verify(
        bytes.fromhex(release["signature"]), release["manifest"].encode())
    manifest = json.loads(release["manifest"])
    names = [entry["name"] for entry in manifest["files"]]
    if sorted(names) != sorted(release["files"]):
        raise ValueError("The bundle's files are not the files its manifest lists")
    for entry in manifest["files"]:
        raw = base64.b64decode(release["files"][entry["name"]])
        if len(raw) != entry["size"] or hashlib.sha512(raw).hexdigest() != entry["sha512"]:
            raise ValueError(f"{entry['name']} does not match the signed manifest")
    return manifest


def public_key_hex(key):
    return key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw).hex()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--key", type=Path, required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--bin-dir", type=Path, help="where the freshly built native programs are (default: payload/bin)")
    args = parser.parse_args()
    key = serialization.load_pem_private_key(args.key.read_bytes(), password=None)
    if not isinstance(key, Ed25519PrivateKey):
        raise ValueError("An Ed25519 signing key is required")
    files = dict(FILES)
    if args.bin_dir:
        files.update({name: args.bin_dir / name for name in NATIVE})
    missing = [str(p) for p in files.values() if not p.exists()]
    if missing:
        raise SystemExit("Missing release files: " + ", ".join(missing))
    release = bundle(key, args.version, files)
    verify(release, public_key_hex(key))   # never write a bundle that would not verify
    args.out.write_text(json.dumps(release, separators=(",", ":")), encoding="utf-8")
    print(f"Signed release {args.version}: {args.out}")
