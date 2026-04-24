"""
Write App Store Connect API .p8 key for altool. Accepts the GitHub secret as either
(1) full PEM text (-----BEGIN PRIVATE KEY-----) or
(2) base64 of the .p8 file (one or many lines, e.g. from certutil / base64).
"""
from __future__ import annotations

import base64
import os
import sys
from pathlib import Path

KEY_ID = os.environ.get("APP_STORE_KEY_ID", "").strip()
raw = os.environ.get("APP_STORE_CONNECT_API_KEY_CONTENT", "").replace("\r", "")


def main() -> int:
    if not KEY_ID:
        print("APP_STORE_KEY_ID is empty", file=sys.stderr)
        return 1
    s = raw.strip()
    if s.startswith("\ufeff"):
        s = s.lstrip("\ufeff")
    if not s:
        print("APP_STORE_CONNECT_API_KEY_CONTENT is empty", file=sys.stderr)
        return 1

    if "-----BEGIN" in s and "PRIVATE KEY" in s:
        data = s.encode("utf-8")
    else:
        b64 = "".join(s.split())
        pad = "=" * ((4 - len(b64) % 4) % 4)
        try:
            data = base64.b64decode(b64 + pad, validate=True)
        except Exception:
            try:
                data = base64.b64decode(b64 + pad, validate=False)
            except Exception as e:
                print("Could not read API key. Paste the full .p8 file, or a single base64 of that file.", file=sys.stderr)
                return 1

    if b"-----BEGIN" not in data or b"PRIVATE" not in data or b"PRIVATE KEY" not in data:
        print("Parsed key is not a PEM private key. Check APP_STORE_CONNECT_API_KEY_CONTENT in GitHub Secrets.", file=sys.stderr)
        return 1

    out = Path.home() / ".appstoreconnect" / "private_keys" / f"AuthKey_{KEY_ID}.p8"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(data)
    # Do not log key contents; only size.
    print(f"Wrote App Store Connect key ({len(data)} bytes) to {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
