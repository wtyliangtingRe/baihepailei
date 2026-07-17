# Comments system

- Registered users can submit plain-text comments from detail pages.
- New comments are stamped with the authenticated user and published immediately; there is no pre-publication approval queue.
- Users can reply to a root comment or another reply. Replies are normalized into one visible nesting level and keep the addressed user's display name, which keeps long mobile discussions readable.
- Comment authors can delete their own comments.
- Editors, administrators and the owner can delete any comment. The legacy moderation field remains only for database compatibility; old `pending` comments are treated as public, while old rejected or hidden rows stay private.
- Comment bodies are limited to 1,200 characters.
- Login-required messages link to the public account flow rather than Payload Admin.

Human Radar evidence should be submitted through `/feedback`; ordinary comments do not alter ratings. Account suspension immediately revokes the user's sessions and blocks further commenting.
