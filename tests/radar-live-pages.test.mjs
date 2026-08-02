import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const root = new URL('../', import.meta.url)
const read = (path) => fs.readFileSync(new URL(path, root), 'utf8')
const exists = (path) => fs.existsSync(new URL(path, root))

test('Radar research archive requires registration and stays read-only', () => {
  const collection = read('src/collections/RadarPublicRecords.ts')
  const indexPage = read('src/app/(frontend)/radar/page.tsx')
  const detailPage = read('src/app/(frontend)/radar/[id]/page.tsx')

  assert.match(collection, /if \(!req\.user\) return false/)
  assert.match(collection, /if \(isEditor\(req\.user\)\) return true/)
  assert.match(collection, /read: currentRegisteredOrStaff/)

  assert.match(indexPage, /if \(!auth\.user\) redirect/)
  assert.match(indexPage, /注册用户资料区/)
  assert.match(indexPage, /本页不提供任何修改入口/)
  assert.doesNotMatch(indexPage, /\/me\/studio\/radar/)

  assert.match(detailPage, /if \(!auth\.user\) redirect/)
  assert.match(detailPage, /record\.recordStatus !== 'current' && !staff/)
  assert.match(detailPage, /本页为只读资料档案/)
  assert.match(detailPage, /href=\{`\/radar\/\$\{record\.id\}\/download`\}/)
  assert.doesNotMatch(detailPage, /完整编辑研究记录|完整编辑评级|网页编辑/)
  assert.equal(exists('src/app/(frontend)/me/studio/radar/[id]/page.tsx'), false)
})

test('Radar download is editor-only and mutation-free', () => {
  const download = read('src/app/(frontend)/radar/[id]/download/route.ts')

  assert.match(download, /if \(!auth\.user\) return jsonError\('需要登录。', 401\)/)
  assert.match(download, /if \(!isEditor\(auth\.user\)\) return jsonError\('只有编辑以上权限可以下载。', 403\)/)
  assert.match(download, /Content-Disposition/)
  assert.match(download, /attachment; filename=/)
  assert.match(download, /type RecordStatus = 'current' \| 'withdrawn'/)
  assert.doesNotMatch(download, /payload\.(create|update|delete)/)
})

test('ratings are public on normal catalogue and work pages', () => {
  const ratingsPage = read('src/app/(frontend)/ratings/page.tsx')
  const projection = read('src/app/(frontend)/_components/RadarPublicProjection.tsx')
  const workDetail = read('src/app/(frontend)/works/[slug]/page.tsx')
  const home = read('src/app/(frontend)/page.tsx')
  const layout = read('src/app/(frontend)/layout.tsx')

  assert.match(ratingsPage, /作品排雷评级/)
  assert.match(ratingsPage, /recordStatus: \{ equals: 'current' \}/)
  assert.match(ratingsPage, /canonicalContentUrl\('works', rating\.workIdSnapshot\)/)
  assert.doesNotMatch(ratingsPage, /redirect\(`\/account\/login/)

  assert.match(projection, /统一评级结论/)
  assert.match(projection, /机器 \{rating\.coreGrade/)
  assert.match(projection, /浏览大众评级页/)
  assert.doesNotMatch(projection, /编辑这条 Radar 记录/)

  assert.match(workDetail, /RadarPublicProjection/)
  assert.match(workDetail, /<RadarPublicProjection workId=\{visibleItem\.recordId\} \/>/)
  assert.match(home, /href: '\/ratings'/)
  assert.match(home, /currentRadarCounts/)
  assert.match(layout, /\{ href: '\/ratings', label: '评级' \}/)
  assert.match(layout, /\{ href: '\/radar', label: '研究档案' \}/)
})
