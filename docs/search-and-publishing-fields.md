# Search and publishing fields

This document explains the fields added for the Lite/Full publishing split and future search index generation.

## Publishing visibility

The core content collections now use two visibility flags:

```text
isLiteVisible
isFullVisible
```

Collections using these fields:

- `works`
- `creators`
- `terms`
- `rules`

### isLiteVisible

Controls whether the document should be included in the low-cost public Lite edition.

Default:

```text
true
```

Use cases:

- hide private migration-only pages from the public site;
- hide unfinished or noisy items from the Lite edition;
- keep an item in Payload for later review without publishing it to Lite.

### isFullVisible

Controls whether the document should be included in the Full archive/offline edition.

Default:

```text
true
```

Use cases:

- exclude private or unwanted items from the Full archive;
- keep an internal draft in Payload without exporting it;
- support a future curated Full release.

## Search text

The core content collections now use:

```text
searchText
```

Collections using this field:

- `works`
- `creators`
- `terms`
- `rules`

This field is a manual supplement for the future generated search index.

It should contain useful search-only keywords that may not naturally appear in the title or rich text body.

Examples:

```text
作品日文名
作品英文名
常见简称
旧译名
作者别名
社团名
旧 XWiki 页面关键词
容易输错的名字
```

The future search index generator should combine:

```text
title / name
originalTitle
aliases
rank
creator names
rich text plain text
searchText
legacyXWikiPage
```

## Work evidence flags

The `works` collection now includes:

```text
hasEvidence
evidenceNote
```

### hasEvidence

Marks whether the work has evidence materials such as screenshots, archived images, or source notes.

Default:

```text
false
```

The Lite edition should not display large evidence images by default, but it may show a small text hint such as:

```text
This work has evidence records in the Full edition.
```

### evidenceNote

A temporary text field for evidence notes.

Later, this can be migrated into a dedicated `evidence` collection.

## Media scope

The `media` collection now includes:

```text
mediaScope
```

Options:

| Value | Meaning | Lite | Full |
|---|---|---:|---:|
| `site-ui` | Site UI / logo / layout asset | yes | yes |
| `cover` | Work or creator cover image | optional | yes |
| `evidence` | Evidence screenshot or proof image | no by default | yes |
| `legacy` | Old XWiki attachment | no by default | yes |
| `full-only` | Any large full-edition-only asset | no | yes |

Default:

```text
legacy
```

This conservative default prevents accidentally pushing old attachments into the Lite public site.

## Media migration metadata

The `media` collection also includes:

```text
legacyXWikiPage
originalFilename
sourceNote
```

These fields are for attachment recovery and future Full archive generation.

## Recommended next steps

1. Update the direct importer to populate `isLiteVisible`, `isFullVisible`, and `searchText` where possible.
2. Add a Lite search index exporter.
3. Build `/search` using the generated index.
4. Add frontend detail pages that respect `isLiteVisible`.
5. Restore selected legacy images as `mediaScope = legacy` or `mediaScope = evidence`.
