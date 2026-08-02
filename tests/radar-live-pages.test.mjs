import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('public Radar pages stay live, current-only for visitors, and staff-editable', () => {
  const indexPage = read('src/app/(frontend)/radar/page.tsx')
  const detailPage = read('src/app/(frontend)/radar/[id]/page.tsx')
  const projection = read('src/app/(frontend)/_components/RadarPublicProjection.tsx')

  assert.match(indexPage, /export const dynamic = 'force-dynamic'/)
  assert.match(indexPage, /recordStatus: \{ equals: filters\.status \}/)
  assert.match(indexPage, /const staff = isEditor\(auth\.user\)/)
  assert.match(indexPage, /recordStatus: \{ equals: filters\.status \}/)
  assert.match(indexPage, /href=\{`\/me\/studio\/radar\/\$\{record\.id\}`\}/)

  assert.match(detailPage, /record\.recordStatus !== 'current' && !staff/)
  assert.match(detailPage, /isEditor\(auth\.user\)/)
  assert.match(detailPage, /完整编辑研究记录/)
  assert.match(detailPage, /完整编辑评级/)

  assert.match(projection, /recordStatus: \{ equals: 'current' \}/)
  assert.match(projection, /编辑这条 Radar 记录/)
})

test('first-party Radar editor is permission-gated and has no delete path', () => {
  const studio = read('src/app/(frontend)/me/studio/radar/[id]/page.tsx')

  assert.match(studio, /if \(!isEditor\(auth\.user\)\)/)
  assert.match(studio, /collection: 'radar-public-records'/)
  assert.match(studio, /collection: 'radar-public-ratings'/)
  assert.match(studio, /所有保存仍通过 Payload 集合权限与审计钩子/)
  assert.doesNotMatch(studio, /payload\.delete/)
})

test('works, home, and navigation expose the live Radar projection', () => {
  const workDetail = read('src/app/(frontend)/works/[slug]/page.tsx')
  const home = read('src/app/(frontend)/page.tsx')
  const layout = read('src/app/(frontend)/layout.tsx')

  assert.match(workDetail, /RadarPublicProjection/)
  assert.match(workDetail, /<RadarPublicProjection workId=\{visibleItem\.recordId\} \/>/)
  assert.match(home, /href: '\/radar'/)
  assert.match(home, /currentRadarCount/)
  assert.match(layout, /\{ href: '\/radar', label: 'Radar' \}/)
  assert.match(layout, /import '\.\/radar\.css'/)
})
