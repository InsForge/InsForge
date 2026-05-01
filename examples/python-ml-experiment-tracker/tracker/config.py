from __future__ import annotations

import dataclasses
import json
from pathlib import Path
from typing import Any

CONFIG_DIR = Path.home() / ".config" / "ml-tracker"
CONFIG_FILE = CONFIG_DIR / "config.json"
DEFAULT_SERVER_URL = "http://localhost:7130"


@dataclasses.dataclass
class Config:
    server_url: str = DEFAULT_SERVER_URL
    access_token: str | None = None
    refresh_token: str | None = None
    user_email: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return dataclasses.asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Config":
        return cls(
            server_url=data.get("server_url", DEFAULT_SERVER_URL),
            access_token=data.get("access_token"),
            refresh_token=data.get("refresh_token"),
            user_email=data.get("user_email"),
        )


def load_config() -> Config:
    if not CONFIG_FILE.exists():
        return Config()
    with CONFIG_FILE.open("r") as f:
        data = json.load(f)
    return Config.from_dict(data)


def save_config(config: Config) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    tmp = CONFIG_FILE.with_suffix(".tmp")
    with tmp.open("w") as f:
        json.dump(config.to_dict(), f, indent=2)
    tmp.replace(CONFIG_FILE)
    CONFIG_FILE.chmod(0o600)


def update_tokens(access_token: str, refresh_token: str) -> None:
    cfg = load_config()
    cfg.access_token = access_token
    cfg.refresh_token = refresh_token
    save_config(cfg)


def clear_tokens() -> None:
    cfg = load_config()
    cfg.access_token = None
    cfg.refresh_token = None
    save_config(cfg)
