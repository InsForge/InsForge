"""
Storage module for the InsForge Python SDK.

Usage:
    result = client.storage.from_("images").upload("posts/cover.jpg", file_bytes, "image/jpeg")
    result = client.storage.from_("uploads").upload_auto(file_bytes, "image/png")
    data   = client.storage.from_("images").download("posts/cover.jpg")
    result = client.storage.from_("images").remove("posts/cover.jpg")
"""

from __future__ import annotations

import io
import mimetypes
import uuid
from typing import Any, BinaryIO

from requests import RequestException

from .http import InsForgeError


class StorageBucket:
    """Scoped operations on a single bucket."""

    def __init__(self, http: Any, bucket_name: str) -> None:
        self._http = http
        self._bucket = bucket_name

    # ------------------------------------------------------------------
    # Upload
    # ------------------------------------------------------------------

    def upload(
        self,
        path: str,
        file: bytes | BinaryIO,
        content_type: str | None = None,
    ) -> dict[str, Any]:
        """
        Upload a file at the given path/key.

        Uses the new upload-strategy API automatically:
        - For local storage → direct PUT
        - For S3 → presigned POST then confirm

        Args:
            path: Object key (e.g. "users/avatar.jpg").
            file: File bytes or a file-like object.
            content_type: MIME type. Auto-detected from path if omitted.

        Returns:
            Dict with keys: bucket, key, size, mime_type, uploaded_at, url.

        Raises:
            InsForgeError: On API error.
        """
        if isinstance(file, (bytes, bytearray)):
            content = bytes(file)
        else:
            content = file.read()

        if content_type is None:
            content_type, _ = mimetypes.guess_type(path)
            content_type = content_type or "application/octet-stream"

        filename = path
        size = len(content)

        # Step 1: get upload strategy
        strategy = self._http.post(
            f"/api/storage/buckets/{self._bucket}/upload-strategy",
            data={"filename": filename, "contentType": content_type, "size": size},
        )

        method = strategy.get("method", "direct")
        upload_url = strategy["uploadUrl"]
        key = strategy["key"]
        confirm_required = strategy.get("confirmRequired", False)

        if method == "presigned":
            # S3 presigned POST
            fields = strategy.get("fields", {})
            multipart_data = {k: (None, v) for k, v in fields.items()}
            multipart_data["file"] = (filename, io.BytesIO(content), content_type)
            self._http.post_external(upload_url, files=multipart_data)

            if confirm_required:
                # Server explicitly requires a confirm round-trip
                confirm_url = strategy["confirmUrl"]
                return self._http.post(
                    confirm_url,
                    data={"size": size, "contentType": content_type},
                )
            elif "confirmUrl" in strategy:
                # confirmUrl is present but confirmRequired is False — still call it
                return self._http.post(
                    strategy["confirmUrl"],
                    data={"size": size, "contentType": content_type},
                )
            else:
                # No confirmUrl — use the same metadata endpoint as the PUT branch
                return self._http.post(
                    f"/api/storage/buckets/{self._bucket}/objects/{key}/confirm-upload",
                    data={"size": size, "contentType": content_type},
                )
        else:
            # Direct upload via PUT
            self._http.put_external(
                self._http._url(upload_url),
                content=content,
                content_type=content_type,
            )
            # Fetch object metadata
            return self._http.post(
                f"/api/storage/buckets/{self._bucket}/objects/{key}/confirm-upload",
                data={"size": size, "contentType": content_type},
            )

    def upload_auto(
        self,
        file: bytes | BinaryIO,
        content_type: str | None = None,
        original_filename: str | None = None,
    ) -> dict[str, Any]:
        """
        Upload a file with an auto-generated unique key.

        Args:
            file: File bytes or a file-like object.
            content_type: MIME type.
            original_filename: Hint for extension detection.

        Returns:
            Dict with keys: bucket, key, size, mime_type, uploaded_at, url.
        """
        filename = original_filename or f"upload-{uuid.uuid4().hex}"
        return self.upload(filename, file, content_type)

    # ------------------------------------------------------------------
    # Download
    # ------------------------------------------------------------------

    def download(self, path: str) -> dict[str, Any]:
        """
        Download a file as bytes.

        Uses the download-strategy API:
        - Local storage → direct GET
        - S3 → fetches from presigned URL

        Args:
            path: Object key.

        Returns:
            Dict with keys: data (bytes), error.
        """
        try:
            strategy = self._http.post(
                f"/api/storage/buckets/{self._bucket}/objects/{path}/download-strategy",
                data={},
            )
            url = strategy.get("url", "")
            if url.startswith("http"):
                # External URL (S3 presigned) — use the SDK's configured session
                r = self._http._session.get(url, timeout=self._http.timeout)
                r.raise_for_status()
                return {"data": r.content, "error": None}
            else:
                # Local storage — relative URL
                content = self._http.get_raw(url)
                return {"data": content, "error": None}
        except (RequestException, InsForgeError) as exc:
            return {"data": None, "error": exc}

    # ------------------------------------------------------------------
    # Remove
    # ------------------------------------------------------------------

    def remove(self, path: str) -> dict[str, Any]:
        """
        Delete a file from the bucket.

        Args:
            path: Object key.

        Returns:
            Dict with keys: data (message), error.
        """
        try:
            result = self._http.delete(
                f"/api/storage/buckets/{self._bucket}/objects/{path}"
            )
            return {"data": result, "error": None}
        except Exception as exc:
            return {"data": None, "error": exc}

    # ------------------------------------------------------------------
    # List
    # ------------------------------------------------------------------

    def list(
        self,
        *,
        prefix: str | None = None,
        search: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> dict[str, Any]:
        """
        List objects in the bucket.

        Args:
            prefix: Filter by key prefix.
            search: Search by partial key match.
            limit: Max objects to return (1-1000).
            offset: Number of objects to skip.

        Returns:
            Dict with keys: data (list of objects), pagination, error.
        """
        params: dict[str, Any] = {"limit": limit, "offset": offset}
        if prefix:
            params["prefix"] = prefix
        if search:
            params["search"] = search
        try:
            result = self._http.get(
                f"/api/storage/buckets/{self._bucket}/objects", params=params
            )
            return {"data": result.get("data", []), "pagination": result.get("pagination"), "error": None}
        except Exception as exc:
            return {"data": None, "pagination": None, "error": exc}


class StorageClient:
    """Entry point for storage operations."""

    def __init__(self, http: Any) -> None:
        self._http = http

    def from_(self, bucket_name: str) -> StorageBucket:
        """
        Get a bucket instance for file operations.

        Args:
            bucket_name: Name of the storage bucket.

        Returns:
            StorageBucket instance.

        Example:
            bucket = client.storage.from_("images")
            result = bucket.upload("cover.jpg", data, "image/jpeg")
        """
        return StorageBucket(self._http, bucket_name)
