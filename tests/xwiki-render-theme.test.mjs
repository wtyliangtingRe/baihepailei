import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const renderer = fs.readFileSync(new URL('../src/app/(frontend)/_components/RichTextRenderer.tsx', import.meta.url), 'utf8')
const layout = fs.readFileSync(new URL('../src/app/(frontend)/layout.tsx', import.meta.url), 'utf8')
const themeToggle = fs.readFileSync(new URL('../src/app/(frontend)/_components/ThemeToggle.tsx', import.meta.url), 'utf8')
const themeCss = fs.readFileSync(new URL('../src/app/(frontend)/theme.css', import.meta.url), 'utf8')
const xwikiCss = fs.readFileSync(new URL('../src/app/(frontend)/xwiki-renderer.css', import.meta.url), 'utf8')

test('rich text renderer detects and renders legacy markup text', () => {
  assert.ok(renderer.includes('function looksLikeLegacyMarkup'))
  assert.ok(renderer.includes('function renderLegacyMarkup'))
  assert.ok(renderer.includes('xwiki-rendered'))
  assert.ok(renderer.includes('xwiki-warning'))
  assert.ok(renderer.includes('xwiki-color-emphasis'))
  assert.ok(renderer.includes('wikiHref'))
})

test('legacy renderer extracts text from lexical nodes before rendering', () => {
  assert.ok(renderer.includes('function nodePlainText'))
  assert.ok(renderer.includes('function nodesPlainText'))
  assert.ok(renderer.includes('const extractedText = nodesPlainText(nodes)'))
  assert.ok(renderer.includes('if (looksLikeLegacyMarkup(extractedText)) return renderLegacyMarkup(extractedText)'))
})

test('legacy renderer strips old wrappers and supports readable blocks', () => {
  assert.ok(renderer.includes('{{warning}}'))
  assert.ok(renderer.includes('{{/warning}}'))
  assert.ok(renderer.includes('velocity'))
  assert.ok(renderer.includes('doc:名词解释'))
  assert.ok(xwikiCss.includes('.xwiki-warning'))
  assert.ok(xwikiCss.includes('.xwiki-rendered h2'))
})

test('legacy renderer supports spaced style attributes', () => {
  assert.ok(renderer.includes('style\\s*=\\s*'))
})

test('legacy renderer builds toc and collapsed sections', () => {
  assert.ok(renderer.includes('function renderLegacyToc'))
  assert.ok(renderer.includes('function splitLegacySections'))
  assert.ok(renderer.includes('function sectionStartOf'))
  assert.ok(renderer.includes('function rankTitleFromLine'))
  assert.ok(renderer.includes('className="xwiki-toc"'))
  assert.ok(renderer.includes('className="xwiki-section"'))
  assert.ok(renderer.includes('sections.length >= 4'))
  assert.ok(renderer.includes('<details'))
  assert.ok(!renderer.includes('open={index < 2}'))
})

test('legacy renderer parses rank explanation lines as sections', () => {
  assert.ok(renderer.includes('const sectionStart = entry.type === \'line\' ? sectionStartOf(entry.value, headingIndex) : null'))
  assert.ok(renderer.includes('if (sectionStart.body) current.entries.push'))
  assert.ok(renderer.includes('sections: sections.filter((section) => section.entries.length > 0)'))
  assert.ok(renderer.includes('stripHeadingMarks'))
  assert.ok(renderer.includes('removeRankPrefix'))
})

test('legacy toc and section styles are present', () => {
  assert.ok(xwikiCss.includes('.xwiki-toc'))
  assert.ok(xwikiCss.includes('.xwiki-section'))
  assert.ok(xwikiCss.includes('.xwiki-section-body'))
  assert.ok(xwikiCss.includes('.xwiki-section summary span'))
  assert.ok(xwikiCss.includes('[data-theme=\'light\'] .xwiki-section'))
})

test('theme toggle is wired into the frontend layout', () => {
  assert.ok(layout.includes("import ThemeToggle from './_components/ThemeToggle'"))
  assert.ok(layout.includes('<ThemeToggle />'))
  assert.ok(layout.includes("import './theme.css'"))
  assert.ok(layout.includes("import './xwiki-renderer.css'"))
})

test('theme toggle persists light and dark modes', () => {
  assert.ok(themeToggle.includes("'use client'"))
  assert.ok(themeToggle.includes('localStorage'))
  assert.ok(themeToggle.includes('dataset.theme'))
  assert.ok(themeToggle.includes('白天模式'))
  assert.ok(themeToggle.includes('夜间模式'))
})

test('light theme overrides common dark UI surfaces', () => {
  assert.ok(themeCss.includes("[data-theme='light'] body"))
  assert.ok(themeCss.includes("[data-theme='light'] .detail-card"))
  assert.ok(themeCss.includes("[data-theme='light'] .rich-text"))
  assert.ok(themeCss.includes("[data-theme='light'] .search-box input"))
})
