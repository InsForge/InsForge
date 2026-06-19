"""
InsForge Python SDK client.

Usage:
    from insforge import create_client

    client = create_client(
        base_url="https://your-app.region.insforge.app",
        anon_key="your-anon-key",
    )

    # Authentication
    result = client.auth.sign_up(email="user@example.com", password="pass123")

    # Database
    result = client.database.from_("posts").select().eq("status", "active").execute()

    # Storage
    result = client.storage.from_("images").upload("cover.jpg", file_bytes, "image/jpeg")

    # AI
    response = client.ai.chat.completions.create(
        model="anthropic/claude-3.5-haiku",
        messages=[{"role": "user", "content": "Hello!"}],
    )

    # Functions
    result = client.functions.invoke("hello-world", body={"name": "World"})

    # Realtime
    client.realtime.connect()
    client.realtime.subscribe("chat:room-1")
    client.realtime.on("new_message", lambda p: print(p))
"""

from __future__ import annotations

from .ai import AIClient
from .auth import AuthClient
from .database import DatabaseClient
from .functions import FunctionsClient
from .http import HttpClient
from .realtime import RealtimeClient
from .storage import StorageClient


class InsForgeClient:
    """
    Main InsForge client.

    Instantiate via :func:`create_client` rather than directly.

    Attributes:
        auth: Authentication operations.
        database: Database CRUD and RPC.
        storage: File upload/download.
        ai: Chat completions, embeddings, image generation.
        functions: Serverless function invocation.
        realtime: WebSocket pub/sub.
    """

    def __init__(
        self,
        *,
        base_url: str,
        anon_key: str | None = None,
        edge_function_token: str | None = None,
        timeout: int = 30,
    ) -> None:
        """
        Create an InsForge client.

        Args:
            base_url: Your InsForge backend URL
                      (e.g., 'https://your-app.region.insforge.app').
            anon_key: Your project's anonymous key (get from backend metadata).
            edge_function_token: Bearer token for use inside edge functions
                                 (pass the user JWT from the request header).
            timeout: HTTP request timeout in seconds (default: 30).
        """
        if not base_url:
            raise ValueError("base_url is required")
        if not anon_key and not edge_function_token:
            raise ValueError("either anon_key or edge_function_token is required")

        self._http = HttpClient(
            base_url=base_url,
            anon_key=anon_key or "",
            edge_function_token=edge_function_token,
            timeout=timeout,
        )

        self.auth = AuthClient(self._http)
        self.database = DatabaseClient(self._http)
        self.storage = StorageClient(self._http)
        self.ai = AIClient(self._http)
        self.functions = FunctionsClient(self._http)
        self.realtime = RealtimeClient(self._http)


def create_client(
    *,
    base_url: str,
    anon_key: str | None = None,
    edge_function_token: str | None = None,
    timeout: int = 30,
) -> InsForgeClient:
    """
    Create and return an :class:`InsForgeClient` instance.

    Args:
        base_url: Your InsForge backend URL.
        anon_key: Your project's anonymous key.
        edge_function_token: Bearer token for edge function contexts.
        timeout: HTTP request timeout in seconds.

    Returns:
        Configured :class:`InsForgeClient`.

    Example::

        from insforge import create_client

        client = create_client(
            base_url="https://your-app.region.insforge.app",
            anon_key="your-anon-key",
        )
    """
    return InsForgeClient(
        base_url=base_url,
        anon_key=anon_key,
        edge_function_token=edge_function_token,
        timeout=timeout,
    )
