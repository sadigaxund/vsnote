"""`GET /api/app-config` — Phase 17's ONE public, unauthenticated endpoint,
and the server contract behind the app-wide login gate.

The phase brief requires a login screen in front of the shell "because every
authenticated client can sync the whole vault". The client cannot decide
that on its own: whether a login is even POSSIBLE is a deployment fact
(is there an account? is Cloudflare Access in front?), and gating on a fact
the client guessed would either lock an owner out of a deployment with no
credentials configured, or leave a real deployment ungated. So the server
states it, in the smallest possible response.

**Deliberately unauthenticated** (a gate you must already be past to learn
about is useless), and therefore deliberately CONTENT-FREE about the vault:
three booleans, no path, no repo name, no user list, no counts, nothing that
distinguishes one deployment's data from another's. The vault's real state
lives behind `GET /api/vault` (session-only). Nothing here is a secret, and
nothing here is an existence oracle for anything guessable.

`login_required` is a conjunction on purpose:

    require_login setting  AND  (a local account exists  OR  Cf-Access is configured)

The right-hand side is the "never lock the owner out" clause. A fresh
deployment with no account and no Access in front has NO way to satisfy a
login prompt, so demanding one would brick the app for its own owner; there
is also nothing server-side to protect yet (no users means no shares, no
tokens, no sessions). The moment either credential path exists, the gate
turns itself on — the operator does not have to remember a second switch.
`VSNOTE_REQUIRE_LOGIN` (default true) is the explicit off switch for the
one case the conjunction can't infer: a deployment that has accounts but
deliberately wants the shell open (the e2e suite is exactly this, see
`tests/e2e/shareFixtures.ts`).

Client semantics (see `docs/ARCHITECTURE.md`'s login-gate section): the gate
applies only to a DEFINITE `login_required: true` from a REACHABLE backend.
An unreachable backend never gates — CLAUDE.md rule 3's local-first
guarantee wins, an already-loaded or PWA-cached app keeps editing its own
IndexedDB clone offline, and every server-side surface (sync, shares) stays
authenticated on the server side regardless of what the client renders.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import models, schemas
from ..config import Settings


def build_router(get_db, settings: Settings) -> APIRouter:
    router = APIRouter(tags=["app-config"])

    @router.get("/app-config", response_model=schemas.AppConfigOut)
    def get_app_config(db: Session = Depends(get_db)) -> schemas.AppConfigOut:
        cf_access = bool(settings.cf_access_team_domain and settings.cf_access_aud)
        password_login = db.query(models.User).filter(models.User.password_hash.isnot(None)).count() > 0
        return schemas.AppConfigOut(
            login_required=settings.require_login and (cf_access or password_login),
            password_login=password_login,
            cf_access=cf_access,
        )

    return router
