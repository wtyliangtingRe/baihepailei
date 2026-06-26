# Personalized recommendations

This is the first bridge between personal work lists and rule-based recommendations.

## Current behavior

The `/recommendations` page still renders normal rule-based groups first.

A client-side panel also reads the signed-in user's records from `/api/user-lists`.

When the user is signed in:

- works marked `avoid` are removed from the personal candidate list
- works marked `seen` are removed from the personal candidate list
- works marked `want` or `needs_review` keep their status label
- list counts are shown in the panel

When the user is not signed in, the panel shows a login hint and the normal recommendation groups remain available.

## Limits

This is not a full recommendation algorithm.

It does not yet support:

- custom weights
- public profile preferences
- collaborative filtering
- browser history
- per-user hidden tags
- batch list management
