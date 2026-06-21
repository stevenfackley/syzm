try:
    from pydantic_settings import BaseSettings, SettingsConfigDict

    class Settings(BaseSettings):
        app_name: str = "syzm-brain"
        env: str = "dev"
        model_uri: str = "models/latest.json"
        strategy_version: str = "2026.1"
        default_retry_delay_minutes: int = 90
        max_retries: int = 4
        timezone: str = "America/New_York"
        maintenance_start_hour: int = 1
        maintenance_end_hour: int = 3
        # API key for authenticating callers. Set SYZM_BRAIN_API_KEY in production.
        # The default is intentionally obvious so it never silently "works" in prod.
        brain_api_key: str = "dev-insecure-change-me"

        model_config = SettingsConfigDict(env_prefix="SYZM_", env_file=".env")

except ImportError:  # pragma: no cover - allows lightweight test execution without full deps
    from dataclasses import dataclass

    @dataclass
    class Settings:
        app_name: str = "syzm-brain"
        env: str = "dev"
        model_uri: str = "models/latest.json"
        strategy_version: str = "2026.1"
        default_retry_delay_minutes: int = 90
        max_retries: int = 4
        timezone: str = "America/New_York"
        maintenance_start_hour: int = 1
        maintenance_end_hour: int = 3
        brain_api_key: str = "dev-insecure-change-me"


settings = Settings()
