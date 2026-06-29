# Bangumi next media import plan

## Scope

This note records the next safe import direction after the first anime work/entity relationship apply.

## Completed before this step

- Anime work/entity link preview, audit, patch plan, dry-run, dry-run audit, and guarded apply are complete locally.
- The guarded apply path only patched `works.creators`, `works.creatorCredits`, and `works.organizations`.

## Cover cache first

The immediate next task is to cache Bangumi cover images locally while network traffic is available.

Safety boundary:

- Download to `data_local/media/bangumi-covers` only.
- Do not upload to Payload media.
- Do not patch works.
- Do not decide yet whether cached images should be used as official covers.

## Book handling

Bangumi book subjects can be handled together at the source import layer.

For the first pass, do not force separate manga / novel / light novel pipelines. Instead:

- Fetch and normalize book subjects together.
- Preserve the original Bangumi type and source metadata.
- Infer `mediaType` / `format` later from tags, infobox hints, title hints, and manual review.
- Keep the relationship extraction intentionally narrow.

Recommended first-pass book relationships:

- creators: author / original creator / story / art / illustrator when available.
- organizations: publisher / imprint / magazine when available.

This keeps the first book import smaller than the anime staff import and avoids overfitting noisy credit lines.

## Game handling

Game subjects can reuse more of the anime-style relationship pipeline, because game credits may include developers, publishers, platforms, brands, circles, scenario writers, character designers, and music labels.

Recommended first-pass game relationships:

- creators: scenario, writer, original creator, character design, illustrator, producer/director when available.
- organizations: developer, publisher, brand, platform, circle, distributor when available.

## Suggested PR sequence

1. Cover manifest/cache only.
2. Cover cache audit/report.
3. Book subject fetch/normalize preview.
4. Book entity seed preview/audit/import.
5. Book work/entity link preview/audit/plan/dry-run/apply.
6. Game subject fetch/normalize preview.
7. Game entity seed preview/audit/import.
8. Game work/entity link preview/audit/plan/dry-run/apply.

Each PR should stay local-only or guarded by explicit apply confirmation until the corresponding audit passes.
