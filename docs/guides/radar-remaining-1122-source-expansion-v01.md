# Radar remaining 1,122 Phase 1 source expansion v0.1

## Purpose

This phase expands evidence for the frozen 1,122-row closeout input without
reading or writing Payload or PostgreSQL.

It performs three bounded operations:

1. exact-ID Wikidata lookup:
   - Bangumi subject ID: P5732;
   - AniList anime ID: P8729;
   - Visual Novel Database ID: P3180;
2. title-search candidate generation for the 65 synthetic MGV2 identities;
3. offline closeout triage:
   - reconstruct 203 missing source summaries without changing grade/rule;
   - close low-grade D/E/F risk signals as consistent without mutation;
   - keep S/A/B/C risk signals in human adjudication;
   - never accept title-only identity matching automatically.

## Identity rules

Exact external identifiers may add Wikidata as an independent provider.

A title search may only produce candidates. It cannot:

- resolve identity;
- increase the independent-provider count;
- change grade or decisive rule;
- authorize publication.

## Resume behavior

Network checkpoints are retained under:

`exports/radar-remaining-1122-source-expansion-work-v01`

A failed or interrupted run can be repeated. Completed exact-ID batches,
entity lookups, and MGV2 title searches are reused.

## Network path

The PowerShell runner checks `127.0.0.1:10808`.

- if reachable, it uses `http://127.0.0.1:10808`;
- otherwise it uses a direct curl connection;
- a caller may explicitly pass `-ProxyUrl none` or another proxy URL.

## Output

The result ZIP contains:

- exact-ID Wikidata evidence;
- MGV2 title candidates;
- complete 1,122-row Phase 1 resolution ledger;
- ready/additional-source/human/fresh-research queues;
- summary, input binding, run receipt, and recursive manifest.

This phase does not create a production gate.
