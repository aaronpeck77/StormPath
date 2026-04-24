"""
Write App Store Connect API .p8 for altool.

Accepts GitHub secret as any of:
  (1) Full .p8 PEM
  (2) PEM with extra text around it (we extract the block)
  (3) Base64 of the entire .p8 file
  (4) Base64 of only the inner body (decodes to DER — openssl converts to PEM)
"""
from __future__ import annotations

import base64
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

PEM_PKCS8 = re.compile(
    r"-----BEGIN PRIVATE KEY-----\s*([\s\S]+?)\s*-----END PRIVATE KEY-----",
    re.MULTILINE,
)
# Broader: EC / RSA / PKCS#8 private key PEM
PEM_LOOSE = re.compile(
    r"-----BEGIN (?:EC PRIVATE KEY|RSA PRIVATE KEY|PRIVATE KEY)-----[\s\S]+?-----END (?:EC PRIVATE KEY|RSA PRIVATE KEY|PRIVATE KEY)-----",
    re.MULTILINE,
)


def _b64decode_loose(s: str) -> bytes:
    t = "".join(s.split())
    if not t:
        raise ValueError("empty after whitespace strip")
    pad = "=" * ((4 - len(t) % 4) % 4)
    try:
        return base64.b64decode(t + pad, validate=True)
    except Exception:
        return base64.b64decode(t + pad, validate=False)


def _is_pem_private(b: bytes) -> bool:
    if b"-----BEGIN" not in b or b"PRIVATE" not in b:
        return False
    if b"PRIVATE KEY" in b or b"EC PRIVATE KEY" in b or b"RSA PRIVATE KEY" in b:
        return True
    return False


def _der_to_pem(der: bytes) -> bytes | None:
    if len(der) < 8 or der[0] != 0x30:
        return None
    with tempfile.NamedTemporaryFile(suffix=".der", delete=False) as f:
        f.write(der)
        p = f.name
    try:
        r = subprocess.run(
            ["openssl", "pkey", "-inform", "DER", "-in", p, "-outform", "PEM", "-out", "-"],
            capture_output=True,
        )
        if r.returncode == 0 and _is_pem_private(r.stdout):
            return r.stdout
    finally:
        try:
            os.unlink(p)
        except OSError:
            pass
    return None


def _normalize_input(s0: str) -> str:
    s0 = s0.strip()
    if s0.startswith("\ufeff"):
        s0 = s0.lstrip("\ufeff")
    if len(s0) > 1 and s0[0] == s0[-1] and s0[0] in ('"', "'"):
        s0 = s0[1:-1]
    return s0


def parse_to_pem(s0: str) -> bytes:
    if not s0:
        raise ValueError("APP_STORE_CONNECT_API_KEY_CONTENT is empty")

    m = PEM_PKCS8.search(s0)
    if m:
        block = f"-----BEGIN PRIVATE KEY-----\n{m.group(1).strip()}\n-----END PRIVATE KEY-----\n"
        return block.encode("utf-8")

    m = PEM_LOOSE.search(s0)
    if m and _is_pem_private(m.group(0).encode()):
        return m.group(0).encode("utf-8")

    if "-----BEGIN" in s0 and "PRIVATE" in s0 and _is_pem_private(s0.encode()):
        return s0.encode("utf-8")

    der = _b64decode_loose(s0)
    if _is_pem_private(der):
        return der
    pem = _der_to_pem(der)
    if pem is not None:
        return pem

    raise ValueError(
        "Could not read the API key. In GitHub: Settings → Secrets — set "
        "APP_STORE_CONNECT_API_KEY_CONTENT to the text inside your AuthKey_xxx.p8 from "
        "App Store Connect (including BEGIN/END lines), or paste one line of base64 of that whole file."
    )


def main() -> int:
    key_id = os.environ.get("APP_STORE_KEY_ID", "").strip()
    if not key_id:
        print("APP_STORE_KEY_ID is empty", file=sys.stderr)
        return 1
    raw = os.environ.get("APP_STORE_CONNECT_API_KEY_CONTENT", "").replace("\r", "")
    try:
        data = parse_to_pem(_normalize_input(raw))
    except Exception as e:
        print(e, file=sys.stderr)
        return 1
    if not _is_pem_private(data):
        print("Key does not look like a private key after parsing.", file=sys.stderr)
        return 1
    out = Path.home() / ".appstoreconnect" / "private_keys" / f"AuthKey_{key_id}.p8"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(data)
    print(f"Wrote App Store Connect key ({len(data)} bytes) to {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
