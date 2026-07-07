#!/usr/bin/env python3
"""Preflight: can GitHub Actions see StormPath in App Store Connect via API?"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

BUNDLE_ID = "com.aaronpeck.stormpath"


def main() -> int:
    key_id = os.environ.get("APP_STORE_KEY_ID", "").strip()
    issuer_id = os.environ.get("APP_STORE_CONNECT_ISSUER_ID", "").strip()
    if not key_id or not issuer_id:
        print("::error::APP_STORE_CONNECT_API_KEY_ID or APP_STORE_CONNECT_ISSUER_ID is empty.")
        return 1

    env = os.environ.copy()
    env["APP_STORE_KEY_ID"] = key_id
    r = subprocess.run(
        [sys.executable, str(Path(__file__).resolve().parent / "write-appstore-connect-key.py")],
        env=env,
        capture_output=True,
        text=True,
    )
    if r.returncode != 0:
        print(r.stderr or r.stdout, file=sys.stderr)
        return r.returncode

    try:
        import jwt  # type: ignore
    except ImportError:
        subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", "PyJWT", "cryptography"])
        import jwt  # type: ignore

    key_path = Path.home() / ".appstoreconnect" / "private_keys" / f"AuthKey_{key_id}.p8"
    private_key = key_path.read_text(encoding="utf-8")
    now = int(time.time())
    token = jwt.encode(
        {"iss": issuer_id, "iat": now, "exp": now + 1200, "aud": "appstoreconnect-v1"},
        private_key,
        algorithm="ES256",
        headers={"kid": key_id, "typ": "JWT"},
    )
    if isinstance(token, bytes):
        token = token.decode("ascii")

    url = (
        "https://api.appstoreconnect.apple.com/v1/apps?"
        + urllib.parse.urlencode({"filter[bundleId]": BUNDLE_ID, "limit": 5})
    )
    req = urllib.request.Request(
        url,
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = json.load(resp)
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        print(f"::error::App Store Connect API returned HTTP {e.code} listing apps for {BUNDLE_ID}.")
        print(detail)
        if e.code == 403:
            print(
                "::error::403 usually means: pending Apple agreement, API key lacks App Manager access, "
                "or Issuer ID / Key ID / .p8 secret mismatch in GitHub Actions secrets."
            )
        return 1

    apps = body.get("data") or []
    if not apps:
        print(f"::error::No App Store Connect app found for bundle id {BUNDLE_ID}.")
        return 1

    app = apps[0]
    attrs = app.get("attributes") or {}
    print(
        f"App Store Connect OK — app id {app.get('id')} "
        f"({attrs.get('name', '?')}, bundle {attrs.get('bundleId', BUNDLE_ID)})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
