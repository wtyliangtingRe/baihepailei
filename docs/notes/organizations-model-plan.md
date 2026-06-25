# Organizations model plan

Organizations represent publishers, studios, production companies, circles, brands, platforms, committees, and other non-person creators related to works.

This model is intentionally separate from creators:

- Creators: people, author names, artist names, writer names, circles used as creator identity when appropriate.
- Organizations: publishers, production studios, game companies, distributors, platforms, brands, production committees, and similar entities.

Initial collection fields:

- name
- slug
- type
- aliases
- notes
- sourceLinks
- searchText
- isLiteVisible
- isFullVisible
- legacyXWikiPage
- status

Later PRs will connect works to organizations with a role field, for example:

- publisher
- studio
- developer
- distributor
- circle
- brand
- platform
- committee
- other
