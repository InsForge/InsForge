"""
InsForge Python SDK

Official Python client for InsForge - Backend-as-a-Service platform.

Usage:
    from insforge import create_client

    client = create_client(
        base_url="https://your-app.region.insforge.app",
        anon_key="your-anon-key"
    )
"""

from .client import InsForgeClient, create_client

__all__ = ["InsForgeClient", "create_client"]
__version__ = "1.0.0"
