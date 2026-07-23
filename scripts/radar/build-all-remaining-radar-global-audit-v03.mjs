#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const source = path.join(root, 'build-all-remaining-radar-global-audit-v01.mjs')
if (!fs.existsSync(source)) throw new Error(`Missing v01 source: ${source}`)

let content = fs.readFileSync(source, 'utf8')
  .replace(/^\uFEFF/u, '')
  .replace(/\r\n?/gu, '\n')

function replaceExact(needle, replacement, expected = 1) {
  const count = content.split(needle).length - 1
  if (count !== expected) throw new Error(`Expected ${expected} occurrence(s), found ${count}: ${needle.slice(0, 160)}`)
  content = content.split(needle).join(replacement)
}

replaceExact(
  `const EXPECTED_WORKS = 35615`,
  `const EXPECTED_DRAFT_WORKS = 35615\nconst EXPECTED_PUBLISHED_WORKS = 35613`,
)

replaceExact(
  `function publicAssessmentFor(source, privatePlan) {`,
  `function publicAssessmentFor(source, privatePlan, publishedWork) {`,
)

replaceExact(
  `    workSiteId: privatePlan.target.siteId,\n    title: privatePlan.target.title,`,
  `    workSiteId: val(publishedWork?.siteId || privatePlan.target.siteId),\n    title: val(publishedWork?.title || privatePlan.target.title),`,
)

replaceExact(
  `  const works = await fetchCollection(baseUrl, token, 'works', { draft: 'true' })\n  if (works.length !== EXPECTED_WORKS) globalBlockers.push(\`payload_works_expected_\${EXPECTED_WORKS}_received_\${works.length}\`)\n  const publicConclusions = publicSchemaReady\n    ? await fetchCollection(baseUrl, token, 'radar-public-conclusions')\n    : []\n  const publicByKey = new Map(publicConclusions.map((row) => [val(row.publicationKey), row]))\n  const indexes = buildWorkIndexes(works)\n  const sourcePackageSha256 = val(sourceSummary.packageManifestSha256) || sha256File(sourceFile)`,
  `  const draftWorks = await fetchCollection(baseUrl, token, 'works', { draft: 'true' })\n  const publishedWorks = await fetchCollection(baseUrl, token, 'works', { draft: 'false' })\n  if (draftWorks.length !== EXPECTED_DRAFT_WORKS) globalBlockers.push(\`payload_draft_works_expected_\${EXPECTED_DRAFT_WORKS}_received_\${draftWorks.length}\`)\n  if (publishedWorks.length !== EXPECTED_PUBLISHED_WORKS) globalBlockers.push(\`payload_published_works_expected_\${EXPECTED_PUBLISHED_WORKS}_received_\${publishedWorks.length}\`)\n  const publicConclusions = publicSchemaReady\n    ? await fetchCollection(baseUrl, token, 'radar-public-conclusions')\n    : []\n  const publicByKey = new Map(publicConclusions.map((row) => [val(row.publicationKey), row]))\n  const indexes = buildWorkIndexes(draftWorks)\n  const draftWorkById = new Map(draftWorks.map((work) => [val(work.id), work]))\n  const publishedWorkById = new Map(publishedWorks.map((work) => [val(work.id), work]))\n  const sourcePackageSha256 = val(sourceSummary.packageManifestSha256) || sha256File(sourceFile)`,
)

replaceExact(
  `    const targetWork = privatePlan?.target?.id\n      ? works.find((work) => val(work.id) === val(privatePlan.target.id))\n      : null`,
  `    const targetWork = privatePlan?.target?.id\n      ? draftWorkById.get(val(privatePlan.target.id)) || null\n      : null\n    const publishedWork = privatePlan?.target?.id\n      ? publishedWorkById.get(val(privatePlan.target.id)) || null\n      : null`,
)

replaceExact(
  `      ...lifecycleBlockers(targetWork),`,
  `      ...lifecycleBlockers(publishedWork),`,
)

replaceExact(
  `      publicRecord = publicAssessmentFor(source, privatePlan)`,
  `      publicRecord = publicAssessmentFor(source, privatePlan, publishedWork)`,
)

replaceExact(
  `        blockers: ['discarded_test_assessment_requires_fresh_research'],\n        needsPublicationGuard: source.needsPublicationGuard === true,`,
  `        privateBlockers: ['discarded_test_assessment_requires_fresh_research'],\n        publicBlockers: ['discarded_test_assessment_requires_fresh_research'],\n        blockers: ['discarded_test_assessment_requires_fresh_research'],\n        needsPublicationGuard: source.needsPublicationGuard === true,`,
)

replaceExact(
  `      currentPublicId: currentPublicId || undefined,\n      blockers: unique([...privatePlan.blockers, ...publicBlockers]),\n      warnings: privatePlan.warnings,`,
  `      currentPublicId: currentPublicId || undefined,\n      privateBlockers: unique(privatePlan.blockers),\n      publicBlockers: unique(publicBlockers),\n      blockers: unique([...privatePlan.blockers, ...publicBlockers]),\n      warnings: privatePlan.warnings,`,
)

replaceExact(
  `      byBlocker: countBy(privateBlocked.flatMap((row) => row.blockers || []), (item) => item),`,
  `      byBlocker: countBy(privateBlocked.flatMap((row) => row.privateBlockers || []), (item) => item),`,
)

replaceExact(
  `      byBlocker: countBy(publicBlocked.flatMap((row) => row.blockers || []), (item) => item),`,
  `      byBlocker: countBy(publicBlocked.flatMap((row) => row.publicBlockers || []), (item) => item),`,
)

replaceExact(
  `      worksRead: works.length,`,
  `      worksRead: draftWorks.length,\n      draftWorksRead: draftWorks.length,\n      publishedWorksRead: publishedWorks.length,`,
)

replaceExact(
  `  console.log(\`ProductionWorksRead: \${works.length}\`)`,
  `  console.log(\`ProductionWorksRead: \${draftWorks.length}\`)\n  console.log(\`PublishedWorksRead: \${publishedWorks.length}\`)`,
)

const temporary = path.join(root, `.build-all-remaining-radar-global-audit-v03-${crypto.randomUUID()}.mjs`)
fs.writeFileSync(temporary, content, 'utf8')
try {
  const check = spawnSync(process.execPath, ['--check', temporary], { encoding: 'utf8' })
  if (check.status !== 0) throw new Error(check.stderr || check.stdout || 'Patched global audit syntax check failed.')
  const result = spawnSync(process.execPath, [temporary, ...process.argv.slice(2)], { stdio: 'inherit' })
  if (result.status !== 0) process.exitCode = result.status || 1
} finally {
  fs.rmSync(temporary, { force: true })
}
