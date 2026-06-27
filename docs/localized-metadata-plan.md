# Localized metadata plan

Baihepailei should remain a Chinese-first site for now, while storing multilingual and regional names as structured metadata.

This avoids the cost of a full multilingual site while still supporting:

- original titles and names
- simplified and traditional Chinese titles
- English titles
- Japanese, Korean, and other source-language names
- romanized names
- regional release names
- search-only aliases
- cross-source dedupe and matching

## Not a full multilingual site yet

This plan does not introduce per-locale routes such as `/en/works/...` or translated review content.

The frontend can still be Chinese-first, while detail pages expose useful basic title/name metadata.

## Work media grouping

`mediaType` remains the detailed type, such as:

- `anime`
- `manga`
- `light_novel`
- `visual_novel`
- `game`
- `audio_drama`

`mediaGroup` is the broad frontend grouping:

| mediaType | mediaGroup |
| --- | --- |
| `anime` | `anime` |
| `manga`, `webtoon` | `manga` |
| `novel`, `light_novel`, `web_serial` | `novel` |
| `game`, `visual_novel` | `game` |
| `audio_drama`, `live_action`, `doujin`, `anthology`, `other` | `other` |
| `unknown` | `unknown` |

The helper lives at:

```text
tools/source_import/lib/media-groups.mjs
```

Later source imports and frontend exports should use this helper to keep grouping consistent.

## Work localized titles

Works use `localizedTitles` for structured title metadata.

Example:

```json
{
  "localizedTitles": [
    {
      "title": "やがて君になる",
      "language": "ja",
      "region": "JP",
      "kind": "original",
      "isPrimary": true,
      "source": "manual"
    },
    {
      "title": "终将成为你",
      "language": "zh-Hans",
      "region": "CN",
      "kind": "official",
      "isPrimary": true,
      "source": "Bangumi"
    },
    {
      "title": "終將成為妳",
      "language": "zh-Hant",
      "region": "TW",
      "kind": "localized",
      "isPrimary": false,
      "source": "manual"
    },
    {
      "title": "Bloom Into You",
      "language": "en",
      "region": "US",
      "kind": "official",
      "isPrimary": false,
      "source": "Wikidata"
    }
  ]
}
```

`localizedTitles` should not replace the current `title`, `originalTitle`, or `aliases` fields immediately. It gives us a structured home for multilingual names while preserving old compatibility.

## Creator and organization localized names

Creators and organizations use `localizedNames`.

This field is optional and sparse. Not every creator or organization needs every language.

Example:

```json
{
  "localizedNames": [
    {
      "name": "仲谷鳰",
      "language": "ja",
      "region": "JP",
      "kind": "original",
      "isPrimary": true
    },
    {
      "name": "Nakatani Nio",
      "language": "en",
      "kind": "romanized",
      "isPrimary": false
    }
  ]
}
```

## Search direction

A later PR should add these fields to generated search text:

- `works.localizedTitles[].title`
- `creators.localizedNames[].name`
- `organizations.localizedNames[].name`
- existing aliases and external IDs

This keeps search useful without requiring full i18n routing.

## PR sequence

1. PR #60: metadata fields and media group helper.
2. PR #61: import/export/search text support for localized metadata and `mediaGroup`.
3. PR #62: frontend display and filters for work media groups and basic localized titles.
4. PR #63+: source adapters populate localized titles/names from Bangumi, AniList, VNDB, Wikidata.
