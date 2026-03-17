-- Migration: 025 - Create browse_records_guarded RPC function
-- Guards oversized cell values during record browsing to prevent RAM spikes.
-- Replaces values exceeding p_max_bytes with a sentinel containing a truncated preview.

CREATE OR REPLACE FUNCTION system.browse_records_guarded(
  p_table_name text,
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0,
  p_order_column text DEFAULT NULL,
  p_order_direction text DEFAULT 'asc',
  p_search_query text DEFAULT NULL,
  p_max_bytes int DEFAULT 262144
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_search_conditions text[] := '{}';
  v_col record;
  v_query text;
  v_count_query text;
  v_where_clause text := '';
  v_order_clause text := '';
  v_result jsonb;
  v_total bigint;
  v_safe_limit int;
  v_safe_offset int;
  v_search_pattern text;
BEGIN
  -- Validate table exists in public schema
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = p_table_name
  ) THEN
    RAISE EXCEPTION 'Table "%" does not exist', p_table_name;
  END IF;

  -- Cap limit and offset
  v_safe_limit := LEAST(GREATEST(p_limit, 1), 1000);
  v_safe_offset := GREATEST(p_offset, 0);

  -- Validate and build order clause
  IF p_order_column IS NOT NULL AND p_order_column <> '' THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = p_table_name AND column_name = p_order_column
    ) THEN
      RAISE EXCEPTION 'Column "%" does not exist in table "%"', p_order_column, p_table_name;
    END IF;

    IF lower(p_order_direction) NOT IN ('asc', 'desc') THEN
      p_order_direction := 'asc';
    END IF;

    v_order_clause := format(' ORDER BY t.%I %s', p_order_column, p_order_direction);
  END IF;

  -- Build search conditions from text columns
  IF p_search_query IS NOT NULL AND p_search_query <> '' THEN
    v_search_pattern := replace(replace(replace(p_search_query, '\', '\\'), '%', '\%'), '_', '\_');

    FOR v_col IN
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = p_table_name
        AND lower(data_type) IN ('text', 'character varying', 'character')
      ORDER BY ordinal_position
    LOOP
      v_search_conditions := array_append(
        v_search_conditions,
        format('t.%I ILIKE ''%%'' || %L || ''%%'' ESCAPE ''\''', v_col.column_name, v_search_pattern)
      );
    END LOOP;
  END IF;

  -- Build WHERE clause
  IF array_length(v_search_conditions, 1) > 0 THEN
    v_where_clause := ' WHERE (' || array_to_string(v_search_conditions, ' OR ') || ')';
  END IF;

  -- Get total count (with search filter applied)
  v_count_query := format('SELECT count(*) FROM %I.%I t%s', 'public', p_table_name, v_where_clause);
  EXECUTE v_count_query INTO v_total;

  -- Build main query with guarded column expressions
  v_query := 'SELECT jsonb_agg(row_data) FROM ('
    || 'SELECT jsonb_build_object('
    || (
      SELECT string_agg(
        format('%L, %s', col_info.column_name, col_info.expr),
        ', '
      )
      FROM (
        SELECT c.column_name,
          CASE
            WHEN c.data_type IN ('text', 'character varying', 'character') THEN
              format(
                'CASE WHEN t.%I IS NULL THEN ''null''::jsonb '
                'WHEN octet_length(t.%I) > %s THEN jsonb_build_object(''__guarded'', true, ''preview'', left(t.%I, 100), ''size'', octet_length(t.%I)) '
                'ELSE to_jsonb(t.%I) END',
                c.column_name, c.column_name, p_max_bytes, c.column_name, c.column_name, c.column_name
              )
            WHEN c.data_type IN ('json', 'jsonb') OR c.udt_name IN ('json', 'jsonb') THEN
              format(
                'CASE WHEN t.%I IS NULL THEN ''null''::jsonb '
                'WHEN octet_length(t.%I::text) > %s THEN jsonb_build_object(''__guarded'', true, ''preview'', left(t.%I::text, 100), ''size'', octet_length(t.%I::text)) '
                'ELSE to_jsonb(t.%I) END',
                c.column_name, c.column_name, p_max_bytes, c.column_name, c.column_name, c.column_name
              )
            WHEN c.data_type = 'bytea' OR c.udt_name = 'bytea' THEN
              format(
                'CASE WHEN t.%I IS NULL THEN ''null''::jsonb '
                'WHEN (octet_length(t.%I) * 4 / 3) > %s THEN jsonb_build_object(''__guarded'', true, ''preview'', ''[binary data]'', ''size'', octet_length(t.%I)) '
                'ELSE to_jsonb(encode(t.%I, ''base64'')) END',
                c.column_name, c.column_name, p_max_bytes, c.column_name, c.column_name
              )
            ELSE
              format('to_jsonb(t.%I)', c.column_name)
          END AS expr
        FROM information_schema.columns c
        WHERE c.table_schema = 'public' AND c.table_name = p_table_name
        ORDER BY c.ordinal_position
      ) col_info
    )
    || ') AS row_data FROM '
    || format('%I.%I t', 'public', p_table_name)
    || v_where_clause
    || v_order_clause
    || format(' LIMIT %s OFFSET %s', v_safe_limit, v_safe_offset)
    || ') sub';

  EXECUTE v_query INTO v_result;

  RETURN jsonb_build_object(
    'rows', COALESCE(v_result, '[]'::jsonb),
    'total', v_total
  );
END;
$$;

-- Grant execute to the postgres role used by the backend
GRANT EXECUTE ON FUNCTION system.browse_records_guarded(text, int, int, text, text, text, int) TO postgres;
