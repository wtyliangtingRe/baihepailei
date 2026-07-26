# Radar next-10,000 research campaign v0.1

This workflow prepares one review-only ZIP for external factual research. It does not read Payload or PostgreSQL, modify Works, publish ratings, create an apply package, or generate research or assessment responses.

## Accepted local inputs

The committed acceptance binding is:

`scripts/radar/fixtures/radar-next-10000-campaign-accepted-sources-v01.json`

It binds the accepted canonical inventory source and review manifests, the earlier 2,500-row campaign, the accepted v0.2 assessment input, and the completed local import review. The preparer verifies hashes, row counts, and the relevant immutable receipts before accepting identities. Coverage is determined from manifest rows, not inferred from artifact filenames.

The canonical source is the accepted published-Works snapshot stored in the repository-local inventory export. Reading that immutable local snapshot is not a Payload or database read.

## Coverage ledger and selection

`buildCoverageLedger` scans every active canonical row and records exclusions with:

- `workId`, `siteId`, and `title`;
- every exclusion reason;
- accepted package and manifest evidence;
- write-protection state;
- human-verification state;
- the normalized identity.

It excludes accepted or completed research, assessment, import, v0.6, and publication-bound coverage; protected and human-verified rows; missing identities; and later duplicate work IDs, site IDs, or normalized identities.

Selection uses the repository-defined inventory ordering:

1. research priority ascending;
2. numeric work ID ascending;
3. site ID ascending;
4. title ascending.

The selection summary stores both the algorithm and a checksum of the ordered identity receipt. If fewer than 10,000 eligible rows exist, the preparer writes only an honest shortfall ledger and summary. It does not create a campaign package, pad, duplicate, or fabricate rows.

## Package contract

The completed input package contains:

- 10,000 ordered immutable input rows;
- 40 independently recoverable Waves of 250 rows;
- 10 chunks per Wave;
- 25 rows per chunk;
- 400 empty, declared external response files;
- package and Wave manifests;
- ordered identity receipts;
- the response schema and research instructions;
- the accepted-source binding;
- coverage and exclusion ledgers;
- the selection summary;
- a human-readable QA report;
- `immutable-root-manifest-v01.json`;
- complete immutable checksums in `SHA256SUMS`.

`SHA256SUMS` starts with the SHA-256 of the immutable root manifest and then lists every immutable file. The immutable root anchors the package manifest, Wave manifests, aggregate and Wave inputs, chunk inputs, schema, instructions, acceptance binding, ledgers, summaries, and QA report. External response files are deliberately excluded from the immutable root so genuine responses can be added later. Their prepared empty state and hashes are recorded separately in `initial-inventory-sha256-v01.json`.

The package manifest declares the exact closed-world file inventory. Validation rejects missing or extra files, path traversal, absolute paths, duplicate entries, normalized-path duplicates, case collisions, symlinks, non-regular entries, and checksum or receipt tampering.

Every Wave declares independent recovery and assembly. Initially every Wave is structurally valid but incomplete because it has zero genuine response rows. The root aggregate remains incomplete until all Waves have valid genuine responses. A future blocker in one Wave must not suppress valid assembly output from another Wave.

## Research response contract

Research responses are factual and separate from assessment. The schema keeps these findings distinct:

- identity status;
- source, content, relationship, and ending summaries;
- sources, unresolved questions, research notes, and contradictions;
- female/female relationship evidence;
- male involvement;
- NTR risk;
- ending status;
- sexual content and participants;
- violence or horror;
- age or consent risk;
- coercion risk;
- raw adult-content facts;
- TS, futa, ABO, and crossdressing/otokonoko settings.

Adult or explicit content is factual metadata. It must not automatically reduce a future grade. Assessment modes, exact suggestions, bounded ranges, labels-only outcomes, final grades, ratings, and publication decisions are forbidden in this campaign.

## Run the real local rehearsal

From the repository root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/radar/run-and-package-radar-next-10000-campaign-v01.ps1
```

Generated data is written only under:

`data_local/outputs/ai-radar/research-campaign-next-10000-v01`

The user-facing review ZIP is written under:

`exports/RADAR-NEXT-CANONICAL-RESEARCH-10000-0001-input-v01-review.zip`

The wrapper regenerates the package, creates the ZIP, calculates its outer SHA-256, extracts it only beneath `data_local` staging, and reruns closed-world, receipt, checksum, structure, uniqueness, and identity/order validation.

Arbitrary output locations are rejected. Node-generated data is confined to `data_local`; the optional review ZIP is confined to `exports`.

## Verification commands

```powershell
node --check scripts/radar/lib/research-campaign-v01.mjs
node --check scripts/radar/prepare-radar-next-10000-campaign-v01.mjs
node --test tests/radar-next-10000-campaign-v01.test.mjs
node --test tests/radar-inventory-research-handoff.test.mjs
node --test tests/radar-research-handoff.test.mjs
node --test tests/radar-research-assessment-bulk-v02.test.mjs
node --test tests/radar-research-assessment-import-v02.test.mjs
```

The PowerShell wrapper must also be parsed with
`System.Management.Automation.Language.Parser.ParseFile` before release.

## Safety declaration

- no network fetch;
- no Payload read or write;
- no PostgreSQL read or write;
- no Works mutation;
- no rating publication;
- no release gate;
- no production apply package;
- no migration or schema push;
- no automatic X;
- no synthetic genuine responses;
- generated data confined to `data_local`;
- review ZIP confined to `exports`;
- arbitrary output paths rejected;
- review-only language and status.
