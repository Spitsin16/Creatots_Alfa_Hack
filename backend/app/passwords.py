"""Password hashing for synthetic demo accounts."""

import hashlib
import hmac
import os

ITERATIONS = 200_000


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, ITERATIONS)
    return f"pbkdf2_sha256${ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, encoded: str) -> bool:
    scheme, rounds, salt_hex, digest_hex = encoded.split("$")
    if scheme != "pbkdf2_sha256":
        return False
    actual = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), int(rounds))
    return hmac.compare_digest(actual, bytes.fromhex(digest_hex))
