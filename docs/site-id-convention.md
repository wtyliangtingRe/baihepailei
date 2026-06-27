# Site ID convention

Baihepailei uses `siteId` as a stable internal business identifier for core content records.

`siteId` is separate from:

- Payload database `id`, which may change across databases or migrations.
- `slug`, which is optimized for URLs and can change for readability.
- External IDs from sources such as Bangumi, AniList, VNDB, Wikidata, or MAL.

## Scope

The first batch of `siteId` fields covers core content collections:

- `works`
- `creators`
- `organizations`
- `evidence`
- `terms`
- `warnings`
- `tags`
- `rules`

Runtime/user-generated collections such as comments, user lists, users, and media do not need this pattern yet.

## Suggested prefixes

```text
work-000001
creator-000001
org-000001
evidence-000001
term-000001
warning-000001
tag-000001
rule-000001
```

These IDs should be assigned by import scripts or manual curation when a record becomes part of the maintained content base.

## Import notes

External candidate imports should match records in this order when possible:

1. `siteId`
2. trusted external IDs
3. normalized title/name plus type-specific context
4. slug

Do not treat candidate source IDs as replacements for `siteId`. External IDs identify records on other services; `siteId` identifies the Baihepailei record itself.
