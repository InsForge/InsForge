from __future__ import annotations

import json
from typing import Any

import httpx

from insforge.errors import InsForgeError


class HttpClient:
    def __init__(
        self,
        base_url: str,
        anon_key: str | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._anon_key = anon_key
        self._extra_headers = headers or {}
        self._access_token: str | None = None
        self._client = httpx.AsyncClient(timeout=30.0)

    def set_access_token(self, token: str | None) -> None:
        self._access_token = token

    def _auth_header(self) -> dict[str, str]:
        token = self._access_token or self._anon_key
        if token:
            return {"Authorization": f"Bearer {token}"}
        return {}

    def _build_headers(self, extra: dict[str, str] | None = None) -> dict[str, str]:
        headers = {
            "Content-Type": "application/json",
            **self._extra_headers,
            **self._auth_header(),
        }
        if extra:
            headers.update(extra)
        return headers

    async def _request(
        self,
        method: str,
        path: str,
        *,
        json_body: Any = None,
        params: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
        content: bytes | None = None,
        content_type: str | None = None,
    ) -> Any:
        url = f"{self._base_url}{path}"
        req_headers = self._build_headers(headers)
        if content_type:
            req_headers["Content-Type"] = content_type
        if content is not None:
            req_headers.pop("Content-Type", None)

        response = await self._client.request(
            method,
            url,
            headers=req_headers,
            json=json_body,
            params=params,
            content=content,
        )

        if response.status_code >= 400:
            try:
                body = response.json()
            except Exception:
                body = {"error": {"message": response.text}}
            raise InsForgeError.from_response(body, response.status_code)

        if response.status_code == 204 or not response.content:
            return None

        return response.json()

    async def get(self, path: str, *, params: dict[str, Any] | None = None, headers: dict[str, str] | None = None) -> Any:
        return await self._request("GET", path, params=params, headers=headers)

    async def post(self, path: str, body: Any = None, *, params: dict[str, Any] | None = None, headers: dict[str, str] | None = None) -> Any:
        return await self._request("POST", path, json_body=body, params=params, headers=headers)

    async def put(self, path: str, body: Any = None, *, headers: dict[str, str] | None = None) -> Any:
        return await self._request("PUT", path, json_body=body, headers=headers)

    async def patch(self, path: str, body: Any = None, *, headers: dict[str, str] | None = None) -> Any:
        return await self._request("PATCH", path, json_body=body, headers=headers)

    async def delete(self, path: str, *, params: dict[str, Any] | None = None, headers: dict[str, str] | None = None) -> Any:
        return await self._request("DELETE", path, params=params, headers=headers)

    async def upload(self, path: str, data: bytes, content_type: str, *, headers: dict[str, str] | None = None) -> Any:
        req_headers = self._build_headers(headers)
        req_headers["Content-Type"] = content_type
        response = await self._client.put(
            f"{self._base_url}{path}",
            content=data,
            headers=req_headers,
        )
        if response.status_code >= 400:
            try:
                body = response.json()
            except Exception:
                body = {"error": {"message": response.text}}
            raise InsForgeError.from_response(body, response.status_code)
        if not response.content:
            return None
        return response.json()

    async def download_bytes(self, path: str) -> bytes:
        url = f"{self._base_url}{path}"
        response = await self._client.get(url, headers=self._build_headers())
        if response.status_code >= 400:
            try:
                body = response.json()
            except Exception:
                body = {"error": {"message": response.text}}
            raise InsForgeError.from_response(body, response.status_code)
        return response.content

    async def aclose(self) -> None:
        await self._client.aclose()

    async def __aenter__(self) -> HttpClient:
        return self

    async def __aexit__(self, *_: Any) -> None:
        await self.aclose()
