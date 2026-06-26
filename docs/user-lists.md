# User work lists

This is the first version of personal work lists.

## Current behavior

Signed-in users can mark a work as one of four statuses:

- `want`: 想看
- `seen`: 已看
- `avoid`: 避雷
- `needs_review`: 需要复核

The frontend control appears inside the work conclusion card on work detail pages.

## Data model

Collection: `user-lists`

Fields:

- `user`: owner account
- `workSlug`: work slug from the Lite detail index
- `workTitle`: work title for display and admin review
- `listStatus`: personal list status
- `note`: private note
- `uniqueKey`: generated from user id and work slug to avoid duplicates

## Access rules

- Signed-in users can create list records.
- Users can read, update, and delete their own records.
- Editors, reviewers, and admins can manage all records.
- Public visitors cannot read user lists.

## Frontend flow

- Load current user's list record from `/api/user-lists`.
- Create a new record when no record exists.
- Patch the existing record when it already exists.
- Show a login-required message when the user is not signed in.

## Future improvements

- Add a dedicated `/me/lists` page.
- Add filters by list status.
- Add bulk export.
- Use the list states for simple recommendation rules.
- Add public sharing only if the user explicitly opts in.
