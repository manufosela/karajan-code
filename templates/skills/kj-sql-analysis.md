# kj-sql-analysis — SQL Analysis & Generation

Generate and review SQL queries with a focus on correctness, performance, and security.

## Your task

$ARGUMENTS

## Coder instructions

When writing or modifying SQL queries:

1. **Parameterized queries only** — never concatenate user input into SQL strings. Use prepared statements or parameterized queries (`$1`, `?`, `:param`) to prevent injection.
2. **Comment complex logic** — add inline comments explaining non-obvious JOINs, subqueries, CTEs, and window functions.
3. **Validate against schema** — if a schema or migration files are available, verify that table names, column names, and types match the actual schema.
4. **Prefer explicit column lists** — avoid `SELECT *`; list the columns you need.
5. **Use aliases consistently** — when joining multiple tables, alias every table and prefix all column references.
6. **Index-aware queries** — structure WHERE clauses and JOINs to leverage existing indexes. Avoid wrapping indexed columns in functions.
7. **Limit result sets** — add `LIMIT` / `TOP` for queries that could return unbounded rows unless the full result is explicitly needed.
8. **Handle NULLs explicitly** — use `COALESCE`, `IS NULL`, or `IS NOT NULL` where NULL values could affect logic.

## Reviewer checklist

When reviewing SQL-related code, check for:

- [ ] **Injection risk** — any string concatenation or template literals building SQL?
- [ ] **N+1 queries** — loops executing individual queries instead of a single batch/join?
- [ ] **Missing indexes** — queries filtering or joining on columns without indexes?
- [ ] **Correct JOINs** — LEFT vs INNER vs CROSS used intentionally? Accidental cartesian products?
- [ ] **Transaction safety** — multi-statement operations wrapped in transactions where needed?
- [ ] **Schema alignment** — column names, types, and constraints match the current schema?
- [ ] **Performance** — unnecessary subqueries that could be CTEs or JOINs? Missing LIMIT on large tables?
- [ ] **NULL handling** — aggregations, comparisons, and JOINs account for NULL values?

## Output

Provide the SQL queries with:
- Inline comments for complex sections
- Explanation of the query plan and expected performance characteristics
- Any schema changes needed (new indexes, columns, tables)
