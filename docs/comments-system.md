# Comments system

This is the first internal comments implementation for the frontend detail pages.

## Current behavior

- Signed-in users can submit comments from detail pages.
- New comments are always created as `pending`.
- Editors and reviewers can approve, reject, hide, update, or delete comments in Payload admin.
- Public visitors only read `approved` comments.
- The frontend comment block fetches approved comments from `/api/comments` after page load.

## Comment target fields

Each comment stores a lightweight target reference:

- `targetCollection`
- `targetSlug`
- `targetTitle`

This keeps comments usable with the Lite frontend detail index while avoiding hard dependencies on collection-specific relationship fields.

## Moderation states

- `pending`: submitted and waiting for review
- `approved`: visible on frontend
- `rejected`: rejected during review
- `hidden`: previously visible but hidden later

## Future improvements

- Add per-user comment management pages.
- Add reporting / flagging.
- Add rate limiting.
- Add richer moderation filters.
- Add notifications for approved or rejected comments.
- Add migration helper if comments are later attached to real relationship fields.
