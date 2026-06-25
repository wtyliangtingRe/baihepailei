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

test('works rank groups include return links after the group heading', () => {
  assert.match(worksPage, /className="rank-group-actions"/)
  assert.match(worksPage, /href="#works-rank-nav"/)
  assert.match(worksPage, /返回分级导航/)
})

test('works rank navigation and grouped sections have supporting styles', () => {
  assert.match(styles, /\.rank-jump-list/)
  assert.match(styles, /\.rank-group\s*\{[\s\S]*scroll-margin-top:/)
  assert.match(styles, /\.rank-group-actions/)
  assert.match(styles, /scroll-behavior: smooth/)
})
