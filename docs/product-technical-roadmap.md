# Product and technical roadmap

This document records the current product direction for Baihepailei after the first Payload CMS bootstrap and clean old-content import work.

The core principle is:

```text
one editable content source
-> multiple publishing targets
```

We should not maintain separate Lite and Full content copies by hand. Payload CMS remains the canonical editing backend. Published outputs are generated from that same source.

## Goals

Baihepailei should support three main user needs:

1. Search a work or creator before deciding whether to watch/read/play it.
2. Browse works by rank or category.
3. Preserve a full evidence/archive edition without making the main site expensive to host.

## Publishing editions

### Lite edition

The Lite edition is the low-cost public site, intended for the main domain.

It should prioritize:

- text content;
- fast search;
- rank/category browsing;
- minimal image usage;
- low hosting and bandwidth cost;
- good mobile access.

The Lite edition includes:

- site home and core static pages;
- works;
- creators;
- terms;
- rules;
- text summaries and analysis;
- small UI assets;
- generated search index.

The Lite edition excludes by default:

- evidence screenshots;
- large image galleries;
- full legacy attachment archive;
- raw old backup files;
- private migration data.

### Full edition

The Full edition is the archival and complete edition.

It may include:

- all Lite text content;
- all reviewed media;
- legacy images and attachments;
- evidence screenshots;
- source notes;
- complete search index;
- local deployment scripts;
- static offline site export.

The Full edition can be distributed through one or more of:

- Hugging Face Dataset repository;
- GitHub Releases if the package stays small enough;
- Google Drive or similar cloud storage;
- Chinese cloud drives such as Aliyun Drive or Baidu Netdisk;
- QQ group file sharing.

The Full edition should not depend on the main AWS host for large assets.

## Canonical data model

Payload CMS remains the source of truth.

Primary collections:

- `works`
- `creators`
- `terms`
- `rules`
- `warnings`
- `tags`
- `media`
- `users`

Future collection candidates:

- `evidence`
- `sources`
- `releases`
- `exportJobs`

## Visibility model

Collections should eventually support output visibility fields.

Recommended fields for `works`:

```text
isLiteVisible: boolean
isFullVisible: boolean
hasEvidence: boolean
searchText: text
```

Recommended fields for `media`:

```text
mediaScope:
  site-ui
  cover
  evidence
  legacy
  full-only

legacyXWikiPage
originalFilename
sourceNote
```

Recommended fields for future `evidence`:

```text
title
relatedWork
image
description
source
capturedAt
visibility: lite | full-only | private
note
```

## Search strategy

Search is a core product feature, not a secondary convenience.

Expected search inputs:

- Chinese title;
- Japanese title;
- English title;
- aliases;
- creator name;
- rank;
- old XWiki page name;
- warning keywords;
- term keywords.

### Phase 1: local generated search index

Use a generated JSON index for Lite and offline Full editions.

Example output:

```text
public/search-index.json
```

Each search document should include:

```text
id
collection
slug
title
aliases
originalTitle
rank
creators
terms
warnings
summaryText
searchText
url
```

A client-side search library such as Fuse.js or MiniSearch can support fuzzy search without running a separate search server.

This is the preferred first implementation because it works for:

- the AWS Lite site;
- static exports;
- offline packages;
- local full packages.

### Phase 2: Payload / PostgreSQL search

Payload and PostgreSQL can handle simple backend search and admin filtering.

This is useful for:

- admin list filtering;
- small public API search;
- exact and partial matching;
- controlled server-side filtering.

### Phase 3: dedicated search service

If the dataset grows, consider a dedicated search service.

Candidates:

- Meilisearch;
- Typesense.

This should wait until the simple generated index is no longer enough.

## Export strategy

### Lite export

The Lite export should produce:

```text
lite-export/
├─ pages or static app output
├─ search-index.json
├─ works.json
├─ creators.json
├─ terms.json
└─ rules.json
```

The Lite export should exclude full-only media.

### Full static export

The Full static export should produce:

```text
baihepailei-full-static/
├─ index.html
├─ assets/
│  ├─ images/
│  └─ evidence/
├─ data/
│  ├─ works.json
│  ├─ creators.json
│  ├─ terms.json
│  ├─ rules.json
│  └─ search-index.json
└─ README.html
```

This package should be usable without Node.js, Docker, or PostgreSQL.

### Full local deployment package

The Full local package is for advanced users and long-term preservation.

It may contain:

```text
baihepailei-full-local/
├─ app/
├─ docker-compose.yml
├─ media/
├─ seed/
├─ scripts/
│  ├─ start-windows.ps1
│  └─ import-seed.ps1
└─ README.md
```

This version can require Docker Desktop.

A true one-click desktop app can be considered later with Electron or Tauri, but it should not block the web project.

## Media and evidence policy

The main public site should not carry large media by default.

Media should be classified by purpose:

| Scope | Lite site | Full edition | Notes |
|---|---:|---:|---|
| `site-ui` | yes | yes | logo, icons, layout images |
| `cover` | optional | yes | small covers may be allowed in Lite later |
| `evidence` | no by default | yes | screenshots, proof images |
| `legacy` | no | yes | old XWiki attachments |
| `full-only` | no | yes | large archive material |

Evidence should be structured instead of scattered inside free-form text whenever possible.

## Cost strategy

Recommended hosting layers:

| Layer | Content | Suggested host |
|---|---|---|
| Lite public site | text, search, small assets | AWS / main domain |
| Full static archive | full text, media, evidence | Hugging Face Dataset / Drive / cloud drive |
| Full local package | app, seed, media, local scripts | downloadable zip/release |
| Raw backup | SQL, tar, certificates, old volumes | private local storage only |

Raw backups should never be committed to GitHub or distributed publicly.

## Near-term PR plan

### PR 6: roadmap document

This document.

### PR 7: search and visibility fields

Add fields needed by the Lite/Full split and search pipeline:

- `isLiteVisible`
- `isFullVisible`
- `searchText`
- `hasEvidence`
- `mediaScope`
- media legacy metadata

### PR 8: Lite search index exporter

Add a script that exports searchable JSON from Payload data.

Target output:

```text
public/search-index.json
```

### PR 9: frontend search page

Add `/search` with fuzzy search over works, creators, terms, and rules.

Minimum requirements:

- search by title;
- search by alias;
- search by creator;
- search by rank;
- search by raw text keyword;
- show result type and rank;
- link to detail page.

### PR 10: frontend detail pages

Add public pages for:

- work list and work detail;
- creator list and creator detail;
- term list and term detail;
- rule pages.

### PR 11: media recovery plan

Recover selected legacy attachments from `xwiki-data.tar.gz` and classify them as Full-only by default.

Initial target attachments:

- `死亡.jpg`
- `死亡2.jpg`
- `01.jpg`
- `裤裆悲剧.jpg`

### PR 12: Full static package exporter

Generate the first local static archive package.

## Open decisions

- Whether Lite should include small cover images later.
- Whether Full static package should be generated by Next static export or a custom HTML builder.
- Whether evidence records need a dedicated `evidence` collection before the first Full archive.
- Whether Hugging Face should host only release zips or also unpacked browsable data.
- How much of old XWiki syntax should be converted versus preserved as raw text.

## Current recommendation

Prioritize in this order:

1. Keep Payload as the canonical backend.
2. Add search/visibility fields.
3. Build the Lite search index.
4. Build the public search UI.
5. Add detail pages.
6. Restore media as Full-only.
7. Build Full static archive packages.

This keeps the project useful quickly while preserving the path to a complete archival edition.
