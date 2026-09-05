import { mkdtempSync, mkdirSync, copyFileSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

// Run manually with the account owner's gh login. No private repository files
// outside this explicit allowlist can enter the new public repository.
const repository = process.argv[2]
if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(repository || '') ||
    ['baihepailei','baihepailei-research-data'].includes(repository.split('/')[1])) {
  throw new Error('Usage: node scripts/create-public-feedback-repo.mjs OWNER/NEW-PUBLIC-FEEDBACK-REPO')
}
function run(command, args, cwd, capture = false) {
  const result = spawnSync(command, args, { cwd, encoding:'utf8', stdio:capture ? 'pipe' : 'inherit', shell:false })
  if (result.error || result.status !== 0) throw new Error(`${command} failed; stop and inspect the preceding error`)
  return result.stdout
}
run('gh',['auth','status'])
const owner = JSON.parse(run('gh',['api','user'],undefined,true)).login
if (owner.toLowerCase() !== repository.split('/')[0].toLowerCase()) throw new Error('Create this repository under the authenticated personal account')
const source = resolve(dirname(fileURLToPath(import.meta.url)), '../deploy/github-feedback')
const files = ['README.md','CONTRIBUTING.md','.github/ISSUE_TEMPLATE/config.yml',
  '.github/ISSUE_TEMPLATE/work-correction.yml','.github/ISSUE_TEMPLATE/new-work.yml']
for (const file of files) if (!existsSync(join(source,file))) throw new Error(`Missing public template: ${file}`)
const staging = mkdtempSync(join(tmpdir(),'baihepailei-public-feedback-'))
for (const file of files) { mkdirSync(dirname(join(staging,file)),{recursive:true}); copyFileSync(join(source,file),join(staging,file)) }
run('git',['init','-b','main'],staging)
run('git',['add','--',...files],staging)
run('git',['commit','-m','Initialize public-only feedback forms'],staging)
// If the repository already exists GitHub refuses creation; never repurpose it.
run('gh',['repo','create',repository,'--public','--description','百合排雷：公开待核实投稿与图片证据','--disable-wiki'],staging)
// Disable execution before pushing templates. No workflows or secrets are copied.
run('gh',['api',`repos/${repository}/actions/permissions`,'--method','PUT','-F','enabled=false'],staging)
run('git',['remote','add','origin',`https://github.com/${repository}.git`],staging)
run('git',['push','-u','origin','main'],staging)
console.log(`Set NEXT_PUBLIC_FEEDBACK_ISSUE_URL=https://github.com/${repository}/issues/new and rebuild the website.`)
console.log(`Public-only source copy: ${staging}`)
