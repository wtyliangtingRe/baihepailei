import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const CONFIRM = 'RECONCILE-ISOLATED-RADAR-PUBLIC-DEV-SCHEMA-V02'
const EXPECTED_BRANCH = 'agent/radar-unified-release-lab-0575-v01'
const HISTORICAL_BASELINE = '20260723_141905_current_schema_baseline_before_radar_public_v01'
const HISTORICAL_MIGRATION = '20260723_141908_radar_public_conclusions_v01'
const RECORDS_BASELINE = '20260801_101546_current_schema_baseline_before_radar_public_records_v01'
const RECORDS_MIGRATION = '20260801_101551_radar_public_records_v01'
const RATINGS_MIGRATION = '20260802_030535_radar_public_ratings_v01'
const FACT_VALUE_TEXT_MIGRATION = '20260802_045057_radar_public_record_fact_value_text_v01'
const EVIDENCE_ROLE_MIGRATION = '20260802_062015_radar_public_record_evidence_role_v01'
const FORMAL_MIGRATIONS = [
  '20260718_072813_existing_schema_baseline_v01',
  '20260718_072843_stewardship_notices_v01',
  HISTORICAL_BASELINE,
  HISTORICAL_MIGRATION,
  RECORDS_BASELINE,
  RECORDS_MIGRATION,
  RATINGS_MIGRATION,
  FACT_VALUE_TEXT_MIGRATION,
  EVIDENCE_ROLE_MIGRATION,
]
const OLD_RADAR_TABLES = [
  'radar_public',
  'radar_public_review_reasons',
  'radar_public_radar_assessment_matched_rules',
  'radar_public_radar_assessment_contradictions',
]

function fail(message) { throw new Error(message) }

function parseArgs(argv) {
  const values = new Map()
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key?.startsWith('--') || !value || value.startsWith('--')) fail(`Invalid argument near ${key}`)
    values.set(key, value)
    index += 1
  }
  return {
    environmentFile: values.get('--environment-file'),
    expectedWebsiteHead: values.get('--expected-website-head'),
    outDir: values.get('--out-dir'),
    confirm: values.get('--confirm'),
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    windowsHide: true,
  })
  if (options.stdoutPath) writeFileSync(options.stdoutPath, result.stdout ?? '', 'utf8')
  if (options.stderrPath) writeFileSync(options.stderrPath, result.stderr ?? '', 'utf8')
  if (result.error) throw result.error
  if (result.status !== 0) fail(`${options.label ?? command} failed (${result.status}): ${String(result.stderr ?? '').trim()}`)
  return String(result.stdout ?? '')
}

function normalizedLines(text) {
  return String(text).split(/\r?\n/u).map((line) => line.trimEnd()).filter(Boolean)
}

function assertExactLines(actualText, expectedLines, label) {
  const actual = normalizedLines(actualText)
  const expected = [...expectedLines].sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${label} mismatch:\nactual=${actual.join(', ')}\nexpected=${expected.join(', ')}`)
  }
}

function sha256(value) { return createHash('sha256').update(value).digest('hex') }

function normalizeDump(text) {
  return String(text)
    .replace(/\r\n/gu, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => {
      const trimmed = line.trim()
      return trimmed
        && !trimmed.startsWith('--')
        && !trimmed.startsWith('\\restrict ')
        && !trimmed.startsWith('\\unrestrict ')
        && !trimmed.startsWith('SET ')
        && !trimmed.startsWith('SELECT pg_catalog.set_config')
    })
    .join('\n') + '\n'
}

const args = parseArgs(process.argv.slice(2))
if (!args.environmentFile || !args.expectedWebsiteHead || !args.outDir || args.confirm !== CONFIRM) fail('Missing reconciliation arguments.')
if (!/^[a-f0-9]{40}$/u.test(args.expectedWebsiteHead)) fail('Invalid website commit.')

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const environmentPath = realpathSync(resolve(args.environmentFile))
const outDir = resolve(args.outDir)
const allowedRoot = resolve(repoRoot, 'data_local', 'outputs', 'radar-unified-release-lab-0575-v01')
const relativeOut = relative(allowedRoot, outDir)
if (relativeOut === '..' || relativeOut.startsWith(`..${sep}`) || isAbsolute(relativeOut)) fail('Output must remain under unified lab data_local.')
mkdirSync(outDir, { recursive: true })

const lab = JSON.parse(readFileSync(environmentPath, 'utf8'))
if (lab.schemaVersion !== 'radar-unified-release-lab-environment-0575-v01') fail('Lab environment version mismatch.')
if (lab.websiteCommit !== args.expectedWebsiteHead) fail('Lab website commit mismatch.')
if (lab.sourceDatabaseWrite !== false || lab.sourcePostcheckPassed !== true || lab.isolatedRestorePassed !== true) fail('Source-readonly proof missing.')
if (!/^baihepailei-radar-unified-release-lab-[0-9]{8}-[0-9]{6}$/u.test(String(lab.labContainer))) fail('Unsafe lab container name.')
if (lab.labDatabase !== 'radar_unified_release_lab' || lab.labUser !== 'radar_lab') fail('Unexpected lab database identity.')
if (!Number.isInteger(Number(lab.labPort)) || Number(lab.labPort) < 31000 || Number(lab.labPort) > 31999) fail('Unexpected lab database port.')
if (!/^postgresql:\/\/radar_lab:[a-f0-9]+@127\.0\.0\.1:31[0-9]{3}\/radar_unified_release_lab$/u.test(String(lab.databaseUrl))) fail('Unsafe lab database URL.')

const head = run('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, label: 'read local head' }).trim()
const remoteHead = run('git', ['rev-parse', `origin/${EXPECTED_BRANCH}`], { cwd: repoRoot, label: 'read remote head' }).trim()
if (head !== args.expectedWebsiteHead || remoteHead !== args.expectedWebsiteHead) fail(`Branch head mismatch: ${head} / ${remoteHead}`)

const running = run('docker', ['inspect', '-f', '{{.State.Running}}', String(lab.labContainer)], { cwd: repoRoot }).trim()
if (running !== 'true') fail('Disposable PostgreSQL is not running.')

const psql = (database, sql, options = {}) => run('docker', [
  'exec', '-e', `PGPASSWORD=${lab.labPassword}`, String(lab.labContainer),
  'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', String(lab.labUser), '-d', database, '-c', sql,
], { cwd: repoRoot, ...options })

const migrationRowsSql = `SELECT name || E'\\t' || batch::text FROM public.payload_migrations ORDER BY name, batch;`
assertExactLines(psql(String(lab.labDatabase), migrationRowsSql), [
  '20260718_072813_existing_schema_baseline_v01\t1',
  '20260718_072843_stewardship_notices_v01\t1',
  'dev\t-1',
], 'pre-reconciliation migrations')

const objectGate = psql(String(lab.labDatabase), `
SELECT concat_ws(E'\\t',
  ${OLD_RADAR_TABLES.map((name) => `COALESCE(to_regclass('public.${name}')::text, '')`).join(',\n  ')},
  COALESCE(to_regclass('public.radar_public_records')::text, ''),
  COALESCE(to_regclass('public.radar_public_ratings')::text, '')
);`).replace(/\r?\n$/u, '')
const expectedGate = `${OLD_RADAR_TABLES.join('\t')}\t\t`
if (objectGate !== expectedGate) fail(`Legacy/new schema gate mismatch: ${objectGate}`)

const referenceDatabase = `radar_unified_reference_${Date.now().toString(36)}`
let referenceCreated = false
let reconciled = false
try {
  psql('postgres', `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${lab.labDatabase}' AND pid <> pg_backend_pid();`)
  run('docker', [
    'exec', '-e', `PGPASSWORD=${lab.labPassword}`, String(lab.labContainer),
    'createdb', '-U', String(lab.labUser), '-T', String(lab.labDatabase), referenceDatabase,
  ], { cwd: repoRoot, label: 'create reference database' })
  referenceCreated = true

  const setupReference = `
BEGIN;
${OLD_RADAR_TABLES.map((name) => `DROP TABLE IF EXISTS public.${name} CASCADE;`).join('\n')}
DO $$
DECLARE item record;
BEGIN
  FOR item IN
    SELECT typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND typname LIKE 'enum_radar_public%'
      AND typname NOT LIKE 'enum_radar_public_records%'
      AND typname NOT LIKE 'enum_radar_public_ratings%'
  LOOP EXECUTE format('DROP TYPE IF EXISTS public.%I CASCADE', item.typname); END LOOP;
END $$;
DELETE FROM public.payload_migrations WHERE name = 'dev' AND batch = -1;
INSERT INTO public.payload_migrations (name, batch, updated_at, created_at)
SELECT name, 1, now(), now()
FROM (VALUES ('${RECORDS_BASELINE}'), ('${RECORDS_MIGRATION}'), ('${RATINGS_MIGRATION}'), ('${FACT_VALUE_TEXT_MIGRATION}'), ('${EVIDENCE_ROLE_MIGRATION}')) AS wanted(name)
WHERE NOT EXISTS (SELECT 1 FROM public.payload_migrations p WHERE p.name = wanted.name);
COMMIT;`
  psql(referenceDatabase, setupReference, {
    label: 'prepare reference migration state',
    stdoutPath: join(outDir, 'reference-setup-stdout.txt'),
    stderrPath: join(outDir, 'reference-setup-stderr.txt'),
  })

  const referenceUrl = new URL(String(lab.databaseUrl))
  referenceUrl.pathname = `/${referenceDatabase}`
  const command = process.platform === 'win32'
    ? { executable: process.env.ComSpec || 'cmd.exe', argv: ['/d', '/s', '/c', 'pnpm.cmd payload migrate'] }
    : { executable: 'pnpm', argv: ['payload', 'migrate'] }
  run(command.executable, command.argv, {
    cwd: repoRoot,
    label: 'run formal migrations in reference database',
    env: {
      ...process.env,
      DATABASE_URL: referenceUrl.toString(),
      PAYLOAD_DB_PUSH: 'false',
      STEWARDSHIP_NOTICES_SCHEMA_READY: 'true',
      RADAR_PUBLIC_CONCLUSIONS_SCHEMA_READY: 'true',
      RADAR_PUBLIC_RECORDS_SCHEMA_READY: 'true',
      RADAR_PUBLIC_RATINGS_SCHEMA_READY: 'true',
    },
    stdoutPath: join(outDir, 'reference-payload-migrate-stdout.txt'),
    stderrPath: join(outDir, 'reference-payload-migrate-stderr.txt'),
  })

  assertExactLines(psql(referenceDatabase, migrationRowsSql), FORMAL_MIGRATIONS.map((name) => {
    const batch = name.startsWith('20260723') ? 2 : 1
    return `${name}\t${batch}`
  }), 'reference migrations')

  const dumpArgs = (database) => [
    'exec', '-e', `PGPASSWORD=${lab.labPassword}`, String(lab.labContainer),
    'pg_dump', '--schema-only', '--quote-all-identifiers', '--no-owner',
    '-U', String(lab.labUser), '-d', database,
    ...OLD_RADAR_TABLES.flatMap((name) => ['--table', `public.${name}`]),
  ]
  const actualDump = normalizeDump(run('docker', dumpArgs(String(lab.labDatabase)), { cwd: repoRoot, label: 'dump actual legacy schema' }))
  const referenceDump = normalizeDump(run('docker', dumpArgs(referenceDatabase), { cwd: repoRoot, label: 'dump reference legacy schema' }))
  writeFileSync(join(outDir, 'legacy-radar-actual.sql'), actualDump, 'utf8')
  writeFileSync(join(outDir, 'legacy-radar-reference.sql'), referenceDump, 'utf8')
  const actualHash = sha256(actualDump)
  const referenceHash = sha256(referenceDump)
  if (actualDump !== referenceDump) {
    const actualLines = actualDump.split('\n')
    const referenceLines = referenceDump.split('\n')
    const differences = []
    for (let index = 0; index < Math.max(actualLines.length, referenceLines.length) && differences.length < 100; index += 1) {
      if (actualLines[index] !== referenceLines[index]) differences.push(`line ${index + 1}\nactual: ${actualLines[index] ?? '<missing>'}\nreference: ${referenceLines[index] ?? '<missing>'}`)
    }
    writeFileSync(join(outDir, 'legacy-radar-schema-diff.txt'), `${differences.join('\n\n')}\n`, 'utf8')
    fail(`Legacy schema is not migration-equivalent: ${actualHash} != ${referenceHash}`)
  }

  const reconcileSql = `
BEGIN;
LOCK TABLE public.payload_migrations IN ACCESS EXCLUSIVE MODE;
DO $$
DECLARE dev_count integer; historical_count integer; records_count integer; ratings_count integer; fact_value_text_count integer; evidence_role_count integer;
BEGIN
  SELECT count(*) INTO dev_count FROM public.payload_migrations WHERE name = 'dev' AND batch = -1;
  SELECT count(*) INTO historical_count FROM public.payload_migrations WHERE name IN ('${HISTORICAL_BASELINE}', '${HISTORICAL_MIGRATION}');
  SELECT count(*) INTO records_count FROM public.payload_migrations WHERE name IN ('${RECORDS_BASELINE}', '${RECORDS_MIGRATION}');
  SELECT count(*) INTO ratings_count FROM public.payload_migrations WHERE name = '${RATINGS_MIGRATION}';
  SELECT count(*) INTO fact_value_text_count FROM public.payload_migrations WHERE name = '${FACT_VALUE_TEXT_MIGRATION}';
  SELECT count(*) INTO evidence_role_count FROM public.payload_migrations WHERE name = '${EVIDENCE_ROLE_MIGRATION}';
  IF dev_count <> 1 OR historical_count <> 0 OR records_count <> 0 OR ratings_count <> 0 OR fact_value_text_count <> 0 OR evidence_role_count <> 0 THEN
    RAISE EXCEPTION 'reconciliation precondition failed: dev %, historical %, records %, ratings %, fact value text %, evidence role %', dev_count, historical_count, records_count, ratings_count, fact_value_text_count, evidence_role_count;
  END IF;
END $$;
DELETE FROM public.payload_migrations WHERE name = 'dev' AND batch = -1;
INSERT INTO public.payload_migrations (name, batch, updated_at, created_at) VALUES
  ('${HISTORICAL_BASELINE}', 2, now(), now()),
  ('${HISTORICAL_MIGRATION}', 2, now(), now());
COMMIT;`
  psql(String(lab.labDatabase), reconcileSql, {
    label: 'register equivalent historical migrations in disposable clone',
    stdoutPath: join(outDir, 'reconciliation-stdout.txt'),
    stderrPath: join(outDir, 'reconciliation-stderr.txt'),
  })
  reconciled = true

  assertExactLines(psql(String(lab.labDatabase), migrationRowsSql), [
    '20260718_072813_existing_schema_baseline_v01\t1',
    '20260718_072843_stewardship_notices_v01\t1',
    `${HISTORICAL_BASELINE}\t2`,
    `${HISTORICAL_MIGRATION}\t2`,
  ], 'post-reconciliation migrations')

  writeFileSync(join(outDir, 'radar-public-dev-schema-reconciliation-v02.json'), `${JSON.stringify({
    schemaVersion: 'radar-public-dev-schema-reconciliation-v02',
    websiteCommit: args.expectedWebsiteHead,
    labDatabase: lab.labDatabase,
    referenceDatabaseCreated: true,
    migrationsExecutedOnlyInReference: true,
    schemaSignatureMethod: 'normalized_pg_dump_schema_only',
    schemaSignatureMatched: true,
    actualSchemaSignatureSha256: actualHash,
    referenceSchemaSignatureSha256: referenceHash,
    developmentMigrationMarkersRemoved: 1,
    historicalMigrationRowsRegistered: 2,
    recordsMigrationRowsRegistered: 0,
    ratingsMigrationRowsRegistered: 0,
    factValueTextMigrationRowsRegistered: 0,
    evidenceRoleMigrationRowsRegistered: 0,
    sourceDatabaseWrite: false,
    productionAuthorization: false,
    accepted: true,
  }, null, 2)}\n`, 'utf8')
} finally {
  if (referenceCreated) {
    try { psql('postgres', `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${referenceDatabase}' AND pid <> pg_backend_pid();`) } catch {}
    const dropped = spawnSync('docker', [
      'exec', '-e', `PGPASSWORD=${lab.labPassword}`, String(lab.labContainer),
      'dropdb', '--if-exists', '-U', String(lab.labUser), referenceDatabase,
    ], { cwd: repoRoot, encoding: 'utf8', windowsHide: true })
    if (dropped.status !== 0 && reconciled) fail(`Reference cleanup failed: ${String(dropped.stderr ?? '').trim()}`)
  }
}
