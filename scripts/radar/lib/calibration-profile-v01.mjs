import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

import { list, unique, val } from './assessment-handoff-v01.mjs'

export const CALIBRATION_REGISTRY_VERSION = 'ai-radar-calibration-registry-v0.1'
export const CALIBRATION_PROFILE_VERSION = 'ai-radar-calibration-profile-v0.1'
export const CALIBRATED_HANDOFF_VERSION = 'ai-radar-calibrated-assessment-handoff-v0.1'
export const DEFAULT_CALIBRATION_REGISTRY = 'config/radar/calibration-profiles/registry.v0.1.json'

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, ''))
}

function sha256File(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function normalizeWeight(value, fallback = 0) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(1, Math.max(0, number))
}

export function normalizeTitleKey(value) {
  return val(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s*[（(]\s*\d+\s*[）)]\s*$/u, '')
    .replace(/\s+第?\s*\d+\s*[巻卷册集]?\s*$/u, '')
    .replace(/\s*第\s*\d+\s*[巻卷册集]\s*$/u, '')
    .replace(/[\s\p{P}\p{S}]+/gu, '')
}

function validateRegistry(registry, registryFile) {
  const blockers = []
  if (val(registry?.version) !== CALIBRATION_REGISTRY_VERSION) blockers.push('calibration_registry_version_mismatch')
  if (!val(registry?.activeProfileId)) blockers.push('calibration_registry_active_profile_missing')
  if (!Array.isArray(registry?.profiles)) blockers.push('calibration_registry_profiles_missing')
  if (blockers.length) throw new Error(`Calibration registry invalid at ${registryFile}: ${blockers.join(', ')}`)
}

function validateProfile(profile, profileFile, registryEntry) {
  const blockers = []
  if (val(profile?.version) !== CALIBRATION_PROFILE_VERSION) blockers.push('calibration_profile_version_mismatch')
  if (val(profile?.profileId) !== val(registryEntry?.profileId)) blockers.push('calibration_profile_id_mismatch')
  if (val(profile?.status) !== 'approved') blockers.push('calibration_profile_not_approved')
  if (val(profile?.policyVersion) !== val(registryEntry?.policyVersion)) blockers.push('calibration_profile_policy_mismatch')
  if (val(profile?.mode) !== 'advisory') blockers.push('calibration_profile_mode_not_advisory')
  if (!Array.isArray(profile?.principles)) blockers.push('calibration_profile_principles_missing')
  if (!Array.isArray(profile?.anchors)) blockers.push('calibration_profile_anchors_missing')
  if (blockers.length) throw new Error(`Calibration profile invalid at ${profileFile}: ${blockers.join(', ')}`)
}

export function loadCalibrationProfile(registryFile = DEFAULT_CALIBRATION_REGISTRY, requestedProfileId = '') {
  const resolvedRegistry = path.resolve(registryFile)
  if (!fs.existsSync(resolvedRegistry)) throw new Error(`Calibration registry not found: ${registryFile}`)
  const registry = readJson(resolvedRegistry)
  validateRegistry(registry, registryFile)

  const profileId = val(requestedProfileId) || val(registry.activeProfileId)
  const entry = list(registry.profiles).find((item) => val(item?.profileId) === profileId)
  if (!entry) throw new Error(`Calibration profile is not registered: ${profileId}`)
  if (val(entry?.status) !== 'approved') throw new Error(`Calibration profile is not approved: ${profileId}`)
  if (normalizeWeight(entry?.weight, 0) <= 0) throw new Error(`Calibration profile weight must be positive: ${profileId}`)

  const profileFile = path.resolve(path.dirname(resolvedRegistry), '..', '..', '..', val(entry.file))
  const directProfileFile = path.resolve(val(entry.file))
  const resolvedProfile = fs.existsSync(directProfileFile) ? directProfileFile : profileFile
  if (!fs.existsSync(resolvedProfile)) throw new Error(`Calibration profile file not found: ${val(entry.file)}`)
  const profile = readJson(resolvedProfile)
  validateProfile(profile, resolvedProfile, entry)

  const activeStatuses = new Set(list(profile.activeAnchorStatuses).map(val).filter(Boolean))
  const activePrinciples = list(profile.principles)
    .filter((item) => val(item?.status) === 'approved' && normalizeWeight(item?.weight, 0) > 0)
    .map((item) => ({
      principleId: val(item.principleId),
      weight: normalizeWeight(item.weight, 1),
      appliesTo: unique(item.appliesTo),
      effect: val(item.effect),
      note: val(item.note),
      sourceAnchors: unique(item.sourceAnchors),
    }))
  const activeAnchors = list(profile.anchors)
    .filter((item) => activeStatuses.has(val(item?.status)) && normalizeWeight(item?.weight, 0) > 0)
    .map((item) => ({
      anchorId: val(item.anchorId),
      title: val(item.title),
      matchTitles: unique(item.matchTitles),
      weight: normalizeWeight(item.weight, 1),
      currentGrade: val(item.currentGrade),
      currentRuleCodes: unique(item.currentRuleCodes),
      calibrationQuestion: val(item.calibrationQuestion),
      ownerReview: val(item.ownerReview),
      sourceId: val(item.sourceId),
    }))

  return {
    registry,
    registryFile: resolvedRegistry,
    registrySha256: sha256File(resolvedRegistry),
    profile,
    profileFile: resolvedProfile,
    profileSha256: sha256File(resolvedProfile),
    profileId,
    profileWeight: normalizeWeight(entry.weight, 1),
    activePrinciples,
    activeAnchors,
  }
}

function rowTitleKeys(row) {
  return new Set([
    val(row?.title),
    ...list(row?.titles),
    val(row?.series?.seriesKey),
  ].map(normalizeTitleKey).filter(Boolean))
}

function anchorMatchesRow(anchor, keys) {
  const anchorKeys = unique([anchor.title, ...list(anchor.matchTitles)]).map(normalizeTitleKey).filter(Boolean)
  return anchorKeys.some((anchorKey) => [...keys].some((key) => key === anchorKey || (anchorKey.length >= 5 && (key.includes(anchorKey) || anchorKey.includes(key)))))
}

export function buildCalibrationContext(row, loaded) {
  const keys = rowTitleKeys(row)
  const relevantAnchors = loaded.activeAnchors.filter((anchor) => anchorMatchesRow(anchor, keys))
  const stats = loaded.profile?.statistics || {}
  return {
    version: CALIBRATION_PROFILE_VERSION,
    profileId: loaded.profileId,
    displayName: val(loaded.profile?.displayName),
    policyVersion: val(loaded.profile?.policyVersion),
    mode: 'advisory',
    profileWeight: loaded.profileWeight,
    factsOverrideCalibration: loaded.profile?.behavior?.factsOverrideCalibration !== false,
    neverCreateEvidence: loaded.profile?.behavior?.neverCreateEvidence !== false,
    activePrinciples: loaded.activePrinciples,
    relevantAnchors,
    ignoredAnchorCounts: {
      tentative: Number(stats.ignoredTentativeAnchors) || 0,
      partial: Number(stats.ignoredPartialAnchors) || 0,
      pending: Number(stats.ignoredPendingAnchors) || 0,
    },
    instructions: [
      '事实证据优先于校准倾向；不得用校准档案创造剧情、关系或结局事实。',
      '校准档案只用于解释模糊边界、规则选择和严重度，不得隐藏已经命中的风险。',
      '只允许引用本行 activePrinciples 和 relevantAnchors 中列出的 ID。',
      '输出 calibrationSignals；没有适用信号时输出空数组，并说明未使用。',
    ],
  }
}

export function applyCalibrationProfile(rows, loaded) {
  return list(rows).map((row) => ({
    ...row,
    calibrationContext: buildCalibrationContext(row, loaded),
  }))
}

export function validateCalibrationResponse(input, response, workId) {
  const blockers = []
  const warnings = []
  const context = input?.calibrationContext || {}
  const expectedProfileId = val(context.profileId)
  if (!expectedProfileId) blockers.push(`calibration_context_missing:${workId}`)
  if (val(response?.calibrationProfileId) !== expectedProfileId) blockers.push(`calibration_profile_id_mismatch:${workId}`)

  if (!Array.isArray(response?.calibrationSignals)) blockers.push(`calibration_signals_missing:${workId}`)
  const allowedPrinciples = new Set(list(context.activePrinciples).map((item) => val(item?.principleId)).filter(Boolean))
  const allowedAnchors = new Set(list(context.relevantAnchors).map((item) => val(item?.anchorId)).filter(Boolean))
  const seen = new Set()
  const signals = []
  for (const signal of list(response?.calibrationSignals)) {
    const type = val(signal?.type)
    const id = val(signal?.id)
    const effect = val(signal?.effect)
    const reason = val(signal?.reason)
    const key = `${type}:${id}`
    if (!['principle', 'anchor'].includes(type)) blockers.push(`calibration_signal_type_invalid:${workId}:${id || 'missing'}`)
    if (!id) blockers.push(`calibration_signal_id_missing:${workId}`)
    if (seen.has(key)) blockers.push(`calibration_signal_duplicate:${workId}:${key}`)
    seen.add(key)
    if (type === 'principle' && !allowedPrinciples.has(id)) blockers.push(`calibration_principle_not_allowed:${workId}:${id}`)
    if (type === 'anchor' && !allowedAnchors.has(id)) blockers.push(`calibration_anchor_not_allowed:${workId}:${id}`)
    if (!effect) blockers.push(`calibration_signal_effect_missing:${workId}:${id || 'missing'}`)
    if (!reason) blockers.push(`calibration_signal_reason_missing:${workId}:${id || 'missing'}`)
    signals.push({ type, id, effect, reason, weight: normalizeWeight(signal?.weight, 1) })
  }
  if (!signals.length) warnings.push(`calibration_no_signal_used:${workId}`)

  return {
    blockers: unique(blockers),
    warnings: unique(warnings),
    calibration: {
      profileId: expectedProfileId,
      profileVersion: val(context.version),
      policyVersion: val(context.policyVersion),
      mode: val(context.mode) || 'advisory',
      signals,
      notes: unique(response?.calibrationNotes),
      context,
    },
  }
}
