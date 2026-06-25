import { spawnSync } from 'node:child_process'

const suites = [
  ['frontend-polish', ['node', '--test', 'tests/frontend-polish.test.mjs']],
  ['frontend-expanded-polish', ['node', '--test', 'tests/frontend-expanded-polish.test.mjs']],
  ['works-rank', ['node', '--test', 'tests/works-rank-page.test.mjs']],
  ['search-utils', ['node', '--test', 'tests/search-utils.test.mjs']],
]

for (const [name, command] of suites) {
  console.log(`\n▶ ${name}`)
  const [bin, ...args] = command
  const result = spawnSync(bin, args, { stdio: 'inherit', shell: process.platform === 'win32' })

  if (result.status !== 0) {
    process.exit(result.status || 1)
  }
}
