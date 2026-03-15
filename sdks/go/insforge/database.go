package insforge

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
)

// DatabaseClient is the entry point for database operations.
type DatabaseClient struct {
	http *httpClient
}

func newDatabaseClient(h *httpClient) *DatabaseClient {
	return &DatabaseClient{http: h}
}

// From starts a new query builder for the given table.
func (d *DatabaseClient) From(table string) *QueryBuilder {
	return &QueryBuilder{
		http:      d.http,
		table:     table,
		operation: "select",
		selectCols: "*",
	}
}

// Rpc calls a database RPC function.
func (d *DatabaseClient) Rpc(functionName string, params map[string]any) *RpcBuilder {
	return &RpcBuilder{http: d.http, function: functionName, params: params}
}

// -----------------------------------------------------------------------
// QueryBuilder
// -----------------------------------------------------------------------

// QueryBuilder provides a fluent interface for building database queries.
type QueryBuilder struct {
	http       *httpClient
	table      string
	operation  string // "select", "insert", "update", "delete", "upsert"
	selectCols string
	filters    []string
	orderCol   string
	orderDir   string
	limitVal   *int
	offsetVal  *int
	singleRow  bool
	maybeSingle bool
	body       any
}

// Select specifies columns to return.
func (q *QueryBuilder) Select(columns string) *QueryBuilder {
	q.selectCols = columns
	q.operation = "select"
	return q
}

// Insert prepares an INSERT operation. Pass a slice of maps or structs.
func (q *QueryBuilder) Insert(data any) *QueryBuilder {
	q.operation = "insert"
	q.body = data
	return q
}

// Update prepares an UPDATE operation.
func (q *QueryBuilder) Update(data map[string]any) *QueryBuilder {
	q.operation = "update"
	q.body = data
	return q
}

// Delete prepares a DELETE operation.
func (q *QueryBuilder) Delete() *QueryBuilder {
	q.operation = "delete"
	return q
}

// Upsert prepares an UPSERT operation.
func (q *QueryBuilder) Upsert(data any) *QueryBuilder {
	q.operation = "upsert"
	q.body = data
	return q
}

// -----------------------------------------------------------------------
// Filters
// -----------------------------------------------------------------------

func (q *QueryBuilder) addFilter(col, op, value string) *QueryBuilder {
	q.filters = append(q.filters, fmt.Sprintf("%s=%s.%s", col, op, value))
	return q
}

// Eq filters rows where column equals value.
func (q *QueryBuilder) Eq(column string, value any) *QueryBuilder {
	return q.addFilter(column, "eq", fmt.Sprintf("%v", value))
}

// Neq filters rows where column is not equal to value.
func (q *QueryBuilder) Neq(column string, value any) *QueryBuilder {
	return q.addFilter(column, "neq", fmt.Sprintf("%v", value))
}

// Gt filters rows where column is greater than value.
func (q *QueryBuilder) Gt(column string, value any) *QueryBuilder {
	return q.addFilter(column, "gt", fmt.Sprintf("%v", value))
}

// Gte filters rows where column is greater than or equal to value.
func (q *QueryBuilder) Gte(column string, value any) *QueryBuilder {
	return q.addFilter(column, "gte", fmt.Sprintf("%v", value))
}

// Lt filters rows where column is less than value.
func (q *QueryBuilder) Lt(column string, value any) *QueryBuilder {
	return q.addFilter(column, "lt", fmt.Sprintf("%v", value))
}

// Lte filters rows where column is less than or equal to value.
func (q *QueryBuilder) Lte(column string, value any) *QueryBuilder {
	return q.addFilter(column, "lte", fmt.Sprintf("%v", value))
}

// Like filters using a LIKE pattern (case-sensitive).
func (q *QueryBuilder) Like(column, pattern string) *QueryBuilder {
	return q.addFilter(column, "like", pattern)
}

// ILike filters using an ILIKE pattern (case-insensitive).
func (q *QueryBuilder) ILike(column, pattern string) *QueryBuilder {
	return q.addFilter(column, "ilike", pattern)
}

// In filters rows where column value is in the provided list.
func (q *QueryBuilder) In(column string, values []any) *QueryBuilder {
	strs := make([]string, len(values))
	for i, v := range values {
		strs[i] = fmt.Sprintf("%v", v)
	}
	filter := fmt.Sprintf("%s=in.(%s)", column, strings.Join(strs, ","))
	q.filters = append(q.filters, filter)
	return q
}

// Is filters rows where column matches a special value: null, true, false.
func (q *QueryBuilder) Is(column string, value any) *QueryBuilder {
	return q.addFilter(column, "is", fmt.Sprintf("%v", value))
}

// -----------------------------------------------------------------------
// Modifiers
// -----------------------------------------------------------------------

// Order sets the result ordering. dir should be "asc" or "desc".
func (q *QueryBuilder) Order(column, dir string) *QueryBuilder {
	q.orderCol = column
	q.orderDir = dir
	return q
}

// Limit restricts the number of rows returned.
func (q *QueryBuilder) Limit(n int) *QueryBuilder {
	q.limitVal = &n
	return q
}

// Range paginates results: from and to are zero-based indices.
func (q *QueryBuilder) Range(from, to int) *QueryBuilder {
	count := to - from + 1
	q.limitVal = &count
	q.offsetVal = &from
	return q
}

// Single asserts that exactly one row is returned; errors otherwise.
func (q *QueryBuilder) Single() *QueryBuilder {
	q.singleRow = true
	return q
}

// MaybeSingle returns one row or nil; errors if more than one row is returned.
func (q *QueryBuilder) MaybeSingle() *QueryBuilder {
	q.maybeSingle = true
	return q
}

// -----------------------------------------------------------------------
// Execution
// -----------------------------------------------------------------------

// Execute runs the query and decodes the result into out.
// For SELECT, out should be a pointer to a slice (e.g., *[]MyStruct).
// For Single/MaybeSingle, out should be a pointer to a struct or map.
func (q *QueryBuilder) Execute(out any) error {
	params := q.buildParams()
	path := "/api/database/records/" + q.table

	switch q.operation {
	case "select":
		extraHeaders := map[string]string{}
		if q.singleRow {
			extraHeaders["Accept"] = "application/vnd.pgrst.object+json"
		}
		if q.maybeSingle {
			// Fetch up to 2 rows; if >1, error
			twoLimit := 2
			params.Set("limit", fmt.Sprintf("%d", twoLimit))
			var rows []json.RawMessage
			if err := q.http.do("GET", path, nil, params, &rows, extraHeaders); err != nil {
				return err
			}
			if len(rows) > 1 {
				return &InsForgeError{Message: "MaybeSingle: multiple rows returned", StatusCode: 0}
			}
			if len(rows) == 0 {
				return nil
			}
			return json.Unmarshal(rows[0], out)
		}
		return q.http.do("GET", path, nil, params, out, extraHeaders)

	case "insert":
		extraHeaders := map[string]string{
			"Prefer": "return=representation",
		}
		return q.http.do("POST", path, q.body, params, out, extraHeaders)

	case "upsert":
		extraHeaders := map[string]string{
			"Prefer": "return=representation,resolution=merge-duplicates",
		}
		return q.http.do("POST", path, q.body, params, out, extraHeaders)

	case "update":
		extraHeaders := map[string]string{
			"Prefer": "return=representation",
		}
		return q.http.do("PATCH", path, q.body, params, out, extraHeaders)

	case "delete":
		extraHeaders := map[string]string{
			"Prefer": "return=representation",
		}
		return q.http.do("DELETE", path, nil, params, out, extraHeaders)
	}

	return fmt.Errorf("insforge: unknown operation %q", q.operation)
}

// ExecuteRaw runs the query and returns raw JSON bytes.
func (q *QueryBuilder) ExecuteRaw() (json.RawMessage, error) {
	var raw json.RawMessage
	if err := q.Execute(&raw); err != nil {
		return nil, err
	}
	return raw, nil
}

func (q *QueryBuilder) buildParams() url.Values {
	params := url.Values{}
	if q.operation == "select" {
		if q.selectCols != "" && q.selectCols != "*" {
			params.Set("select", q.selectCols)
		}
	}
	for _, f := range q.filters {
		// filters are already in "col=op.val" format; split at first "="
		idx := strings.IndexByte(f, '=')
		if idx < 0 {
			continue
		}
		params.Add(f[:idx], f[idx+1:])
	}
	if q.orderCol != "" {
		dir := q.orderDir
		if dir == "" {
			dir = "asc"
		}
		params.Set("order", q.orderCol+"."+dir)
	}
	if q.limitVal != nil {
		params.Set("limit", fmt.Sprintf("%d", *q.limitVal))
	}
	if q.offsetVal != nil {
		params.Set("offset", fmt.Sprintf("%d", *q.offsetVal))
	}
	return params
}

// -----------------------------------------------------------------------
// RpcBuilder
// -----------------------------------------------------------------------

// RpcBuilder calls a Postgres RPC function.
type RpcBuilder struct {
	http     *httpClient
	function string
	params   map[string]any
}

// Execute calls the RPC function and decodes the result into out.
func (r *RpcBuilder) Execute(out any) error {
	return r.http.do("POST", "/api/database/rpc/"+r.function, r.params, nil, out, nil)
}
