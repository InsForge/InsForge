"""
Core HTTP client for InsForge SDK.
Handles authentication, request building, and response parsing.
"""

from __future__ import annotations

import threading
from typing import Any
from urllib.parse import urljoin

import requests
from requests import Response, Session


class InsForgeError(Exception):
    """Raised when the InsForge API returns an error response."""

    def __init__(
        self,
        message: str,
        status_code: int | None = None,
        error_code: str | None = None,
        next_actions: str | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.error_code = error_code
        self.next_actions = next_actions

    def __repr__(self) -> str:
        return (
            f"InsForgeError(message={self.message!r}, "
            f"status_code={self.status_code}, "
            f"error_code={self.error_code!r})"
        )


class _SessionState:
    """Thread-safe in-memory session storage."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._access_token: str | None = None
        self._refresh_token: str | None = None
        self._csrf_token: str | None = None
        self._user: dict[str, Any] | None = None

    def set(
        self,
        *,
        access_token: str | None = None,
        refresh_token: str | None = None,
        csrf_token: str | None = None,
        user: dict[str, Any] | None = None,
    ) -> None:
        with self._lock:
            if access_token is not None:
                self._access_token = access_token
            if refresh_token is not None:
                self._refresh_token = refresh_token
            if csrf_token is not None:
                self._csrf_token = csrf_token
            if user is not None:
                self._user = user

    def clear(self) -> None:
        with self._lock:
            self._access_token = None
            self._refresh_token = None
            self._csrf_token = None
            self._user = None

    @property
    def access_token(self) -> str | None:
        with self._lock:
            return self._access_token

    @property
    def refresh_token(self) -> str | None:
        with self._lock:
            return self._refresh_token

    @property
    def csrf_token(self) -> str | None:
        with self._lock:
            return self._csrf_token

    @property
    def user(self) -> dict[str, Any] | None:
        with self._lock:
            return self._user


class HttpClient:
    """Low-level HTTP client used by all SDK modules."""

    def __init__(
        self,
        base_url: str,
        anon_key: str,
        edge_function_token: str | None = None,
        timeout: int = 30,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.anon_key = anon_key
        self.edge_function_token = edge_function_token
        self.timeout = timeout
        self._session = Session()
        self._state = _SessionState()

        if edge_function_token:
            self._state.set(access_token=edge_function_token)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _get_auth_token(self) -> str:
        """Return the best available bearer token."""
        return self._state.access_token or self.anon_key

    def _build_headers(self, extra: dict[str, str] | None = None) -> dict[str, str]:
        headers: dict[str, str] = {
            "Authorization": f"Bearer {self._get_auth_token()}",
            "Content-Type": "application/json",
        }
        if extra:
            headers.update(extra)
        return headers

    @staticmethod
    def _raise_for_error(response: Response) -> None:
        if response.ok:
            return
        try:
            body = response.json()
        except Exception:
            body = {}
        raise InsForgeError(
            message=body.get("message", response.text or "Unknown error"),
            status_code=response.status_code,
            error_code=body.get("error"),
            next_actions=body.get("nextActions"),
        )

    def _url(self, path: str) -> str:
        return urljoin(self.base_url + "/", path.lstrip("/"))

    # ------------------------------------------------------------------
    # HTTP verbs
    # ------------------------------------------------------------------

    def get(
        self,
        path: str,
        params: dict[str, Any] | None = None,
        extra_headers: dict[str, str] | None = None,
    ) -> Any:
        r = self._session.get(
            self._url(path),
            params=params,
            headers=self._build_headers(extra_headers),
            timeout=self.timeout,
        )
        self._raise_for_error(r)
        return r.json() if r.content else None

    def post(
        self,
        path: str,
        data: Any = None,
        params: dict[str, Any] | None = None,
        extra_headers: dict[str, str] | None = None,
        raw: bool = False,
    ) -> Any:
        headers = self._build_headers(extra_headers)
        r = self._session.post(
            self._url(path),
            json=data,
            params=params,
            headers=headers,
            timeout=self.timeout,
        )
        self._raise_for_error(r)
        if raw:
            return r
        return r.json() if r.content else None

    def patch(
        self,
        path: str,
        data: Any = None,
        params: dict[str, Any] | None = None,
        extra_headers: dict[str, str] | None = None,
    ) -> Any:
        r = self._session.patch(
            self._url(path),
            json=data,
            params=params,
            headers=self._build_headers(extra_headers),
            timeout=self.timeout,
        )
        self._raise_for_error(r)
        return r.json() if r.content else None

    def put(
        self,
        path: str,
        data: Any = None,
        extra_headers: dict[str, str] | None = None,
        files: dict[str, Any] | None = None,
    ) -> Any:
        headers = self._build_headers(extra_headers)
        if files:
            # multipart upload — drop Content-Type so requests sets boundary
            headers.pop("Content-Type", None)
            r = self._session.put(
                self._url(path),
                files=files,
                headers=headers,
                timeout=self.timeout,
            )
        else:
            r = self._session.put(
                self._url(path),
                json=data,
                headers=headers,
                timeout=self.timeout,
            )
        self._raise_for_error(r)
        return r.json() if r.content else None

    def delete(
        self,
        path: str,
        params: dict[str, Any] | None = None,
        data: Any = None,
        extra_headers: dict[str, str] | None = None,
    ) -> Any:
        r = self._session.delete(
            self._url(path),
            json=data,
            params=params,
            headers=self._build_headers(extra_headers),
            timeout=self.timeout,
        )
        self._raise_for_error(r)
        return r.json() if r.content else None

    def post_multipart(
        self,
        path: str,
        files: dict[str, Any],
        data: dict[str, Any] | None = None,
        extra_headers: dict[str, str] | None = None,
    ) -> Any:
        headers = self._build_headers(extra_headers)
        headers.pop("Content-Type", None)  # let requests set multipart boundary
        r = self._session.post(
            self._url(path),
            files=files,
            data=data,
            headers=headers,
            timeout=self.timeout,
        )
        self._raise_for_error(r)
        return r.json() if r.content else None

    def get_raw(
        self,
        path: str,
        extra_headers: dict[str, str] | None = None,
    ) -> bytes:
        r = self._session.get(
            self._url(path),
            headers=self._build_headers(extra_headers),
            timeout=self.timeout,
        )
        self._raise_for_error(r)
        return r.content

    def post_external(
        self,
        url: str,
        files: dict[str, Any] | None = None,
        data: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> Response:
        """POST to an external URL (e.g., S3 presigned upload)."""
        r = self._session.post(url, files=files, data=data, headers=headers, timeout=self.timeout)
        r.raise_for_status()
        return r

    def put_external(
        self,
        url: str,
        content: bytes,
        content_type: str,
    ) -> None:
        """PUT raw bytes to an external URL."""
        r = self._session.put(
            url,
            data=content,
            headers={"Content-Type": content_type},
            timeout=self.timeout,
        )
        r.raise_for_status()
