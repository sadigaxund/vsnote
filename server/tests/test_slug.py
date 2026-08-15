"""Slug generation entropy + format validation (roadmap §1)."""

from __future__ import annotations

import math

import pytest

from app import security


def test_slug_entropy_at_least_128_bits():
    length = security.SLUG_LENGTH
    bits = length * math.log2(len(security.SLUG_ALPHABET))
    assert bits >= 128, f"slug entropy {bits} bits < 128"


def test_generated_slug_matches_own_alphabet_and_regex():
    for _ in range(200):
        slug = security.generate_slug()
        assert len(slug) == security.SLUG_LENGTH
        assert all(c in security.SLUG_ALPHABET for c in slug)
        assert security.validate_slug_format(slug)


def test_generated_slug_is_not_a_hash_of_anything_deterministic():
    # Two calls must differ — a slug must never be reproducible from content
    # or path (roadmap §1: "NOT a hash of content or path").
    slugs = {security.generate_slug() for _ in range(50)}
    assert len(slugs) == 50


@pytest.mark.parametrize(
    "candidate,expected",
    [
        ("a" * 8, True),  # minimum length
        ("a" * 64, True),  # maximum length
        ("Abc123_-XYZ", True),
        ("a" * 7, False),  # too short
        ("a" * 65, False),  # too long
        ("", False),
        ("has a space", False),
        ("has/slash", False),
        ("has.dot", False),
        ("emoji😀aaaaaa", False),
        ("../../etc/passwd", False),
        ("' OR 1=1 --", False),
        ("<script>aaaa", False),
        ("null\x00byte1", False),
    ],
)
def test_slug_regex_accept_reject_table(candidate: str, expected: bool):
    assert security.validate_slug_format(candidate) is expected
