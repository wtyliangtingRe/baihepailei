const VALID_GRADES = new Set(['S', 'A', 'B', 'C', 'D', 'E', 'F', 'X'])
const DISPLAY_GRADES = new Set([...VALID_GRADES, 'unknown'])
const HUMAN_STATUS_VALUES = new Set(['pending', 'reviewed', 'disputed', 'deprecated'])

export const ASSESSMENT_TRACK_FIELDS = [
  'track',
  'state',
  'grade',
  'summary',
  'sourceSummary',
  'sourceLinks',
  'evidenceStatus',
  'evidenceStrength',
  'confidencePercent',
  'evidenceCoveragePercent',
  'sourceCount',
  'policyVersion',
  'assessmentBatch',
  'decisiveRuleCode',
  'decisiveRuleReason',
  'matchedRules',
  'contradictions',
  'requiresHumanReview',
  'assessedAt',
  'assessedBy',
  'bestGrade',
  'likelyGrade',
  'worstGrade',
  'provenance',
]

export function text(value) {
  return String(value ?? '').trim()
}

export function grade(value) {
  const normalized = text(value).toUpperCase()
  return VALID_GRADES.has(normalized) ? normalized : ''
}

function displayGrade(value) {
  const raw = text(value)
  if (!raw) return ''
  if (raw.toLowerCase() === 'unknown') return 'unknown'
  const normalized = raw.toUpperCase()
  return DISPLAY_GRADES.has(normalized) ? normalized : ''
}

export function relationshipID(value) {
  if (value && typeof value === 'object') return text(value.id || value.value)
  return text(value)
}

function hasNumberValue(value) {
  return value !== null && value !== undefined && text(value) !== ''
}

function boundedPercent(value) {
  if (!hasNumberValue(value)) return null
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(100, Math.max(0, number)) : null
}

function nonNegativeInteger(value) {
  if (!hasNumberValue(value)) return null
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : null
}

function normalizeLinks(value) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => ({
      label: text(item?.label) || null,
      url: text(item?.url) || null,
    }))
    .filter((item) => item.label || item.url)
}

function normalizeRules(value) {
  if (!Array.isArray(value)) return []
  return value
    .map((rule) => ({
      code: text(rule?.code) || null,
      grade: displayGrade(rule?.grade) || null,
      confidencePercent: boundedPercent(rule?.confidencePercent),
      reason: text(rule?.reason) || null,
    }))
    .filter((rule) => Object.values(rule).some((entry) => entry !== null))
}

function normalizeContradictions(value) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => text(typeof item === 'string' ? item : item?.value))
    .filter(Boolean)
}

function makeTrack(values) {
  const track = {}
  for (const field of ASSESSMENT_TRACK_FIELDS) {
    if (field === 'sourceLinks' || field === 'matchedRules' || field === 'contradictions') {
      track[field] = Array.isArray(values[field]) ? values[field] : []
    } else {
      track[field] = values[field] ?? null
    }
  }
  return track
}

function humanState(status) {
  switch (status) {
    case 'reviewed': return 'assessed'
    case 'disputed': return 'disputed'
    case 'deprecated': return 'withdrawn'
    default: return 'pending'
  }
}

function aiState(conclusion, radar) {
  if (text(conclusion?.recordStatus) === 'withdrawn') return 'withdrawn'
  if (
    radar?.evidenceStatus === 'conflicting_evidence'
    || (radar?.contradictions || []).length > 0
  ) return 'disputed'
  if (
    radar?.requiresHumanReview !== false
    || ['ai_synthesized_pending_review', 'insufficient_information'].includes(text(conclusion?.ratingNotice))
  ) return 'pending'
  return 'assessed'
}

export function normalizeRadarAssessment(value) {
  if (!value || typeof value !== 'object') return null
  const assessment = {
    confidencePercent: boundedPercent(value.confidencePercent),
    evidenceCoveragePercent: boundedPercent(value.evidenceCoveragePercent),
    evidenceStatus: text(value.evidenceStatus) || null,
    sourceSummary: text(value.sourceSummary) || null,
    sourceLinks: normalizeLinks(value.sourceLinks),
    sourceCount: nonNegativeInteger(value.sourceCount),
    policyVersion: text(value.policyVersion) || null,
    assessmentBatch: text(value.assessmentBatch) || null,
    suggestedGrade: displayGrade(value.suggestedGrade) || null,
    decisiveRuleCode: text(value.decisiveRuleCode) || null,
    decisiveRuleReason: text(value.decisiveRuleReason) || null,
    matchedRules: normalizeRules(value.matchedRules),
    contradictions: normalizeContradictions(value.contradictions),
    requiresHumanReview: typeof value.requiresHumanReview === 'boolean'
      ? value.requiresHumanReview
      : null,
    assessedAt: text(value.assessedAt) || null,
    assessedBy: relationshipID(value.assessedBy) || null,
  }
  return Object.values(assessment).some((entry) => (
    Array.isArray(entry) ? entry.length > 0 : entry !== null
  )) ? assessment : null
}

export function normalizeHumanAssessmentTrack(item) {
  if (!item || typeof item !== 'object') return null

  const human = item.humanAssessment && typeof item.humanAssessment === 'object'
    ? item.humanAssessment
    : {}
  const canonicalStatus = HUMAN_STATUS_VALUES.has(text(human.status)) ? text(human.status) : ''
  const legacyStatus = HUMAN_STATUS_VALUES.has(text(item.reviewStatus)) ? text(item.reviewStatus) : ''
  const canonicalNote = text(human.note)
  const legacyNote = text(item.humanReviewNote)
  const canonicalAssessedAt = text(human.assessedAt)
  const legacyAssessedAt = text(item.humanReviewedAt)
  const canonicalAssessedBy = relationshipID(human.assessedBy)
  const legacyAssessedBy = relationshipID(item.humanReviewedBy)
  const sourceLinks = normalizeLinks(human.sourceLinks)
  const canonicalGrade = displayGrade(human.grade)
  const compatibilityHumanGrade = displayGrade(item.humanGrade)

  const hasCanonical = Boolean(
    canonicalGrade
    || canonicalNote
    || text(human.sourceSummary)
    || text(human.evidenceStatus)
    || sourceLinks.length
    || canonicalAssessedAt
    || canonicalAssessedBy
    || (canonicalStatus && canonicalStatus !== 'pending')
  )
  const hasLegacy = Boolean(
    legacyNote
    || legacyAssessedAt
    || legacyAssessedBy
    || compatibilityHumanGrade
    || (legacyStatus && legacyStatus !== 'pending')
  )
  if (!hasCanonical && !hasLegacy) return null

  const contradictions = []
  if (canonicalStatus && legacyStatus && canonicalStatus !== legacyStatus) {
    contradictions.push(`新旧人工审核状态不一致：humanAssessment=${canonicalStatus}；legacy=${legacyStatus}`)
  }
  if (canonicalNote && legacyNote && canonicalNote !== legacyNote) {
    contradictions.push('新旧人工审核说明不一致，展示采用 humanAssessment，旧说明保留待迁移复核。')
  }
  if (canonicalAssessedAt && legacyAssessedAt && canonicalAssessedAt !== legacyAssessedAt) {
    contradictions.push('新旧人工审核时间不一致。')
  }
  if (canonicalAssessedBy && legacyAssessedBy && canonicalAssessedBy !== legacyAssessedBy) {
    contradictions.push('新旧人工审核记录人不一致。')
  }

  const status = canonicalStatus || legacyStatus || 'pending'
  const effectiveGrade = canonicalGrade || compatibilityHumanGrade || null
  const provenance = hasCanonical && hasLegacy
    ? 'humanAssessment_with_legacy_fallback'
    : (hasCanonical ? 'humanAssessment' : 'legacy_fallback')

  return makeTrack({
    track: 'human',
    state: humanState(status),
    grade: effectiveGrade,
    summary: canonicalNote || legacyNote || null,
    sourceSummary: text(human.sourceSummary) || null,
    sourceLinks,
    evidenceStatus: text(human.evidenceStatus) || null,
    evidenceStrength: text(human.evidenceStrength || item.evidenceStrength) || null,
    confidencePercent: boundedPercent(human.confidencePercent),
    evidenceCoveragePercent: boundedPercent(human.evidenceCoveragePercent),
    sourceCount: nonNegativeInteger(human.sourceCount ?? sourceLinks.length),
    policyVersion: text(human.policyVersion) || null,
    assessmentBatch: text(human.assessmentBatch) || null,
    decisiveRuleCode: text(human.decisiveRuleCode) || null,
    decisiveRuleReason: text(human.decisiveRuleReason) || null,
    matchedRules: normalizeRules(human.matchedRules),
    contradictions: [
      ...normalizeContradictions(human.contradictions),
      ...contradictions,
    ],
    requiresHumanReview: status !== 'reviewed',
    assessedAt: canonicalAssessedAt || legacyAssessedAt || null,
    assessedBy: canonicalAssessedBy || legacyAssessedBy || null,
    bestGrade: effectiveGrade,
    likelyGrade: effectiveGrade,
    worstGrade: effectiveGrade,
    provenance,
  })
}

export function normalizeAIConclusionTrack(conclusion) {
  if (!conclusion || typeof conclusion !== 'object') return null
  const radar = normalizeRadarAssessment(conclusion.radarAssessment) || {}
  const effectiveGrade = displayGrade(
    conclusion.compatibilityGrade
    || conclusion.likelyGrade
    || radar.suggestedGrade,
  ) || null
  const bestGrade = displayGrade(conclusion.bestGrade) || effectiveGrade
  const likelyGrade = displayGrade(conclusion.likelyGrade) || effectiveGrade
  const worstGrade = displayGrade(conclusion.worstGrade) || effectiveGrade

  return makeTrack({
    track: 'ai',
    state: aiState(conclusion, radar),
    grade: effectiveGrade,
    summary: radar.decisiveRuleReason || radar.sourceSummary || null,
    sourceSummary: radar.sourceSummary || null,
    sourceLinks: radar.sourceLinks?.length ? radar.sourceLinks : normalizeLinks(conclusion.sourceLinks),
    evidenceStatus: radar.evidenceStatus || null,
    evidenceStrength: text(conclusion.evidenceStrength) || null,
    confidencePercent: radar.confidencePercent ?? null,
    evidenceCoveragePercent: radar.evidenceCoveragePercent ?? null,
    sourceCount: radar.sourceCount ?? null,
    policyVersion: radar.policyVersion || null,
    assessmentBatch: radar.assessmentBatch || null,
    decisiveRuleCode: radar.decisiveRuleCode || null,
    decisiveRuleReason: radar.decisiveRuleReason || null,
    matchedRules: radar.matchedRules || [],
    contradictions: radar.contradictions || [],
    requiresHumanReview: radar.requiresHumanReview,
    assessedAt: radar.assessedAt || text(conclusion.publishedAt) || null,
    assessedBy: radar.assessedBy || null,
    bestGrade,
    likelyGrade,
    worstGrade,
    provenance: text(conclusion.sourceKind) || 'public_ai_conclusion',
  })
}

function validHumanGrade(track) {
  return Boolean(
    track
    && grade(track.grade)
    && ['assessed', 'disputed'].includes(track.state)
  )
}

function validAIGrade(track) {
  return Boolean(track && grade(track.grade) && track.state !== 'withdrawn')
}

export function buildAssessmentTracks(item, conclusion) {
  const human = normalizeHumanAssessmentTrack(item)
  const ai = normalizeAIConclusionTrack(conclusion)

  if (validHumanGrade(human)) {
    return {
      human,
      ai,
      effectiveGrade: grade(human.grade),
      effectiveGradeSource: 'human',
    }
  }
  if (validAIGrade(ai)) {
    return {
      human,
      ai,
      effectiveGrade: grade(ai.grade),
      effectiveGradeSource: 'ai',
    }
  }
  return {
    human,
    ai,
    effectiveGrade: 'unknown',
    effectiveGradeSource: 'none',
  }
}
