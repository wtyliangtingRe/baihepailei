#!/usr/bin/env node
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { loadPublicModule, loadPublicRelease } from '../lib/load-public-release.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const { values } = parseArgs({ options: { output: { type: 'string' } } })
const output = resolve(values.output ?? join(root, 'exports/offline/index.html'))
const release = loadPublicRelease(root)
const { RADAR_POLICY_VERSION, radarClassEntries, radarGradeLabels, radarGradeSummaries } =
  loadPublicModule(root, 'src/lib/radar/ratingPolicy.ts')
const { chineseEditionTitle, mediaGroupLabels, mediaLabel, publicStatusLabels } =
  loadPublicModule(root, 'src/lib/radar/publicPresentation.ts')
const { publicTagDefinitions } = loadPublicModule(root, 'src/lib/radar/publicTags.ts')
const { publicSearchTermsForRatingClass } =
  loadPublicModule(root, 'src/lib/radar/publicSearchTerms.ts')

function credits(rows) {
  return rows.map(({ name, role }) => ({ name, role }))
}

function exportWork(work) {
  const title = chineseEditionTitle(work.title, work.localizedTitles) ?? work.title
  const aliases = [...new Set([work.title, ...work.aliases, ...work.localizedTitles.map(row => row.title)])]
    .filter(value => value && value !== title)
  const rating = work.rating
  return {
    id: work.workId, title, aliases, media: work.media.group,
    mediaLabel: mediaLabel(work.media.group, work.media.type), format: work.media.format,
    published: work.firstPublishedLabel ?? work.firstPublished,
    creators: credits(work.creators), organizations: credits(work.organizations),
    tags: work.publicTags.map(tag => tag.key),
    summary: work.summary?.text, summarySource: work.summary?.sourceUrl,
    grade: rating.grade, state: rating.state, classes: rating.classes, source: rating.decidingSource,
    rationale: rating.reasoningSummary, reviewed: rating.gradeReviewed || undefined,
    findings: rating.sourceFindings, evidence: rating.evidenceSources,
    catalog: work.sources,
    continuity: rating.continuity?.map(({ character, workId }) => ({
      character, id: release.getPublicWorkById(workId)?.workId ?? workId,
    })),
  }
}

// Read the same ordered, deduplicated catalog that powers the public works page.
const stats = release.getPublicCatalogMergeStats()
const works = []
for (let offset = 0; offset < stats.visibleWorks; offset += 100) {
  const { items } = release.getPublicWorkList({ offset, limit: 100 })
  works.push(...items.map(exportWork))
}
assert.equal(works.length, stats.visibleWorks)
assert.equal(new Set(works.map(work => work.id)).size, stats.visibleWorks)
assert.equal(works.filter(work => work.grade).length, stats.ratedVisibleWorks)

const date = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date())
const payload = {
  date, policy: RADAR_POLICY_VERSION, works,
  counts: {
    visible: stats.visibleWorks, rated: stats.ratedVisibleWorks,
    safe: works.filter(work => work.grade === 'S' || work.grade === 'A').length,
  },
  media: mediaGroupLabels, statuses: publicStatusLabels, tags: publicTagDefinitions,
  grades: release.PUBLIC_GRADES.map(code => ({
    code, label: radarGradeLabels[code], summary: radarGradeSummaries[code],
  })),
  rules: Object.fromEntries(radarClassEntries.map(([code, definition]) => [
    code, { ...definition, searchTerms: publicSearchTermsForRatingClass(code) },
  ])),
}

function template(name) {
  return readFileSync(new URL('./offline/' + name, import.meta.url), 'utf8').replaceAll('\r\n', '\n')
}

function integrity(text) {
  return 'sha256-' + createHash('sha256').update(text).digest('base64')
}

const image = readFileSync(join(root, 'public/ui/lily-bookplate.webp')).toString('base64')
const styles = template('catalog.css').replace('{{ART}}', 'data:image/webp;base64,' + image)
const script = template('catalog.js')
const sections = {
  STYLES: styles, SCRIPT: script,
  STYLES_HASH: integrity(styles), SCRIPT_HASH: integrity(script),
  DATA: JSON.stringify(payload).replaceAll('<', '\\u003c'),
}
const html = template('index.html').replace(/\{\{([A-Z_]+)\}\}/g, (_match, key) => {
  assert.ok(Object.hasOwn(sections, key), 'Unexpected offline template key ' + key)
  return sections[key]
})

mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, html)
console.log(
  'Exported ' + stats.visibleWorks + ' works, ' + stats.ratedVisibleWorks + ' ratings and ' +
    radarClassEntries.length + ' rules to ' + output,
)
