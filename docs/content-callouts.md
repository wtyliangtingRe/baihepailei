# Content callouts

Content callouts are optional frontend blocks for detail pages.

They are designed for old XWiki-style decorative or explanatory templates, such as black banner templates, notes, warnings, and image-text blocks.

A detail-index item may include:

```json
{
  "callouts": [
    {
      "id": "legacy-template-example",
      "style": "black-banner",
      "title": "模板标题",
      "quote": "引用文字",
      "text": "说明文字",
      "image": {
        "url": "/media/example.png",
        "alt": "图片说明"
      },
      "sourceLabel": "旧 Wiki 页面",
      "sourceUrl": "https://example.invalid"
    }
  ]
}
```

Supported styles:

- `black-banner`: old Wiki black banner style
- `note`: normal note
- `warning`: warning callout
- `image-text`: image and text callout

## XWiki image-text example

Old XWiki blocks like this are intended to become `image-text` callouts:

```text
{{example}}
(% style="display: table; width: 100%;" %)
(((
(% style="display:table-cell; padding-right:20px; vertical-align:middle" %)
[[image:01.jpg||height="111" width="83"]]
(% style="display:table-cell; font-size:18px; vertical-align:middle" %)
文字说明
)))
```

Suggested detail-index shape:

```json
{
  "callouts": [
    {
      "id": "legacy-example-01",
      "style": "image-text",
      "title": "示例",
      "text": "文字说明",
      "image": {
        "url": "/media/01.jpg",
        "alt": "示例图片"
      }
    }
  ]
}
```

Real migrated content should be added through export/import logic later. This document only defines the frontend data shape.
