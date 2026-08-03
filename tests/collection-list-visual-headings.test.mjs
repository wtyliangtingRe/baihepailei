import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const root = new URL('../', import.meta.url)

const read = (relativePath) =>
  fs.readFileSync(new URL(relativePath, root), 'utf8')

test('works creators and organizations list pages use the restored visual UI', () => {
  const works = read(
    'src/app/(frontend)/works/page.tsx',
  )

  const collectionIndex = read(
    'src/app/(frontend)/_components/CollectionIndexPage.tsx',
  )

  const creators = read(
    'src/app/(frontend)/creators/page.tsx',
  )

  const organizations = read(
    'src/app/(frontend)/organizations/page.tsx',
  )

  const visualCss = read(
    'src/app/(frontend)/ui-visual-assets.css',
  )

  assert.match(
    works,
    /page-heading collection-heading site-guide-heading/,
  )

  assert.match(
    works,
    /collection-card work-card work-title-only-card/,
  )

  assert.match(
    collectionIndex,
    /visualHeading\?: boolean/,
  )

  assert.match(
    collectionIndex,
    /visualHeading = false/,
  )

  assert.match(
    collectionIndex,
    /visualHeading \? ' site-guide-heading' : ''/,
  )

  assert.match(
    collectionIndex,
    /collection-grid collection-grid-compact/,
  )

  assert.match(
    collectionIndex,
    /collection-card collection-card-compact/,
  )

  assert.match(creators, /visualHeading/)
  assert.match(organizations, /visualHeading/)

  assert.match(
    visualCss,
    /\.site-guide-heading::before/,
  )

  assert.match(
    visualCss,
    /hero-site-guide\.webp/,
  )

  assert.match(
    visualCss,
    /\.work-title-only-card/,
  )
})
