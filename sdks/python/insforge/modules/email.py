"""Email module - send transactional emails."""
from __future__ import annotations

from typing import Any

from insforge.errors import InsForgeError
from insforge.lib.http_client import HttpClient


class Emails:
    def __init__(self, http: HttpClient) -> None:
        self._http = http

    async def send(
        self,
        *,
        to: str | list[str],
        subject: str,
        html: str,
        cc: str | list[str] | None = None,
        bcc: str | list[str] | None = None,
        from_: str | None = None,
        reply_to: str | None = None,
        text: str | None = None,
    ) -> dict[str, Any]:
        """Send a transactional email."""
        body: dict[str, Any] = {"to": to, "subject": subject, "html": html}
        if cc:
            body["cc"] = cc
        if bcc:
            body["bcc"] = bcc
        if from_:
            body["from"] = from_
        if reply_to:
            body["replyTo"] = reply_to
        if text:
            body["text"] = text
        try:
            data = await self._http.post("/api/email/send-raw", body)
            return {"data": data, "error": None}
        except InsForgeError as e:
            return {"data": None, "error": e}
