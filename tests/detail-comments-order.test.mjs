import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const detail = fs.readFileSync(new URL('../src/app/(frontend)/_components/DetailIndexDetail.tsx', import.meta.url), 'utf8')
const block = fs.readFileSync(new URL('../src/app/(frontend)/_components/CommentBlock.tsx', import.meta.url), 'utf8')
const css = fs.readFileSync(new URL('../src/app/(frontend)/comments.css', import.meta.url), 'utf8')
const docs = fs.readFileSync(new URL('../docs/content-callouts.md', import.meta.url), 'utf8')

test('work summary renders before retained materials', () => {
  assert.ok(detail.indexOf('<RichTextSections item={item} />') < detail.indexOf('<RelatedEvidence evidence={relatedEvidence}'))
})

test('comment block is wired into details', () => {
  assert.ok(detail.includes("import CommentBlock from './CommentBlock'"))
  assert.ok(detail.includes('<CommentBlock item={item} />'))
  assert.ok(block.includes('简易评论'))
  assert.ok(block.includes('登录后评论'))
  assert.ok(css.includes('.comment-block'))
})

test('image text callout mapping is documented', () => {
  assert.ok(docs.includes('image-text'))
  assert.ok(docs.includes('XWiki image-text example'))
})
