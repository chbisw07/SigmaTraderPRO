from __future__ import annotations

import base64
import hashlib
import json
from typing import Any

from cryptography.fernet import Fernet, InvalidToken


class CryptoError(RuntimeError):
    pass


def _derive_fernet_key(passphrase: str) -> bytes:
    digest = hashlib.sha256(passphrase.encode("utf-8")).digest()
    return base64.urlsafe_b64encode(digest)


def _fernet(passphrase: str) -> Fernet:
    if not passphrase:
        raise CryptoError("BROKER_ENCRYPTION_KEY is not configured")
    return Fernet(_derive_fernet_key(passphrase))


def encrypt_json(payload: dict[str, Any], *, key: str) -> str:
    token = _fernet(key).encrypt(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    )
    return token.decode("utf-8")


def decrypt_json(token: str, *, key: str) -> dict[str, Any]:
    try:
        raw = _fernet(key).decrypt(token.encode("utf-8"))
    except InvalidToken as exc:
        raise CryptoError("Invalid encrypted payload") from exc
    try:
        decoded = json.loads(raw.decode("utf-8"))
    except Exception as exc:  # noqa: BLE001 - must be best-effort
        raise CryptoError("Invalid decrypted JSON payload") from exc
    if not isinstance(decoded, dict):
        raise CryptoError("Decrypted payload is not an object")
    return decoded
