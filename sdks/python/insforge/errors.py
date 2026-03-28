from __future__ import annotations
from typing import Any


class InsForgeError(Exception):
    """Base error class for InsForge SDK."""

    def __init__(
        self,
        message: str,
        status_code: int = 0,
        error: str = "",
        next_actions: str | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.error = error
        self.next_actions = next_actions

    @classmethod
    def from_response(cls, body: dict[str, Any], status_code: int) -> InsForgeError:
        err = body.get("error", {})
        if isinstance(err, dict):
            message = err.get("message", str(body))
            code = err.get("code", "")
            next_actions = err.get("details")
        else:
            message = str(err) if err else str(body)
            code = ""
            next_actions = None
        return cls(message=message, status_code=status_code, error=code, next_actions=next_actions)

    def __repr__(self) -> str:
        return f"InsForgeError(message={self.message!r}, status_code={self.status_code}, error={self.error!r})"
