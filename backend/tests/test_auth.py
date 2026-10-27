from collections.abc import Mapping
import logging
from typing import Any

import mongomock
import pytest
from fastapi.testclient import TestClient
from google.auth.exceptions import GoogleAuthError
from pymongo.errors import AutoReconnect

from app.config import get_settings
from app.main import create_app
from app.security import DUMMY_PASSWORD_HASH, hash_password
from app.services.google_auth_service import (
    GoogleIdentityError,
    verify_google_identity,
)

GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com"


@pytest.fixture
def database(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "test-only-secret-that-is-not-used-outside-tests")
    monkeypatch.setenv("GOOGLE_CLIENT_ID", GOOGLE_CLIENT_ID)
    get_settings.cache_clear()
    database = mongomock.MongoClient(tz_aware=True).get_database("test_auth")
    yield database
    get_settings.cache_clear()


def make_user(**overrides: Any) -> dict[str, Any]:
    user = {
        "user_id": "admin-1",
        "email": "Admin@example.com",
        "email_normalized": "admin@example.com",
        "password_hash": hash_password("test-password"),
        "role": "institution_admin",
        "institution_id": "I-1",
        "active": True,
    }
    user.update(overrides)
    return user


def verified_claims(**overrides: Any) -> dict[str, Any]:
    claims = {
        "iss": "https://accounts.google.com",
        "aud": GOOGLE_CLIENT_ID,
        "email": "ADMIN@example.com",
        "email_verified": True,
        "role": "aicte_official",
    }
    claims.update(overrides)
    return claims


def test_google_login_issues_existing_session_and_preserves_account_role(database, monkeypatch):
    database.users.insert_one(make_user())
    monkeypatch.setattr(
        "app.routes.auth.verify_google_identity",
        lambda credential, client_id: "admin@example.com",
    )
    app = create_app(database)

    with TestClient(app) as client:
        response = client.post("/api/v1/auth/google", json={"credential": "verified-google-token"})
        me = client.get(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {response.json()['access_token']}"},
        )

    assert response.status_code == 200
    assert response.json()["token_type"] == "bearer"
    assert me.status_code == 200
    assert me.json() == {
        "user_id": "admin-1",
        "email": "Admin@example.com",
        "role": "institution_admin",
        "institution_id": "I-1",
    }
    assert database.users.find_one({"user_id": "admin-1"})["role"] == "institution_admin"
    assert database.audit_logs.count_documents({"action": "auth.google_login", "outcome": "success"}) == 1


@pytest.mark.parametrize(
    ("user", "claims"),
    [
        (None, verified_claims()),
        (make_user(active=False), verified_claims()),
        (make_user(), verified_claims(email_verified=False)),
    ],
    ids=["unknown-email", "inactive-account", "unverified-email"],
)
def test_google_login_rejects_unavailable_accounts_without_disclosure(database, monkeypatch, user, claims):
    if user is not None:
        database.users.insert_one(user)

    def verify_identity(credential: str, client_id: str) -> str:
        if not claims["email_verified"]:
            raise GoogleIdentityError
        return claims["email"].casefold()

    monkeypatch.setattr("app.routes.auth.verify_google_identity", verify_identity)
    app = create_app(database)

    with TestClient(app) as client:
        response = client.post("/api/v1/auth/google", json={"credential": "unaccepted-token"})

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid Google credentials"
    assert database.audit_logs.count_documents({"action": "auth.google_login"}) == 0


@pytest.mark.parametrize(
    "claims",
    [
        verified_claims(iss="https://attacker.example"),
        verified_claims(aud="another-client-id"),
        verified_claims(email_verified=False),
        verified_claims(email="  "),
    ],
    ids=["invalid-issuer", "wrong-audience", "unverified-email", "empty-email"],
)
def test_google_identity_rejects_untrusted_claims(monkeypatch, claims):
    monkeypatch.setattr(
        "app.services.google_auth_service.id_token.verify_oauth2_token",
        lambda credential, request, audience: claims,
    )

    with pytest.raises(GoogleIdentityError):
        verify_google_identity("test-token", GOOGLE_CLIENT_ID)


@pytest.mark.parametrize(
    "verification_error",
    [
        ValueError("signature rejected"),
        ValueError("token expired"),
        ValueError("malformed token"),
        GoogleAuthError("Google token verification failed"),
    ],
    ids=["invalid-signature", "expired-token", "malformed-token", "google-auth-error"],
)
def test_google_identity_verification_failures_are_generic(
    database, monkeypatch, verification_error
):
    database.users.insert_one(make_user())
    monkeypatch.setattr(
        "app.services.google_auth_service.id_token.verify_oauth2_token",
        lambda credential, request, audience: (_ for _ in ()).throw(verification_error),
    )
    app = create_app(database)

    with TestClient(app) as client:
        response = client.post("/api/v1/auth/google", json={"credential": "invalid-token"})

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid Google credentials"
    assert "signature" not in response.text
    assert "expired" not in response.text
    assert database.audit_logs.count_documents({"action": "auth.google_login"}) == 0


def test_google_verifier_uses_configured_audience_and_normalizes_verified_email(monkeypatch):
    captured: dict[str, Any] = {}

    def fake_verify(credential: str, request: Any, audience: str) -> Mapping[str, Any]:
        captured["credential"] = credential
        captured["audience"] = audience
        return verified_claims()

    monkeypatch.setattr(
        "app.services.google_auth_service.id_token.verify_oauth2_token",
        fake_verify,
    )

    email = verify_google_identity("test-token", GOOGLE_CLIENT_ID)

    assert email == "admin@example.com"
    assert captured == {"credential": "test-token", "audience": GOOGLE_CLIENT_ID}


def test_password_login_still_issues_session_and_audits_success(database):
    database.users.insert_one(make_user())
    app = create_app(database)

    with TestClient(app) as client:
        response = client.post(
            "/api/v1/auth/login",
            json={"email": "ADMIN@example.com", "password": "test-password"},
        )
        me = client.get(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {response.json()['access_token']}"},
        )

    assert response.status_code == 200
    assert me.status_code == 200
    assert me.json()["role"] == "institution_admin"
    assert database.audit_logs.count_documents({"action": "auth.login", "outcome": "success"}) == 1


@pytest.mark.parametrize(
    ("account_state", "password"),
    [
        ("unknown", "test-password"),
        ("active", "wrong-password"),
        ("inactive", "test-password"),
    ],
    ids=["unknown-email", "wrong-password", "inactive-account"],
)
def test_password_login_rejects_invalid_credentials_generically(
    database, caplog, account_state, password
):
    if account_state != "unknown":
        database.users.insert_one(make_user(active=account_state == "active"))
    email = "unknown@example.com" if account_state == "unknown" else "admin@example.com"
    app = create_app(database)

    with caplog.at_level(logging.INFO, logger="apaar_verify"):
        with TestClient(app) as client:
            response = client.post(
                "/api/v1/auth/login",
                json={"email": email, "password": password},
            )

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid email or password"
    assert database.audit_logs.count_documents({"action": "auth.login"}) == 0
    assert "argon2_verification" in caplog.text
    assert email not in caplog.text
    assert password not in caplog.text


def test_unknown_account_is_rejected_even_when_dummy_verification_matches(database, monkeypatch):
    monkeypatch.setattr(
        "app.routes.auth.verify_password",
        lambda password, password_digest: password_digest == DUMMY_PASSWORD_HASH,
    )
    app = create_app(database)

    with TestClient(app) as client:
        response = client.post(
            "/api/v1/auth/login",
            json={"email": "unknown@example.com", "password": "irrelevant"},
        )

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid email or password"
    assert database.audit_logs.count_documents({"action": "auth.login"}) == 0


def test_login_timing_logs_contain_only_safe_metrics(database, caplog):
    database.users.insert_one(make_user())
    app = create_app(database)

    with caplog.at_level(logging.INFO, logger="apaar_verify"):
        with TestClient(app) as client:
            response = client.post(
                "/api/v1/auth/login",
                json={"email": "ADMIN@example.com", "password": "test-password"},
            )
            token = response.json()["access_token"]
            me = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 200
    assert me.status_code == 200
    for metric in (
        "auth.login_request",
        "auth.me_request",
        "mongodb_account_lookup",
        "argon2_verification",
        "jwt_creation",
    ):
        assert metric in caplog.text
    assert "test-password" not in caplog.text
    assert "admin@example.com" not in caplog.text
    assert token not in caplog.text


def test_database_outages_return_503_and_readiness_still_pings(database, monkeypatch):
    database.users.insert_one(make_user())
    app = create_app(database)

    def database_unavailable(*_args: Any, **_kwargs: Any) -> None:
        raise AutoReconnect("database unavailable")

    with TestClient(app) as client:
        monkeypatch.setattr(database, "command", database_unavailable)
        login_response = client.post(
            "/api/v1/auth/login",
            json={"email": "admin@example.com", "password": "test-password"},
        )
        readiness_response = client.get("/ready")

    assert login_response.status_code == 200
    assert readiness_response.status_code == 503
    assert readiness_response.json()["detail"] == "Database is unavailable"


def test_database_operation_failures_return_503(database, monkeypatch):
    app = create_app(database)

    def database_unavailable(*_args: Any, **_kwargs: Any) -> None:
        raise AutoReconnect("database unavailable")

    monkeypatch.setattr(database.users, "find_one", database_unavailable)
    with TestClient(app) as client:
        response = client.post(
            "/api/v1/auth/login",
            json={"email": "admin@example.com", "password": "test-password"},
        )

    assert response.status_code == 503
    assert response.json()["detail"] == "Database is unavailable"


def test_google_login_requires_server_client_id(database, monkeypatch):
    monkeypatch.delenv("GOOGLE_CLIENT_ID", raising=False)
    get_settings.cache_clear()
    app = create_app(database)

    with TestClient(app) as client:
        response = client.post("/api/v1/auth/google", json={"credential": "test-token"})

    assert response.status_code == 503
    assert response.json()["detail"] == "Google sign-in is not configured"
