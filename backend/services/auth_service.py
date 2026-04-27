import os
import hashlib
from datetime import datetime, timedelta, timezone
from jose import JWTError, jwt
from passlib.context import CryptContext
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '../../.env'))

SECRET_KEY = os.getenv('JWT_SECRET', 'ch16hyla-super-secret')
ALGORITHM  = os.getenv('JWT_ALGORITHM', 'HS256')
EXPIRE_HRS = int(os.getenv('JWT_EXPIRE_HOURS', '24'))

pwd_context = CryptContext(schemes=['bcrypt'], deprecated='auto')


def _sha256_hex(plain: str) -> str:
    return hashlib.sha256(plain.encode()).hexdigest()


def verify_password(plain: str, hashed: str) -> bool:
    if not hashed:
        return False
    # SHA256 hex (64 chars) — used by HylaAnalytics2 / reference system
    if len(hashed) == 64 and all(c in '0123456789abcdef' for c in hashed.lower()):
        return _sha256_hex(plain) == hashed.lower()
    # bcrypt — fallback for CH16 native accounts
    try:
        return pwd_context.verify(plain, hashed)
    except Exception:
        return False


def create_access_token(data: dict) -> str:
    payload = data.copy()
    payload['exp'] = datetime.now(timezone.utc) + timedelta(hours=EXPIRE_HRS)
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> dict:
    return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
