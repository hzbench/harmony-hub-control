"""Match a requested command name to a hub command; no Home Assistant imports, so it tests alone."""

import re

# Keep in step with CONTROLS in payload/www/go.js (the web UI's alias table), command-name aliases only.
ALIASES = (
    ("power", "powertoggle", "onoff"),
    ("poweron", "on"),
    ("poweroff", "off"),
    ("input", "inputnext", "inputup", "source"),
    ("up", "directionup", "arrowup", "uparrow"),
    ("left", "directionleft", "arrowleft", "leftarrow"),
    ("ok", "select", "enter"),
    ("right", "directionright", "arrowright", "rightarrow"),
    ("down", "directiondown", "arrowdown", "dnarrow", "downarrow"),
    ("back", "return"),
    ("home", "smarthome"),
    ("menu", "settings", "homemenu"),
    ("volumeup", "volup"),
    ("volumedown", "voldown", "voldn"),
    ("mute",),
    ("channelup", "programup", "pageup", "chnext"),
    ("channeldown", "programdown", "pagedown", "chprev"),
    ("rewind", "rew"),
    ("play", "playpause"),
    ("pause",),
    ("stop",),
    ("guide", "tvguide", "epg"),
    ("fastforward", "forward"),
)


def normalize(name):
    """Same folding as norm() in go.js: '+' is up, a trailing '-' is down, then letters and digits only."""
    name = re.sub(r"-\s*$", "down", str(name).lower().replace("+", "up"))
    return re.sub(r"[^a-z0-9]", "", name)


def _group(key):
    return next((g for g in ALIASES if key in g), (key,))


def match_commands(requested, names):
    """Names that answer to `requested`: exact, else normalized, else alias. Empty when none match."""
    names = list(names)
    exact = [n for n in names if n == requested]
    if exact:
        return exact
    key = normalize(requested)
    folded = [n for n in names if normalize(n) == key]
    if folded:
        return folded
    group = _group(key)
    return [n for n in names if normalize(n) in group]
