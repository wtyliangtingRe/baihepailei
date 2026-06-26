# My lists page

Route: `/me/lists`

This page is the first personal list dashboard.

## Current behavior

- Reads the signed-in user's records from `/api/user-lists`.
- Groups works by list status.
- Links each entry back to its work detail page.
- Shows a login-required message when the user is not signed in.

## Groups

- `want`: want to watch / read
- `seen`: already seen
- `avoid`: avoid
- `needs_review`: needs review

## Future improvements

- Edit status directly on this page.
- Delete list records.
- Filter and search within the list.
- Export personal lists.
- Add an opt-in public sharing mode.
