import assert from 'node:assert/strict'
import test from 'node:test'
import { loadPublicModule } from '../scripts/lib/load-public-release.mjs'

const root = process.cwd()
const { addPublicMetadata } = loadPublicModule(root, 'src/lib/publicMetadata.ts')
const { collectWorkReferences, referencePurpose } = loadPublicModule(root, 'src/lib/publicWorkReferences.ts')

test('empty metadata never erases descriptions, title details or credit evidence', () => {
  const original = { workId: '1', title: '作品', aliases: ['旧别名'], localizedTitles: [{ title: 'Title', language: 'en', kind: 'official' }],
    media: { group: 'manga', type: 'manga', format: '连载' }, firstPublished: '2020', firstPublishedPrecision: 'year',
    creators: [{ name: '作者', role: '原作', sourceUrl: 'https://example.org/old' }], organizations: [],
    sources: [{ title: '原始依据', url: 'https://example.org/old', tier: '1' }],
    summary: { kind: 'source_summary', text: '已经核实的简短介绍。', sourceUrl: 'https://example.org/old' }, rating: {} }
  const result = addPublicMetadata(original, [{ workId: '1', aliases: [' '], localizedTitles: [{ title: 'Title', language: '', kind: undefined }],
    creators: [{ name: '作者', role: '原作', sourceUrl: '' }], organizations: [], format: ' ',
    sources: [{ title: '', url: 'https://example.org/old', tier: '' }], summary: { kind: 'source_summary', text: ' ' } }])
  assert.equal(result.localizedTitles[0].language, 'en')
  assert.equal(result.localizedTitles[0].kind, 'official')
  assert.equal(result.creators[0].sourceUrl, 'https://example.org/old')
  assert.equal(result.sources[0].title, '原始依据')
  assert.equal(result.sources[0].tier, '1')
  assert.equal(result.summary.text, original.summary.text)
  assert.equal(result.media.format, '连载')
  assert.equal(result.firstPublished, '2020')
  assert.ok(result.aliases.includes('旧别名'))
})

test('references deduplicate evidence and do not turn encyclopedia or publisher pages into stores', () => {
  const work = { creators: [{ name: '作者', role: '作者', sourceUrl: 'https://bgm.tv/subject/1' }], organizations: [],
    summary: { sourceUrl: 'https://bgm.tv/subject/1' }, rating: { evidenceUrl: 'https://bgm.tv/subject/1' },
    sources: [{ title: '百科', url: 'https://bgm.tv/subject/1' }, { title: '游戏', url: 'https://store.steampowered.com/app/123/' },
      { title: 'unsafe', url: 'javascript:alert(1)' }] }
  const references = collectWorkReferences(work)
  assert.equal(references.length, 2)
  assert.equal(references[0].usages.length, 3)
  assert.equal(references[0].purpose, '资料来源')
  assert.equal(references[1].purpose, '购买 / 游玩 · Steam')
  assert.equal(referencePurpose('https://store.steampowered.com.evil.example/app/123'), '资料来源')
  assert.equal(referencePurpose('https://store.steampowered.com/developer/example'), '资料来源')
})
