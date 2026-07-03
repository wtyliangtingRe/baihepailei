export const SOURCE_PRIORITY_POLICY_ID = 'source-priority-policy-v0.1' as const

export const sourcePriorityOrder = [
  'yurizukan',
  'bangumi',
  'mangadex',
  'ndl',
  'steam',
  'wikidata',
  'anilist',
] as const

export type SourcePriorityName = typeof sourcePriorityOrder[number]

export const sourcePriorityRank: Record<SourcePriorityName, number> = Object.fromEntries(
  sourcePriorityOrder.map((source, index) => [source, index + 1]),
) as Record<SourcePriorityName, number>

export const sourcePriorityPolicy = {
  policyId: SOURCE_PRIORITY_POLICY_ID,
  order: sourcePriorityOrder,
  conflictRule: 'Earlier source wins. Later conflicting source is preserved as review evidence, not used to overwrite.',
  notes: [
    'Yurizukan has highest priority for this project because it is closest to the site purpose.',
    'Bangumi, MangaDex, NDL, and Steam are used as structured source layers in that order.',
    'Wikidata is identity / external ID evidence only, not radar evidence.',
    'AniList is a broad candidate pool and should not override earlier sources.',
    'When source conflict is detected, preserve both sides and route to review queue.',
  ],
} as const

export function compareSourcePriority(a: string, b: string) {
  const ar = sourcePriorityRank[a as SourcePriorityName] ?? 999
  const br = sourcePriorityRank[b as SourcePriorityName] ?? 999
  return ar - br
}
