# kj-csv-transform — CSV & Data Transformation

Transform, validate, and process CSV and tabular data files.

## Your task

$ARGUMENTS

## Coder instructions

When working with CSV or tabular data:

1. **Auto-detect delimiter** — do not assume comma. Detect the actual delimiter (comma, semicolon, tab, pipe) by inspecting the first few lines. Use libraries that support delimiter sniffing when available.
2. **Handle encoding** — detect and handle file encoding (UTF-8, UTF-8 BOM, Latin-1/ISO-8859-1, Windows-1252). Convert to UTF-8 for processing.
3. **Validate data types per column** — after parsing, verify that each column contains the expected data type (string, number, date, boolean). Flag rows with type mismatches.
4. **Handle missing values explicitly** — define a strategy for missing/empty values (keep as null, fill with default, skip row). Never silently drop rows with missing data.
5. **Preserve row count** — track input vs output row counts. Log any rows filtered, merged, or split so the transformation is auditable.
6. **Quote fields correctly** — when writing CSV output, properly escape fields containing delimiters, quotes, or newlines.
7. **Header normalization** — trim whitespace from headers, handle duplicate column names, and normalize casing if needed.
8. **Large file support** — for files that may be large, use streaming/chunked processing instead of loading everything into memory.

## Reviewer checklist

When reviewing CSV/data transformation code, check for:

- [ ] **Data integrity** — input row count matches expected output row count (accounting for intentional filters)?
- [ ] **No silent data loss** — missing values are handled explicitly, not silently dropped?
- [ ] **Correct transformations** — type conversions, date parsing, and numeric formatting are accurate?
- [ ] **Encoding handled** — non-ASCII characters preserved correctly through the pipeline?
- [ ] **Delimiter consistency** — detection works for the actual file, not just assumed comma?
- [ ] **Edge cases** — empty files, single-row files, files with only headers, fields with embedded newlines?
- [ ] **Memory safety** — large files processed via streams, not loaded entirely into memory?
- [ ] **Output format** — output CSV is well-formed (proper quoting, consistent line endings)?

## Output

Provide the transformation code with:
- Clear input/output format documentation
- Row count summary (input rows, output rows, filtered rows, error rows)
- Sample of transformed data for verification
