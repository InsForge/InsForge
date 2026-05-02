from __future__ import annotations

from typing import Any

import httpx

from tracker.config import Config, clear_tokens, load_config, update_tokens
from tracker.models import Experiment, Run


class AuthError(Exception):
    """Raised when an operation requires valid credentials that are absent or expired."""


class APIError(Exception):
    """Raised when the InsForge API returns a non-2xx response."""

    def __init__(self, status_code: int, code: str, message: str) -> None:
        """Store the HTTP status code, machine-readable error code, and human-readable message."""
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


class InsForgeClient:
    """HTTP client for the InsForge BaaS API with automatic token refresh on 401."""

    def __init__(self, config: Config | None = None) -> None:
        """Initialise the client, loading config from disk if not provided."""
        self._config = config or load_config()
        self._http = httpx.Client(
            base_url=self._config.server_url,
            timeout=30.0,
        )

    def close(self) -> None:
        """Close the underlying HTTP connection pool."""
        self._http.close()

    def __enter__(self) -> "InsForgeClient":
        """Support use as a context manager, returning self."""
        return self

    def __exit__(self, *args: Any) -> None:
        """Close the HTTP client on context-manager exit."""
        self.close()

    # ── Internal helpers ──────────────────────────────────────────────────

    def _auth_headers(self) -> dict[str, str]:
        """Return the Authorization header dict, raising AuthError if not logged in."""
        if not self._config.access_token:
            raise AuthError("Not logged in. Run `tracker login` first.")
        return {"Authorization": f"Bearer {self._config.access_token}"}

    def _raise_for_error(self, response: httpx.Response) -> None:
        """Raise APIError if the response is not a 2xx success."""
        if response.is_success:
            return
        try:
            body = response.json()
            code = body.get("error", "UNKNOWN")
            message = body.get("message", response.text)
        except Exception:
            code = "UNKNOWN"
            message = response.text or f"HTTP {response.status_code}"
        raise APIError(response.status_code, code, message)

    def _refresh_token(self) -> None:
        """Exchange the stored refresh token for a new access token, updating config on disk."""
        if not self._config.refresh_token:
            raise AuthError("Session expired. Run `tracker login` again.")
        resp = self._http.post(
            "/api/auth/sessions",
            json={"refreshToken": self._config.refresh_token},
        )
        if not resp.is_success:
            clear_tokens()
            raise AuthError("Session expired. Run `tracker login` again.")
        data = resp.json()
        new_access = data.get("accessToken") or data.get("access_token", "")
        if not new_access:
            clear_tokens()
            raise AuthError("Session expired. Run `tracker login` again.")
        new_refresh = data.get("refreshToken") or data.get("refresh_token", self._config.refresh_token)
        self._config.access_token = new_access
        self._config.refresh_token = new_refresh
        update_tokens(new_access, new_refresh)

    def _request(
        self,
        method: str,
        path: str,
        *,
        json: object = None,
        params: dict[str, Any] | None = None,
        extra_headers: dict[str, str] | None = None,
        retry_on_401: bool = True,
    ) -> httpx.Response:
        """Send an authenticated request, transparently retrying once after a 401."""
        headers = {**self._auth_headers(), **(extra_headers or {})}
        resp = self._http.request(method, path, json=json, params=params, headers=headers)

        if resp.status_code == 401 and retry_on_401:
            self._refresh_token()
            return self._request(
                method, path,
                json=json, params=params, extra_headers=extra_headers,
                retry_on_401=False,
            )

        self._raise_for_error(resp)
        return resp

    # ── Auth ──────────────────────────────────────────────────────────────

    def register(self, email: str, password: str) -> dict[str, Any]:
        """Create a new InsForge user account and return the raw response body."""
        resp = self._http.post("/api/auth/users", json={"email": email, "password": password})
        self._raise_for_error(resp)
        return resp.json()

    def login(self, email: str, password: str) -> tuple[str, str]:
        """Authenticate with email/password and return (access_token, refresh_token)."""
        resp = self._http.post("/api/auth/sessions", json={"email": email, "password": password})
        self._raise_for_error(resp)
        data = resp.json()
        access = data.get("accessToken") or data.get("access_token", "")
        refresh = data.get("refreshToken") or data.get("refresh_token", "")
        return access, refresh

    # ── Table management ─────────────────────────────────────────────────

    def table_exists(self, table: str) -> bool:
        """Return True if the table is accessible, False if it doesn't exist (404)."""
        try:
            self._request("GET", f"/api/database/records/{table}", params={"limit": 0})
            return True
        except APIError as e:
            if e.status_code == 404:
                return False
            raise

    # ── Generic CRUD helpers ─────────────────────────────────────────────

    def _list_records(
        self,
        table: str,
        filters: dict[str, str] | None = None,
        limit: int | None = None,
        offset: int = 0,
        order: str | None = None,
        select: str | None = None,
    ) -> list[dict[str, Any]]:
        """Fetch rows from a database table with optional filtering, ordering, and pagination."""
        params: dict[str, Any] = {"offset": offset}
        if limit is not None:
            params["limit"] = limit
        if order:
            params["order"] = order
        if select:
            params["select"] = select
        if filters:
            params.update(filters)
        resp = self._request("GET", f"/api/database/records/{table}", params=params)
        return resp.json()

    def _create_record(self, table: str, record: dict[str, Any]) -> dict[str, Any]:
        """Insert a single record into a table and return the created row."""
        resp = self._request(
            "POST",
            f"/api/database/records/{table}",
            json=[record],
            extra_headers={"Prefer": "return=representation"},
        )
        rows = resp.json()
        return rows[0] if isinstance(rows, list) else rows

    # ── Experiments ──────────────────────────────────────────────────────

    def get_or_create_experiment(
        self, name: str, description: str | None = None
    ) -> Experiment:
        """Return the named experiment, creating it if it does not yet exist."""
        rows = self._list_records(
            "experiments",
            filters={"name": f"eq.{name}"},
            limit=1,
        )
        if rows:
            return Experiment.from_dict(rows[0])

        record: dict[str, Any] = {"name": name}
        if description:
            record["description"] = description
        try:
            created = self._create_record("experiments", record)
            return Experiment.from_dict(created)
        except APIError as e:
            # UNIQUE violation: another caller created it; retry GET
            if e.status_code in (409, 422) or "unique" in e.message.lower():
                rows = self._list_records(
                    "experiments",
                    filters={"name": f"eq.{name}"},
                    limit=1,
                )
                if rows:
                    return Experiment.from_dict(rows[0])
            raise

    def list_experiments(self, limit: int = 50) -> list[Experiment]:
        """Return up to *limit* experiments ordered by creation time, newest first."""
        rows = self._list_records("experiments", limit=limit, order="created_at.desc")
        return [Experiment.from_dict(r) for r in rows]

    # ── Runs ─────────────────────────────────────────────────────────────

    def create_run(
        self,
        experiment_id: str,
        experiment_name: str,
        run_name: str | None,
        params: dict[str, Any],
        metrics: dict[str, Any],
        notes: str | None,
        started_at: str,
        finished_at: str,
    ) -> Run:
        """Insert a run record and return the persisted Run model."""
        record: dict[str, Any] = {
            "experiment_id": experiment_id,
            "experiment_name": experiment_name,
            "params": params,
            "metrics": metrics,
            "started_at": started_at,
            "finished_at": finished_at,
        }
        if run_name:
            record["run_name"] = run_name
        if notes:
            record["notes"] = notes
        created = self._create_record("runs", record)
        return Run.from_dict(created)

    def list_runs(
        self,
        experiment_name: str | None = None,
        limit: int = 20,
        offset: int = 0,
    ) -> list[Run]:
        """Return recent runs, optionally filtered by experiment name."""
        filters: dict[str, str] = {}
        if experiment_name:
            filters["experiment_name"] = f"eq.{experiment_name}"
        rows = self._list_records(
            "runs",
            filters=filters,
            limit=limit,
            offset=offset,
            order="created_at.desc",
        )
        return [Run.from_dict(r) for r in rows]

    def get_run(self, run_id: str) -> Run:
        """Fetch a single run by its full UUID, raising APIError(404) if missing."""
        rows = self._list_records("runs", filters={"id": f"eq.{run_id}"}, limit=1)
        if not rows:
            raise APIError(404, "NOT_FOUND", f"Run not found: {run_id}")
        return Run.from_dict(rows[0])
