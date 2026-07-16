# AI radar assessment handoff v0.1

The full catalog has been accounted for under the corrected queue rules:

```text
35,611 total Works
10,805 ready for local-evidence AI assessment
23,607 requiring external research
138 requiring identity or series review
94 already carrying a complete AI radar assessment
441 protected, reviewed or deprecated
526 missing siteId
0 unclassified
```

This stage prepares one deterministic assessment batch for ChatGPT/web review. It does not write Payload or PostgreSQL.

## Why a handoff layer is needed

The catalog queue contains 44 normal assessment batches. Each batch is SHA-bound and series-aware, but a 250-row JSONL may be too large to assess safely in one response.

The handoff layer:

- verifies the source catalog manifest and batch SHA-256;
- accepts only `ready_for_ai_assessment` batches;
- copies the exact source batch into an isolated directory;
- splits it into deterministic upload chunks;
- records the exact expected response file and identity set for every chunk;
- validates and assembles returned JSONL without trusting model-supplied identity or protection fields.

## Prepare a batch

After pulling the branch, prepare the first normal assessment batch:

```powershell
pnpm radar:prepare-assessment-handoff -- `
  --batch-id RADAR-ASSESS-0001
```

The default chunk size is 25. It can be changed from 5 to 100:

```powershell
pnpm radar:prepare-assessment-handoff -- `
  --batch-id RADAR-ASSESS-0001 `
  --chunk-size 50
```

Default output:

```text
data_local/staging/ai-radar/assessment-handoffs-v01/radar-assess-0001/
  ASSESSMENT_INSTRUCTIONS.md
  handoff-manifest.json
  handoff-summary.json
  radar-assess-0001.source.jsonl
  chunks/
    radar-assess-0001-chunk-0001.input.jsonl
    ...
  responses/
  assembled/
```

The command replaces only this local handoff directory. The catalog queue and Payload are unchanged.

## Web assessment workflow

Upload the chunk input files in manifest order. The generated instructions require one JSONL output row per input row and preserve these principles:

- evaluate all current radar rules internally;
- output every matched rule and material contradiction;
- do not manufacture verbose negative rows for all 55 rules;
- never invent sources, plot events, endings or relationship claims;
- use `insufficient_evidence` or `unknown` honestly;
- preserve exact workId and siteId;
- keep page semantics as `AI 综合，待复核`, never `最终评级`;
- do not treat the existing rank as ground truth.

Save each result to the exact response path listed in `handoff-manifest.json`.

## Assemble returned chunks

```powershell
pnpm radar:assemble-assessment-handoff -- `
  --batch-id RADAR-ASSESS-0001
```

The assembler rejects:

- missing response chunks;
- unknown, missing or duplicate work IDs;
- siteId mismatches;
- invalid evidence coverage or evidence status;
- missing source summaries;
- malformed rule assessments;
- source/chunk SHA changes.

The assembler does not accept model-supplied `existingState` or `writeProtection`. Those fields are injected only from the original canonical input.

When all chunks pass, the complete raw assessment file is written under:

```text
assembled/radar-assess-0001.raw-assessments.jsonl
```

The summary prints the exact local resolver command. Resolver output remains local and review-only.

## Safety

```text
Payload read: false
Payload write: false
Payload PATCH requests: 0
PostgreSQL write: false
creates/deletes Works: false
outputs restricted to data_local
model can alter canonical identity/protection: false
```

No generalized Payload write path is introduced by this stage.
