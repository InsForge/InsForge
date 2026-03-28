"""Storage module - file upload/download."""
from __future__ import annotations

from typing import Any

from insforge.errors import InsForgeError
from insforge.lib.http_client import HttpClient


class StorageBucket:
    def __init__(self, http: HttpClient, bucket_name: str) -> None:
        self._http = http
        self._bucket = bucket_name

    def _base(self) -> str:
        return f"/api/storage/buckets/{self._bucket}"

    def get_public_url(self, path: str) -> str:
        """Return the public URL for an object (works for public buckets)."""
        clean = path.lstrip("/")
        return f"{self._http._base_url}{self._base()}/objects/{clean}"

    async def upload(
        self,
        path: str,
        data: bytes,
        *,
        content_type: str = "application/octet-stream",
    ) -> dict[str, Any]:
        """Upload a file to the bucket at the given path."""
        clean = path.lstrip("/")
        try:
            # Request upload strategy
            body: dict[str, Any] = {"filename": clean, "contentType": content_type, "size": len(data)}
            strategy = await self._http.post(f"{self._base()}/upload-strategy", body)

            method = (strategy or {}).get("method", "direct")
            upload_url: str = (strategy or {}).get("uploadUrl", "")
            key: str = (strategy or {}).get("key", clean)

            if method == "presigned":
                # S3 presigned POST: multipart/form-data with strategy fields + file content
                import httpx
                fields: dict[str, Any] = (strategy or {}).get("fields") or {}
                files = {"file": (key, data, content_type)}
                async with httpx.AsyncClient() as client:
                    resp = await client.post(upload_url, data=fields, files=files)
                    resp.raise_for_status()
                # Confirm if needed
                if (strategy or {}).get("confirmRequired"):
                    confirm_url: str = (strategy or {}).get("confirmUrl", "")
                    confirm_path = confirm_url.replace(self._http._base_url, "")
                    result = await self._http.post(confirm_path, {"size": len(data), "contentType": content_type})
                    return {"data": result, "error": None}
                return {"data": {"key": key}, "error": None}
            else:
                # Direct upload: use uploadUrl from strategy (has the URL-encoded key)
                direct_path = upload_url.replace(self._http._base_url, "") or f"{self._base()}/objects/{key}"
                result = await self._http.upload(direct_path, data, content_type)
                return {"data": result, "error": None}
        except InsForgeError as e:
            return {"data": None, "error": e}

    async def download(self, path: str) -> dict[str, Any]:
        """Download a file from the bucket. Returns raw bytes in data."""
        clean = path.lstrip("/")
        try:
            # Get download strategy
            strategy = await self._http.post(
                f"{self._base()}/objects/{clean}/download-strategy", {}
            )
            download_url: str = (strategy or {}).get("downloadUrl", "")

            if download_url and not download_url.startswith(self._http._base_url):
                import httpx
                async with httpx.AsyncClient() as client:
                    resp = await client.get(download_url)
                    resp.raise_for_status()
                    return {"data": resp.content, "error": None}
            else:
                content = await self._http.download_bytes(f"{self._base()}/objects/{clean}")
                return {"data": content, "error": None}
        except InsForgeError as e:
            return {"data": None, "error": e}

    async def list(
        self,
        *,
        prefix: str | None = None,
        search: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> dict[str, Any]:
        """List objects in the bucket."""
        params: dict[str, Any] = {"limit": limit, "offset": offset}
        if prefix:
            params["prefix"] = prefix
        if search:
            params["search"] = search
        try:
            data = await self._http.get(f"{self._base()}/objects", params=params)
            return {"data": data, "error": None}
        except InsForgeError as e:
            return {"data": None, "error": e}

    async def remove(self, path: str) -> dict[str, Any]:
        """Delete an object from the bucket."""
        clean = path.lstrip("/")
        try:
            data = await self._http.delete(f"{self._base()}/objects/{clean}")
            return {"data": data, "error": None}
        except InsForgeError as e:
            return {"data": None, "error": e}


class Storage:
    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def from_(self, bucket_name: str) -> StorageBucket:
        """Get a reference to a specific storage bucket."""
        return StorageBucket(self._http, bucket_name)
