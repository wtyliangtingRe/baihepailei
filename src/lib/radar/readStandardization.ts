export type RadarAuthority =
  | 'human'
  | 'published'
  | 'candidate'
  | 'research'
  | 'legacy'
  | 'unassessed'

export type RadarConclusionMode =
  | 'fixed_grade'
  | 'bounded_range'
  | 'labels_only'
  | 'blocked'
  | 'legacy'

export type RadarExactIdentity = {
  workId: string | number
  siteId: string
}

export type RadarIdentitySnapshot = {
  workIdSnapshot?: string | number | null
  workSiteId?: string | null
  identityKey?: string | null
}

export type RadarGradeRangeInput = {
  bestGrade?: string | null
  likelyGrade?: string | null
  worstGrade?: string | null
}

export type RadarConclusionInput = RadarIdentitySnapshot & RadarGradeRangeInput & {
  recordStatus?: string | null
  conclusionMode?: string | null
  coreGrade?: string | null
  compatibilityGrade?: string | null
  ratingNotice?: string | null
  blocksPublication?: boolean | null
}

export type RadarResearchInput = RadarIdentitySnapshot & {
  recordStatus?: string | null
  proposedBestGrade?: string | null
  proposedLikelyGrade?: string | null
  proposedWorstGrade?: string | null
  importedAt?: string | null
  updatedAt?: string | null
}

export type RadarHumanInput = {
  grade?: string | null
  status?: string | null
}

export type RadarLegacyInput = {
  grade?: string | null
  assessedAt?: string | null
}

export type RadarReadSnapshot = {
  identity: RadarExactIdentity
  humanOverride?: RadarHumanInput | null
  published?: {
    record?: RadarConclusionInput | null
    rating?: RadarConclusionInput | null
  } | null
  candidate?: RadarConclusionInput | null
  research?: {
    latest?: RadarResearchInput | null
    history?: RadarResearchInput[] | null
    truncated?: boolean
  } | null
  legacyCompatibility?: RadarLegacyInput | null
}

export type RadarGradeRange = {
  bestGrade: string
  likelyGrade: string
  worstGrade: string
}

export type RadarGradeState = {
  mode: RadarConclusionMode
  grade: string | null
  range: RadarGradeRange | null
  valid: boolean
  rawMode: string
  rawGrade: string
  reason?: string
}

export type RadarAuthoritySelection = {
  authority: RadarAuthority
  pending: boolean
  gradeState: RadarGradeState
  snapshot: RadarReadSnapshot
}

const GRADE_ORDER = ['S', 'A', 'B', 'C', 'D', 'E', 'F', 'X'] as const
const GRADE_RANK = new Map(GRADE_ORDER.map((grade, index) => [grade, index]))

function clean(value: unknown) {
  return String(value ?? '').trim()
}

export function normalizeRadarGrade(value: unknown): string | null {
  const grade = clean(value).toUpperCase()
  return GRADE_RANK.has(grade as (typeof GRADE_ORDER)[number]) ? grade : null
}

export function radarIdentityKey(identity: RadarExactIdentity) {
  return `${clean(identity.workId)}|${clean(identity.siteId)}`
}

export function hasExactRadarIdentity(
  expected: RadarExactIdentity,
  actual?: RadarIdentitySnapshot | null,
) {
  if (!actual) return false

  const workId = clean(actual.workIdSnapshot)
  const siteId = clean(actual.workSiteId)
  if (!workId || !siteId) return false
  if (workId !== clean(expected.workId) || siteId !== clean(expected.siteId)) return false

  const identityKey = clean(actual.identityKey)
  return !identityKey || identityKey === radarIdentityKey(expected)
}

export function normalizeRadarMode(value: unknown): RadarConclusionMode {
  const mode = clean(value)
  if (mode === 'fixed_grade') return 'fixed_grade'
  if (mode === 'bounded_range') return 'bounded_range'
  if (mode === 'labels_only') return 'labels_only'
  if (mode === 'blocked') return 'blocked'
  return 'legacy'
}

export function normalizeRadarGradeRange(
  input?: RadarGradeRangeInput | null,
): RadarGradeRange | null {
  if (!input) return null

  const bestGrade = normalizeRadarGrade(input.bestGrade)
  const likelyGrade = normalizeRadarGrade(input.likelyGrade)
  const worstGrade = normalizeRadarGrade(input.worstGrade)
  if (!bestGrade || !likelyGrade || !worstGrade) return null

  const bestRank = GRADE_RANK.get(bestGrade as (typeof GRADE_ORDER)[number])!
  const likelyRank = GRADE_RANK.get(likelyGrade as (typeof GRADE_ORDER)[number])!
  const worstRank = GRADE_RANK.get(worstGrade as (typeof GRADE_ORDER)[number])!

  if (bestRank > likelyRank || likelyRank > worstRank) return null
  return { bestGrade, likelyGrade, worstGrade }
}

function emptyGradeState(reason: string): RadarGradeState {
  return {
    mode: 'legacy',
    grade: null,
    range: null,
    valid: false,
    rawMode: '',
    rawGrade: '',
    reason,
  }
}

function invalidExplicitState(
  mode: 'fixed_grade' | 'bounded_range',
  rawMode: string,
  rawGrade: string,
  reason: string,
  range: RadarGradeRange | null = null,
): RadarGradeState {
  return {
    mode,
    grade: null,
    range,
    valid: false,
    rawMode,
    rawGrade,
    reason,
  }
}

export function normalizeRadarConclusion(
  input?: RadarConclusionInput | null,
): RadarGradeState {
  if (!input) return emptyGradeState('missing_conclusion')

  const rawMode = clean(input.conclusionMode)
  const rawGrade = clean(input.coreGrade || input.compatibilityGrade).toUpperCase()
  const mode = normalizeRadarMode(rawMode)

  if (mode === 'labels_only') {
    return { mode, grade: null, range: null, valid: true, rawMode, rawGrade }
  }

  if (mode === 'blocked') {
    return { mode, grade: null, range: null, valid: true, rawMode, rawGrade }
  }

  if (mode === 'bounded_range') {
    const compatibilityGrade = normalizeRadarGrade(rawGrade)
    const range = normalizeRadarGradeRange(input)
    if (!range) {
      return invalidExplicitState(mode, rawMode, rawGrade, 'invalid_bounded_range')
    }
    if (
      compatibilityGrade === 'X'
      || range.bestGrade === 'X'
      || range.likelyGrade === 'X'
      || range.worstGrade === 'X'
    ) {
      return invalidExplicitState(mode, rawMode, rawGrade, 'machine_x_not_allowed', range)
    }
    if (!compatibilityGrade || compatibilityGrade !== range.likelyGrade) {
      return invalidExplicitState(mode, rawMode, rawGrade, 'bounded_core_likely_mismatch', range)
    }

    return {
      mode,
      grade: range.likelyGrade,
      range,
      valid: true,
      rawMode,
      rawGrade,
    }
  }

  if (mode === 'fixed_grade') {
    const grade = normalizeRadarGrade(rawGrade)
    const range = normalizeRadarGradeRange(input)
    if (grade === 'X' || range?.bestGrade === 'X' || range?.likelyGrade === 'X' || range?.worstGrade === 'X') {
      return invalidExplicitState(mode, rawMode, rawGrade, 'machine_x_not_allowed', range)
    }
    if (!grade || !range) {
      return invalidExplicitState(mode, rawMode, rawGrade, 'invalid_fixed_grade_contract', range)
    }
    const allEqual = grade === range.bestGrade
      && grade === range.likelyGrade
      && grade === range.worstGrade
    if (!allEqual) {
      return invalidExplicitState(mode, rawMode, rawGrade, 'fixed_grade_conflict', range)
    }

    return {
      mode,
      grade,
      range: null,
      valid: true,
      rawMode,
      rawGrade,
    }
  }

  // Generic legacy values remain legacy. In particular, D-UNCLEAR is not coerced to D.
  const grade = normalizeRadarGrade(rawGrade)
  return {
    mode: 'legacy',
    grade,
    range: null,
    valid: Boolean(grade),
    rawMode,
    rawGrade,
    reason: grade ? 'legacy_grade' : rawGrade ? 'legacy_unrecognized_grade' : 'legacy_missing_grade',
  }
}

function isCurrent(record?: { recordStatus?: string | null } | null) {
  return clean(record?.recordStatus) === 'current'
}

function usableHuman(input?: RadarHumanInput | null) {
  if (!input) return null
  const status = clean(input.status)
  const grade = normalizeRadarGrade(input.grade)
  if (!grade || status === 'pending') return null
  return grade
}

function legacyPublishedState(rating: RadarConclusionInput): RadarGradeState {
  const rawGrade = clean(rating.coreGrade).toUpperCase()
  const coreGrade = normalizeRadarGrade(rating.coreGrade)
  const range = normalizeRadarGradeRange(rating)

  // v0.5 legacy fallback contract:
  // - all four grades equal => fixed_grade
  // - ordered non-equal range with core == likely => bounded_range
  // - otherwise preserve the Published authority but expose no invented grade
  if (coreGrade && range && coreGrade === range.likelyGrade) {
    const grades = [coreGrade, range.bestGrade, range.likelyGrade, range.worstGrade]
    if (new Set(grades).size === 1) {
      return {
        mode: 'fixed_grade',
        grade: coreGrade,
        range: null,
        valid: true,
        rawMode: '',
        rawGrade,
        reason: 'legacy_published_all_four_equal',
      }
    }

    return {
      mode: 'bounded_range',
      grade: range.likelyGrade,
      range,
      valid: true,
      rawMode: '',
      rawGrade,
      reason: 'legacy_published_ordered_range',
    }
  }

  return {
    mode: 'legacy',
    grade: null,
    range,
    valid: false,
    rawMode: '',
    rawGrade,
    reason: 'legacy_published_unresolved_do_not_claim_fixed_grade',
  }
}

function publishedState(snapshot: RadarReadSnapshot): RadarGradeState | null {
  const record = snapshot.published?.record
  const rating = snapshot.published?.rating
  if (!record || !rating) return null
  if (!isCurrent(record) || !isCurrent(rating)) return null
  if (!hasExactRadarIdentity(snapshot.identity, record)) return null
  if (!hasExactRadarIdentity(snapshot.identity, rating)) return null
  if (rating.blocksPublication === true) return null

  if (!clean(rating.conclusionMode)) return legacyPublishedState(rating)

  // Authority and grade interpretability are deliberately separate. A malformed
  // current Published row must not silently yield to a lower-authority Candidate.
  return normalizeRadarConclusion(rating)
}

function candidateState(snapshot: RadarReadSnapshot): RadarGradeState | null {
  const candidate = snapshot.candidate
  if (!candidate || !isCurrent(candidate)) return null
  if (!hasExactRadarIdentity(snapshot.identity, candidate)) return null

  // Candidate lineage remains pending even when its grade payload is unresolved.
  // Research must never be used to repair the Candidate in this selector.
  return normalizeRadarConclusion(candidate)
}

export function selectRadarAuthority(snapshot: RadarReadSnapshot): RadarAuthoritySelection {
  const humanGrade = usableHuman(snapshot.humanOverride)
  if (humanGrade) {
    return {
      authority: 'human',
      pending: false,
      gradeState: {
        mode: 'fixed_grade',
        grade: humanGrade,
        range: null,
        valid: true,
        rawMode: 'human_override',
        rawGrade: clean(snapshot.humanOverride?.grade).toUpperCase(),
      },
      snapshot,
    }
  }

  const published = publishedState(snapshot)
  if (published) {
    return { authority: 'published', pending: false, gradeState: published, snapshot }
  }

  const candidate = candidateState(snapshot)
  if (candidate) {
    return { authority: 'candidate', pending: true, gradeState: candidate, snapshot }
  }

  if (snapshot.research?.latest) {
    return {
      authority: 'research',
      pending: false,
      gradeState: emptyGradeState('research_only_no_public_grade'),
      snapshot,
    }
  }

  const legacyGrade = normalizeRadarGrade(snapshot.legacyCompatibility?.grade)
  if (legacyGrade) {
    return {
      authority: 'legacy',
      pending: true,
      gradeState: {
        mode: 'legacy',
        grade: legacyGrade,
        range: null,
        valid: true,
        rawMode: 'works_compatibility',
        rawGrade: clean(snapshot.legacyCompatibility?.grade).toUpperCase(),
        reason: 'legacy_compatibility_projection',
      },
      snapshot,
    }
  }

  return {
    authority: 'unassessed',
    pending: false,
    gradeState: emptyGradeState('unassessed'),
    snapshot,
  }
}
