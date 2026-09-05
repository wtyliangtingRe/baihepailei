# Public catalog equivalence release v01

This append-only release links public-catalog records that represent the same work under different provider IDs or translated titles. It does not rewrite historical Work IDs. Every old member Work ID remains a valid lookup and redirects to the merged public record.

## Result

- Source catalog: 35,411 records.
- Existing strict merge baseline: 35,344 visible works (67 rows merged in 67 groups).
- Explicit equivalence release: 427 groups / 427 evidence-backed edges / 854 linked Work IDs.
- New public result: 34,940 visible works (471 rows merged in 471 groups; largest group 2).
- Search-title evidence: 5,619 records with 19,307 title values.
- Deliberately excluded: 31 candidate/evidence rows.

## Decision rules

1. Prefer explicit provider-ID crosswalks. Require one-to-one cardinality inside the current catalog.
2. Reject same-provider/different-ID collisions and ambiguous one-to-many mappings.
3. For inferred anime links, require a strict title/alias match, the same release year, exact TV/OVA/ONA/movie format agreement, and one-to-one cardinality.
4. For inferred Bangumi/VNDB links, require an official title/alias match, the same release year, Bangumi subject type 4 (game), and one-to-one cardinality.
5. External aliases enrich search and display only. They never become automatic merge keys.
6. Preserve punctuation during identity normalization, so seasons and sequel markers such as `!!`, `♪♪`, `+`, and `Re:` remain distinct.

## Corrected stale mappings

- Bangumi 2170 is the 2007 TV series `Sky Girls` (AniList 2604), not the 2006 OVA (AniList 1480). Bangumi 2171 maps to the OVA.
- Bangumi 504950 is the six-part WEB short series `Lycoris Recoil: Friends are thieves of time.` (AniList 179706), not the separate AniList 161410 placeholder/special entry.

## Provenance and licensing

- Bangumi API: official subject titles, localized names, aliases, dates, and platforms.
- bangumi-data revision [779b5e878d145363f3c77bfe9b1ba5b778c70473](https://github.com/bangumi-data/bangumi-data/tree/779b5e878d145363f3c77bfe9b1ba5b778c70473), CC BY 4.0.
- anime-offline-database release [2026-27](https://github.com/manami-project/anime-offline-database/releases/tag/2026-27), ODbL 1.0; used for AniList title/date/format cross-checks.
- Wikidata cross-provider identifiers, CC0 1.0, queried on 2026-09-05.
- VNDB API: official VN title and release metadata.

See `catalog-equivalence-exclusions.jsonl` for every retained ambiguity, media conflict, stale mapping, or unavailable source record.
