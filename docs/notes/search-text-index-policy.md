# Search text index policy

`searchText` fields are intentionally **not indexed** in PostgreSQL.

Reason:

- `searchText` is a long textarea used to build the static Lite search index.
- Payload versions copy the field into version tables as `version_search_text`.
- PostgreSQL btree indexes have row-size limits.
- Long migrated XWiki content can exceed that limit and fail during schema initialization.

Observed failure example:

```text
index row size exceeds btree version 4 maximum 2704
CREATE INDEX ... ON "_rules_v" USING btree ("version_search_text")
```

Frontend search does **not** rely on PostgreSQL indexes for this field. It uses generated files instead:

```text
public/search-index.json
public/detail-index.json
```

So `searchText` should stay as a plain textarea without `index: true`.
