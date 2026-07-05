# Catalog Work Graph Policy v0.1

This document defines the first review-safe policy for building a catalog work graph from the full-catalog dry-run plan.

The policy is intentionally conservative. It describes how to represent source records, work candidates, child candidates, editions, releases, and existing Payload works as graph nodes and edges without turning uncertain relationships into final catalog structure.

## Status

- Version: v0.1
- Scope: local graph preview and review artifacts
- Based on: SourceRecord v0.2 and full catalog ingestion plan v0.4
- Safety level: preview only

## Core principles

1. Record evidence before deciding identity.
2. A Work is a stable creative entity, not every source row.
3. A volume, chapter, edition, platform release, or import artifact must not be promoted to a Work by accident.
4. Same title is evidence, not proof.
5. Source identity and external IDs are stronger than normalized title.
6. Uncertain relationships must remain reviewable.
7. The graph builder must not remove, rewrite, or overwrite Payload data.
8. The graph preview is a staging artifact, not a production catalog mutation.

## Current trusted input

The graph builder should use the current Payload-checked v0.4 dry-run plan as input.

Expected default input:

```text
data_local/staging/full-catalog-ingestion/full-catalog-ingestion-plan-v04.jsonl
```

The v0.4 baseline should pass the Payload baseline guard before it is used as the current graph input.

Expected guard indicators:

```text
readyForPayloadBaseline: true
payloadChecked: true
payloadWorks > 0
needsPayloadComparison: 0
sourceRecordsFailed: 0
```

## Node model

### SourceRecord node

A SourceRecord node represents one normalized source row from AniList, Bangumi, VNDB, Steam, Wikidata-derived evidence, or another staged source.

Suggested node type:

```text
source_record
```

Suggested id pattern:

```text
source:<sourceName>:<sourceRecordKey>
```

Required fields:

- `nodeId`
- `nodeType`
- `sourceRecordKey`
- `sourceName`
- `sourceId`
- `sourceUrl`
- `sourceTitle`
- `normalizedTitle`
- `sourceMediaType`
- `eligibilityStatus`
- `rawPath`

A SourceRecord node may point to a candidate node or to an existing Payload Work node, but it is not itself a Work.

### Existing Work node

An Existing Work node represents a Work that already exists in Payload and was matched during dry-run planning.

Suggested node type:

```text
existing_work
```

Suggested id pattern:

```text
payload-work:<id>
```

Required fields when available:

- `payloadId`
- `siteId`
- `slug`
- `title`
- `normalizedTitle`

Existing Work nodes are reference nodes in the preview graph. The graph builder must not modify them.

### WorkCandidate node

A WorkCandidate node represents a source row that may become a stable top-level Work after review or after a future guarded import path.

Suggested node type:

```text
work_candidate
```

Suggested id pattern:

```text
work-candidate:<sourceRecordKey>
```

Source plan actions that may produce WorkCandidate nodes:

- `create_new_work`
- `create_new_work_needs_review`

A WorkCandidate is not a final Work. It is a candidate with evidence.

### ChildEntityCandidate node

A ChildEntityCandidate node represents a likely child entity, such as a volume-like item, chapter-like item, part-like item, or source row that should not be promoted to top-level Work without policy review.

Suggested node type:

```text
child_entity_candidate
```

Suggested id pattern:

```text
child-candidate:<sourceRecordKey>
```

Source plan actions that may produce ChildEntityCandidate nodes:

- `create_child_entity_needs_policy`

A ChildEntityCandidate should point to a candidate parent when the evidence is useful, or remain parentless for review when the parent evidence was rejected or missing.

### EditionOrReleaseCandidate node

An EditionOrReleaseCandidate node represents a release, edition, platform-specific version, packaging variant, or other publication-level row that should not become a top-level Work by default.

Suggested node type:

```text
edition_or_release_candidate
```

Suggested id pattern:

```text
edition-release-candidate:<sourceRecordKey>
```

Source plan actions that may produce EditionOrReleaseCandidate nodes:

- `create_volume_or_edition_needs_policy`

This node type is for staging relation review, not for automatic top-level Work creation.

### IdentityEvidence node

An IdentityEvidence node represents structured evidence for identity decisions, such as source IDs, URLs, external database IDs, Wikidata QIDs, official URLs, or cross-source links.

Suggested node type:

```text
identity_evidence
```

Suggested id pattern:

```text
evidence:<evidenceType>:<valueHash>
```

IdentityEvidence nodes should be produced in a later identity evidence index step. The Work Graph may reserve the type but does not need to fully populate it in the first preview.

## Edge model

### evidence_for_candidate

Connects a SourceRecord node to a candidate node.

Examples:

```text
source_record -> work_candidate
source_record -> child_entity_candidate
source_record -> edition_or_release_candidate
```

Use when a source row is represented as evidence for a staged candidate entity.

### linked_to_existing_work

Connects a SourceRecord node to an Existing Work node when the dry-run plan matched one existing Payload Work.

Common source action:

```text
link_existing_work_exact_title
```

This edge means the source row is currently aligned to an existing Work by the planner. It does not change Payload data.

### candidate_child_of

Connects a ChildEntityCandidate node to a likely parent candidate or existing Work.

Use only when the planner provided a useful parent candidate or matched parent work.

When parent evidence is rejected, do not create a confident parent edge. Instead, preserve the rejected evidence on the child candidate and route it to review.

### candidate_edition_of

Connects an EditionOrReleaseCandidate node to a likely parent candidate or existing Work.

This edge should be review-safe. It means the row is likely an edition or release of another entity, not an independent top-level Work.

### possible_duplicate_of

Connects a candidate or source record to one or more existing Works or candidates when the planner found a duplicate-title or identity ambiguity.

Common source action:

```text
possible_duplicate_title
```

This edge is always review-only in v0.1.

### same_title_candidate

Connects two candidates or existing Works that share the same normalized title but do not have stronger identity evidence.

This edge must never be treated as a confirmed identity relation.

### identity_evidence_for

Connects an IdentityEvidence node to a SourceRecord, candidate, or Existing Work node.

This edge is reserved for the identity evidence index and merge scoring stage.

## Action-to-node mapping

| Plan action | Primary node | Primary edge | Notes |
|---|---|---|---|
| `create_new_work` | `work_candidate` | `evidence_for_candidate` | Candidate only. Not a final Work. |
| `create_new_work_needs_review` | `work_candidate` | `evidence_for_candidate` | Candidate with review requirement. |
| `link_existing_work_exact_title` | `existing_work` reference | `linked_to_existing_work` | Planner alignment to an existing Work. |
| `possible_duplicate_title` | source/candidate + existing references | `possible_duplicate_of` | Manual identity review. |
| `create_child_entity_needs_policy` | `child_entity_candidate` | `evidence_for_candidate`; optional `candidate_child_of` | No top-level promotion. |
| `create_volume_or_edition_needs_policy` | `edition_or_release_candidate` | `evidence_for_candidate`; optional `candidate_edition_of` | No top-level promotion. |
| `link_to_parent_work_candidate` | child/edition candidate + existing/candidate parent | `candidate_child_of` or `candidate_edition_of` | Review-safe parent relation. |
| `evidence_only` | `source_record` only | optional future `identity_evidence_for` | Do not create WorkCandidate. |
| `quarantine` | none in accepted graph | none | Must be zero for current v0.4 baseline. |
| `needs_payload_comparison` | none for baseline graph | none | Must be zero for Payload baseline graph. |

## Boundary rules

### Stable Work candidate

A row may become a WorkCandidate when all of the following are true:

- It has usable title identity evidence.
- It is in scope for the catalog.
- It is not volume-like, chapter-like, edition-like, or release-like.
- It does not match multiple existing Works by normalized title.
- It does not require Payload comparison.

### Child candidate

A row should remain a ChildEntityCandidate when it looks like a volume, part, chapter, numbered sub-item, or child source row.

Examples include source rows with boundary reasons such as:

```text
volume_like_title
volume_like_title_without_useful_parent
parent_title_inferred
```

A child candidate may have rejected parent evidence. Rejected parent evidence must be preserved, not silently discarded.

### Edition or release candidate

A row should remain an EditionOrReleaseCandidate when it represents a release, edition, platform version, packaging variant, or source-specific publication instance.

The graph may point it toward a likely parent, but this is not a top-level Work promotion.

### Evidence-only row

A row with identity evidence but no safe Work identity should remain SourceRecord evidence only.

Common reason:

```text
missing_title_identity_evidence
```

These rows can be useful later for identity indexing, but they do not create candidate Works by themselves.

## Review-only conditions

The following graph relations must be review-only in v0.1:

- `possible_duplicate_of`
- `same_title_candidate`
- parent edge created only from weak inferred title
- child candidate with rejected parent evidence
- edition/release candidate with unclear parent
- any row with low confidence and no strong identity evidence

## Blocker conditions for graph preview audit

The Work Graph audit should treat these as blockers:

- Duplicate node IDs.
- Duplicate edge IDs.
- Edge source node missing.
- Edge target node missing.
- Any accepted graph node from `quarantine` rows.
- Any accepted graph node from known local workflow artifact rows.
- Any accepted graph node from `needs_payload_comparison` rows.
- Remaining numeric parent candidate edges.
- Remaining too-short parent candidate edges.
- SourceRecord input row count does not match represented SourceRecord nodes.

## Warning conditions for graph preview audit

The Work Graph audit should treat these as warnings, not blockers:

- `possible_duplicate_title` rows remain.
- Low-confidence candidates remain.
- Child candidates without confident parent remain.
- Edition/release candidates without confident parent remain.
- Rejected parent candidates are present but preserved correctly.

Warnings should feed review queues rather than block the preview graph.

## Expected v0.1 outputs

A graph preview builder should write:

```text
data_local/staging/work-graph/work-graph-v01.nodes.jsonl
data_local/staging/work-graph/work-graph-v01.edges.jsonl
data_local/staging/work-graph/work-graph-v01-summary.json
data_local/staging/work-graph/work-graph-v01.md
```

A graph audit should write:

```text
data_local/staging/work-graph/work-graph-v01-audit.json
data_local/staging/work-graph/work-graph-v01-audit-summary.json
data_local/staging/work-graph/work-graph-v01-audit.md
```

A graph review queue should write:

```text
data_local/staging/work-graph/work-graph-review-queue-v01.jsonl
data_local/staging/work-graph/work-graph-review-queue-v01.csv
data_local/staging/work-graph/work-graph-review-queue-v01.md
```

These files are local staging outputs and should not be committed.

## Human review queue priorities

| Priority | Condition | Example handling |
|---|---|---|
| P0 | Graph integrity blocker | Fix builder or input before using graph. |
| P1 | Possible duplicate identity | Manual identity review. |
| P2 | Child or edition relation unclear | Keep as candidate and review parent relation. |
| P3 | Low-confidence but structurally safe | Keep as source evidence or candidate with warning. |

## Current known cases

### Rain-sleep duplicate title cluster

The current v0.4 Payload baseline still has four `possible_duplicate_title` rows for the `雨眠` title cluster.

Policy decision:

- Keep these as review-only identity candidates.
- Do not auto-link by title only.
- Do not auto-merge existing Works.
- Route to identity review queue.

### Rejected parent candidate samples

The current v0.4 plan preserves four rejected parent candidates:

- `哇!` rejected as too short.
- `10` rejected as numeric.
- `24` rejected as numeric.
- `384` rejected as numeric.

Policy decision:

- Preserve rejected evidence.
- Do not create parent edges from rejected values.
- Keep affected rows as child candidate or review-needs WorkCandidate according to planner output.

## Non-goals for v0.1

This policy does not define a production database schema.

This policy does not authorize graph import into Payload.

This policy does not define final identity merge decisions.

This policy does not define public frontend presentation.

This policy only defines how to create a safe local graph preview and the audit requirements for trusting that preview.

## Next PRs

The intended next steps are:

1. Build Work Graph preview from v0.4 plan.
2. Audit Work Graph preview.
3. Build Work Graph review queue.
4. Define identity merge policy.
5. Build identity evidence index.
6. Score identity merge candidates.
7. Audit identity merge candidates.
8. Build combined catalog graph and identity review queue.
