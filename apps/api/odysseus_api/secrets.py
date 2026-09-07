"""Transparent encryption-at-rest for database secrets.

The application continues to work with plaintext Python values, while SQLAlchemy bind/result
processors store AES-256-GCM envelopes in PostgreSQL. Legacy plaintext rows remain readable and are
rewritten through the encrypted types once at startup.

DATA_ENCRYPTION_KEY is intentionally separate from JWT_SECRET/INTERNAL_TOKEN. Backups require the
same key; losing it makes encrypted provider credentials unrecoverable.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
from typing import Any

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import attributes
from sqlalchemy.types import Text, TypeDecorator

PREFIX = "enc:v1:"
JSON_ENVELOPE = "__odysseus_encrypted_v1__"
AAD = b"odysseus-db-secret-v1"
_installed = False


def _master_key() -> bytes | None:
    from .config import settings

    raw = (settings.data_encryption_key or "").encode("utf-8")
    return hashlib.sha256(raw).digest() if raw else None


def is_encrypted(value: str | None) -> bool:
    return bool(value and value.startswith(PREFIX))


def encrypt_secret(value: str | None) -> str:
    text = value or ""
    if not text or is_encrypted(text):
        return text
    key = _master_key()
    if key is None:
        # Development can intentionally run without a persistence key; production startup forbids it.
        return text
    nonce = os.urandom(12)
    ciphertext = AESGCM(key).encrypt(nonce, text.encode("utf-8"), AAD)
    payload = base64.urlsafe_b64encode(nonce + ciphertext).decode("ascii")
    return PREFIX + payload


def decrypt_secret(value: str | None) -> str:
    text = value or ""
    if not is_encrypted(text):
        return text  # legacy plaintext / development compatibility
    key = _master_key()
    if key is None:
        raise RuntimeError("DATA_ENCRYPTION_KEY가 없어 저장된 비밀값을 복호화할 수 없습니다")
    try:
        raw = base64.urlsafe_b64decode(text[len(PREFIX) :].encode("ascii"))
        nonce, ciphertext = raw[:12], raw[12:]
        return AESGCM(key).decrypt(nonce, ciphertext, AAD).decode("utf-8")
    except Exception as exc:  # noqa: BLE001 — key mismatch/corruption must fail closed
        raise RuntimeError("저장된 비밀값을 복호화할 수 없습니다. DATA_ENCRYPTION_KEY를 확인하세요") from exc


class EncryptedText(TypeDecorator):
    impl = Text
    cache_ok = True

    def process_bind_param(self, value: Any, dialect) -> str:
        return encrypt_secret(str(value or ""))

    def process_result_value(self, value: Any, dialect) -> str:
        return decrypt_secret(str(value or ""))


class EncryptedJSON(TypeDecorator):
    """Store a JSON value as a single encrypted envelope inside the existing JSONB column."""

    impl = JSONB
    cache_ok = True

    def process_bind_param(self, value: Any, dialect) -> Any:
        if value is None:
            return None
        # Already-enveloped values can appear in low-level migrations; do not double encrypt.
        if isinstance(value, dict) and set(value) == {JSON_ENVELOPE}:
            return value
        encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":"), default=str)
        encrypted = encrypt_secret(encoded)
        if is_encrypted(encrypted):
            return {JSON_ENVELOPE: encrypted}
        return value

    def process_result_value(self, value: Any, dialect) -> Any:
        if isinstance(value, dict) and set(value) == {JSON_ENVELOPE}:
            decoded = decrypt_secret(str(value[JSON_ENVELOPE]))
            return json.loads(decoded)
        return value  # legacy plaintext JSON / development compatibility


def install_encrypted_types() -> None:
    """Install transparent types before application queries begin."""
    global _installed
    if _installed:
        return
    from .models import AiProvider, AppSetting

    AiProvider.__table__.c.api_key.type = EncryptedText()
    AiProvider.__table__.c.default_headers.type = EncryptedJSON()
    # App settings can contain GitHub/search credentials and legacy AI keys. Encrypt the whole JSON.
    AppSetting.__table__.c.value.type = EncryptedJSON()
    _installed = True


async def migrate_encrypted_storage(db: AsyncSession) -> int:
    """Force legacy rows through encrypted bind processors; idempotent and safe to rerun."""
    if _master_key() is None:
        return 0
    from sqlalchemy import select
    from .models import AiProvider, AppSetting

    changed = 0
    providers = (await db.execute(select(AiProvider))).scalars().all()
    for row in providers:
        if row.api_key:
            attributes.flag_modified(row, "api_key")
            changed += 1
        if row.default_headers:
            attributes.flag_modified(row, "default_headers")
            changed += 1
    app_settings = (await db.execute(select(AppSetting))).scalars().all()
    for row in app_settings:
        if row.value is not None:
            attributes.flag_modified(row, "value")
            changed += 1
    if changed:
        await db.commit()
    return changed
