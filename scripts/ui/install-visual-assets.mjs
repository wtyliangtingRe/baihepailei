#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import sharp from 'sharp'

function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) args[key] = true
    else {
      args[key] = next
      index += 1
    }
  }
  return args
}

const args = parseArgs(process.argv.slice(2))
const inputDir = path.resolve(String(args.input || 'data_local/uipic'))
const outputDir = path.resolve(String(args.output || 'public/ui'))
const quality = Math.min(95, Math.max(60, Number(args.quality || 84)))

const assetFiles = {
  heroHome: '首页 Hero 主视觉横幅.png',
  coverFloral: '默认封面占位图（主系列）.png',
  coverRadar: '默认封面占位图（主系列） (2).png',
  coverRestricted: '默认封面占位图（成人限制展示版）.png',
  emptySearch: '搜索无结果空状态图.png',
  heroGuide: '站点说明页头图.png',
  noticeReview: 'ChatGPT Image 2026年7月12日 01_38_42 (1).png',
  noticeConflict: 'ChatGPT Image 2026年7月12日 01_38_42 (2).png',
  noticeRisk: 'ChatGPT Image 2026年7月12日 01_38_42 (3).png',
  noticeSourceConflict: 'ChatGPT Image 2026年7月12日 01_38_42 (4).png',
  noticeInsufficient: 'ChatGPT Image 2026年7月12日 01_38_42 (5).png',
  noticeRestricted: 'ChatGPT Image 2026年7月12日 01_38_42 (6).png',
  heroSearch: '搜索页顶部轻装饰背景.png',
  rankSheet: '等级徽章.png',
  noticeIconSheet: '站点说明缩略小图标.png',
}

const noticeTemplateIds = [
  'terminology-page',
  'ongoing-page',
  'neutral-stance',
  'creator-visited',
  'final-adjudication',
  'no-hype',
  'info-insufficient',
  'external-source-pending-review',
  'ai-synthesized-pending-review',
  'identity-conflict',
  'needs-radar',
  'heavy-radar-warning',
  'high-risk-radar-warning',
  'adult-visibility-warning',
  'ideology-discomfort-warning',
]

const gradeNames = ['s', 'a', 'b', 'c', 'd', 'e', 'f', 'x']

function sourcePath(key) {
  const file = assetFiles[key]
  const resolved = path.join(inputDir, file)
  if (!fs.existsSync(resolved)) throw new Error(`Missing UI source asset: ${resolved}`)
  return resolved
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

async function writeWebp(key, relativeOutput, { width, height, fit = 'inside', position = 'centre' } = {}) {
  const output = path.join(outputDir, relativeOutput)
  ensureDir(path.dirname(output))
  let pipeline = sharp(sourcePath(key)).rotate()
  if (width || height) {
    pipeline = pipeline.resize({ width, height, fit, position, withoutEnlargement: true })
  }
  await pipeline.webp({ quality, alphaQuality: 90, smartSubsample: true }).toFile(output)
  return relativeOutput.replaceAll('\\', '/')
}

async function cropRankBadges() {
  const input = sourcePath('rankSheet')
  const metadata = await sharp(input).metadata()
  const scaleX = Number(metadata.width || 1055) / 1055
  const scaleY = Number(metadata.height || 1491) / 1491
  const outputs = []

  for (let index = 0; index < gradeNames.length; index += 1) {
    const grade = gradeNames[index]
    const left = Math.round(75 * scaleX)
    const top = Math.round((85 + index * 171) * scaleY)
    const width = Math.round(255 * scaleX)
    const height = Math.round(145 * scaleY)
    const relativeOutput = `ranks/rank-${grade}.webp`
    const output = path.join(outputDir, relativeOutput)
    ensureDir(path.dirname(output))
    await sharp(input)
      .extract({ left, top, width, height })
      .resize({ width: 360, fit: 'inside', withoutEnlargement: false })
      .webp({ quality: 90, alphaQuality: 90 })
      .toFile(output)
    outputs.push(relativeOutput)
  }

  return outputs
}

async function cropNoticeIcons() {
  const input = sourcePath('noticeIconSheet')
  const metadata = await sharp(input).metadata()
  const scaleX = Number(metadata.width || 1536) / 1536
  const scaleY = Number(metadata.height || 1024) / 1024
  const outputs = []

  for (let index = 0; index < noticeTemplateIds.length; index += 1) {
    const column = index % 5
    const row = Math.floor(index / 5)
    const left = Math.round((8 + column * 307) * scaleX)
    const top = Math.round((96 + row * 330) * scaleY)
    const width = Math.round(288 * scaleX)
    const height = Math.round(226 * scaleY)
    const id = noticeTemplateIds[index]
    const relativeOutput = `notices/${id}.webp`
    const output = path.join(outputDir, relativeOutput)
    ensureDir(path.dirname(output))
    await sharp(input)
      .extract({ left, top, width, height })
      .resize({ width: 320, height: 252, fit: 'contain', background: { r: 6, g: 5, b: 18, alpha: 1 } })
      .webp({ quality: 88, alphaQuality: 90 })
      .toFile(output)
    outputs.push(relativeOutput)
  }

  return outputs
}

async function main() {
  ensureDir(outputDir)

  const outputs = []
  outputs.push(await writeWebp('heroHome', 'hero-home.webp', { width: 1920 }))
  outputs.push(await writeWebp('coverFloral', 'covers/placeholder-floral.webp', { width: 760 }))
  outputs.push(await writeWebp('coverRadar', 'covers/placeholder-radar.webp', { width: 760 }))
  outputs.push(await writeWebp('coverRestricted', 'covers/placeholder-restricted.webp', { width: 760 }))
  outputs.push(await writeWebp('emptySearch', 'empty-search.webp', { width: 920 }))
  outputs.push(await writeWebp('heroGuide', 'hero-site-guide.webp', { width: 1920 }))
  outputs.push(await writeWebp('heroSearch', 'hero-search.webp', { width: 1920 }))

  const featureNoticeAssets = [
    ['noticeReview', 'notices/feature-ai-synthesized-pending-review.webp'],
    ['noticeConflict', 'notices/feature-neutral-stance.webp'],
    ['noticeRisk', 'notices/feature-heavy-radar-warning.webp'],
    ['noticeSourceConflict', 'notices/feature-identity-conflict.webp'],
    ['noticeInsufficient', 'notices/feature-info-insufficient.webp'],
    ['noticeRestricted', 'notices/feature-adult-visibility-warning.webp'],
  ]

  for (const [key, relativeOutput] of featureNoticeAssets) {
    outputs.push(await writeWebp(key, relativeOutput, { width: 900 }))
  }

  outputs.push(...await cropRankBadges())
  outputs.push(...await cropNoticeIcons())

  const manifest = {
    generatedAt: new Date().toISOString(),
    inputDir: path.relative(process.cwd(), inputDir).replaceAll('\\', '/'),
    outputDir: path.relative(process.cwd(), outputDir).replaceAll('\\', '/'),
    quality,
    assetCount: outputs.length,
    assets: outputs,
  }

  fs.writeFileSync(path.join(outputDir, 'asset-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify(manifest, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
