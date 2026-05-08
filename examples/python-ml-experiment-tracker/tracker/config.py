from __future__ import annotations

import dataclasses
import json
import os
from pathlib import Path
from typing import Any

CONFIG_DIR = Path.home() / ".config" / "ml-tracker"
CONFIG_FILE = CONFIG_DIR / "config.json"
DEFAULT_SERVER_URL = "http://localhost:7130"


@dataclasses.dataclass
class Config:
    """Persisted configuration for the tracker CLI, stored at ~/.config/ml-tracker/config.json."""

    server_url: str = DEFAULT_SERVER_URL
    access_token: str | None = None
    refresh_token: str | None = None
    user_email: str | None = None

    def to_dict(self) -> dict[str, Any]:
        """Serialise the config to a plain dict suitable for JSON encoding."""
        return dataclasses.asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Config":
        """Deserialise a config from a plain dict, applying defaults for missing keys."""
        return cls(
            server_url=data.get("server_url", DEFAULT_SERVER_URL),
            access_token=data.get("access_token"),
            refresh_token=data.get("refresh_token"),
            user_email=data.get("user_email"),
        )


def load_config() -> Config:
    """Load the config from disk, returning defaults if the file does not exist."""
    if not CONFIG_FILE.exists():
        return Config()
    with CONFIG_FILE.open("r") as f:
        data = json.load(f)
    return Config.from_dict(data)


def save_config(config: Config) -> None:
    """Atomically write config to disk with 0o600 permissions, protecting token data."""
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    tmp = CONFIG_FILE.with_suffix(".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(config.to_dict(), f, indent=2)
    tmp.replace(CONFIG_FILE)


def update_tokens(access_token: str, refresh_token: str) -> None:
    """Reload config from disk, replace both tokens, and save."""
    cfg = load_config()
    cfg.access_token = access_token
    cfg.refresh_token = refresh_token
    save_config(cfg)


def clear_tokens() -> None:
    """Clear stored access and refresh tokens from the config file."""
    cfg = load_config()
    cfg.access_token = None
    cfg.refresh_token = None
    save_config(cfg)
