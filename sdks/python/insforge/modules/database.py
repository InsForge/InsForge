"""Database module - PostgREST-style query builder."""
from __future__ import annotations

from typing import Any

from insforge.errors import InsForgeError
from insforge.lib.http_client import HttpClient


class QueryBuilder:
    """Fluent query builder for a specific table."""

    def __init__(self, http: HttpClient, table: str) -> None:
        self._http = http
        self._table = table
        self._select_cols = "*"
        self._filters: list[str] = []
        self._order: str | None = None
        self._limit: int | None = None
        self._offset: int | None = None
        self._count: bool = False

    # ------------------------------------------------------------------ #
    # Column selection
    # ------------------------------------------------------------------ #

    def select(self, columns: str = "*", *, count: bool = False) -> QueryBuilder:
        self._select_cols = columns
        self._count = count
        return self

    # ------------------------------------------------------------------ #
    # Filters
    # ------------------------------------------------------------------ #

    def eq(self, column: str, value: Any) -> QueryBuilder:
        self._filters.append(f"{column}=eq.{value}")
        return self

    def neq(self, column: str, value: Any) -> QueryBuilder:
        self._filters.append(f"{column}=neq.{value}")
        return self

    def gt(self, column: str, value: Any) -> QueryBuilder:
        self._filters.append(f"{column}=gt.{value}")
        return self

    def gte(self, column: str, value: Any) -> QueryBuilder:
        self._filters.append(f"{column}=gte.{value}")
        return self

    def lt(self, column: str, value: Any) -> QueryBuilder:
        self._filters.append(f"{column}=lt.{value}")
        return self

    def lte(self, column: str, value: Any) -> QueryBuilder:
        self._filters.append(f"{column}=lte.{value}")
        return self

    def like(self, column: str, pattern: str) -> QueryBuilder:
        self._filters.append(f"{column}=like.{pattern}")
        return self

    def ilike(self, column: str, pattern: str) -> QueryBuilder:
        self._filters.append(f"{column}=ilike.{pattern}")
        return self

    def is_(self, column: str, value: Any) -> QueryBuilder:
        self._filters.append(f"{column}=is.{value}")
        return self

    def in_(self, column: str, values: list[Any]) -> QueryBuilder:
        vals = ",".join(str(v) for v in values)
        self._filters.append(f"{column}=in.({vals})")
        return self

    # ------------------------------------------------------------------ #
    # Ordering / pagination
    # ------------------------------------------------------------------ #

    def order(self, column: str, *, ascending: bool = True) -> QueryBuilder:
        direction = "asc" if ascending else "desc"
        self._order = f"{column}.{direction}"
        return self

    def limit(self, count: int) -> QueryBuilder:
        self._limit = count
        return self

    def offset(self, start: int) -> QueryBuilder:
        self._offset = start
        return self

    # ------------------------------------------------------------------ #
    # Terminal methods
    # ------------------------------------------------------------------ #

    def _build_params(self) -> dict[str, Any]:
        params: dict[str, Any] = {"select": self._select_cols}
        for f in self._filters:
            col, expr = f.split("=", 1)
            params[col] = expr
        if self._order:
            params["order"] = self._order
        if self._limit is not None:
            params["limit"] = self._limit
        if self._offset is not None:
            params["offset"] = self._offset
        if self._count:
            params["count"] = "exact"
        return params

    async def execute(self) -> dict[str, Any]:
        """Execute the SELECT query."""
        try:
            data = await self._http.get(
                f"/api/database/records/{self._table}",
                params=self._build_params(),
            )
            return {"data": data, "error": None}
        except InsForgeError as e:
            return {"data": None, "error": e}

    async def insert(self, records: list[dict[str, Any]]) -> dict[str, Any]:
        """Insert one or more records."""
        try:
            data = await self._http.post(f"/api/database/records/{self._table}", records)
            return {"data": data, "error": None}
        except InsForgeError as e:
            return {"data": None, "error": e}

    async def update(self, values: dict[str, Any]) -> dict[str, Any]:
        """Update records matching the current filters."""
        try:
            params: dict[str, Any] = {}
            for f in self._filters:
                col, expr = f.split("=", 1)
                params[col] = expr
            data = await self._http.patch(
                f"/api/database/records/{self._table}",
                values,
                params=params or None,
            )
            return {"data": data, "error": None}
        except InsForgeError as e:
            return {"data": None, "error": e}

    async def delete(self) -> dict[str, Any]:
        """Delete records matching the current filters."""
        try:
            data = await self._http.delete(
                f"/api/database/records/{self._table}",
                params={f.split("=")[0]: f.split("=", 1)[1] for f in self._filters},
            )
            return {"data": data, "error": None}
        except InsForgeError as e:
            return {"data": None, "error": e}

    def __await__(self):
        return self.execute().__await__()


class Database:
    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def from_(self, table: str) -> QueryBuilder:
        """Start a query against the given table."""
        return QueryBuilder(self._http, table)

    async def rpc(
        self, fn: str, args: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        """Call a PostgreSQL function via RPC."""
        try:
            data = await self._http.post("/api/database/rpc", {"function": fn, "args": args or {}})
            return {"data": data, "error": None}
        except InsForgeError as e:
            return {"data": None, "error": e}

    async def query(
        self, sql: str, params: list[Any] | None = None
    ) -> dict[str, Any]:
        """Execute a raw parameterized SQL query (admin only)."""
        try:
            body: dict[str, Any] = {"sql": sql}
            if params:
                body["params"] = params
            data = await self._http.post("/api/database/advance/query", body)
            return {"data": data, "error": None}
        except InsForgeError as e:
            return {"data": None, "error": e}
