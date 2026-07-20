import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const editor = read('src/app/(frontend)/me/studio/works/[id]/page.tsx')
const layout = read('src/app/(frontend)/me/studio/works/[id]/layout.tsx')
const publishBar = read('src/app/(frontend)/me/studio/works/[id]/StudioPublishBar.tsx')
const publishCss = read('src/app/(frontend)/me/studio/works/[id]/StudioPublishBar.module.css')
const editorCss = read('src/app/(frontend)/review-editor.css')

test('every work editor inserts publishing actions into the existing sticky save footer', () => {
  assert.match(layout, /StudioPublishBar/u)
  assert.match(layout, /<StudioPublishBar \/>/u)
  assert.match(publishBar, /createPortal/u)
  assert.match(publishBar, /form\.review-editor-form \.review-editor-submit/u)
  assert.match(publishBar, /oldSubmit\.hidden = true/u)
  assert.match(publishBar, /保存与发布/u)
  assert.match(publishBar, /保存为草稿/u)
  assert.match(publishBar, /保存当前设置/u)
  assert.match(publishBar, /保存并发布/u)
  assert.match(publishBar, /form\.requestSubmit\(\)/u)
  assert.match(editorCss, /\.review-editor-submit[\s\S]*position: sticky/u)
  assert.doesNotMatch(publishCss, /top:\s*12px/u)
})

test('publish action activates and exposes the work without hidden switch combinations', () => {
  assert.match(publishBar, /setSelect\(form, '_status', 'published'\)/u)
  assert.match(publishBar, /setSelect\(form, 'catalogStatus', 'active'\)/u)
  assert.match(publishBar, /setCheckbox\(form, 'isLiteVisible', true\)/u)
  assert.match(publishBar, /setCheckbox\(form, 'isFullVisible', true\)/u)
  assert.match(publishBar, /保存并发布会把作品设为正常目录、已发布/u)
})

test('draft action always removes public visibility while retaining the advanced editor fields', () => {
  assert.match(publishBar, /setSelect\(form, '_status', 'draft'\)/u)
  assert.match(publishBar, /setCheckbox\(form, 'isLiteVisible', false\)/u)
  assert.match(publishBar, /setCheckbox\(form, 'isFullVisible', false\)/u)
  assert.match(editor, /name="_status"/u)
  assert.match(editor, /name="catalogStatus"/u)
  assert.match(editor, /name="isLiteVisible"/u)
  assert.match(editor, /name="isFullVisible"/u)
})
