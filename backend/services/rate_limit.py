"""Shared SlowAPI rate limiter — import from here in both main.py and route files."""
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
