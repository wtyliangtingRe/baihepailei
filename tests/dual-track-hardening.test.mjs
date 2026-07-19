import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const exists = (file) => fs.existsSync(path.join(root, file))

const roles = read('src/access/roles.ts')
assert.match(roles, /Role = 'owner' \| 'admin' \| 'editor' \| 'member'/u)
assert.doesNotMatch(roles, /role === 'reviewer'|role === 'trusted'/u)

for (const collection of ['Rules', 'Tags', 'Terms', 'Warnings']) {
  assert.doesNotMatch(read(`src/collections/${collection}.ts`), /trustedAndUp/u)
}

const config = read('payload.config.ts')
assert.match(config, /STEWARDSHIP_NOTICES_SCHEMA_READY.*'true'/u)
assert.match(config, /AuditEvents/u)

const works = read('src/collections/Works.ts')
assert.match(works, /name: 'humanAssessment'/u)
assert.doesNotMatch(works, /legacyXWikiPage/u)
assert.match(read('src/lib/ratingTracks.ts'), /status !== 'pending'/u)
assert.match(read('src/lib/audit.ts'), /auditActorID/u)
const detailExport = read('scripts/export/build-lite-detail-index.mjs')
assert.doesNotMatch(detailExport, /legacyXWikiPage/u)
const users = read('src/collections/Users.ts')
assert.match(users, /requestedRole\(original\.role\)/u)

const comments = read('src/collections/Comments.ts')
assert.match(comments, /comment_rate_limited/u)
assert.match(comments, /reportCount/u)
assert.match(comments, /comment\.created/u)
assert(exists('src/app/(frontend)/api/comments/[id]/report/route.ts'))

const detail = read('src/app/(frontend)/works/[slug]/page.tsx')
assert.match(detail, /preview.*=== '1'/u)
assert.doesNotMatch(detail, /'reviewer'/u)

assert(exists('src/collections/AuditEvents.ts'))
assert(exists('src/lib/audit.ts'))
assert(exists('src/lib/ratingTracks.ts'))
assert(exists('src/app/(frontend)/me/studio/entities/[collection]/page.tsx'))
assert(exists('src/app/(frontend)/me/studio/entities/[collection]/[id]/page.tsx'))
assert(!exists('src/app/(frontend)/xwiki-renderer.css'))
assert.doesNotMatch(read('src/app/(frontend)/layout.tsx'), /xwiki-renderer/u)

console.log('dual-track-hardening: ok')
