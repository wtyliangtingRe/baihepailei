import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

function read(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

const worksPage = read('src/app/(frontend)/works/page.tsx')
const styles = read('src/app/(frontend)/styles.css')

test('works page maps legacy AA rank to S for frontend labels and anchors', () => {
  const rankLabelBody = worksPage.match(/function rankLabel[\s\S]*?\n}/)?.[0] || ''
  const rankAnchorBody = worksPage.match(/function rankAnchor[\s\S]*?\n}/)?.[0] || ''

  assert.match(rankLabelBody, /if \(rank === 'AA'\) return 'S级'/)
  assert.match(rankLabelBody, /return `\$\{rank\}级`/)
  assert.ok(rankLabelBody.indexOf("if (rank === 'AA') return 'S级'") < rankLabelBody.indexOf('return `${rank}级`'))
  assert.match(rankAnchorBody, /if \(rank === 'AA'\) return 'rank-s'/)
})

test('works page keeps rank order, grouped sections, and rank jump navigation', () => {
  assert.match(worksPage, /const rankOrder = \['AA', 'A', 'B', 'C', 'D', 'E', 'unknown'\]/)
  assert.match(worksPage, /className="rank-jump-list"/)
  assert.match(worksPage, /id="works-rank-nav"/)
  assert.match(worksPage, /id=\{rankAnchor\(group\.rank\)\}/)
})

test('works page supports media group filters and quick links', () => {
  assert.match(worksPage, /const mediaGroupOptions = \[/)
  assert.match(worksPage, /name="media"/)
  assert.match(worksPage, /normalizeMediaGroup\(firstParam\(params\.media\)\)/)
  assert.match(worksPage, /filters\.media !== 'all'/)
  assert.match(worksPage, /className="media-group-links"/)
  assert.match(worksPage, /href=\{`\/works\?media=\$\{option\.value\}`\}/)
})

test('works page cards show media metadata and localized titles', () => {
  assert.match(worksPage, /mediaGroupLabel\(item\.mediaGroup\)/)
  assert.match(worksPage, /compactValues\(item\.localizedTitles\)/)
  assert.match(worksPage, /item\.mediaType, item\.format, item\.firstPublishedLabel/)
  assert.match(worksPage, /译名：/)
  assert.match(worksPage, /基础信息：/)
})

test('works rank groups include return links to the rank navigation', () => {
  assert.match(worksPage, /className="rank-group-actions"/)
  assert.match(worksPage, /href="#works-rank-nav"/)
  assert.match(worksPage, /返回分级导航/)
})

test('works rank navigation and grouped sections have supporting styles', () => {
  assert.match(styles, /\.rank-jump-list/)
  assert.match(styles, /\.rank-group\s*\{[\s\S]*scroll-margin-top:/)
  assert.match(styles, /\.rank-group-actions/)
  assert.match(styles, /\.media-group-links/)
  assert.match(styles, /scroll-behavior: smooth/)
})
