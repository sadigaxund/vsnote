"""§5 (docs/PLAN-2026-09-05-refresh.md) — the dynamic link map
(`app/linkmap.py`) and `back_link` resolution, exercised end-to-end through
the public `/share/{id}/content` JSON contract (the shape the Phase 10
client reader actually consumes). See `app/linkmap.py`'s module docstring
for the no-filesystem argument and the restricted/password visibility
decision this file's tests pin down.
"""

from __future__ import annotations

import time

from conftest import OWNER_EMAIL, publish_share


def _content(client, slug: str) -> dict:
    r = client.get(f"/share/{slug}", headers={"Accept": "application/json"})
    assert r.status_code == 200, r.text
    return r.json()


def test_two_post_blog_resolves_both_directions(owner_client):
    post2 = publish_share(
        owner_client,
        content=b"# Part Two\n\nBack to [part one](./part-1.md).\n",
        source_path="blog/part-2.md",
        render_mode="rendered",
        general_access="link",
        auth_mode="none",
    )
    post1 = publish_share(
        owner_client,
        content=b"# Part One\n\nRead [part two](./part-2.md) next.\n",
        source_path="blog/part-1.md",
        render_mode="rendered",
        general_access="link",
        auth_mode="none",
    )

    body1 = _content(owner_client, post1["slug"])
    assert body1["links"] == {"./part-2.md": f"/share/{post2['slug']}"}

    body2 = _content(owner_client, post2["slug"])
    assert body2["links"] == {"./part-1.md": f"/share/{post1['slug']}"}


def test_link_to_unshared_file_is_absent(owner_client):
    post = publish_share(
        owner_client,
        content=b"# Solo\n\nSee [elsewhere](./not-shared.md).\n",
        source_path="blog/solo.md",
        render_mode="rendered",
        general_access="link",
        auth_mode="none",
    )
    body = _content(owner_client, post["slug"])
    assert body["links"] == {}


def test_revoked_target_drops_out_of_the_map_immediately(owner_client):
    target = publish_share(
        owner_client,
        content=b"# Target\n",
        source_path="blog/target.md",
        render_mode="rendered",
        general_access="link",
        auth_mode="none",
    )
    source = publish_share(
        owner_client,
        content=b"# Source\n\nSee [target](./target.md).\n",
        source_path="blog/source.md",
        render_mode="rendered",
        general_access="link",
        auth_mode="none",
    )
    assert _content(owner_client, source["slug"])["links"] == {"./target.md": f"/share/{target['slug']}"}

    owner_client.delete(f"/api/shares/{target['id']}")

    # No republish of `source` needed — computed fresh on every fetch.
    assert _content(owner_client, source["slug"])["links"] == {}


def test_expired_target_drops_out_of_the_map(owner_client):
    target = publish_share(
        owner_client,
        content=b"# Target\n",
        source_path="blog/target.md",
        render_mode="rendered",
        general_access="link",
        auth_mode="none",
        expires_at=time.time() - 60,
    )
    source = publish_share(
        owner_client,
        content=b"# Source\n\nSee [target](./target.md).\n",
        source_path="blog/source.md",
        render_mode="rendered",
        general_access="link",
        auth_mode="none",
    )
    assert _content(owner_client, source["slug"])["links"] == {}
    assert target["slug"]  # sanity: target really was created


def test_another_owners_share_never_appears(owner_client, anon_client, db_session):
    from app import models, security

    other = models.User(username="other", password_hash=security.hash_password("x"), email="other@example.com")
    db_session.add(other)
    db_session.commit()

    other_client = anon_client
    r = other_client.post("/api/auth/login", json={"username": "other", "password": "x"})
    assert r.status_code == 200, r.text
    other_share = publish_share(
        other_client,
        content=b"# Other owner's post\n",
        source_path="blog/target.md",
        render_mode="rendered",
        general_access="link",
        auth_mode="none",
    )

    source = publish_share(
        owner_client,
        content=b"# Source\n\nSee [target](./target.md).\n",
        source_path="blog/source.md",
        render_mode="rendered",
        general_access="link",
        auth_mode="none",
    )
    assert _content(owner_client, source["slug"])["links"] == {}
    assert other_share["slug"]


def test_dotdot_and_absolute_inputs_never_produce_a_match_outside_the_map(owner_client):
    # A file that really does live at the vault root, so a naive resolver
    # that let ".." escape "above" the vault could accidentally match it.
    escape_target = publish_share(
        owner_client,
        content=b"# Root file\n",
        source_path="root.md",
        render_mode="rendered",
        general_access="link",
        auth_mode="none",
    )
    source = publish_share(
        owner_client,
        content=(
            b"# Source\n\n"
            b"[climb out](../../../root.md) and [absolute](/root.md) "
            b"should both resolve to nothing.\n"
        ),
        source_path="blog/nested/source.md",
        render_mode="rendered",
        general_access="link",
        auth_mode="none",
    )
    body = _content(owner_client, source["slug"])
    assert body["links"] == {}
    assert escape_target["slug"]


def test_restricted_and_password_targets_are_included_by_design(owner_client):
    """app/linkmap.py's documented visibility decision: a public blog index
    linking to a password/restricted post still resolves the link — the
    target's own policy gate still enforces itself on click."""
    password_target = publish_share(
        owner_client,
        content=b"# Members only\n",
        source_path="blog/members-only.md",
        render_mode="rendered",
        general_access="link",
        auth_mode="password",
        password="s3cret-pw",
    )
    restricted_target = publish_share(
        owner_client,
        content=b"# Restricted\n",
        source_path="blog/restricted.md",
        render_mode="rendered",
        general_access="restricted",
        auth_mode="none",
        grants=[{"principal": OWNER_EMAIL, "role": "viewer"}],
    )
    source = publish_share(
        owner_client,
        content=(
            b"# Index\n\n"
            b"[members only](./members-only.md) and [restricted](./restricted.md).\n"
        ),
        source_path="blog/index.md",
        render_mode="rendered",
        general_access="link",
        auth_mode="none",
    )
    body = _content(owner_client, source["slug"])
    assert body["links"] == {
        "./members-only.md": f"/share/{password_target['slug']}",
        "./restricted.md": f"/share/{restricted_target['slug']}",
    }


# --- back_link -------------------------------------------------------------


def test_back_link_resolves_href_and_label(owner_client):
    index = publish_share(
        owner_client,
        content=b"# Blog Index\n",
        source_path="blog/index.md",
        render_mode="rendered",
        general_access="link",
        auth_mode="none",
        alias="blog-index",
    )
    post = publish_share(
        owner_client,
        content=b"# A Post\n\nBody text.\n",
        source_path="blog/a-post.md",
        render_mode="rendered",
        general_access="link",
        auth_mode="none",
        back_link="blog-index",
    )
    body = _content(owner_client, post["slug"])
    assert body["back_link"] == {"href": f"/share/{index['alias']}", "label": "Blog Index"}


def test_back_link_omitted_when_target_revoked(owner_client):
    index = publish_share(
        owner_client,
        content=b"# Blog Index\n",
        source_path="blog/index.md",
        render_mode="rendered",
        general_access="link",
        auth_mode="none",
        alias="blog-index-2",
    )
    post = publish_share(
        owner_client,
        content=b"# A Post\n",
        source_path="blog/a-post-2.md",
        render_mode="rendered",
        general_access="link",
        auth_mode="none",
        back_link="blog-index-2",
    )
    owner_client.delete(f"/api/shares/{index['id']}")

    body = _content(owner_client, post["slug"])
    assert body["back_link"] is None


def test_back_link_omitted_when_unset(owner_client):
    post = publish_share(
        owner_client,
        content=b"# Standalone\n",
        source_path="blog/standalone.md",
        render_mode="rendered",
        general_access="link",
        auth_mode="none",
    )
    body = _content(owner_client, post["slug"])
    assert body["back_link"] is None
