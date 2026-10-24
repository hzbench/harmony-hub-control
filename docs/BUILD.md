# Build Notes

The repository ships ready-to-install MIPS binaries in `payload/bin/`. Rebuild
only when native source changes.

For the standalone service, use the pinned sources in `payload/source/vendor`
and an existing MIPS/uClibc compiler:

```sh
python3 tools/build_payload.py --cc /path/to/mips-buildroot-linux-uclibc-gcc --output build/output
```

The UI source, including the standalone profile importers, is in `payload/www`.
`tools/package_assets.mjs` packages the Lucide sprite. There are no runtime CDN
dependencies, and neither tool extracts JavaScript from C source.

## Target

- CPU: MIPS, big-endian
- Userspace: uClibc-era embedded Linux
- Output: mostly static helper binaries

## Linux Build

The helper build script is written for a Debian/Kali-like Linux environment:

```sh
cd build
./build_harmony_tools_kali.sh
```

It downloads the Bootlin MIPS uClibc toolchain and Dropbear source into
`build/toolchains/` and `build/tmp/`, then writes fresh binaries to
`build/output/`.

After rebuilding:

1. Copy the required binaries from `build/output/` into `payload/bin/`.
2. Refresh `payload/bin/MANIFEST.txt`.
3. Deploy to a test hub with `install_webui.ps1` or `python3 install_webui.py`.
4. Confirm checksums and runtime behavior.

## Windows

Windows can deploy with PowerShell, and Linux/macOS can deploy with the Python
installer. Use WSL, a Linux VM, or the existing build server for rebuilding MIPS
binaries.

## Dropbear

`dropbearmulti` is included so the web UI package can keep SSH reachable on a
rooted hub. The installer does not replace `authorized_keys`; it only uploads
Dropbear binaries/wrappers and starts the service if needed.

## Runtime Checks

From the repository root on Linux:

```sh
gcc -O0 tools/test_ir_runtime.c payload/source/vendor/cJSON.c payload/source/vendor/monocypher.c payload/source/vendor/monocypher-ed25519.c -o /tmp/test-ir && /tmp/test-ir
gcc -O0 tools/test_hbus_hold.c -o /tmp/test-hold && /tmp/test-hold
lua5.1 tools/test_mqtt_runtime.lua
lua5.1 tools/test_mqtt_protocol.lua
python3 tools/test_mqtt_broker.py
node tools/test_profiles.mjs
node tools/test_local_controls.mjs
node tools/test_go_shell.mjs
python3 tools/test_local_api.py
python3 tools/test_recovery.py
python3 tools/test_assets.py
python3 tools/test_upload.py
```

`test_mqtt_protocol.lua` and the broker test require LuaSocket and lua-cjson.
The broker test starts and removes a Mosquitto 2 Docker container bound only to
loopback. `test_home_assistant.py` runs inside the Home Assistant 2026.9.4 image
with this repository on `PYTHONPATH`; it uses an in-process fake hub and sends no IR.

These check IR responses, holds, release timeouts, LTCP framing, MQTT discovery
and reloads, profile imports, browser button handling, pairing, configuration
preservation, recovery, signed updates, and uploads without contacting a device.
Run the C checks on the build host, not a hub.

For a disposable browser walkthrough, run `python3 tools/preview_ui.py` and open
`http://127.0.0.1:8097/`. It serves the real assets with a memory-only API fixture.
It cannot contact a hub or transmit IR. Restarting it clears the fixture devices;
use `test_local_api.py` to check the real backend's writes and rollback.

`node tools/ir_database_smoke_test.mjs --sample 10 --seed cleanup` checks a
repeatable sample from public profile databases. It downloads files but never
changes a hub. Use the paired UI to import profiles.

On Windows, also run `powershell -NoProfile -File tools/test_ssh_helpers.ps1`.
The rollback script uses `ssh_helpers.ps1`; keep them together. The PowerShell
installer forwards its options to the shared Python installer.

## Signed Releases

Create and protect an Ed25519 PEM signing key off-device. Export its raw
32-byte public key as 64 hexadecimal characters in a text file. Install that
public key with `install_webui.py --release-public-key <public-key.txt>` through
owner SSH. No default development key is trusted.

With the desktop `cryptography` package installed:

```sh
python3 tools/release_bundle.py --key <private-key.pem> --version <version> --out <release.json>
```

The bundle covers the five native helpers, Lua core/MQTT, local assets, startup
scripts and schema migration metadata. Initial installation and changes to
stock listener restrictions use owner SSH, not browser updates. Schema 1
currently supports identity migrations only; reject later schemas until a
tested migration is supplied.

### Releases from GitHub

`.github/workflows/hub-release.yml` builds and signs a release for you, so nobody needs a MIPS
compiler or the signing key on their own machine.

- **Publish:** merge to main, then tag the merge commit (`git tag v0.2.0 && git push origin v0.2.0`).
  The workflow refuses a tag whose commit is not on main or has not passed the *Test* workflow. It
  compiles the five native programs with the pinned Bootlin MIPS/uClibc toolchain (its SHA-256 is
  checked), confirms each is a static big-endian MIPS program and that `codex_webui` was built from
  current source, builds the bundle with `tools/release_bundle.py`, verifies it against the public
  key, and attaches `hub-release-<version>.json` and its `.sha256` to a GitHub Release. The committed
  files in `payload/bin/` are only a starting point and are not what a release contains.
- **Run by hand** (Actions > Hub release > Run workflow, from main) to build and sign a bundle as a
  downloadable artifact without publishing.
- **Key:** an Ed25519 key, off the hub. The private half is the repository secret
  `HUB_RELEASE_KEY_PEM`; the public half (64 hex characters) is the repository variable
  `HUB_RELEASE_PUBLIC_KEY` and is what each hub must be given once, over owner SSH:
  `install_webui.py --release-public-key <file-with-the-public-key>`. The build fails if the
  secret's key is not the one that variable names. A secret can't be read back out of GitHub, so
  keep a backup of the private key (the maintainer's copy is `~/.hub-remote-signing/hub-release-private.pem`).
- **The version** is recorded inside the bundle's `migrations.json`, which the hub replaces and rolls
  back with the rest of a release; `GET /api/v1/updates/status` (owner) reports it, whether the
  startup health check is still pending, and the last result.
- **Install:** `python3 tools/push_release.py --hub <ip> --latest` from a computer, or Setup >
  Software update in the app.

The boot recovery script and known-good helper are outside the replaceable
bundle. They validate startup and restore one previous release on failure.
Host tests exercise signature rejection, activation and exact rollback in
temporary directories. They do not reboot a real hub or replace the separate
blank-hub and offline acceptance gates.
