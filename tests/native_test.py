import importlib.util
import io
import json
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("tu_network", ROOT / "native/tu_buddy_network.py")
network = importlib.util.module_from_spec(spec)
spec.loader.exec_module(network)
URL = "https://radius-01.tu-berlin.de:8443/portal/gateway?portal=" + network.PORTAL + "&sessionId=fixture-only"


class NativeTests(unittest.TestCase):
    def test_redirect_validation(self):
        self.assertTrue(network.safe_portal_url(URL))
        for url in [URL.replace(":8443", ""), URL.replace("https:", "http:"), URL.replace(".de:", ".de.attacker.test:"),
                    URL.replace("fixture-only", ""), URL.replace(network.PORTAL, "other")]:
            self.assertFalse(network.safe_portal_url(url))

    def test_detects_ssid_on_any_interface(self):
        def command(args, **kwargs):
            if "DEVICE,TYPE,STATE" in args:
                return "wlan0:wifi:connected\nwlan3:wifi:connected\nlo:loopback:connected"
            if "GENERAL.CON-UUID" in args:
                return "AndroidAPP" if args[-1] == "wlan0" else "Auto TUB-Guest"
            if "802-11-wireless.ssid" in args:
                return "AndroidAPP" if args[-1] == "AndroidAPP" else "TUB-Guest"
            return "/org/freedesktop/NetworkManager/ActiveConnection/42\n141.23.1.2/19"
        with patch.object(network, "command", side_effect=command):
            found = list(network.guest_networks())
        self.assertEqual(found[0][0], "wlan3")
        self.assertEqual(len(found), 1)

    def test_probe_binds_adapter_and_never_sends_credentials(self):
        with patch.object(network, "guest_networks", return_value=iter([("wlan3", "new-connection")])), \
             patch.object(network, "command", return_value="HTTP/1.1 200 OK\nLocation: " + URL) as run:
            result = network.discover({"action": "discover"})
        self.assertEqual(result["url"], URL)
        args = run.call_args.args[0]
        self.assertEqual(args[args.index("--interface") + 1], "wlan3")
        self.assertNotIn("--location", args)
        self.assertNotIn("--data", args)

    def test_unchanged_connection_skips_network_probe(self):
        with patch.object(network, "guest_networks", return_value=iter([("wlan3", "seen")])), \
             patch.object(network, "command") as run:
            result = network.discover({"action": "discover", "previousNetwork": "seen"})
        self.assertTrue(result["unchanged"])
        run.assert_not_called()

    def test_falls_back_when_a_probe_is_reset(self):
        with patch.object(network, "guest_networks", return_value=iter([("wlan3", "new")])), \
             patch.object(network, "command", side_effect=[subprocess.CalledProcessError(56, "curl", output=""),
                                                         "HTTP/1.1 200 OK\nLocation: " + URL]) as run:
            self.assertEqual(network.discover({"action": "discover"})["url"], URL)
            self.assertEqual(run.call_count, 2)

    def test_retains_trusted_headers_when_body_is_reset(self):
        with patch.object(network, "guest_networks", return_value=iter([("wlan3", "new")])), \
             patch.object(network, "command", side_effect=subprocess.CalledProcessError(56, "curl", output="Location: " + URL)):
            self.assertEqual(network.discover({"action": "discover"})["url"], URL)

    def test_no_arbitrary_native_actions_or_credential_payloads(self):
        for request in [{"action": "login"}, {"action": "discover", "password": "forbidden"}, [], {"action": "discover", "previousNetwork": []}]:
            self.assertIn("reason", network.discover(request))

    def test_partial_native_reads(self):
        class ShortReads(io.BytesIO):
            def read(self, count=-1):
                return super().read(min(count, 2))
        self.assertEqual(network.read_exact(ShortReads(b"abcdef"), 6), b"abcdef")
        with self.assertRaises(EOFError):
            network.read_exact(io.BytesIO(b"a"), 4)

    def test_native_wire_protocol(self):
        payload = json.dumps({"action": "unsupported"}).encode()
        result = subprocess.run([sys.executable, str(ROOT / "native/tu_buddy_network.py")],
                                input=struct.pack("=I", len(payload)) + payload, capture_output=True, check=True)
        length = struct.unpack("=I", result.stdout[:4])[0]
        self.assertEqual(length, len(result.stdout[4:]))
        self.assertFalse(json.loads(result.stdout[4:])["connected"])
        self.assertEqual(result.stderr, b"")

    def test_user_scoped_install_and_uninstall(self):
        with tempfile.TemporaryDirectory() as tmp:
            cmd = [sys.executable, str(ROOT / "native/install.py"), "--prefix", tmp]
            subprocess.run(cmd, check=True, capture_output=True)
            manifest = Path(tmp) / ".mozilla/native-messaging-hosts/de.tu_berlin.tu_buddy.json"
            data = json.loads(manifest.read_text())
            self.assertEqual(data["allowed_extensions"], ["tu-auto-login@local.nick"])
            self.assertTrue(Path(data["path"]).exists())
            subprocess.run(cmd + ["--uninstall"], check=True, capture_output=True)
            self.assertFalse(manifest.exists())
            self.assertFalse(Path(data["path"]).exists())


if __name__ == "__main__":
    unittest.main()
