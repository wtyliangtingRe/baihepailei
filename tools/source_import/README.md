# Source import workspace

This directory is for the future external candidate import pipeline.

The first goal is not to rate works. The first goal is to build a repeatable path from external metadata sources into local candidate records that can later be imported into Payload as drafts.

## Local-only data layout

Real fetched data must stay under `data_local/`, which is ignored by Git.

```text
data_local/
  raw/
    bangumi/
    anilist/
    vndb/
    wikidata/
    wikipedia/
  normalized/
  deduped/
  import_ready/
  reports/
```

Suggested meanings:

- `raw/`: cached source responses or manual exports, unchanged except for wrapping with fetch metadata.
- `normalized/`: source-specific records converted into Baihepailei candidate shapes.
- `deduped/`: merged candidate records and conflict lists.
- `import_ready/`: Payload seed files or JSONL files ready for local import.
- `reports/`: human-readable summaries such as dedupe conflicts and import counts.

## Repository-safe files

The repository may contain:

- source registry examples
- source adapter code
- normalization code
- fixture/sample data that is clearly synthetic or tiny and safe
- documentation

The repository must not contain:

- real raw source dumps
- user comment exports
- private notes
- large scraped data
- generated Payload import files containing real migrated content

## Planned stages

```text
Raw Source
  -> Normalized Candidate
  -> Dedupe / Conflict Report
  -> Payload Draft Seed
  -> Human Review
```

## First source adapter target

Bangumi should be the first small adapter because it is useful for Chinese titles, aliases, tags, and community context.

The first adapter should only fetch or process small samples and should not import comments or ratings into public fields.

## Candidate records are not ratings

Candidate data is only used to answer whether a work may be worth reviewing for Baihepailei. It must not be treated as final rank, review status, or evidence strength.
