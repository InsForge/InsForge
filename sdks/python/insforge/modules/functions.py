"""Functions module - invoke serverless edge functions."""
from __future__ import annotations

from typing import Any, Literal

from insforge.errors import InsForgeError
from insforge.lib.http_client import HttpClient


class Functions:
    def __init__(self, http: HttpClient) -> None:
        self._http = http

    async def invoke(
        self,
        slug: str,
        *,
        body: Any = None,
        headers: dict[str, str] | None = None,
        method: Literal["GET", "POST", "PUT", "PATCH", "DELETE"] = "POST",
    ) -> dict[str, Any]:
        """Invoke a deployed edge function by its slug."""
        path = f"/functions/{slug}"
        try:
            if method == "GET":
                data = await self._http.get(path, headers=headers)
            elif method == "POST":
                data = await self._http.post(path, body, headers=headers)
            elif method == "PUT":
                data = await self._http.put(path, body, headers=headers)
            elif method == "PATCH":
                data = await self._http.patch(path, body, headers=headers)
            elif method == "DELETE":
                data = await self._http.delete(path, headers=headers)
            else:
                data = await self._http.post(path, body, headers=headers)
            return {"data": data, "error": None}
        except InsForgeError as e:
            return {"data": None, "error": e}
        except Exception as e:
            return {"data": None, "error": e}
