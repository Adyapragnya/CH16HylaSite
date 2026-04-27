from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class UserLogin(BaseModel):
    username: str
    password: str


class UserOut(BaseModel):
    id: str
    username: str
    email: Optional[str] = None
    full_name: Optional[str] = None
    role: Optional[str] = None
    is_active: bool = True


class Token(BaseModel):
    access_token: str
    token_type: str = 'bearer'
    user: UserOut


class TokenData(BaseModel):
    username: Optional[str] = None
    user_id: Optional[str] = None
