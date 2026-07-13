import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const workspaceConfig = readFileSync('pnpm-workspace.yaml', 'utf8')

test('pnpm v11 build approvals use allowBuilds', () => {
  assert.doesNotMatch(workspaceConfig, /onlyBuiltDependencies/u)
  assert.match(workspaceConfig, /allowBuilds:\s*[\s\S]*esbuild:\s*true/u)
  assert.match(workspaceConfig, /allowBuilds:\s*[\s\S]*sharp:\s*true/u)
})
