"""`/api/auth/oauth/*` — provider-based sign-in (TODO §8.2, the deferred
"OAuth sign-in for restricted shares" candidate).

Google-first via the plain OAuth2 authorization-code flow, deliberately
without an OIDC client library: two HTTP calls (token exchange + userinfo)
and a signed state parameter are the whole protocol surface, keeping the
server venv dependency-free.

Identity semantics — identical to the Cloudflare Access SSO precedent
(`auth.py::_get_or_create_cf_user`):
  - users are upserted BY EMAIL; OAuth-only users get `password_hash=None`
    (they can never password-login) and `is_admin=False`;
  - `AuthContext.principal` prefers email, so share grants that name a
    person's email automatically admit their OAuth identity — no grant
    migration needed;
  - the session is the SAME signed app-session cookie password login uses,
    so whoami/PublishDialog/save round-trips need zero changes.

CSRF/replay protection: `state = b64url(nonce|return_to) + "." + HMAC`.
The nonce is fresh per start, the signature is keyed by the app secret,
the whole state rides in a short-lived HttpOnly cookie AND the query, and
callback requires exact equality plus a valid signature.

Open-redirect guard: `return_to` must be a ROOT-RELATIVE path (starts with
exactly one "/"); scheme-relative ("//host") and absolute URLs are forced
back to "/".
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
from typing import Any, Optional

import httpx
from fastapi import APIRouter, Depends, Request
from fastapi.responses import RedirectResponse, Response
from sqlalchemy.orm import Session

from .. import models
from ..audit import write_audit_event
from ..auth import APP_SESSION_COOKIE, create_app_session_cookie

STATE_COOKIE = "vsnote_oauth_state"
STATE_TTL_SECONDS = 600

AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _b64url_decode(text: str) -> bytes:
    pad = "=" * (-len(text) % 4)
    return base64.urlsafe_b64decode(text + pad)


def _sign(secret_key: str, payload: str) -> str:
    return hmac.new(secret_key.encode(), payload.encode(), hashlib.sha256).hexdigest()


def _make_state(secret_key: str, return_to: str) -> str:
    nonce = secrets.token_urlsafe(16)
    payload = f"{nonce}|{return_to}"
    encoded = _b64url(payload.encode())
    return f"{encoded}.{_sign(secret_key, encoded)}"


def _parse_state(secret_key: str, state: str) -> Optional[str]:
    """Returns the embedded return_to when the signature verifies, else None."""
    try:
        encoded, supplied_sig = state.split(".", 1)
        expected = _sign(secret_key, encoded)
        if not hmac.compare_digest(expected, supplied_sig):
            return None
        payload = _b64url_decode(encoded).decode()
        nonce, _, return_to = payload.partition("|")
        # Nonce is present in the signed blob; freshness comes from the
        # cookie's max-age + the cookie/state equality check in the handler.
        if not nonce or not hmac.compare_digest(_sign(secret_key, nonce)[: len(_sign(secret_key, nonce))], _sign(secret_key, nonce)):
            return None
        if not return_to.startswith("/") or return_to.startswith("//"):
            return "/"
        return return_to
    except Exception:
        return None


async def exchange_code(settings, code: str, redirect_uri: str) -> Optional[dict[str, Any]]:
    """Token exchange + userinfo fetch. Module-level so tests can monkeypatch."""
    async with httpx.AsyncClient(timeout=15) as client:
        token_res = await client.post(
            TOKEN_URL,
            data={
                "code": code,
                "client_id": settings.oauth_google_client_id,
                "client_secret": settings.oauth_google_client_secret,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
        )
        if token_res.status_code != 200:
            return None
        access_token = token_res.json().get("access_token")
        if not access_token:
            return None
        user_res = await client.get(USERINFO_URL, headers={"Authorization": f"Bearer {access_token}"})
        if user_res.status_code != 200:
            return None
        return user_res.json()


def build_router(get_db, settings, secret_key: str):
    router = APIRouter(prefix="/auth/oauth", tags=["oauth"])

    def google_configured() -> bool:
        return bool(settings.oauth_google_client_id and settings.oauth_google_client_secret)

    @router.get("/providers")
    def providers():
        """UI capability probe: which sign-in buttons to render."""
        return {"google": google_configured()}

    @router.get("/google/start")
    def google_start(request: Request, return_to: str = "/"):
        if not google_configured():
            return Response(status_code=404)
        safe_return = return_to if return_to.startswith("/") and not return_to.startswith("//") else "/"
        state = _make_state(secret_key, safe_return)
        redirect_uri = str(request.base_url).rstrip("/") + "/api/auth/oauth/google/callback"
        response = RedirectResponse(
            (
                f"{AUTHORIZE_URL}?client_id={settings.oauth_google_client_id}"
                f"&redirect_uri={redirect_uri}"
                "&response_type=code&scope=openid%20email%20profile"
                f"&state={state}&prompt=select_account"
            ),
            status_code=302,
        )
        response.set_cookie(
            STATE_COOKIE,
            state,
            httponly=True,
            secure=settings.cookie_secure,
            samesite="lax",
            path="/",
            max_age=STATE_TTL_SECONDS,
        )
        return response

    @router.get("/google/callback")
    async def google_callback(
        request: Request,
        db: Session = Depends(get_db),
        code: str = "",
        state: str = "",
    ):
        if not google_configured():
            return Response(status_code=404)

        cookie_state = request.cookies.get(STATE_COOKIE)
        if not code or not state or not cookie_state or state != cookie_state:
            return RedirectResponse("/login-error?reason=oauth_state", status_code=302)
        return_to = _parse_state(secret_key, state)
        if return_to is None:
            return RedirectResponse("/login-error?reason=oauth_state", status_code=302)

        redirect_uri = str(request.base_url).rstrip("/") + "/api/auth/oauth/google/callback"
        userinfo = await exchange_code(settings, code, redirect_uri)
        email = (userinfo or {}).get("email")
        if not email or not (userinfo or {}).get("email_verified", False):
            return RedirectResponse("/login-error?reason=oauth_email", status_code=302)

        user = db.query(models.User).filter(models.User.email == email).one_or_none()
        if user is None:
            user = models.User(username=email, email=email, password_hash=None, is_admin=False)
            db.add(user)
            db.commit()
            db.refresh(user)

        write_audit_event(db, "login.success", principal=user.email or user.username, request=request)

        cookie = create_app_session_cookie(secret_key, user, settings.session_ttl_min)
        response = RedirectResponse(return_to, status_code=302)
        response.set_cookie(
            APP_SESSION_COOKIE,
            cookie,
            httponly=True,
            secure=settings.cookie_secure,
            samesite="lax",
            path="/",
            max_age=settings.session_ttl_min * 60,
        )
        response.delete_cookie(STATE_COOKIE, path="/")
        return response

    return router
