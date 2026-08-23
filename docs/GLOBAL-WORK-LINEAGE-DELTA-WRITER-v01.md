# Global Work Lineage v01 CAS delta writer

This is the narrow write path for replacing the current document of an existing
`work_id` in `global_work_lineage_v01.work_lineages`. It is not an importer, a
queue, a scheduler, a compatibility bridge, or a second state model.

New Work IDs and new immutable provenance objects do not belong here. They use
the separate insert-only path in
[`GLOBAL-WORK-LINEAGE-PROVISION-WRITER-v01.md`](GLOBAL-WORK-LINEAGE-PROVISION-WRITER-v01.md).
Neither writer can silently fall back to the other.

The default command is offline. It reads no database and writes only a generated
`apply.sql` and deterministic `receipt.json`. A database connection is made only
when every apply control described below is present and consistent.

## Boundary

Each replacement document has exactly:

- `contractVersion` and `workId`;
- the 12 active top-level blocks: `canonical`, `identities`, `research`,
  `assessment`, `candidate`, `published`, `human`, `reservations`, `quarantine`,
  `effectiveState`, `integrity`, and `provenance`.

The Frozen logical census remains 13. The migration-only `legacy` block is
retired and must be absent. Every active block must be a JSON object. The tool
also verifies the current physical-schema requirements for a nonblank
`canonical.naming.canonicalTitle` and `provenance.auditRunRef`.

The delta writer can only replace rows that already exist. Generated SQL takes
each target row with `FOR UPDATE`, compares its current `document_sha256` to the
declared base digest, and then performs one `UPDATE` guarded by the same digest.
Any missing row, digest mismatch, constraint failure, or affected-row count other
than one aborts the transaction. There is no create, delete, merge, or upsert
path, and no whole-table lock.

## Delta JSONL

The input is UTF-8 JSONL with LF line endings, a final LF, no blank lines, and
canonical JSON on every line. Each row has exactly:

```json
{"baseDocumentSha256":"<64 lowercase hex>","document":{"assessment":{},"candidate":{},"canonical":{"naming":{"canonicalTitle":"Example"}},"contractVersion":"global-work-lineage-v01","effectiveState":{},"human":{},"identities":{},"integrity":{},"provenance":{"auditRunRef":"audit-run-v01:example"},"published":{},"quarantine":{},"research":{},"reservations":{},"workId":"42"},"schemaVersion":"global-work-lineage-delta-row-v01","workId":"42"}
```

Canonical JSON is identical to the fresh importer:

```python
json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
```

`document_sha256` is SHA-256 of those canonical document bytes. The raw delta
digest is SHA-256 of the JSONL file bytes exactly as supplied. The base-set
digest is SHA-256 of the following UTF-8 byte sequence, after sorting rows by
`(len(workId), workId)`:

```text
<workId>\t<baseDocumentSha256>\n
```

Duplicate work IDs, duplicate base digests, duplicate new document digests, and
no-op replacements are rejected before SQL is written.

## Offline preparation

```bash
python3 scripts/work-lineage/apply_global_work_lineage_delta_v01.py \
  --delta path/to/release.delta.jsonl \
  --release-ref 'release/global-work-lineage-v01/2026-08-20.1' \
  --out-dir out/global-work-lineage-delta-2026-08-20.1
```

Review `apply.sql` and `receipt.json`. The receipt supplies the exact
`delta.rawSha256`, `delta.baseSetSha256`, and `delta.rowCount` values to bind in
a versioned gate. Re-running the same input and release reference in a different
empty output directory produces byte-identical outputs.

Copy `config/global-work-lineage-delta-apply-gate-v01.template.json` to a
versioned, reviewable gate file. Replace all placeholders with the receipt
values and release reference. Keep `applyEnabled` false while reviewing. Passing
that file with `--gate` in offline mode verifies all four bindings without
connecting to PostgreSQL.

## Authorized apply

An apply is rejected unless all of these are true at the same time:

1. `--apply` is present.
2. `--database-url` is an explicit `postgres` or `postgresql` URL naming one
   database.
3. `--gate` names a versioned gate with schema
   `global-work-lineage-delta-apply-gate-v01` and `applyEnabled: true`.
4. Gate `releaseRef`, raw delta SHA-256, base-set SHA-256, and row count exactly
   match the current invocation and delta bytes.
5. `--confirm-release-ref` exactly repeats `--release-ref`.

Only after the gate has been reviewed and deliberately enabled:

```bash
python3 scripts/work-lineage/apply_global_work_lineage_delta_v01.py \
  --delta path/to/release.delta.jsonl \
  --release-ref 'release/global-work-lineage-v01/2026-08-20.1' \
  --out-dir out/global-work-lineage-delta-2026-08-20.1-apply \
  --gate config/global-work-lineage-delta-apply-gate-2026-08-20.1.json \
  --apply \
  --database-url "$DATABASE_URL" \
  --confirm-release-ref 'release/global-work-lineage-v01/2026-08-20.1'
```

The implementation uses only the Python standard library and invokes `psql`
with `--no-psqlrc` and `ON_ERROR_STOP=1`; it does not require a PostgreSQL Python
driver. The database URL is neither stored in the receipt nor printed on
success. Do not commit production apply-enabled gates or database credentials.
Repository workflows run offline unit validation and may generate an ephemeral
enabled gate only against a disposable PostgreSQL service database for
integration proof.

## Tests

```bash
python3 -m unittest discover -s tests -p 'test_apply_global_work_lineage_delta_v01.py' -v
```
