# AI radar source provenance audit v0.1

The first-100 Payload plan and dry-run were structurally consistent, but a separate audit found that source-count and evidence-status claims need a traceability check before apply.

## What counts as traceable

A source is traceable only when its `researchSources` entry contains a concrete URL. Internal `series_context` records and web-research notes without URLs remain useful review context, but they do not count toward the public field labelled `可追溯来源数量`.

## Blocking rules

- `multiple_secondary_supported` requires at least two distinct traceable URLs.
- `single_secondary_supported` requires at least one traceable URL.

## Warning rules

- Declared `sourceCount` differs from the distinct traceable URL count.
- A `secondary_web` source note has no URL.

## First-100 review result

The uploaded plan package and its source batch produced:

```text
blocked by source provenance: 19
warning only: 8
clean: 73
```

These findings are separate from the six identity/write-protection blockers already present in the Payload plan. With both protections applied, only 75 rows should remain eligible for a later apply review until provenance problems are repaired.

## Command

```powershell
node scripts/radar/audit-ai-radar-source-provenance-v01.mjs
```

Outputs are written under:

```text
data_local/staging/ai-radar/source-provenance-audit-v01/
```

The audit is read-only and does not modify Payload, PostgreSQL, or the assessment batch.
