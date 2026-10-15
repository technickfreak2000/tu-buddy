#!/usr/bin/env python3
"""Install/remove the user-scoped Firefox native host; no service or root required."""
import argparse
import json
from pathlib import Path
import shutil


def install(prefix, uninstall=False):
    target = prefix / ".local/share/tu-buddy/tu_buddy_network.py"
    manifest = prefix / ".mozilla/native-messaging-hosts/de.tu_berlin.tu_buddy.json"
    if uninstall:
        manifest.unlink(missing_ok=True)
        target.unlink(missing_ok=True)
        print("Removed the TU Buddy Firefox network helper.")
        return
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    manifest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(Path(__file__).with_name("tu_buddy_network.py"), target)
    target.chmod(0o700)
    manifest.write_text(json.dumps({
        "name": "de.tu_berlin.tu_buddy",
        "description": "Discover TUB-Guest captive portals on connected Linux Wi-Fi adapters",
        "path": str(target.resolve()),
        "type": "stdio",
        "allowed_extensions": ["tu-auto-login@local.nick"],
    }, indent=2) + "\n")
    manifest.chmod(0o600)
    print(f"Installed {target}")
    print(f"Registered {manifest}")
    print("Restart Firefox, then enable TUB-Guest and second-adapter detection in extension settings.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prefix", type=Path, default=Path.home(), help="User home directory (default: current user)")
    parser.add_argument("--uninstall", action="store_true")
    args = parser.parse_args()
    install(args.prefix.expanduser().resolve(), args.uninstall)
