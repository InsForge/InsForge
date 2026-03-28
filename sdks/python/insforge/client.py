"""InsForge Python client."""
from __future__ import annotations

from typing import Any

from insforge.lib.http_client import HttpClient
from insforge.modules.ai import AI
from insforge.modules.auth import Auth
from insforge.modules.database import Database
from insforge.modules.email import Emails
from insforge.modules.functions import Functions
from insforge.modules.realtime import Realtime
from insforge.modules.storage import Storage


class InsForgeClient:
    """
    Main InsForge client.

    Usage::

        from insforge import create_client

        client = create_client(
            base_url="https://your-app.region.insforge.app",
            anon_key="your-anon-key",
        )

        # Auth
        result = await client.auth.sign_in_with_password(email="...", password="...")

        # Database
        result = await client.database.from_("users").select("*").eq("active", True).execute()

        # Storage
        result = await client.storage.from_("avatars").upload("user.png", file_bytes)

        # AI
        result = await client.ai.chat.completions.create(
            model="openai/gpt-4o",
            messages=[{"role": "user", "content": "Hello!"}],
        )
    """

    def __init__(
        self,
        base_url: str = "http://localhost:7130",
        anon_key: str | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        self._http = HttpClient(base_url=base_url, anon_key=anon_key, headers=headers)
        self.auth = Auth(self._http)
        self.database = Database(self._http)
        self.storage = Storage(self._http)
        self.ai = AI(self._http)
        self.functions = Functions(self._http)
        self.realtime = Realtime(self._http)
        self.emails = Emails(self._http)

    def get_http_client(self) -> HttpClient:
        """Return the underlying HTTP client (for advanced use)."""
        return self._http

    async def aclose(self) -> None:
        """Close the underlying HTTP client."""
        await self._http.aclose()

    async def __aenter__(self) -> InsForgeClient:
        return self

    async def __aexit__(self, *_: Any) -> None:
        await self.aclose()
