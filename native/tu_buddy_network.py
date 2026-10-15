#!/usr/bin/env python3
"""Read-only NetworkManager/portal discovery for Firefox. Never accepts credentials."""
import hashlib
import json
import os
import re
import struct
import subprocess
import sys
from urllib.parse import parse_qs, urlsplit

HOST = "radius-01.tu-berlin.de"
PORTAL = "26d19560-2e58-11e9-98fb-0050568775a3"
PROBES = ("http://firefox-portal-detection.com/generate_204",
          "http://captive.apple.com/hotspot-detect.html",
          "http://www.msftconnecttest.com/connecttest.txt",
          "http://192.0.2.123/")
MAX_MESSAGE = 16 * 1024


def command(args, timeout=5):
    result = subprocess.run(args, capture_output=True, text=True, timeout=timeout,
                            env={**os.environ, "LC_ALL": "C"}, check=True)
    return result.stdout.strip()


def safe_portal_url(value):
    try:
        url = urlsplit(value)
        query = parse_qs(url.query)
        return (url.scheme == "https" and url.hostname == HOST and url.port == 8443
                and not url.username and not url.password and not url.fragment
                and url.path in {"/portal/gateway", "/portal/PortalSetup.action", "/portal/Login.action"}
                and query.get("portal") == [PORTAL] and bool(query.get("sessionId", [""])[0]))
    except (ValueError, TypeError):
        return False


def guest_networks():
    listing = command(["nmcli", "-t", "-f", "DEVICE,TYPE,STATE", "device", "status"])
    for line in listing.splitlines():
        fields = line.split(":")
        if len(fields) != 3:
            continue
        interface, kind, state = fields
        if kind != "wifi" or state != "connected" or not re.fullmatch(r"[A-Za-z0-9_.-]{1,15}", interface):
            continue
        connection = command(["nmcli", "--escape", "no", "-g", "GENERAL.CON-UUID", "device", "show", interface])
        ssid = command(["nmcli", "--escape", "no", "-g", "802-11-wireless.ssid", "connection", "show", "uuid", connection])
        if ssid.casefold() != "tub-guest":
            continue
        identity = command(["nmcli", "--escape", "no", "-g", "GENERAL.CON-PATH,IP4.ADDRESS", "device", "show", interface])
        network_id = hashlib.sha256((interface + "\n" + identity).encode()).hexdigest()
        yield interface, network_id


def discover(request):
    if (not isinstance(request, dict) or request.get("action") != "discover"
            or set(request) - {"action", "previousNetwork"}
            or not isinstance(request.get("previousNetwork", ""), str)):
        return {"connected": False, "reason": "Unsupported discovery request."}
    for interface, network_id in guest_networks():
        result = {"connected": True, "interface": interface, "networkId": network_id}
        if request.get("previousNetwork") == network_id:
            return {**result, "unchanged": True}
        for probe in PROBES:
            try:
                # No redirects, cookies or credentials. Bind each probe to the TUB-Guest adapter.
                response = command(["curl", "--interface", interface, "--noproxy", "*", "--silent", "--show-error",
                                    "--connect-timeout", "4", "--max-time", "7", "--max-filesize", "65536",
                                    "--dump-header", "-", probe], timeout=9)
            except subprocess.CalledProcessError as error:
                # A gateway can send valid redirect headers and then reset the body connection.
                response = error.stdout or ""
            except (OSError, subprocess.SubprocessError):
                continue
            for line in response.splitlines():
                if line.lower().startswith("location:"):
                    url = line.split(":", 1)[1].strip()
                    if safe_portal_url(url):
                        return {**result, "url": url}
                    return {**result, "reason": "The network redirected to an unrecognized portal; no credentials will be sent."}
            if re.search(r"^HTTP/\S+ 204(?:\s|$)", response, re.MULTILINE):
                return {**result, "online": True}
        return {**result, "reason": "TUB-Guest returned no trusted captive-portal redirect; discovery will be retried."}
    return {"connected": False}


def read_exact(stream, length):
    chunks = bytearray()
    while len(chunks) < length:
        part = stream.read(length - len(chunks))
        if not part:
            raise EOFError
        chunks.extend(part)
    return bytes(chunks)


def main():
    try:
        length = struct.unpack("=I", read_exact(sys.stdin.buffer, 4))[0]
        if length > MAX_MESSAGE:
            raise ValueError("Oversized native request")
        request = json.loads(read_exact(sys.stdin.buffer, length))
        result = discover(request)
    except EOFError:
        return
    except (ValueError, OSError, subprocess.SubprocessError):
        result = {"connected": False, "reason": "Network discovery is unavailable. Check that NetworkManager, nmcli and curl are installed."}
    data = json.dumps(result, separators=(",", ":")).encode()
    sys.stdout.buffer.write(struct.pack("=I", len(data)) + data)
    sys.stdout.buffer.flush()


if __name__ == "__main__":
    main()
