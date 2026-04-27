import logging
from fastapi import APIRouter, HTTPException, Request, status, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError
from db.connection import get_users_col, get_users_src
from models.user import UserLogin, Token, UserOut, TokenData
from services.auth_service import verify_password, create_access_token, decode_token
from services.rate_limit import limiter

log    = logging.getLogger(__name__)
router = APIRouter(prefix='/api/auth', tags=['Auth'])
bearer = HTTPBearer(auto_error=False)


async def _find_user(username: str):
    """Look up user in CH16db first, then HylaAnalytics2 as fallback."""
    col = get_users_col()
    user = await col.find_one({'$or': [{'username': username}, {'email': username}]})
    if not user:
        # fallback to source DB
        src = get_users_src()
        user = await src.find_one({'$or': [{'username': username}, {'email': username}]})
    return user


@router.post('/login', response_model=Token)
@limiter.limit('10/minute')        # max 10 login attempts per IP per minute
async def login(request: Request, body: UserLogin):
    client_ip = request.client.host if request.client else 'unknown'
    user = await _find_user(body.username)
    if not user:
        log.warning('[AUTH] Failed login — unknown user "%s" from %s', body.username, client_ip)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Invalid credentials')
    # Support both bcrypt (CH16 native) and SHA256 (HylaAnalytics2 / reference system)
    stored_hash = user.get('hashed_password') or user.get('password') or ''
    if not verify_password(body.password, stored_hash):
        log.warning('[AUTH] Failed login — wrong password for "%s" from %s', body.username, client_ip)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Invalid credentials')
    if not user.get('is_active', True):
        log.warning('[AUTH] Blocked inactive account "%s" login from %s', body.username, client_ip)
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Account is inactive')

    log.info('[AUTH] Successful login for "%s" from %s', body.username, client_ip)
    token = create_access_token({'sub': user.get('username'), 'uid': str(user.get('id', ''))})
    return Token(
        access_token=token,
        user=UserOut(
            id=str(user.get('id', user.get('_id', ''))),
            username=user.get('username', ''),
            email=user.get('email'),
            full_name=user.get('full_name'),
            role=user.get('role', 'user'),
            is_active=user.get('is_active', True),
        ),
    )


async def get_current_user(creds: HTTPAuthorizationCredentials = Depends(bearer)):
    if not creds:
        raise HTTPException(status_code=401, detail='Not authenticated')
    try:
        payload = decode_token(creds.credentials)
        username = payload.get('sub')
        if not username:
            raise HTTPException(status_code=401, detail='Invalid token')
        user = await _find_user(username)
        if not user:
            raise HTTPException(status_code=401, detail='User not found')
        return user
    except JWTError:
        raise HTTPException(status_code=401, detail='Invalid or expired token')


@router.get('/me', response_model=UserOut)
async def me(user=Depends(get_current_user)):
    return UserOut(
        id=str(user.get('id', user.get('_id', ''))),
        username=user.get('username', ''),
        email=user.get('email'),
        full_name=user.get('full_name'),
        role=user.get('role', 'user'),
        is_active=user.get('is_active', True),
    )
