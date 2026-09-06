import { writeFileSync } from 'node:fs'
import { loadPublicRelease } from './lib/load-public-release.mjs'

const output = process.argv[2]
if (!output) throw new Error('Usage: node scripts/export-public-creator-input.mjs <output.json>')
const release = loadPublicRelease(process.cwd())
const works = release.getPublicCreatorGraphInput()
writeFileSync(output, JSON.stringify(works) + '\n')
console.log(`Exported ${works.length} canonical public Works`)
