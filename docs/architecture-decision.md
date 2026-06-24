# Architecture Decision: Rebuild with Payload + Next.js + PostgreSQL

## Decision

The new Baihepailei site will not continue using XWiki as the primary runtime.

We will rebuild the site as a structured content application using:

- Payload CMS
- Next.js
- PostgreSQL
- Docker Compose for local database/runtime helpers

## Why not XWiki

XWiki is powerful for page-oriented knowledge bases, but the new site is not just a wiki. It needs structured records, reviewable editing, relationships, filtering, and a clearer content model.

The old XWiki backup remains valuable as a raw archive, but the new system should not inherit the old XWiki user model, system pages, or password data.

## Product shape

The site should be treated as a structured yuri review / warning / reference database:

- Works
- Creators
- Terms
- Warning points
- Tags
- Rules / principles
- Media
- Trusted editor submissions

## User migration policy

Do not migrate old XWiki users or passwords.

The old user pages can be deleted from the new system, except `XWiki.MadokArumoH`, which should remain as a local raw-data review item until identified.

New backend users should be created from scratch in Payload.

## Data migration policy

The old backup should live locally under:

```text
old_data/
```

This directory is private and must not be committed.

The migration flow should be:

```text
old XWiki backup
↓
raw audit/export
↓
clean intermediate JSON/CSV/Markdown
↓
Payload seed/import scripts
↓
reviewed published content
```

## First implementation milestone

The first site milestone should only include:

- local development setup docs;
- Docker Compose PostgreSQL;
- Payload + Next.js scaffold;
- minimal collections: Users, Works, Creators, Terms, Warnings, Tags, Media;
- import staging folder for cleaned old data.
