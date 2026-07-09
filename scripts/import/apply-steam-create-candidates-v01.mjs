#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const VERSION = 'steam-create-candidates-apply-v0.4'
const DEFAULT_INPUT = 'data_local/staging/steam-work-integration/create-priority/p1-bangumi-high-medium-adult-review.jsonl'
const DEFAULT_OUT_DIR = 'data_local/staging/steam-work-integration/create-priority'
const CONFIRM = 'apply-steam-create-candidates-v01'
const ADULT_MARKER_NOTE = 'contentRating=erotica; contentVisibility=adult; adultOrMarkedContent=true; sourcePolicy=Steam adult/marked content flow; metadata-only candidate pending human review; hidden from ordinary mode by derived content visibility until user switches to all works.'
const TITLE_SEPARATOR_PATTERN = '[\\s\\u00a0\\u1680\\u180e\\u2000-\\u200d\\u2028\\u2029\\u202f\\u205f\\u2060\\u3000\\ufeff]+'
const CJKISH_CHAR_CLASS = '[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}ー]'
const CJKISH_SPACING_RE = new RegExp(`(${CJKISH_CHAR_CLASS})${TITLE_SEPARATOR_PATTERN}(${CJKISH_CHAR_CLASS})`, 'gu')
const CJKISH_BEFORE_PUNCT_RE = new RegExp(`(${CJKISH_CHAR_CLASS})${TITLE_SEPARATOR_PATTERN}([）》」』】、。！？：；,.!?])`, 'gu')
const PUNCT_BEFORE_CJKISH_RE = new RegExp(`([（《「『【])${TITLE_SEPARATOR_PATTERN}(${CJKISH_CHAR_CLASS})`, 'gu')
const ALLOWED_REVIEW_REASONS = new Set(['radar_seed_attached', 'source_conflict', 'multi_source_or_variant', 'wikidata_candidate_review', 'wikidata_quarantine', 'manual_review', 'other'])

function val(value) { return String(value ?? '').trim() }
function list(value) { return Array.isArray(value) ? value : [] }
function parseArgs(argv) { const args = {}; for (let i = 0; i < argv.length; i += 1) { const item = argv[i]; if (!item.startsWith('--')) continue; const key = item.slice(2); const next = argv[i + 1]; if (!next || next.startsWith('--')) args[key] = true; else { args[key] = next; i += 1 } } return args }
function cleanLine(value) { return val(value).normalize('NFKC').replace(/[\r\n\t]+/gu, ' ').replace(new RegExp(TITLE_SEPARATOR_PATTERN, 'gu'), ' ').trim() }
function normalizeText(value) { return cleanLine(value).normalize('NFKC').toLowerCase() }
function readJsonl(file) { if (!fs.existsSync(file)) throw new Error(`Input file not found: ${file}`); const raw = fs.readFileSync(file, 'utf8').trim(); if (!raw) return []; return raw.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line)) }
function writeJsonl(file, rows) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8') }
function countBy(rows, key) { const out = {}; for (const row of rows) { const value = typeof key === 'function' ? key(row) : row?.[key]; const name = val(value) || 'missing'; out[name] = (out[name] || 0) + 1 } return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) }
function splitSearchText(value) { return val(value).split(/[\r\n|]+/u).map(cleanLine).filter(Boolean) }
function suspiciousTitleSpaceScore(value) { const text = cleanLine(value); return (text.match(CJKISH_SPACING_RE) || []).length + (text.match(CJKISH_BEFORE_PUNCT_RE) || []).length + (text.match(PUNCT_BEFORE_CJKISH_RE) || []).length + (text.match(/\[object Object\]/u) || []).length }
function exactTitleSet(work) { return new Set([work?.title, work?.originalTitle, ...list(work?.aliases).map((item) => item?.value), ...splitSearchText(work?.searchText)].map(normalizeText).filter(Boolean)) }
function slugify(value) { const slug = cleanLine(value).normalize('NFKD').replace(/[\u0300-\u036f]/gu, '').toLowerCase().replace(/&/gu, ' and ').replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '').replace(/-{2,}/gu, '-'); return slug || 'steam-work' }
function normalizeUrl(value) { return val(value).replace(/\s+/gu, '').replace(/\/+$/u, '') }
function sourceLinkRows(doc) { return list(doc?.sourceLinks).map((item) => ({ label: cleanLine(item?.label), url: normalizeUrl(item?.url) })).filter((item) => item.url) }
function candidateSourceRows(doc) { return list(doc?.candidateSources).map((item) => ({ source: val(item?.source), label: cleanLine(item?.label), externalId: val(item?.externalId), url: normalizeUrl(item?.url), note: cleanLine(item?.note) })).filter((item) => item.source || item.externalId || item.url || item.note) }
function steamIdsOfWork(work) { const ids = []; for (const item of [...sourceLinkRows(work), ...candidateSourceRows(work)]) { const hit = item.url?.match(/store\.steampowered\.com\/app\/(\d+)/iu)?.[1]; if (hit) ids.push(hit); if (item.source === 'steam' && /^\d+$/u.test(item.externalId)) ids.push(item.externalId) } return [...new Set(ids)] }
function buildIndexes(works) { const steam = new Map(), slug = new Map(), siteId = new Map(), title = new Map(); for (const work of works) { for (const id of steamIdsOfWork(work)) steam.set(id, work); if (val(work.slug)) slug.set(val(work.slug).toLowerCase(), work); if (val(work.siteId)) siteId.set(val(work.siteId).toUpperCase(), work); for (const key of exactTitleSet(work)) { if (!title.has(key)) title.set(key, []); title.get(key).push(work) } } return { steam, slug, siteId, title } }
async function requestJson(url, options = {}) { const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } }); const text = await response.text(); let payload = null; try { payload = text ? JSON.parse(text) : null } catch { payload = { raw: text } } if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 1200)}`); return payload }
function authHeaders(token) { return token ? { Authorization: `JWT ${token}` } : {} }
async function login(baseUrl) { const email = process.env.PAYLOAD_EXPORT_EMAIL || process.env.PAYLOAD_SEED_EMAIL; const password = process.env.PAYLOAD_EXPORT_PASSWORD || process.env.PAYLOAD_SEED_PASSWORD; if (!email || !password) throw new Error('Missing Payload login env vars'); const result = await requestJson(`${baseUrl}/api/users/login`, { method: 'POST', body: JSON.stringify({ email, password }) }); if (!result?.token) throw new Error('Payload login did not return a token'); return result.token }
async function fetchAllWorks(baseUrl, token) { const docs = []; let page = 1, totalPages = 1; do { const params = new URLSearchParams(); params.set('limit', '200'); params.set('page', String(page)); params.set('depth', '0'); params.set('draft', 'true'); const result = await requestJson(`${baseUrl}/api/works?${params.toString()}`, { headers: authHeaders(token) }); docs.push(...(Array.isArray(result?.docs) ? result.docs : [])); totalPages = Number(result?.totalPages || 1); page += 1 } while (page <= totalPages); return docs }
function hasSensitiveSteamWarning(plan) { const text = [plan?.warnings, plan?.raw?.required_age, plan?.raw?.content_descriptors?.notes, JSON.stringify(plan?.raw?.ratings || {}), JSON.stringify(plan?.createCandidatePreview?.candidateSources || [])].flat().map(val).join('\n'); return /adult|sexual|nudity|erotic|porn|sex|sexo|sexuelle|explicit|18|2147483647|banned/iu.test(text) }
function shouldForceAdultMarker(input, args) { if (args['force-adult-marker']) return true; return /(?:^|[\\/])p[248][^\\/]*(?:sensitive|adult|marked|review)|adult-review|adult-marked|lesbian-sex-only/iu.test(input) }
function isSensitivePlan(plan, options) { return Boolean(options?.forceAdultMarker) || hasSensitiveSteamWarning(plan) }
function safeReviewReasons(sourceReasons, sensitive) { const reasons = [...list(sourceReasons).filter((item) => ALLOWED_REVIEW_REASONS.has(item)), 'manual_review', sensitive ? 'source_conflict' : 'multi_source_or_variant']; return [...new Set(reasons)] }
function adultMarkerParts(sensitive) { return sensitive ? [ADULT_MARKER_NOTE] : [] }
function markerHaystack(payload) { return [payload?.evidenceNote, payload?.sourceConflictNotes, payload?.searchText, ...list(payload?.candidateSources).map((item) => item?.note)].map((item) => val(item).toLowerCase()).join('\n') }
function buildPayload(plan, options = {}) {
  const source = plan?.createCandidatePreview?.payloadPreview || {}
  const title = cleanLine(source.title || plan.title || plan.raw?.name || `Steam ${plan.steamAppId}`)
  const steamAppId = val(plan.steamAppId)
  const slug = cleanLine(source.slug || `${slugify(title)}-steam-${steamAppId}`)
  const siteId = cleanLine(source.siteId || `STEAM-${steamAppId}`).toUpperCase()
  const sensitive = isSensitivePlan(plan, options)
  const markerParts = adultMarkerParts(sensitive)
  const sourceLinks = sourceLinkRows({ sourceLinks: source.sourceLinks || plan.createCandidatePreview?.sourceLinks })
  const candidateSources = candidateSourceRows({ candidateSources: source.candidateSources || plan.createCandidatePreview?.candidateSources }).map((item) => ({ ...item, note: cleanLine([item.note, ...markerParts, 'sourcePolicy=Steam manual review create; metadata-only; human review required'].filter(Boolean).join('; ')) }))
  const evidenceNote = cleanLine([source.evidenceNote, ...markerParts, 'Created from Steam create candidate. Draft status; human review required before final review. No dates/images/creators/tags/summary/externalIds written by this workflow.'].filter(Boolean).join(' '))
  const sourceConflictNotes = cleanLine([source.sourceConflictNotes, sensitive ? 'Steam candidate is in a sensitive/adult-marked input bucket or has adult/sensitive rating or descriptor signals; ordinary mode hides it through derived content visibility until user switches to all works.' : 'Steam candidate created from strong source signals; pending human review.', ...markerParts].filter(Boolean).join(' '))
  return { title, slug, siteId, rank: source.rank || 'unknown', reviewStatus: source.reviewStatus || 'pending', reviewReasons: safeReviewReasons(source.reviewReasons, sensitive), sourceConflictNotes, evidenceStrength: source.evidenceStrength || 'unassessed', ratingNotice: source.ratingNotice || 'ai_synthesized_pending_review', importBatch: 'steam-create-candidates-v01', chosenBaseSource: 'steam', originalTitle: cleanLine(source.originalTitle || title), mediaGroup: source.mediaGroup || 'game', mediaType: source.mediaType || 'game', format: source.format || 'pc_game', yuriCandidateScore: Number(source.yuriCandidateScore || 0.5), sourceLinks, candidateSources, searchText: splitSearchText(source.searchText || title).join('\n'), evidenceNote, isLiteVisible: true, isFullVisible: true, status: 'draft' }
}
function validatePlan(plan, payload, options = {}) { const blockers = []; const sensitive = isSensitivePlan(plan, options); if (val(plan?.action) !== 'steam_create_candidate_preview') blockers.push('unexpected_action'); if (plan?.planStatus !== 'create_candidate_review') blockers.push('not_create_candidate_review'); if (!val(plan?.steamAppId)) blockers.push('missing_steam_appid'); if (!val(payload.title)) blockers.push('missing_title'); if (!val(payload.slug)) blockers.push('missing_slug'); if (!val(payload.siteId)) blockers.push('missing_site_id'); if (payload.status !== 'draft') blockers.push('not_draft_status'); if (payload.reviewStatus !== 'pending') blockers.push('not_pending_review'); if (payload.isLiteVisible !== true) blockers.push('not_lite_visible_for_scope_toggle'); if (payload.isFullVisible !== true) blockers.push('not_full_visible_for_scope_toggle'); if (!list(payload.sourceLinks).some((item) => /store\.steampowered\.com\/app\//iu.test(item.url))) blockers.push('missing_steam_source_link'); if (!list(payload.candidateSources).some((item) => item.source === 'steam' && item.externalId === val(plan.steamAppId))) blockers.push('missing_matching_steam_candidate_source'); for (const reason of list(payload.reviewReasons)) if (!ALLOWED_REVIEW_REASONS.has(reason)) blockers.push(`invalid_review_reason:${reason}`); if (sensitive) { const markers = markerHaystack(payload); if (!markers.includes('contentrating=erotica')) blockers.push('missing_adult_content_rating_note'); if (!markers.includes('contentvisibility=adult')) blockers.push('missing_adult_visibility_note'); if (!markers.includes('adultormarkedcontent=true')) blockers.push('missing_adult_marker_note') } for (const key of ['firstPublishedAt', 'firstReleasedAt', 'publishedAt', 'creators', 'creatorCredits', 'organizations', 'tags', 'summary', 'externalIds']) if (key in payload) blockers.push(`non_writable_create_field:${key}`); for (const value of [payload.title, payload.originalTitle, payload.slug, ...splitSearchText(payload.searchText)]) { if (/\[object Object\]/u.test(value)) blockers.push('object_object_artifact'); if (suspiciousTitleSpaceScore(value) > 0) blockers.push('suspicious_title_spacing_after_sanitize') } return [...new Set(blockers)] }
function duplicateStatus(payload, plan, indexes) { const blockers = []; const steamAppId = val(plan.steamAppId); if (steamAppId && indexes.steam.has(steamAppId)) blockers.push('existing_steam_appid'); if (indexes.slug.has(val(payload.slug).toLowerCase())) blockers.push('existing_slug'); if (indexes.siteId.has(val(payload.siteId).toUpperCase())) blockers.push('existing_site_id'); const searchValues = [payload.title, payload.originalTitle, ...splitSearchText(payload.searchText)]; if (searchValues.some((item) => indexes.title.has(normalizeText(item)))) blockers.push('existing_exact_title_or_search_text'); return [...new Set(blockers)] }
function updateIndexes(payload, doc, plan, indexes) { const steamAppId = val(plan.steamAppId); if (steamAppId) indexes.steam.set(steamAppId, doc); if (payload.slug) indexes.slug.set(val(payload.slug).toLowerCase(), doc); if (payload.siteId) indexes.siteId.set(val(payload.siteId).toUpperCase(), doc); for (const key of exactTitleSet(payload)) { if (!indexes.title.has(key)) indexes.title.set(key, []); indexes.title.get(key).push(doc) } }
async function main() {
  const args = parseArgs(process.argv.slice(2))
  const base = String(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/+$/u, '')
  const input = String(args.input || DEFAULT_INPUT)
  const outDir = String(args['out-dir'] || DEFAULT_OUT_DIR)
  const apply = Boolean(args.apply)
  const confirmMatched = val(args.confirm) === CONFIRM
  const limit = Number(args.limit || 0)
  const forceAdultMarker = shouldForceAdultMarker(input, args)
  const payloadOptions = { forceAdultMarker }
  if (apply && !confirmMatched) throw new Error(`Need --apply --confirm ${CONFIRM}`)
  const allPlans = readJsonl(input)
  const plans = limit > 0 ? allPlans.slice(0, limit) : allPlans
  const token = await login(base)
  const auth = authHeaders(token)
  const indexes = buildIndexes(await fetchAllWorks(base, token))
  const rows = []
  let payloadPostRequests = 0
  for (const plan of plans) {
    const payload = buildPayload(plan, payloadOptions)
    const row = { key: val(plan.key), steamAppId: val(plan.steamAppId), title: payload.title, mode: apply ? 'apply' : 'dry-run', status: '', blockers: validatePlan(plan, payload, payloadOptions), createdWorkId: '', slug: payload.slug, siteId: payload.siteId, sensitive: isSensitivePlan(plan, payloadOptions), forceAdultMarker, adultMarkerApplied: markerHaystack(payload).includes('contentvisibility=adult') }
    try {
      if (!row.blockers.length) {
        const duplicates = duplicateStatus(payload, plan, indexes)
        if (duplicates.length) {
          if (duplicates.includes('existing_steam_appid') || duplicates.includes('existing_slug') || duplicates.includes('existing_site_id')) row.status = 'already_exists'
          else row.blockers.push(...duplicates)
        }
      }
      if (!row.status && !row.blockers.length) {
        if (apply) {
          payloadPostRequests += 1
          const created = await requestJson(`${base}/api/works?draft=true`, { method: 'POST', headers: auth, body: JSON.stringify(payload) })
          const doc = created?.doc || created
          row.createdWorkId = val(doc?.id)
          row.status = 'created'
          if (doc) updateIndexes(payload, doc, plan, indexes)
        } else row.status = 'would_create'
      }
      if (!row.status && row.blockers.length) row.status = 'blocked'
    } catch (error) {
      row.status = 'failed'
      row.blockers.push(String(error?.message || error).slice(0, 1200))
    }
    rows.push(row)
  }
  const outputs = { rows: `${outDir}/steam-create-candidates-apply-v01.rows.jsonl`, wouldCreate: `${outDir}/steam-create-candidates-apply-v01-would-create.jsonl`, created: `${outDir}/steam-create-candidates-apply-v01-created.jsonl`, blocked: `${outDir}/steam-create-candidates-apply-v01-blocked.jsonl`, failed: `${outDir}/steam-create-candidates-apply-v01-failed.jsonl`, summary: `${outDir}/steam-create-candidates-apply-v01-summary.json` }
  const summary = { generatedAt: new Date().toISOString(), version: VERSION, mode: apply ? 'apply' : 'dry-run', payloadBaseUrl: base, input, forceAdultMarker, planRowsRead: allPlans.length, planRowsProcessed: plans.length, wouldCreate: rows.filter((r) => r.status === 'would_create').length, created: rows.filter((r) => r.status === 'created').length, alreadyExists: rows.filter((r) => r.status === 'already_exists').length, blocked: rows.filter((r) => r.status === 'blocked').length, failed: rows.filter((r) => r.status === 'failed').length, sensitiveRows: rows.filter((r) => r.sensitive).length, adultMarkerAppliedRows: rows.filter((r) => r.adultMarkerApplied).length, byStatus: countBy(rows, 'status'), byBlocker: countBy(rows.flatMap((r) => r.blockers), (x) => x), outputs, safety: { applyRequested: apply, confirmMatched, payloadRead: true, payloadWrite: apply, payloadPostRequests, directPostgresqlWrite: false, createsOnlyDraftWorks: true, deletesWorks: false, scopeToggleCompatible: true, sensitiveBucketForceAdultMarker: forceAdultMarker, sensitiveRowsCarryAdultMarkers: true, adultMarkerNote: ADULT_MARKER_NOTE, inputDefaultIsP1BangumiAdultReview: input === DEFAULT_INPUT, usesOnlyAllowedReviewReasonEnums: true, blocksDuplicates: true, doesNotWriteDates: true, doesNotDownloadImages: true, doesNotWriteCreatorsOrTags: true, doesNotWriteSummary: true, doesNotWriteExternalIds: true, confirmToken: CONFIRM } }
  fs.mkdirSync(outDir, { recursive: true })
  writeJsonl(outputs.rows, rows)
  writeJsonl(outputs.wouldCreate, rows.filter((r) => r.status === 'would_create'))
  writeJsonl(outputs.created, rows.filter((r) => r.status === 'created'))
  writeJsonl(outputs.blocked, rows.filter((r) => r.status === 'blocked' || r.status === 'already_exists'))
  writeJsonl(outputs.failed, rows.filter((r) => r.status === 'failed'))
  fs.writeFileSync(outputs.summary, JSON.stringify(summary, null, 2), 'utf8')
  console.log(JSON.stringify({ ok: summary.failed === 0, summary, outputs }, null, 2))
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
