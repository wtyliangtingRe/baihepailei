# Comments roadmap

The current frontend includes a placeholder comment block on detail pages.

This is intentionally not a full write system yet.

## Current behavior

- Detail pages render a simple comment area.
- The textarea and button are disabled.
- The text explains that registered-user comments can be enabled later.

## Future implementation

A full comment system should be implemented in a separate PR:

- Add a Payload `comments` collection.
- Link comments to works, creators, organizations, evidence, terms, or rules.
- Require a signed-in user to create comments.
- Add moderation status such as pending, visible, hidden, archived.
- Render approved comments on frontend detail pages.
- Add basic anti-spam and rate-limit behavior.

Keeping this separate avoids mixing frontend layout cleanup with write-enabled user content.
