# Radar remaining 1,122 Phase 2 live identity guard and AI coverage closeout v0.2

## Purpose

Phase 1 expanded exact-ID evidence and reconstructed missing summaries without
changing any grade or decisive rule. Phase 2 freezes every remaining row into
an AI-coverage state before unified incremental assembly.

The coverage rule is now:

1. human and AI assessment tracks are independent;
2. every canonical Work must have one current AI conclusion;
3. human data never blocks, deletes, replaces, or suppresses the AI conclusion;
4. AI data never mutates the human track;
5. human-first precedence applies only to window display, search display,
   sorting, filtering, and compatibility output.

The final states are:

1. `ready_for_unified_incremental_assembly`;
2. `already_current_ai_conclusion`;
3. `retained_blocked_with_final_reason`;
4. `identity_or_policy_human_decision_required`.

The fourth state must contain zero rows. A retained blocked row is permitted
only when it is noncanonical or cannot yet be attached to a canonical Work
identity. Evidence weakness, human disagreement, lifecycle, or visibility do
not suppress the AI track.

## Live read-only identity guard

A one-time local audit token starts a dedicated Next process with:

```text
PAYLOAD_DB_PUSH=false
RADAR_PUBLIC_CONCLUSIONS_SCHEMA_READY=true
PGOPTIONS=-c default_transaction_read_only=on ...
```

The collector reads:

- all current draft Works;
- all published Works;
- all current public Radar conclusions.

The identity guard blocks new AI storage only when:

- published or latest-draft Work is missing;
- Work ID or `siteId` does not match the canonical target;
- an existing current public conclusion points to the wrong Work or
  publication key.

These values are recorded but do not block AI storage:

- a valid human assessment;
- `catalogStatus`;
- Payload `_status`;
- lite/full visibility.

Lifecycle and visibility still control whether the Work and its effective
display grade are surfaced to users. They do not decide whether the independent
AI conclusion exists.

When a matching current AI conclusion already exists, the row becomes
`already_current_ai_conclusion` and is excluded from create SQL.

## Evidence-shortage policy

A single traceable provider is not enough for a strong conclusion, but it is
enough to avoid an empty AI track.

Rows with one independent provider:

- retain the latest structurally valid grade and decisive rule;
- use `single_traceable_source_ai_conclusion`;
- cap confidence and evidence coverage;
- keep `requiresHumanReview = true`;
- carry an explicit single-provider warning;
- remain eligible for later evidence enrichment.

Evidence weakness changes uncertainty metadata, not the existence of the AI
conclusion.

## Research-completeness boundary

Phase 2 proves AI-track coverage and live canonical identity. It does not claim
that all 1,122 Works have already completed the new per-Work multilingual
walkthrough, Wiki, long-review, and community scan.

Rows without a completed standardized scan are bootstrap AI conclusions:

- they remain eligible for assembly so the AI track is never empty;
- they retain explicit uncertainty and `requiresHumanReview`;
- they remain queued for the multilingual research campaign;
- the later complete research snapshot supersedes the bootstrap snapshot;
- Phase 2 output must not be described as proof that deep-dive research is
  complete.

The mandatory scan and research-ledger rules live in:

```text
docs/guides/radar-work-level-multilingual-research-policy-v01.md
```

## Curated 18-row decisions

The five Gunbuster conflicts follow the locked latest-structurally-valid
policy. Single-provider rows receive reviewable AI conclusions rather than
being omitted.

Automated risk rows are handled in two ways:

- non-decisive or contradicted signals retain the existing grade and rule;
- decisive route, male-romance, identity, or male-centered adult signals
  receive an explicit revised AI grade with traceable rationale.

The three discarded test rows are handled as follows:

- AniList source-split Work `25561` is a noncanonical merge-out record; its
  canonical AI coverage is provided by Work `32094`;
- canonical Bangumi Work `32094` receives a fresh `D/D-GENERAL` AI snapshot,
  even when a human track exists;
- canonical Bangumi Work `32186` receives a fresh `B/B-LIGHT` AI snapshot.

No discarded test snapshot is remapped as a new conclusion.

## Display and search precedence

The derived display grade remains:

```text
valid human grade
→ otherwise current AI grade
→ otherwise unknown
```

This order affects only:

- Work detail windows;
- search result cards;
- filters, sorting, and compatibility `rank` output.

It does not affect:

- AI storage;
- AI publication eligibility;
- AI supersession;
- evidence collection;
- human-track storage.

When human and AI disagree, both tracks remain visible and independently
auditable.

## Network and failure diagnostics

The live collector reads the three collections sequentially to avoid
overloading the local Next process. Every request:

- has a 90-second timeout;
- retries transient network, 408, 429, and 5xx failures;
- prints collection page progress;
- includes method, URL, attempt count, and underlying network cause on final
  failure.

A failed run stores Next stdout, stderr, and a failure receipt under:

```text
exports/radar-remaining-1122-phase2-failure-<timestamp>
```

A failed run never produces an accepted evidence bundle.

## Safety

- Payload login is the only POST and uses a one-time local audit token.
- Collection access is GET-only.
- PostgreSQL is forced read-only at the connection level.
- No Payload mutation method exists.
- No production SQL or apply package is generated.
- No private Work patch is executed.
- No production gate is created.
