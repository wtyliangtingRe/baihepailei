# Catalog Entity Boundary Policy v0.1

Status: draft policy for dry-run planning

This document defines the first public-catalog entity boundaries for the full catalog ingestion work. It exists because `audit-full-catalog-ingestion-plan-v01` found a large number of volume-like `create_new_work` candidates. Before any write path exists, the project needs a clear rule for what should become a Work, what should become a child entity, and what should remain source evidence.

## Core principle

The catalog should not hide uncertain records, but it also should not flatten every source row into a top-level Work.

Use this principle:

```text
Record everything.
Promote only stable creative entities to Work.
Keep editions, volumes, source rows, and identity links visible but structurally separate.
```

This means:

- Unknown records can remain visible with status labels.
- Source evidence should not be discarded.
- A volume, edition, or platform row should not automatically become a top-level Work.
- Radar status belongs to an assessed creative entity, not to every raw source row.
- No rule in this document authorizes Payload writes or PostgreSQL writes.

## Entity definitions

### Work

A Work is a stable creative entity that users would reasonably search for, discuss, review, or assess as a unit.

Examples:

- A manga series.
- A one-shot manga.
- A standalone novel.
- A visual novel.
- An anime series, film, OVA, or ONA entry when it is a distinct release unit.
- A game.

A Work may have many SourceRecords, IdentityLinks, Editions, Volumes, or Releases.

### Series

A Series is a parent grouping for closely related Works, Editions, or Volumes when the source data clearly represents a family of related entries.

Use Series when:

- Multiple source rows share a clear parent title and differ mainly by volume number, part number, edition, or chapter marker.
- A franchise has multiple distinct creative Works that should still be grouped.
- The parent itself is useful for navigation and review.

A Series is not automatically a Work. A project can later choose whether Series is implemented as a separate collection, a Work subtype, or a relationship field.

### Volume

A Volume is a numbered or named part of a parent Work or Series.

Typical markers:

- `01`, `02`, `03`
- `Vol. 1`, `Volume 2`
- `第1卷`, `第2巻`
- `上巻`, `下巻`
- `前篇`, `後篇`, `后篇`

Examples:

- `瑪莉亞的凝望 01`
- `瑪莉亞的凝望 02 黃薔薇革命`
- A manga tankobon volume.
- A light novel volume.

Default rule: **do not create a top-level Work for a volume-like row unless the source row is clearly a standalone creative entity.**

### Edition

An Edition is a publication or release variant of a Work or Volume.

Examples:

- Print edition vs ebook edition.
- Original edition vs revised edition.
- Platform-specific release.
- Language-specific publication.
- Steam release of an already-known game or visual novel.

Default rule: **editions should be attached to their parent Work / Volume rather than promoted to Work.**

### Release

A Release is a time/platform-specific availability event.

Examples:

- Steam release date.
- Console release.
- Blu-ray release.
- Regional publication.

Default rule: **a Release is evidence and timeline data, not a Work.**

### SourceRecord

A SourceRecord is one row or object from an external/local source.

Examples:

- AniList media row.
- Bangumi subject row.
- MangaDex manga row.
- Steam app row.
- VNDB URL row.
- Wikidata identity evidence row.

A SourceRecord can be:

- promoted to a new Work candidate;
- linked to an existing Work;
- linked as evidence only;
- grouped under a Volume / Edition / Release;
- quarantined if unusable.

Default rule: **SourceRecord is always preserved when possible, but not always promoted.**

### IdentityLink

An IdentityLink connects entities or source records that likely refer to the same creative entity or related release.

Examples:

- Steam appid to VNDB ID.
- Bangumi subject ID to MangaDex ID.
- Wikidata QID to AniList ID.

Default rule: **identity links are evidence, not radar evidence and not automatic overwrite authority.**

### RadarAssessment

A RadarAssessment is the public or internal yuri/radar judgement state for a creative entity.

Default rule:

- Radar status should be attached to the best available Work-level entity.
- If a volume or edition materially changes the situation, it can have a scoped assessment or evidence note.
- AI-generated radar text must remain clearly marked as `AI 综合，待复核`.
- Do not use final/permanent wording.

## Promotion rules

### Promote to top-level Work

Promote a SourceRecord to `create_new_work` only when most of these are true:

- It has a usable title.
- It represents a creative entity rather than a publication row only.
- It is not obviously a volume, chapter, edition, or release row.
- It has a media type in scope: anime, manga, novel/book, game, visual novel, or relevant mixed media.
- It is not an identity-link-only row.
- It does not match an existing Work by strong identity key or exact normalized title.

### Link to existing Work

Use `link_existing_work_*` when:

- Strong source identity already points to an existing Work; or
- Exact normalized title matches a single existing Work and no conflict is visible; or
- The row is a platform/source representation of a known Work.

Exact title match is only medium-confidence unless supported by source identity, creator, date, or media type.

### Mark possible duplicate

Use `possible_duplicate_title` or equivalent review state when:

- A normalized title matches multiple existing Works.
- Different source rows share a title but differ by media type, creator, or publication context.
- Existing database already has duplicate titles such as `雨眠` or `少女`.

Default rule: **possible duplicates require human review before write.**

### Create Volume / Edition / child entity

Use a future `create_volume_or_edition` action when:

- The title is volume-like or edition-like.
- A parent title can be inferred with reasonable confidence.
- The row is useful to users but should not become a top-level Work.

Until the schema exists, planner scripts should use a conservative action such as:

```text
create_child_entity_needs_policy
```

or keep the row as `source_record_only` with a parent-candidate note.

### Mark evidence only

Use `evidence_only` when:

- The row exists to connect IDs, URLs, or sources.
- It lacks a standalone title but contains useful identity evidence.
- It describes a source relationship rather than a creative entity.
- It is from Wikidata, VNDB link maps, NDL, Moegirl, or similar evidence workflows unless clearly in-scope as a Work.

### Quarantine

Use `quarantine` only when:

- Title is missing and no useful identity evidence exists.
- The row is parse garbage.
- The row is system/spam/unrelated.
- The row is obviously outside anime/manga/novel/game scope.

Quarantine is not deletion. Quarantined rows should remain auditable in local reports.

## Decision table

| Source row pattern | Default action | Notes |
|---|---|---|
| Standalone manga/anime/game/novel title, no match | `create_new_work` | Still dry-run only. |
| Exact title matches one Work | `link_existing_work_exact_title` | Medium confidence unless source identity also matches. |
| Source key matches one Work | `link_existing_work_source_key` | High confidence. |
| Title matches multiple Works | `possible_duplicate_title` | Human review required. |
| Volume-numbered title | `create_child_entity_needs_policy` | Do not flatten to Work by default. |
| Edition/platform release | `source_record_only` or `create_edition_needs_policy` | Depends on future schema. |
| Steam appid ↔ VNDB URL row | `evidence_only` | Identity evidence only. |
| Wikidata candidate row | `evidence_only` or review | Not radar evidence. |
| Missing title, no identity evidence | `quarantine` | Inspect parse quality. |
| Maybe-catalog / unknown media type | `create_new_work_needs_review` | Review before any apply path. |

## Planner action vocabulary v0.2

Future planner scripts should move toward these actions:

```text
create_new_work
create_new_work_needs_review
link_existing_work_source_key
link_existing_work_exact_title
possible_duplicate_title
identity_conflict_source_key
source_record_only
create_child_entity_needs_policy
create_volume_or_edition_needs_policy
link_to_parent_work_candidate
evidence_only
quarantine
not_catalog
```

## Public display rules

When records are publicly visible before complete review, show status instead of hiding them.

Recommended labels:

- `资料来源：AniList / Bangumi / MangaDex / Steam / VNDB / ...`
- `资料状态：来源记录 / 已连接作品 / 疑似重复 / 缺少标题 / 需要复核`
- `身份状态：单来源 / 多来源已连接 / 可能重复 / 身份冲突 / 身份未知`
- `排雷状态：未评估 / 信息不足 / AI 综合，待复核 / 人工复核 / 有争议 / 连载追踪中`

Do not show AI text as final judgement.

## Current audit implications

The current full catalog ingestion audit found:

- 50,467 planned rows.
- 29,644 `create_new_work` rows.
- 17,309 `evidence_only` rows.
- 2,387 exact-title links.
- 1,080 `create_new_work_needs_review` rows.
- 43 quarantine rows.
- 4 possible duplicate title rows.
- 1,915 volume-like `create_new_work` rows.
- 40 series-like clusters.

Implication:

```text
Do not apply create_new_work in bulk yet.
First update the planner to separate top-level Work candidates from volume / edition / child-entity candidates.
```

## Next implementation steps

1. Add a planner v0.2 or patch v0.1 to classify volume-like rows separately.
2. Add parent-title inference for obvious volume/series clusters.
3. Add a read-only audit for parent-candidate grouping.
4. Review known duplicate titles such as `雨眠` and `少女` before write paths.
5. Only after these audits, design a single-row apply validation path.

## Safety boundary

This policy is documentation only.

It does not authorize:

- Payload writes.
- PostgreSQL writes.
- Deleting local or remote data.
- Bulk importing Works.
- Treating AI synthesis as final public judgement.

All future write paths must still follow:

```text
dry-run → audit → single-row validation → small batch → full apply
```
