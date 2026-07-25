# Remaining canonical Works research handoff V01

## Purpose

This stage converts the accepted remaining-canonical inventory into the existing external-research handoff format.

It does not perform research, assign Radar grades, publish conclusions, modify Works, call Payload, or write PostgreSQL. It only prepares local files beneath `data_local`.

Accepted source evidence:

```text
RADAR-REMAINING-CANONICAL-INVENTORY-20260725-133820.zip
SHA-256 EC1F49A54CD0B6314F97A20DB1E0D3681247CB4FA61B5F89C9A4C1F465C62E5B

RADAR-REMAINING-CANONICAL-INVENTORY-20260725-133820-REVIEW.zip
SHA-256 58265B1009AE1D82091555D658279A8F797308B6008FC9D23B8591A6D8330E2A
```

The accepted inventory contains 2,500 `missing_current` Works divided into ten independently recoverable 250-row waves.

## Why an adapter is required

The inventory rows deliberately describe publication state:

```text
inventoryStatus = missing_current
currentPublicConclusionCount = 0
```

The established external-research preparer and assembler require:

```text
catalogQueue.queue = external_research
```

The adapter preserves every inventory identity field and adds only the research-routing fields required by `ai-radar-research-handoff-v0.1`:

- `catalogQueue`;
- `existingState`;
- `writeProtection`;
- `inputAudit`;
- `researchSource`.

It does not change Work IDs, site IDs, titles, slugs, publication keys, batch order, or wave order.

## Output structure

The formal output is one local package:

```text
data_local/outputs/ai-radar/research-handoffs/
  RADAR-REMAINING-CANONICAL-RESEARCH-0001-input-v01/
```

It contains:

```text
package-manifest.json
catalog-batch-manifest-v01.json
RESEARCH_INSTRUCTIONS.md
SHA256SUMS
source/
handoffs/
```

The handoff layout is fixed:

```text
research rows             2500
subwaves                     10
rows per subwave            250
chunks per subwave           50
rows per chunk                5
total chunks                500
```

Every subwave contains the standard files expected by the existing research assembler:

```text
handoff-manifest.json
handoff-summary.json
RESEARCH_INSTRUCTIONS.md
<batch>.source.jsonl
chunks/*.input.jsonl
responses/
```

No empty response file is created. A response file appears only after that research chunk has actually been completed.

## Validation gates

The adapter refuses to generate output unless all of the following remain true:

- the uploaded review manifest reproduces every listed file by bytes and SHA-256;
- the accepted source bundle SHA matches;
- the independent audit confirms deterministic batch order, exact wave concatenation, accepted wave hashes, and no production-write authorization;
- the research batch contains exactly 2,500 unique identities;
- every row is active, published, `missing_current`, and has zero current public conclusions;
- every row has a Work ID, site ID, title, slug, and matching `publicationKey=work:<id>`;
- all ten wave files match their manifests and concatenate exactly to the accepted research batch;
- output remains below `data_local`;
- write-like CLI flags are rejected.

The runner then independently checks:

- 2,500 / 10×250 / 500×5 counts;
- every subwave is independently recoverable;
- all package `SHA256SUMS` entries;
- all safety declarations;
- the final ZIP SHA-256.

## Run

On the fixed PR branch and HEAD:

```powershell
pwsh `
  -NoProfile `
  -ExecutionPolicy Bypass `
  -File .\scripts\radar\run-and-package-radar-inventory-research-handoff-v01.ps1 `
  -ExpectedBranchHead <fixed 40-character PR HEAD>
```

No Docker container, Payload credentials, or database connection is needed.

Successful output reports:

```text
ResearchRows     : 2500
Subwaves         : 10
RowsPerSubwave   : 250
Chunks           : 500
ChunkSize        : 5
PayloadWrite     : False
PostgreSQLWrite  : False
WorksModified    : False
RatingsPublished : False
ProductionApply  : False
```

## Research execution

Research remains chunked at five Works because each row requires external source verification and structured evidence. The user-facing package is one ZIP, but internally any failed chunk or 250-row wave can be resumed independently.

For each wave:

1. process the 50 chunk input files in manifest order;
2. save each exact matching JSONL response path;
3. run the existing assembler with that wave batch ID and the package `handoffs` directory;
4. inspect blockers, warnings, identity-review rows, and needs-more-research rows;
5. checkpoint the completed wave before starting the next one.

The existing assembler continues to enforce one response per Work, exact site identity, legal evidence status, source URLs, evidence coverage, and the fact-only research boundary.

## Safety boundary

```text
Payload read/write             false / false
PostgreSQL direct write        false
Works modification             false
Radar grade assignment         false
Rating publication             false
Production apply package       false
Migration/schema push          false
Output outside data_local      rejected
```

Completion of this handoff package authorizes research file preparation only. It does not authorize assessment, publication, production apply, or rollback execution.
