# Content visibility and merge rules

## Date merge rule

When two sources disagree on an exact date but the normalized year is the same, treat the date as merge-compatible.

- Compare dates by extracted four-digit year for automatic merge gating.
- If the year is the same, do not block the merge only because month/day differs.
- Keep the existing `firstPublishedAt`, `firstPublishedPrecision`, and `firstPublishedLabel` unchanged unless a later manual review explicitly chooses to update them.
- If the years differ, keep the row in manual review.

This rule is intended for source integration audits such as MangaDex / NDL / Wikidata / AniList where external sources often disagree on serialization date, volume date, release date, or database precision.

## Content visibility rule

Adult or otherwise not-suitable-for-normal-browsing works are still valid Works records. They should be collected like ordinary works, but must carry visibility markers and be hidden from normal browsing by default.

Frontend modes:

- `ordinary`: default. Only ordinary works appear in lists and search results.
- `all`: opt-in. All works appear, including adult/restricted/otherwise marked works.

The top-left content-scope toggle controls this frontend mode.

## Current visibility values

- `ordinary`: normal public browsing.
- `adult`: adult/suggestive/erotica/pornographic or adult-like source marking.
- `restricted`: reserved for future not-suitable-for-normal-browsing cases that are broader than adult content.

## Advisory markers

Search index export may derive advisory markers from tags, warnings, source notes, and supplemental search text:

- `suggestive`
- `erotica`
- `pornographic`
- `doujinshi_or_extra`
- `restricted`

These markers are display/filter metadata. They do not by themselves change Work title, creator, date, publisher, or relationship fields.

## Import policy

For automatic imports:

- Adult/restricted-marked rows must not be merged into ordinary display without the visibility marker.
- Adult/restricted-marked rows may be collected, linked, and reviewed as Works records when source identity is sufficiently clear.
- Automatic enrichment may write safe metadata only when the row passes the relevant guarded dry-run.
- Source metadata and creator/publisher/date changes remain separate review steps.

For complex authors:

- Pure romanization/native-script equivalence may support low-risk `searchText` enrichment.
- Multiple unproven creator groups, source roles such as original author plus artist, circles, anthology authors, or doujinshi-like creator sets remain manual review.
