/**
 * @param {import('./publicRelease').CatalogEquivalenceGroup[]} groups
 * @param {{workId: string, identity: {state: string, provider: string, siteId: string}}[]} records
 * @returns {Map<string, string>}
 */
function reviewedProviderAliases(groups, records) {
  const aliases = new Map()
  const reviewed = groups.filter(group => group.providerDuplicate)
  if (!reviewed.length) return aliases
  const identities = new Map(records.map(record => [record.workId, record.identity]))
  for (const group of reviewed) {
    const { provider, siteIds } = group.providerDuplicate
    const primary = siteIds[group.workIds[0]]
    if (!primary || group.workIds.length < 2 || Object.keys(siteIds).length !== group.workIds.length ||
        new Set(Object.values(siteIds)).size !== group.workIds.length) {
      throw new Error(`Invalid duplicate membership: ${group.groupId}`)
    }
    for (const id of group.workIds) {
      const identity = identities.get(id)
      if (identity?.state !== 'exact' || identity.provider !== provider || identity.siteId !== siteIds[id] ||
          aliases.has(id)) throw new Error(`Unbound duplicate provider ID: ${group.groupId}/${id}`)
      aliases.set(id, primary)
    }
  }
  return aliases
}

exports.reviewedProviderAliases = reviewedProviderAliases
