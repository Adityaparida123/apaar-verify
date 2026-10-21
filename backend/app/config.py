from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    mongodb_uri: str | None = None
    mongodb_database: str = "apaar_verify"
    jwt_secret: str | None = None
    jwt_expire_minutes: int = Field(default=60, ge=1, le=1440)
    frontend_origin: str = "http://localhost:3000"
    demo_mode: bool = False
    demo_admin_email: str = "admin@example.test"
    demo_admin_password: str | None = None
    demo_official_password: str | None = None
    demo_verifier_password: str | None = None
    max_csv_file_bytes: int = Field(default=2_097_152, ge=1_024)
    max_csv_rows: int = Field(default=1000, ge=1, le=1000)


@lru_cache
def get_settings() -> Settings:
    return Settings()
