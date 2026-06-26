# Simple recommendation rules

This is the first rule-based recommendation page.

## Current inputs

The page reads works from `public/detail-index.json` and scores each work using:

- rank
- review status
- evidence strength
- retained material flag
- work risk matrix

## Buckets

- `priority`: high score, shown as priority candidates
- `cautious`: medium score, worth trying after reading notes
- `not-recommended`: low score, default hidden from recommendation-first flows

## Important limits

This is not a final judgment system.

It does not yet use:

- personal work lists
- user preferences
- custom weights
- collaborative filtering
- browsing history

Those can be added later after the basic content data is stable.
