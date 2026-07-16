# Comments system

- Verified registered users can submit plain-text comments from detail pages.
- New comments are always forced to `pending` and stamped with the authenticated user.
- Editors and above can approve, reject, hide or delete comments.
- Public visitors only read `approved` comments.
- Comment bodies are limited to 1,200 characters.
- Login-required messages link to the public account flow rather than Payload Admin.

Human Radar evidence should be submitted through `/feedback`; ordinary comments do not alter ratings.
