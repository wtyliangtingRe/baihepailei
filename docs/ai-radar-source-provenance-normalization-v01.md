# AI radar source provenance normalization v0.1

This stage handles old, obscure, or poorly documented works without inventing sources and without permanently hiding them.

## Principle

A lack of traceable sources is represented honestly:

- `multiple_secondary_supported` with one traceable URL becomes `single_secondary_supported`;
- `multiple_secondary_supported` or `single_secondary_supported` with zero traceable URLs becomes `insufficient_evidence`;
- `sourceCount` is always the number of distinct traceable URLs;
- unlinked series context and research notes remain preserved as internal context but do not count as sources;
- confidence and evidence coverage are not changed by an arbitrary cap;
- the original resolved file is never modified.

## Command

```powershell
node --test tests/radar-source-provenance-normalize.test.mjs
node scripts/radar/normalize-ai-radar-source-provenance-v01.mjs
```

Default normalized output:

```text
data_local/staging/ai-radar/source-provenance-normalized-v01/ai-radar-first100-resolved-source-honest-v01.jsonl
```

Re-audit the normalized copy:

```powershell
node scripts/radar/audit-ai-radar-source-provenance-v01.mjs `
  --input data_local/staging/ai-radar/source-provenance-normalized-v01/ai-radar-first100-resolved-source-honest-v01.jsonl `
  --out-dir data_local/staging/ai-radar/source-provenance-audit-honest-v01
```

Expected first-100 outcome:

```text
blocked: 0
warningsOnly: 6
clean: 94
```

Build the Payload plan from the normalized copy:

```powershell
pnpm radar:plan-payload -- `
  --url http://localhost:3000 `
  --input data_local/staging/ai-radar/source-provenance-normalized-v01/ai-radar-first100-resolved-source-honest-v01.jsonl `
  --out-dir data_local/staging/ai-radar/payload-plan-honest-v01
```

This stage performs no Payload or PostgreSQL writes.
