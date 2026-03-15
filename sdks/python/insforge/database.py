"""
Database module for the InsForge Python SDK.

Provides a chainable query builder that mirrors the TypeScript SDK's fluent API.

Usage:
    result = client.database.from_("posts").select().eq("status", "published").execute()
    result = client.database.from_("posts").insert([{"title": "Hello"}]).execute()
    result = client.database.rpc("get_user_stats", {"user_id": "123"}).execute()
"""

from __future__ import annotations

from typing import Any, Sequence


class QueryBuilder:
    """
    Chainable builder that constructs a database query and executes it.

    Mirrors the InsForge TypeScript SDK database API.
    """

    # Operation types
    _OP_SELECT = "select"
    _OP_INSERT = "insert"
    _OP_UPDATE = "update"
    _OP_DELETE = "delete"
    _OP_UPSERT = "upsert"

    def __init__(self, http: Any, table: str) -> None:
        self._http = http
        self._table = table
        self._operation: str | None = None
        self._columns: str = "*"
        self._body: Any = None
        self._filters: list[tuple[str, str, Any]] = []
        self._order_col: str | None = None
        self._order_asc: bool = True
        self._order_nulls_first: bool | None = None
        self._limit_val: int | None = None
        self._range_from: int | None = None
        self._range_to: int | None = None
        self._single: bool = False
        self._maybe_single: bool = False
        self._count: str | None = None
        self._head: bool = False
        self._return_select: bool = False
        self._upsert_resolution: str | None = None

    # ------------------------------------------------------------------
    # Operations
    # ------------------------------------------------------------------

    def select(
        self,
        columns: str = "*",
        *,
        count: str | None = None,
        head: bool = False,
    ) -> "QueryBuilder":
        """Select columns from the table."""
        self._operation = self._OP_SELECT
        self._columns = columns
        self._count = count
        self._head = head
        return self

    def insert(
        self,
        values: dict[str, Any] | list[dict[str, Any]],
        *,
        count: str | None = None,
    ) -> "QueryBuilder":
        """Insert one or more records."""
        self._operation = self._OP_INSERT
        self._body = values if isinstance(values, list) else [values]
        self._count = count
        return self

    def update(
        self,
        values: dict[str, Any],
        *,
        count: str | None = None,
    ) -> "QueryBuilder":
        """Update records matching the applied filters."""
        self._operation = self._OP_UPDATE
        self._body = values
        self._count = count
        return self

    def delete(self, *, count: str | None = None) -> "QueryBuilder":
        """Delete records matching the applied filters."""
        self._operation = self._OP_DELETE
        self._count = count
        return self

    def upsert(
        self,
        values: dict[str, Any] | list[dict[str, Any]],
        *,
        on_conflict: str | None = None,
        ignore_duplicates: bool = False,
    ) -> "QueryBuilder":
        """Insert or update on conflict."""
        self._operation = self._OP_UPSERT
        self._body = values if isinstance(values, list) else [values]
        if ignore_duplicates:
            self._upsert_resolution = "ignore-duplicates"
        else:
            self._upsert_resolution = "merge-duplicates"
        return self

    # ------------------------------------------------------------------
    # Post-operation modifiers
    # ------------------------------------------------------------------

    def select_after(self, columns: str = "*") -> "QueryBuilder":
        """Chain .select() after insert/update to return created/updated rows."""
        self._return_select = True
        self._columns = columns
        return self

    # ------------------------------------------------------------------
    # Filters
    # ------------------------------------------------------------------

    def eq(self, column: str, value: Any) -> "QueryBuilder":
        self._filters.append((column, "eq", value))
        return self

    def neq(self, column: str, value: Any) -> "QueryBuilder":
        self._filters.append((column, "neq", value))
        return self

    def gt(self, column: str, value: Any) -> "QueryBuilder":
        self._filters.append((column, "gt", value))
        return self

    def gte(self, column: str, value: Any) -> "QueryBuilder":
        self._filters.append((column, "gte", value))
        return self

    def lt(self, column: str, value: Any) -> "QueryBuilder":
        self._filters.append((column, "lt", value))
        return self

    def lte(self, column: str, value: Any) -> "QueryBuilder":
        self._filters.append((column, "lte", value))
        return self

    def like(self, column: str, pattern: str) -> "QueryBuilder":
        self._filters.append((column, "like", pattern))
        return self

    def ilike(self, column: str, pattern: str) -> "QueryBuilder":
        self._filters.append((column, "ilike", pattern))
        return self

    def in_(self, column: str, values: Sequence[Any]) -> "QueryBuilder":
        self._filters.append((column, "in", values))
        return self

    def is_(self, column: str, value: Any) -> "QueryBuilder":
        self._filters.append((column, "is", value))
        return self

    # ------------------------------------------------------------------
    # Modifiers
    # ------------------------------------------------------------------

    def order(
        self,
        column: str,
        *,
        ascending: bool = True,
        nulls_first: bool | None = None,
    ) -> "QueryBuilder":
        self._order_col = column
        self._order_asc = ascending
        self._order_nulls_first = nulls_first
        return self

    def limit(self, count: int) -> "QueryBuilder":
        self._limit_val = count
        return self

    def range(self, from_: int, to: int) -> "QueryBuilder":
        self._range_from = from_
        self._range_to = to
        return self

    def single(self) -> "QueryBuilder":
        self._single = True
        return self

    def maybe_single(self) -> "QueryBuilder":
        self._maybe_single = True
        return self

    # ------------------------------------------------------------------
    # Execution
    # ------------------------------------------------------------------

    def execute(self) -> dict[str, Any]:
        """
        Execute the built query.

        Returns:
            Dict with keys: data (list or object), error (None on success),
            count (if requested).
        """
        params = self._build_params()
        headers = self._build_headers()
        path = f"/api/database/records/{self._table}"

        try:
            if self._operation == self._OP_SELECT:
                raw = self._http.get(path, params=params, extra_headers=headers)
            elif self._operation == self._OP_INSERT or self._operation == self._OP_UPSERT:
                raw = self._http.post(path, data=self._body, params=params, extra_headers=headers)
            elif self._operation == self._OP_UPDATE:
                raw = self._http.patch(path, data=self._body, params=params, extra_headers=headers)
            elif self._operation == self._OP_DELETE:
                raw = self._http.delete(path, params=params, extra_headers=headers)
            else:
                raise ValueError(f"No operation set. Call .select(), .insert(), .update(), or .delete() first.")
        except Exception as exc:
            return {"data": None, "error": exc, "count": None}

        data = raw if isinstance(raw, list) else (raw or [])

        if self._single:
            if len(data) > 1:
                return {"data": None, "error": Exception("Multiple rows returned, expected one"), "count": None}
            data = data[0] if data else None
        elif self._maybe_single:
            data = data[0] if data else None

        return {"data": data, "error": None, "count": None}

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _build_params(self) -> dict[str, Any]:
        params: dict[str, Any] = {}

        if self._operation == self._OP_SELECT:
            if self._columns and self._columns != "*":
                params["select"] = self._columns

        # Filters
        for col, op, val in self._filters:
            if op == "in":
                params[col] = f"in.({','.join(str(v) for v in val)})"
            elif op == "is":
                params[col] = f"is.{val}"
            elif op == "like":
                params[col] = f"like.{val}"
            elif op == "ilike":
                params[col] = f"ilike.{val}"
            else:
                params[col] = f"{op}.{val}"

        # Order
        if self._order_col:
            direction = "asc" if self._order_asc else "desc"
            order_str = f"{self._order_col}.{direction}"
            params["order"] = order_str

        # Pagination
        if self._range_from is not None and self._range_to is not None:
            params["offset"] = self._range_from
            params["limit"] = self._range_to - self._range_from + 1
        elif self._limit_val is not None:
            params["limit"] = self._limit_val

        return params

    def _build_headers(self) -> dict[str, str]:
        headers: dict[str, str] = {}

        if self._operation in (self._OP_INSERT, self._OP_UPDATE, self._OP_DELETE, self._OP_UPSERT):
            headers["Prefer"] = "return=representation"

        if self._operation == self._OP_UPSERT and self._upsert_resolution:
            existing = headers.get("Prefer", "")
            headers["Prefer"] = f"{self._upsert_resolution},{existing}".strip(",")

        return headers


class RpcBuilder:
    """Builds and executes an RPC (stored function) call."""

    def __init__(self, http: Any, function_name: str, args: dict[str, Any] | None = None) -> None:
        self._http = http
        self._function_name = function_name
        self._args = args or {}

    def execute(self) -> dict[str, Any]:
        path = f"/api/database/rpc/{self._function_name}"
        try:
            raw = self._http.post(path, data=self._args)
            return {"data": raw, "error": None}
        except Exception as exc:
            return {"data": None, "error": exc}


class DatabaseClient:
    """Provides database CRUD and RPC operations."""

    def __init__(self, http: Any) -> None:
        self._http = http

    def from_(self, table: str) -> QueryBuilder:
        """
        Start a query against a table.

        Args:
            table: Table name.

        Returns:
            QueryBuilder instance — chain operations then call .execute().

        Example:
            result = client.database.from_("posts").select().eq("status", "active").execute()
        """
        return QueryBuilder(self._http, table)

    def rpc(self, function_name: str, args: dict[str, Any] | None = None) -> RpcBuilder:
        """
        Call a PostgreSQL stored function.

        Args:
            function_name: Name of the stored function.
            args: Optional dict of function arguments.

        Returns:
            RpcBuilder — call .execute() to run.

        Example:
            result = client.database.rpc("get_user_stats", {"user_id": "123"}).execute()
        """
        return RpcBuilder(self._http, function_name, args)
