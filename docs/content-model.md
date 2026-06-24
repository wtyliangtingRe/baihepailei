# Content model draft

This document describes the first structured content model for the new Baihepailei site.

## Collections

### Works

The central content type. A work can represent an anime, manga, game, novel, or other reviewed title.

Important fields:

- `title`
- `slug`
- `rank`: S, AA, A, B, C, D, E, F, trash, unknown
- `originalTitle`
- `aliases`
- `creators`
- `tags`
- `warnings`
- `cover`
- `summary`
- `analysis`
- `sourceLinks`
- `legacyXWikiPage`
- `status`: draft, review, published, archived

### Creators

People, studios, circles, writers, artists, companies, or other creator-like entities.

Important fields:

- `name`
- `slug`
- `rank`
- `aliases`
- `profileImage`
- `notes`
- `legacyXWikiPage`
- `status`

### Terms

Glossary entries migrated from the old XWiki term pages.

Important fields:

- `name`
- `slug`
- `definition`
- `examples`
- `relatedWarnings`
- `relatedTerms`
- `legacyXWikiPage`
- `status`

### Warnings

Reusable warning / review-note definitions that can be attached to works and referenced by rules or terms.

Important fields:

- `name`
- `slug`
- `severity`: low, medium, high, critical
- `category`: content, relationship, creator, operation, other
- `description`
- `relatedTerms`

### Tags

Reusable classification labels for works.

Important fields:

- `name`
- `slug`
- `category`: general, genre, medium, relationship, style, status
- `description`

### Rules

Editorial rules, ranking explanations, migration notes, and site principles.

Important fields:

- `title`
- `slug`
- `category`: principle, ranking, editorial, migration
- `body`
- `relatedWarnings`
- `relatedTags`
- `legacyXWikiPage`
- `status`

## Local test steps

After pulling this branch:

```powershell
cd "D:\0GitHubtest\Baihepailei\_repo"
git checkout content-model-works-warnings-tags
git pull

docker compose up -d postgres
pnpm install
pnpm generate:importmap
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
pnpm dev
```

Then open:

```text
http://localhost:3000/admin
```

The dashboard should show Works, Creators, Terms, Warnings, Tags, Rules, Media, and Users.
