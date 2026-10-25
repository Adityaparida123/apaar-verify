from collections.abc import Mapping
from typing import Any

from google.auth.exceptions import GoogleAuthError
from google.auth.transport.requests import Request
from google.oauth2 import id_token


class GoogleIdentityError(Exception):
    pass


def verify_google_identity(credential: str, client_id: str) -> str:
    try:
        claims: Mapping[str, Any] = id_token.verify_oauth2_token(
            credential,
            Request(),
            audience=client_id,
        )
    except (GoogleAuthError, ValueError) as exc:
        raise GoogleIdentityError from exc

    email = claims.get("email")
    if (
        claims.get("iss") not in {"accounts.google.com", "https://accounts.google.com"}
        or claims.get("aud") != client_id
        or not isinstance(email, str)
        or not email.strip()
        or claims.get("email_verified") is not True
    ):
        raise GoogleIdentityError
    return email.strip().casefold()
