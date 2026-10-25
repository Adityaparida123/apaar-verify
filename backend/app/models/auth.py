from pydantic import EmailStr, Field

from app.models.common import APIModel, Role


class LoginRequest(APIModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=256)


class GoogleLoginRequest(APIModel):
    credential: str = Field(min_length=1, max_length=8192)


class UserResponse(APIModel):
    user_id: str
    email: EmailStr
    role: Role
    institution_id: str | None


class TokenResponse(APIModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
