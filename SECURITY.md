# Security policy

## Reporting a vulnerability

Please report security problems privately through GitHub's
**Security > Report a vulnerability** form on this repository. Do not open a
public issue for them. Expect a first reply within about a week.

## Scope and expectations

This software runs as root on a rooted Logitech Harmony Hub and serves an HTTP
UI for a trusted local network; it is not meant to be exposed to the internet.
See [docs/SECURITY.md](docs/SECURITY.md) for the threat model and access
design. Reports about pairing and access control, command injection, the
update/release signature check, and the installer are especially welcome.

Release bundles are signed; only bundles published on this repository's
Releases page and verified by the hub's updater are official.
