package insforge

import (
	"context"
	"fmt"
	"net/url"
	"strconv"
)

// Database provides PostgREST-style query building for database operations.
type Database struct {
	http *httpClient
}

func newDatabase(h *httpClient) *Database { return &Database{http: h} }

// From returns a QueryBuilder for the given table.
func (d *Database) From(table string) *QueryBuilder {
	return &QueryBuilder{http: d.http, table: table, selectCols: "*"}
}

// RPC calls a PostgreSQL function by name.
func (d *Database) RPC(ctx context.Context, fn string, args map[string]interface{}) Result[interface{}] {
	if args == nil {
		args = map[string]interface{}{}
	}
	raw, err := d.http.post(ctx, "/api/database/rpc", map[string]interface{}{"function": fn, "args": args}, nil)
	if err != nil {
		return fail[interface{}](err)
	}
	return ok[interface{}](raw)
}

// Query executes a raw parameterized SQL query (admin only).
func (d *Database) Query(ctx context.Context, sql string, params ...interface{}) Result[interface{}] {
	body := map[string]interface{}{"sql": sql}
	if len(params) > 0 {
		body["params"] = params
	}
	raw, err := d.http.post(ctx, "/api/database/advance/query", body, nil)
	if err != nil {
		return fail[interface{}](err)
	}
	return ok[interface{}](raw)
}

// ------------------------------------------------------------------ //
// QueryBuilder
// ------------------------------------------------------------------ //

// QueryBuilder builds and executes a query against a table.
type QueryBuilder struct {
	http       *httpClient
	table      string
	selectCols string
	filters    []string
	orderBy    string
	limitVal   *int
	offsetVal  *int
	countMode  bool
}

// Select specifies which columns to retrieve.
func (q *QueryBuilder) Select(cols string) *QueryBuilder {
	q.selectCols = cols
	return q
}

// Count enables returning the total count of matching rows.
func (q *QueryBuilder) Count() *QueryBuilder {
	q.countMode = true
	return q
}

// Eq adds an equality filter: column = value.
func (q *QueryBuilder) Eq(col string, val interface{}) *QueryBuilder {
	q.filters = append(q.filters, fmt.Sprintf("%s=eq.%v", col, val))
	return q
}

// Neq adds a not-equal filter.
func (q *QueryBuilder) Neq(col string, val interface{}) *QueryBuilder {
	q.filters = append(q.filters, fmt.Sprintf("%s=neq.%v", col, val))
	return q
}

// Gt adds a greater-than filter.
func (q *QueryBuilder) Gt(col string, val interface{}) *QueryBuilder {
	q.filters = append(q.filters, fmt.Sprintf("%s=gt.%v", col, val))
	return q
}

// Gte adds a greater-than-or-equal filter.
func (q *QueryBuilder) Gte(col string, val interface{}) *QueryBuilder {
	q.filters = append(q.filters, fmt.Sprintf("%s=gte.%v", col, val))
	return q
}

// Lt adds a less-than filter.
func (q *QueryBuilder) Lt(col string, val interface{}) *QueryBuilder {
	q.filters = append(q.filters, fmt.Sprintf("%s=lt.%v", col, val))
	return q
}

// Lte adds a less-than-or-equal filter.
func (q *QueryBuilder) Lte(col string, val interface{}) *QueryBuilder {
	q.filters = append(q.filters, fmt.Sprintf("%s=lte.%v", col, val))
	return q
}

// Like adds a LIKE filter.
func (q *QueryBuilder) Like(col, pattern string) *QueryBuilder {
	q.filters = append(q.filters, fmt.Sprintf("%s=like.%s", col, pattern))
	return q
}

// ILike adds a case-insensitive LIKE filter.
func (q *QueryBuilder) ILike(col, pattern string) *QueryBuilder {
	q.filters = append(q.filters, fmt.Sprintf("%s=ilike.%s", col, pattern))
	return q
}

// Is adds an IS filter (e.g. IS NULL, IS TRUE).
func (q *QueryBuilder) Is(col string, val interface{}) *QueryBuilder {
	q.filters = append(q.filters, fmt.Sprintf("%s=is.%v", col, val))
	return q
}

// In adds an IN filter.
func (q *QueryBuilder) In(col string, values ...interface{}) *QueryBuilder {
	s := ""
	for i, v := range values {
		if i > 0 {
			s += ","
		}
		s += fmt.Sprintf("%v", v)
	}
	q.filters = append(q.filters, fmt.Sprintf("%s=in.(%s)", col, s))
	return q
}

// Order sets the ordering column and direction.
func (q *QueryBuilder) Order(col string, ascending bool) *QueryBuilder {
	dir := "asc"
	if !ascending {
		dir = "desc"
	}
	q.orderBy = col + "." + dir
	return q
}

// Limit sets the maximum number of rows to return.
func (q *QueryBuilder) Limit(n int) *QueryBuilder {
	q.limitVal = &n
	return q
}

// Offset sets the row offset for pagination.
func (q *QueryBuilder) Offset(n int) *QueryBuilder {
	q.offsetVal = &n
	return q
}

func (q *QueryBuilder) buildFilterParams() url.Values {
	p := url.Values{}
	for _, f := range q.filters {
		idx := 0
		for idx < len(f) && f[idx] != '=' {
			idx++
		}
		if idx < len(f) {
			p.Set(f[:idx], f[idx+1:])
		}
	}
	return p
}

func (q *QueryBuilder) buildParams() url.Values {
	p := url.Values{}
	p.Set("select", q.selectCols)
	for _, f := range q.filters {
		idx := 0
		for idx < len(f) && f[idx] != '=' {
			idx++
		}
		if idx < len(f) {
			p.Set(f[:idx], f[idx+1:])
		}
	}
	if q.orderBy != "" {
		p.Set("order", q.orderBy)
	}
	if q.limitVal != nil {
		p.Set("limit", strconv.Itoa(*q.limitVal))
	}
	if q.offsetVal != nil {
		p.Set("offset", strconv.Itoa(*q.offsetVal))
	}
	if q.countMode {
		p.Set("count", "exact")
	}
	return p
}

// Execute runs the SELECT query.
func (q *QueryBuilder) Execute(ctx context.Context) Result[interface{}] {
	raw, err := q.http.get(ctx, "/api/database/records/"+q.table, q.buildParams(), nil)
	if err != nil {
		return fail[interface{}](err)
	}
	return ok[interface{}](raw)
}

// Insert inserts one or more records.
func (q *QueryBuilder) Insert(ctx context.Context, records interface{}) Result[interface{}] {
	raw, err := q.http.post(ctx, "/api/database/records/"+q.table, records, nil)
	if err != nil {
		return fail[interface{}](err)
	}
	return ok[interface{}](raw)
}

// Update updates records matching current filters with the given values.
func (q *QueryBuilder) Update(ctx context.Context, values map[string]interface{}) Result[interface{}] {
	path := "/api/database/records/" + q.table
	params := q.buildFilterParams()
	if len(params) > 0 {
		path += "?" + params.Encode()
	}
	raw, err := q.http.patch(ctx, path, values, nil)
	if err != nil {
		return fail[interface{}](err)
	}
	return ok[interface{}](raw)
}

// Delete deletes records matching current filters.
func (q *QueryBuilder) Delete(ctx context.Context) Result[interface{}] {
	raw, err := q.http.delete(ctx, "/api/database/records/"+q.table, q.buildParams(), nil)
	if err != nil {
		return fail[interface{}](err)
	}
	return ok[interface{}](raw)
}
