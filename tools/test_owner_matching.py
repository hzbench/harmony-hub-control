"""Command-name matching for the harmony_owner integration. Pure Python: no Home Assistant needed.

Run: python3 tools/test_owner_matching.py
"""
import importlib.util
import unittest
from pathlib import Path

PATH = Path(__file__).resolve().parent.parent / "custom_components" / "harmony_owner" / "matching.py"
spec = importlib.util.spec_from_file_location("owner_matching", PATH)   # by path: the package __init__ imports Home Assistant
matching = importlib.util.module_from_spec(spec)
spec.loader.exec_module(matching)
match = matching.match_commands

SOUND_BAR = ["Power", "Vol_up", "Vol_dn", "Mute", "Input"]


class MatchTests(unittest.TestCase):
    def test_exact_wins_over_looser_matches(self):
        self.assertEqual(match("VolumeUp", ["Vol_up", "VolumeUp", "volume up"]), ["VolumeUp"])

    def test_normalized_beats_alias(self):
        self.assertEqual(match("vol up", ["volume-up", "Vol_up"]), ["Vol_up"])
        self.assertEqual(match("Volume_Up", ["VolumeUp", "Vol_up"]), ["VolumeUp"])

    def test_stock_volume_names_reach_this_hubs_commands(self):
        self.assertEqual(match("VolumeUp", SOUND_BAR), ["Vol_up"])
        self.assertEqual(match("VolumeDown", SOUND_BAR), ["Vol_dn"])

    def test_plus_and_trailing_minus_fold_like_the_web_ui(self):
        self.assertEqual(match("VolumeUp", ["Vol+", "Vol-"]), ["Vol+"])
        self.assertEqual(match("VolumeDown", ["Vol+", "Vol-"]), ["Vol-"])

    def test_other_controls_use_the_same_table(self):
        self.assertEqual(match("DirectionUp", ["Up", "Down"]), ["Up"])
        self.assertEqual(match("Select", ["OK", "Back"]), ["OK"])
        self.assertEqual(match("PowerToggle", ["Power"]), ["Power"])

    def test_not_found(self):
        self.assertEqual(match("VolumeUp", ["Power", "Mute"]), [])
        self.assertEqual(match("Rewind", []), [])

    def test_ambiguous_returns_every_candidate(self):
        self.assertEqual(sorted(match("VolumeUp", ["Vol_up", "Vol up"])), ["Vol up", "Vol_up"])
        self.assertEqual(sorted(match("VolumeUp", ["VolUp", "Vol_Up"])), ["VolUp", "Vol_Up"])

    def test_unrelated_names_do_not_match(self):
        self.assertEqual(match("Up", ["Volume Up", "Channel Up"]), [])
        self.assertEqual(match("Power", ["PowerOn", "PowerOff"]), [])

    def test_unknown_name_only_matches_itself_folded(self):
        self.assertEqual(match("Netflix", ["netflix", "Hulu"]), ["netflix"])


if __name__ == "__main__":
    unittest.main()
