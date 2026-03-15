"""
Functions module for the InsForge Python SDK.

Usage:
    result = client.functions.invoke("hello-world", body={"name": "World"})
    result = client.functions.invoke("get-stats", method="GET")
"""

from __future__ import annotations

from typing import Any


class FunctionsClient:
    """Invoke serverless edge functions."""

    def __init__(self, http: Any) -> None:
        self._http = http

    def invoke(
        self,
        slug: str,
        *,
        body: Any | None = None,
        headers: dict[str, str] | None = None,
        method: str = "POST",
    ) -> dict[str, Any]:
        """
        Invoke a serverless function by its slug.

        Note: Function invocation uses the /functions/{slug} path,
        NOT /api/functions/{slug}.

        Args:
            slug: Function slug/name.
            body: JSON-serializable request body.
            headers: Additional request headers.
            method: HTTP method (default: POST).

        Returns:
            Dict with keys: data (function response), error.

        Raises:
            InsForgeError: On API or function execution error.
        """
        path = f"/functions/{slug}"
        try:
            m = method.upper()
            if m == "GET":
                result = self._http.get(path, extra_headers=headers)
            elif m == "POST":
                result = self._http.post(path, data=body, extra_headers=headers)
            elif m == "PUT":
                result = self._http.put(path, data=body, extra_headers=headers)
            elif m == "PATCH":
                result = self._http.patch(path, data=body, extra_headers=headers)
            elif m == "DELETE":
                result = self._http.delete(path, data=body, extra_headers=headers)
            else:
                raise ValueError(f"Unsupported HTTP method: {method}")
            return {"data": result, "error": None}
        except Exception as exc:
            return {"data": None, "error": exc}
