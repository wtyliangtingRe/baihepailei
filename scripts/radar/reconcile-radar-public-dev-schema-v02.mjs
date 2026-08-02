import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const CONFIRM = 'RECONCILE-ISOLATED-RADAR-PUBLIC-DEV-SCHEMA-V01'
const EXPECTED_BRANCH = 'agent/radar-public-release-lab-v01'
const HISTORICAL_BASELINE = '20260723_141905_current_schema_baseline_before_radar_public_v01'
const HISTORICAL_MIGRATION = '20260723_141908_radar_public_conclusions_v01'
const RECORDS_BASELINE = '20260801_101546_current_schema_baseline_before_radar_public_records_v01'
const RECORDS_MIGRATION = '20260801_101551_radar_public_records_v01'
const FORMAL_MIGRATIONS = [
  '20260718_072813_existing_schema_baseline_v01',
  '20260718_072843_stewardship_notices_v01',
  HISTORICAL_BASELINE,
  HISTORICAL_MIGRATION,
  RECORDS_BASELINE,
  RECORDS_MIGRATION,
]

function fail(message) {
  throw new Error(message)
}

function parseArgs(argv) {
  const args = new Map()
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    if (!key.startsWith('--')) fail(`未知参数：${key}`)
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) fail(`参数缺少值：${key}`)
    args.set(key, value)
    index += 1
  }
  return {
    environmentFile: args.get('--environment-file'),
    expectedWebsiteHead: args.get('--expected-website-head'),
    outDir: args.get('--out-dir'),
    confirm: args.get('--confirm'),
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: 'utf8',
    input: options.input,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  })
  if (options.stdoutPath) writeFileSync(options.stdoutPath, result.stdout ?? '', 'utf8')
  if (options.stderrPath) writeFileSync(options.stderrPath, result.stderr ?? '', 'utf8')
  if (result.error) throw result.error
  if (result.status !== 0) {
    const stderr = String(result.stderr ?? '').trim()
    fail(`${options.label ?? command} 失败（退出码 ${result.status}）${stderr ? `：${stderr}` : ''}`)
  }
  return String(result.stdout ?? '')
}

function quoteIdentifier(value) {
  if (!/^[a-z][a-z0-9_]{0,62}$/u.test(value)) fail(`不安全的 PostgreSQL 标识符：${value}`)
  return `"${value}"`
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function normalizedLines(text) {
  return String(text)
    .split(/\r?\n/u)
    .map((line) => line.trimEnd())
    .filter(Boolean)
}

function assertExactLines(actualText, expectedLines, label) {
  const actual = normalizedLines(actualText)
  const expected = [...expectedLines].sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${label} 不符合预期：\nactual=${actual.join(', ')}\nexpected=${expected.join(', ')}`)
  }
}

const args = parseArgs(process.argv.slice(2))
if (!args.environmentFile || !args.expectedWebsiteHead || !args.outDir || args.confirm !== CONFIRM) {
  fail('隔离 schema 对齐参数或确认字符串不完整。')
}
if (!/^[a-f0-9]{40}$/u.test(args.expectedWebsiteHead)) fail('网站提交格式无效。')

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const environmentPath = realpathSync(resolve(args.environmentFile))
const outDir = resolve(args.outDir)
const allowedOutRoot = resolve(repoRoot, 'data_local', 'outputs', 'radar-public-release-v01')
const relOut = relative(allowedOutRoot, outDir)
if (relOut.startsWith(`..${sep}`) || relOut === '..' || isAbsolute(relOut)) {
  fail(`输出目录不在隔离实验目录内：${outDir}`)
}
mkdirSync(outDir, { recursive: true })

const lab = JSON.parse(readFileSync(environmentPath, 'utf8'))
if (lab.schemaVersion !== 'radar-public-release-lab-environment-v01') fail('实验环境版本不匹配。')
if (lab.websiteCommit !== args.expectedWebsiteHead) fail('实验环境网站提交不匹配。')
if (lab.sourceDatabaseWrite !== false || lab.sourcePostcheckPassed !== true || lab.isolatedRestorePassed !== true) {
  fail('实验环境未证明源库只读和隔离恢复通过。')
}
if (!/^baihepailei-radar-public-release-lab-[0-9]{8}-[0-9]{6}$/u.test(String(lab.labContainer))) {
  fail('实验容器名称不在允许范围。')
}
if (lab.labDatabase !== 'radar_public_release_lab' || lab.labUser !== 'radar_lab') {
  fail('实验数据库身份不符合固定隔离约束。')
}
if (!Number.isInteger(Number(lab.labPort)) || Number(lab.labPort) < 31000 || Number(lab.labPort) > 31999) {
  fail('实验数据库端口不在 31000-31999。')
}
if (!/^postgresql:\/\/radar_lab:[a-f0-9]+@127\.0\.0\.1:31[0-9]{3}\/radar_public_release_lab$/u.test(String(lab.databaseUrl))) {
  fail('实验数据库 URL 不符合固定 loopback 约束。')
}

const head = run('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, label: '读取本地提交' }).trim()
const remoteHead = run('git', ['rev-parse', `origin/${EXPECTED_BRANCH}`], { cwd: repoRoot, label: '读取远端提交' }).trim()
if (head !== args.expectedWebsiteHead || remoteHead !== args.expectedWebsiteHead) {
  fail(`隔离分支提交不匹配：local=${head} remote=${remoteHead}`)
}

const running = run('docker', ['inspect', '-f', '{{.State.Running}}', String(lab.labContainer)], {
  cwd: repoRoot,
  label: '检查实验容器',
}).trim()
if (running !== 'true') fail('实验 PostgreSQL 容器未运行。')

const referenceDatabase = `radar_public_reference_${Date.now().toString(36)}`
quoteIdentifier(referenceDatabase)
let referenceCreated = false
let reconciled = false

const psql = (database, sql, options = {}) => run(
  'docker',
  [
    'exec',
    '-e', `PGPASSWORD=${lab.labPassword}`,
    String(lab.labContainer),
    'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
    '-U', String(lab.labUser), '-d', database, '-c', sql,
  ],
  {
    cwd: repoRoot,
    label: options.label ?? `执行 ${database} SQL`,
    stdoutPath: options.stdoutPath,
    stderrPath: options.stderrPath,
  },
)

const migrationRowsSql = `
SELECT name || E'\\t' || batch::text
FROM public.payload_migrations
ORDER BY name, batch;
`

const expectedSourceMigrationRows = [
  '20260718_072813_existing_schema_baseline_v01\t1',
  '20260718_072843_stewardship_notices_v01\t1',
  'dev\t-1',
]

const sourceMigrationRows = psql(String(lab.labDatabase), migrationRowsSql, {
  label: '读取克隆迁移登记',
  stdoutPath: join(outDir, 'pre-reconciliation-migrations.tsv'),
  stderrPath: join(outDir, 'pre-reconciliation-migrations-stderr.txt'),
})
assertExactLines(sourceMigrationRows, expectedSourceMigrationRows, '克隆迁移登记')

const objectGate = psql(String(lab.labDatabase), `
SELECT concat_ws(E'\\t',
  COALESCE(to_regclass('public.radar_public')::text, ''),
  COALESCE(to_regclass('public.radar_public_review_reasons')::text, ''),
  COALESCE(to_regclass('public.radar_public_radar_assessment_matched_rules')::text, ''),
  COALESCE(to_regclass('public.radar_public_radar_assessment_contradictions')::text, ''),
  COALESCE(to_regclass('public.radar_public_records')::text, '')
);
`, {
  label: '核对旧 Radar 与新记录表边界',
  stdoutPath: join(outDir, 'pre-reconciliation-object-gate.tsv'),
  stderrPath: join(outDir, 'pre-reconciliation-object-gate-stderr.txt'),
}).replace(/\r?\n$/u, '')
if (objectGate !== 'radar_public\tradar_public_review_reasons\tradar_public_radar_assessment_matched_rules\tradar_public_radar_assessment_contradictions\t') {
  fail(`旧 Radar schema 或新记录表边界不符合预期：${objectGate}`)
}

const signatureSql = `
WITH selected_relations AS (
  SELECT c.oid, c.relname, c.relkind, c.relpersistence, c.relrowsecurity,
         c.relforcerowsecurity, c.relreplident, r.rolname AS owner_name,
         COALESCE(obj_description(c.oid, 'pg_class'), '') AS comment_text
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_roles r ON r.oid = c.relowner
  WHERE n.nspname = 'public'
    AND c.relname LIKE 'radar_public%'
    AND c.relname NOT LIKE 'radar_public_records%'
    AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
), selected_tables AS (
  SELECT * FROM selected_relations WHERE relkind IN ('r', 'p')
), signature AS (
  SELECT 'relation' AS kind,
         concat_ws('|', relname, relkind, relpersistence, relrowsecurity::text,
                   relforcerowsecurity::text, relreplident, owner_name, comment_text) AS value
  FROM selected_relations
  UNION ALL
  SELECT 'column', concat_ws('|', c.relname, a.attnum::text, a.attname,
         format_type(a.atttypid, a.atttypmod), a.attnotnull::text,
         COALESCE(pg_get_expr(ad.adbin, ad.adrelid), ''), a.attidentity, a.attgenerated,
         COALESCE(coll.collname, ''), COALESCE(col_description(c.oid, a.attnum), ''))
  FROM selected_tables c
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
  LEFT JOIN pg_attrdef ad ON ad.adrelid = c.oid AND ad.adnum = a.attnum
  LEFT JOIN pg_collation coll ON coll.oid = a.attcollation AND a.attcollation <> 0
  UNION ALL
  SELECT 'constraint', concat_ws('|', c.relname, con.conname, con.contype,
         pg_get_constraintdef(con.oid, true), con.condeferrable::text, con.condeferred::text,
         con.convalidated::text)
  FROM selected_tables c
  JOIN pg_constraint con ON con.conrelid = c.oid
  UNION ALL
  SELECT 'index', concat_ws('|', c.relname, i.relname, ix.indisunique::text,
         ix.indisprimary::text, ix.indisvalid::text, ix.indisready::text,
         pg_get_indexdef(i.oid))
  FROM selected_tables c
  JOIN pg_index ix ON ix.indrelid = c.oid
  JOIN pg_class i ON i.oid = ix.indexrelid
  UNION ALL
  SELECT 'enum', concat_ws('|', t.typname, e.enumsortorder::text, e.enumlabel,
         r.rolname, COALESCE(obj_description(t.oid, 'pg_type'), ''))
  FROM pg_type t
  JOIN pg_namespace n ON n.oid = t.typnamespace
  JOIN pg_enum e ON e.enumtypid = t.oid
  JOIN pg_roles r ON r.oid = t.typowner
  WHERE n.nspname = 'public'
    AND t.typname LIKE 'enum_radar_public%'
    AND t.typname NOT LIKE 'enum_radar_public_records%'
  UNION ALL
  SELECT 'sequence', concat_ws('|', c.relname, s.seqstart::text, s.seqincrement::text,
         s.seqmin::text, s.seqmax::text, s.seqcache::text, s.seqcycle::text,
         COALESCE(t.relname, ''), COALESCE(a.attname, ''))
  FROM selected_relations c
  JOIN pg_sequence s ON s.seqrelid = c.oid
  LEFT JOIN pg_depend d ON d.objid = c.oid AND d.deptype = 'a'
  LEFT JOIN pg_class t ON t.oid = d.refobjid
  LEFT JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
  WHERE c.relkind = 'S'
  UNION ALL
  SELECT 'trigger', concat_ws('|', c.relname, tg.tgname, pg_get_triggerdef(tg.oid, true),
         tg.tgenabled, tg.tgisinternal::text)
  FROM selected_tables c
  JOIN pg_trigger tg ON tg.tgrelid = c.oid
  WHERE NOT tg.tgisinternal
  UNION ALL
  SELECT 'policy', concat_ws('|', c.relname, p.polname, p.polcmd, p.polpermissive::text,
         COALESCE(pg_get_expr(p.polqual, p.polrelid), ''),
         COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), ''))
  FROM selected_tables c
  JOIN pg_policy p ON p.polrelid = c.oid
  UNION ALL
  SELECT 'grant', concat_ws('|', table_name, grantee, privilege_type, is_grantable)
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name LIKE 'radar_public%'
    AND table_name NOT LIKE 'radar_public_records%'
)
SELECT kind || E'\\t' || value
FROM signature
ORDER BY kind, value;
`

try {
  psql('postgres', `
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = '${lab.labDatabase}' AND pid <> pg_backend_pid();
`, { label: '清理模板数据库连接' })

  run('docker', [
    'exec', '-e', `PGPASSWORD=${lab.labPassword}`, String(lab.labContainer),
    'createdb', '-U', String(lab.labUser), '-T', String(lab.labDatabase), referenceDatabase,
  ], { cwd: repoRoot, label: '创建历史 schema 参考数据库' })
  referenceCreated = true

  const setupReferenceSql = `
BEGIN;
DROP TABLE IF EXISTS public.radar_public_review_reasons CASCADE;
DROP TABLE IF EXISTS public.radar_public_radar_assessment_matched_rules CASCADE;
DROP TABLE IF EXISTS public.radar_public_radar_assessment_contradictions CASCADE;
DROP TABLE IF EXISTS public.radar_public CASCADE;
DROP TYPE IF EXISTS public.enum_radar_public_review_reasons CASCADE;
DROP TYPE IF EXISTS public.enum_radar_public_radar_assessment_matched_rules_grade CASCADE;
DROP TYPE IF EXISTS public.enum_radar_public_record_status CASCADE;
DROP TYPE IF EXISTS public.enum_radar_public_conclusion_mode CASCADE;
DROP TYPE IF EXISTS public.enum_radar_public_compatibility_grade CASCADE;
DROP TYPE IF EXISTS public.enum_radar_public_best_grade CASCADE;
DROP TYPE IF EXISTS public.enum_radar_public_likely_grade CASCADE;
DROP TYPE IF EXISTS public.enum_radar_public_worst_grade CASCADE;
DROP TYPE IF EXISTS public.enum_radar_public_rating_notice CASCADE;
DROP TYPE IF EXISTS public.enum_radar_public_evidence_strength CASCADE;
DROP TYPE IF EXISTS public.enum_radar_public_radar_assessment_evidence_status CASCADE;
DROP TYPE IF EXISTS public.enum_radar_public_radar_assessment_suggested_grade CASCADE;
DROP TYPE IF EXISTS public.enum_radar_public_source_kind CASCADE;
DELETE FROM public.payload_migrations WHERE name = 'dev' AND batch = -1;
INSERT INTO public.payload_migrations (name, batch, updated_at, created_at)
SELECT marker.name, 1, now(), now()
FROM (VALUES
  ('${RECORDS_BASELINE}'),
  ('${RECORDS_MIGRATION}')
) AS marker(name)
WHERE NOT EXISTS (
  SELECT 1 FROM public.payload_migrations existing WHERE existing.name = marker.name
);
COMMIT;
`
  psql(referenceDatabase, setupReferenceSql, {
    label: '准备历史 migration 参考数据库',
    stdoutPath: join(outDir, 'reference-setup-stdout.txt'),
    stderrPath: join(outDir, 'reference-setup-stderr.txt'),
  })

  const referenceUrl = new URL(String(lab.databaseUrl))
  referenceUrl.pathname = `/${referenceDatabase}`
  const migrateCommand = process.platform === 'win32'
    ? { command: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', 'pnpm.cmd payload migrate'] }
    : { command: 'pnpm', args: ['payload', 'migrate'] }
  run(migrateCommand.command, migrateCommand.args, {
    cwd: repoRoot,
    label: '在参考数据库执行历史 Radar migration',
    env: {
      ...process.env,
      DATABASE_URL: referenceUrl.toString(),
      PAYLOAD_DB_PUSH: 'false',
      STEWARDSHIP_NOTICES_SCHEMA_READY: 'true',
      RADAR_PUBLIC_CONCLUSIONS_SCHEMA_READY: 'true',
      RADAR_PUBLIC_RECORDS_SCHEMA_READY: 'true',
    },
    stdoutPath: join(outDir, 'reference-payload-migrate-stdout.txt'),
    stderrPath: join(outDir, 'reference-payload-migrate-stderr.txt'),
  })

  const referenceMigrationRows = psql(referenceDatabase, migrationRowsSql, {
    label: '核对参考数据库 migration 登记',
    stdoutPath: join(outDir, 'reference-migrations.tsv'),
    stderrPath: join(outDir, 'reference-migrations-stderr.txt'),
  })
  assertExactLines(
    referenceMigrationRows,
    FORMAL_MIGRATIONS.map((name) => `${name}\t${name.startsWith('20260718') || name.startsWith('20260801') ? 1 : 2}`),
    '参考数据库 migration 登记',
  )

  const actualSignaturePath = join(outDir, 'old-radar-schema-actual.tsv')
  const referenceSignaturePath = join(outDir, 'old-radar-schema-reference.tsv')
  const actualSignature = psql(String(lab.labDatabase), signatureSql, {
    label: '生成旧 Radar 实际 schema 签名',
    stdoutPath: actualSignaturePath,
    stderrPath: join(outDir, 'old-radar-schema-actual-stderr.txt'),
  })
  const referenceSignature = psql(referenceDatabase, signatureSql, {
    label: '生成旧 Radar 参考 schema 签名',
    stdoutPath: referenceSignaturePath,
    stderrPath: join(outDir, 'old-radar-schema-reference-stderr.txt'),
  })

  const actualBuffer = Buffer.from(actualSignature.replace(/\r\n/gu, '\n'), 'utf8')
  const referenceBuffer = Buffer.from(referenceSignature.replace(/\r\n/gu, '\n'), 'utf8')
  const actualHash = sha256(actualBuffer)
  const referenceHash = sha256(referenceBuffer)
  if (!actualBuffer.equals(referenceBuffer)) {
    const actualLines = normalizedLines(actualSignature)
    const referenceLines = normalizedLines(referenceSignature)
    const differences = []
    const maximum = Math.max(actualLines.length, referenceLines.length)
    for (let index = 0; index < maximum && differences.length < 80; index += 1) {
      if (actualLines[index] !== referenceLines[index]) {
        differences.push(`line ${index + 1}\nactual: ${actualLines[index] ?? '<missing>'}\nreference: ${referenceLines[index] ?? '<missing>'}`)
      }
    }
    writeFileSync(join(outDir, 'old-radar-schema-diff.txt'), `${differences.join('\n\n')}\n`, 'utf8')
    fail(`旧 Radar dev-pushed schema 与锁定 migration 不等价：actual=${actualHash} reference=${referenceHash}`)
  }

  const reconcileSql = `
BEGIN;
LOCK TABLE public.payload_migrations IN ACCESS EXCLUSIVE MODE;
DO $$
DECLARE
  dev_count integer;
  historical_count integer;
  records_count integer;
BEGIN
  SELECT count(*) INTO dev_count
  FROM public.payload_migrations
  WHERE name = 'dev' AND batch = -1;
  SELECT count(*) INTO historical_count
  FROM public.payload_migrations
  WHERE name IN ('${HISTORICAL_BASELINE}', '${HISTORICAL_MIGRATION}');
  SELECT count(*) INTO records_count
  FROM public.payload_migrations
  WHERE name IN ('${RECORDS_BASELINE}', '${RECORDS_MIGRATION}');
  IF dev_count <> 1 OR historical_count <> 0 OR records_count <> 0 THEN
    RAISE EXCEPTION 'migration reconciliation precondition failed: dev %, historical %, records %',
      dev_count, historical_count, records_count;
  END IF;
END $$;
DELETE FROM public.payload_migrations WHERE name = 'dev' AND batch = -1;
INSERT INTO public.payload_migrations (name, batch, updated_at, created_at)
VALUES
  ('${HISTORICAL_BASELINE}', 2, now(), now()),
  ('${HISTORICAL_MIGRATION}', 2, now(), now());
COMMIT;
`
  psql(String(lab.labDatabase), reconcileSql, {
    label: '仅在临时克隆登记等价历史 migration',
    stdoutPath: join(outDir, 'reconciliation-stdout.txt'),
    stderrPath: join(outDir, 'reconciliation-stderr.txt'),
  })
  reconciled = true

  const reconciledRows = psql(String(lab.labDatabase), migrationRowsSql, {
    label: '核对临时克隆 migration 对齐结果',
    stdoutPath: join(outDir, 'post-reconciliation-migrations.tsv'),
    stderrPath: join(outDir, 'post-reconciliation-migrations-stderr.txt'),
  })
  assertExactLines(reconciledRows, [
    '20260718_072813_existing_schema_baseline_v01\t1',
    '20260718_072843_stewardship_notices_v01\t1',
    `${HISTORICAL_BASELINE}\t2`,
    `${HISTORICAL_MIGRATION}\t2`,
  ], '临时克隆 migration 对齐结果')

  writeFileSync(join(outDir, 'radar-public-dev-schema-reconciliation-v01.json'), `${JSON.stringify({
    schemaVersion: 'radar-public-dev-schema-reconciliation-v01',
    websiteCommit: args.expectedWebsiteHead,
    labDatabase: lab.labDatabase,
    historicalBaseline: HISTORICAL_BASELINE,
    historicalMigration: HISTORICAL_MIGRATION,
    referenceDatabaseCreated: true,
    historicalMigrationExecutedOnlyInReference: true,
    schemaSignatureMatched: true,
    actualSchemaSignatureSha256: actualHash,
    referenceSchemaSignatureSha256: referenceHash,
    developmentMigrationMarkersRemoved: 1,
    historicalMigrationRowsRegistered: 2,
    sourceDatabaseWrite: false,
    productionAuthorization: false,
    accepted: true,
    decision: 'accept_isolated_historical_schema_reconciliation_v01',
  }, null, 2)}\n`, 'utf8')
} finally {
  if (referenceCreated) {
    try {
      psql('postgres', `
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = '${referenceDatabase}' AND pid <> pg_backend_pid();
`, { label: '终止参考数据库连接' })
    } catch {}
    const dropped = spawnSync('docker', [
      'exec', '-e', `PGPASSWORD=${lab.labPassword}`, String(lab.labContainer),
      'dropdb', '--if-exists', '-U', String(lab.labUser), referenceDatabase,
    ], { cwd: repoRoot, encoding: 'utf8', windowsHide: true })
    if (dropped.status !== 0 && reconciled) {
      fail(`参考数据库清理失败：${String(dropped.stderr ?? '').trim()}`)
    }
  }
}
