"""Local user accounts for LeopardWatch.

Uses SQLite, PBKDF2-HMAC-SHA256 password hashes, and revocable opaque sessions.
Sessions are held in an HttpOnly cookie. The Vite dev proxy keeps /api on the
same browser origin (127.0.0.1:5173), including annotated video playback.

IMPORTANT: secure=False is ONLY for local HTTP development. Deploy over HTTPS
and use secure=True; add persistent rate limiting, proper CSRF tokens, logging,
backups, and account recovery before exposing this prototype to the internet.
"""
from __future__ import annotations

import hashlib
import hmac
import re
import secrets
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path

from fastapi import Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field

DB_PATH = Path(__file__).resolve().parent / "data" / "leopardwatch.sqlite3"
COOKIE_NAME = "leopardwatch_session"
SESSION_SECONDS = 7 * 24 * 60 * 60
ITERATIONS = 480_000
# Local-only trusted browser origins; production should use its actual origin.
TRUSTED_ORIGINS = {
    "http://127.0.0.1:5173", "http://localhost:5173",
    "http://127.0.0.1:8000", "http://localhost:8000",
}
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


class RegisterInput(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    email: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=10, max_length=128)


class LoginInput(BaseModel):
    email: str
    password: str


@contextmanager
def _connection():
    con = sqlite3.connect(str(DB_PATH), timeout=20)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys=ON")
    try:
        yield con
        con.commit()
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()


def initialize_database():
    """Create SQLite tables once; existing accounts are preserved."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with _connection() as con:
        con.execute("""CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at INTEGER NOT NULL
        )""")
        con.execute("""CREATE TABLE IF NOT EXISTS sessions (
            token_hash TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            expires_at INTEGER NOT NULL
        )""")
        con.execute("CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at)")


def _hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, ITERATIONS)
    return f"pbkdf2_sha256${ITERATIONS}${salt.hex()}${digest.hex()}"


def _verify_password(password: str, stored: str) -> bool:
    try:
        algorithm, count, salt, expected = stored.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), int(count))
        return hmac.compare_digest(actual, bytes.fromhex(expected))
    except (ValueError, TypeError):
        return False


def _public_user(user: sqlite3.Row) -> dict:
    return {"id": user["id"], "name": user["name"], "email": user["email"]}


def _validate_origin(request: Request):
    """Block cross-origin browser form/API writes when using cookie sessions."""
    origin = request.headers.get("origin")
    if origin and origin not in TRUSTED_ORIGINS:
        raise HTTPException(403, "Untrusted request origin.")


def _set_session(response: Response, user_id: int):
    token = secrets.token_urlsafe(32)
    digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
    with _connection() as con:
        con.execute("DELETE FROM sessions WHERE expires_at <= ?", (int(time.time()),))
        con.execute("INSERT INTO sessions(token_hash, user_id, expires_at) VALUES(?,?,?)",
                    (digest, user_id, int(time.time()) + SESSION_SECONDS))
    response.set_cookie(
        COOKIE_NAME, token, max_age=SESSION_SECONDS,
        httponly=True, samesite="lax", secure=False, path="/",
    )


def create_user_and_session(data: RegisterInput, response: Response, request: Request) -> dict:
    _validate_origin(request)
    email = data.email.strip().lower()
    name = data.name.strip()
    if len(name) < 2:
        raise HTTPException(422, "Name must contain at least two characters.")
    if not EMAIL_RE.match(email):
        raise HTTPException(422, "Enter a valid email address.")
    # Hash BEFORE opening the write transaction so it does not hold a DB lock.
    password_hash = _hash_password(data.password)
    with _connection() as con:
        try:
            cursor = con.execute(
                "INSERT INTO users(name,email,password_hash,created_at) VALUES(?,?,?,?)",
                (name, email, password_hash, int(time.time())),
            )
        except sqlite3.IntegrityError:
            raise HTTPException(409, "An account with this email already exists.")
        user_id = cursor.lastrowid
        user = con.execute("SELECT id,name,email FROM users WHERE id=?", (user_id,)).fetchone()
    _set_session(response, user_id)
    return {"user": _public_user(user)}


def login_user(data: LoginInput, response: Response, request: Request) -> dict:
    _validate_origin(request)
    email = data.email.strip().lower()
    with _connection() as con:
        user = con.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
    # Use a single generic failure message to avoid disclosing registered emails.
    if not user or not _verify_password(data.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password.")
    _set_session(response, user["id"])
    return {"user": _public_user(user)}


def current_user(request: Request) -> dict:
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Please sign in.")
    digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
    with _connection() as con:
        user = con.execute("""SELECT users.id, users.name, users.email FROM sessions
               JOIN users ON users.id=sessions.user_id
               WHERE sessions.token_hash=? AND sessions.expires_at>?""",
                           (digest, int(time.time()))).fetchone()
    if not user:
        raise HTTPException(status_code=401, detail="Session expired. Please sign in again.")
    return _public_user(user)


def logout_user(request: Request, response: Response, user: dict = Depends(current_user)):
    _validate_origin(request)
    token = request.cookies.get(COOKIE_NAME)
    if token:
        digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
        with _connection() as con:
            con.execute("DELETE FROM sessions WHERE token_hash=? AND user_id=?", (digest, user["id"]))
    response.delete_cookie(COOKIE_NAME, path="/", samesite="lax")
    return {"message": "Signed out successfully."}


initialize_database()
