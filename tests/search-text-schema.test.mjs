import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

function read(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

const collectionPaths = [
  'src/collections/Works.ts',
  'src/collections/Creators.ts',
  'src/collections/Terms.ts',
  'src/collections/Rules.ts',
]

function searchTextFieldBlock(source) {
  const searchTextPosition = source.indexOf("name: 'searchText'")
  assert.notEqual(searchTextPosition, -1)

  const nextFieldPosition = source.indexOf("\n    {", searchTextPosition + 1)
  return nextFieldPosition === -1 ? source.slice(searchTextPosition) : source.slice(searchTextPosition, nextFieldPosition)
}

test('searchText fields are long text fields without btree indexes', () => {
  for (const path of collectionPaths) {
    const source = read(path)
    const block = searchTextFieldBlock(source)

    assert.match(block, /type: 'textarea'/, `${path} searchText should stay as textarea`)
    assert.doesNotMatch(block, /index:\s*true/, `${path} searchText must not use btree index`)
  }
})
