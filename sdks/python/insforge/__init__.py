"""InsForge Python SDK."""
from insforge.client import InsForgeClient
from insforge.errors import InsForgeError


def create_client(
    base_url: str = "http://localhost:7130",
    anon_key: str | None = None,
    headers: dict | None = None,
) -> InsForgeClient:
    """
    Create a new InsForge client.

    Args:
        base_url: Your InsForge backend URL, e.g. "https://your-app.region.insforge.app"
        anon_key: Your project's anonymous API key (from backend metadata).
        headers: Optional extra headers to include on every request.

    Returns:
        An InsForgeClient instance.

    Example::

        from insforge import create_client

        client = create_client(
            base_url="https://your-app.region.insforge.app",
            anon_key="your-anon-key",
        )
    """
    return InsForgeClient(base_url=base_url, anon_key=anon_key, headers=headers)


__all__ = ["create_client", "InsForgeClient", "InsForgeError"]
__version__ = "0.1.0"
