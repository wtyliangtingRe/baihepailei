import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const runner = readFileSync(
  new URL("../scripts/radar/run-ai-radar-wave5-high-impact-extremes9-results-v01.ps1", import.meta.url),
  "utf8",
);

test("extremes-9 runner is bound to the fixed result package and source chain", () => {
  assert.match(runner, /\$PackageId = "RADAR\-WAVE5\-HIGH\-IMPACT\-EXTREMES9\-RESEARCH\-RESULTS\-v01"/);
  assert.match(runner, /\$ExpectedPackageZipSha256 = "9cc0c9df244135538547582558e70db82afbea3ee221374272c2e2d1a64cc578"/);
  assert.match(runner, /\$ExpectedSourceInputZipSha256 = "323229c0d293c030ff4459a618690773663f576ddb49b05381939501b45a22b3"/);
  assert.match(runner, /\$ExpectedSourceCheckpointZipSha256 = "60aeee09bc022fdbb06635a5aa496f93d786832fd05eecdf6b48b3c71a7d19eb"/);
  assert.match(runner, /\$ExpectedPolicyCommit = "2b3f6a088b1c91889e10738c362e8350468477fd"/);
});

test("extremes-9 runner validates fixed grade and QA counts", () => {
  assert.match(runner, /\$ExpectedRows = 9/);
  assert.match(runner, /\$ExpectedPassedRows = 9/);
  assert.match(runner, /\$ExpectedDeferredRows = 0/);
  assert.match(runner, /\$ExpectedGradeS = 1/);
  assert.match(runner, /\$ExpectedGradeF = 8/);
});

test("extremes-9 runner validates calibrated rule and change counts", () => {
  assert.match(runner, /\$ExpectedRuleSRelationship = 1/);
  assert.match(runner, /\$ExpectedRuleSCreatorSafe = 1/);
  assert.match(runner, /\$ExpectedRuleFMaleNtr = 2/);
  assert.match(runner, /\$ExpectedRuleFProjectContamination = 6/);
  assert.match(runner, /\$ExpectedRetained = 7/);
  assert.match(runner, /\$ExpectedRuleNarrowed = 2/);
});

test("extremes-9 runner hard-binds every expected identity", () => {
  const expected = ["4225|work:mgv2-00488-安达与岛村ss", "4601|work:mgv2-00864-捏造トラップ-ntr-1", "4717|work:mgv2-00980-捏造トラップ-ntr-2", "30235|catalog-bangumi-371692", "30234|catalog-bangumi-486264", "27834|catalog-anilist-180516", "27837|catalog-anilist-148370", "27838|catalog-anilist-176299", "27839|catalog-anilist-172420"];
  for (const identity of expected) {
    assert.ok(runner.includes(`"${identity}"`), identity);
  }
  assert.match(runner, /Expected identity missing from extremes-9 results/);
  assert.match(runner, /Unexpected identity in extremes-9 results/);
});

test("extremes-9 runner verifies nested hashes and exact result partitions", () => {
  assert.match(runner, /SHA256SUMS\.txt/);
  assert.match(runner, /Package file SHA-256 mismatch/);
  assert.match(runner, /Passed and deferred partitions do not cover all extremes-9 rows/);
  assert.match(runner, /ai_qa_passed/);
  assert.match(runner, /rule_narrowed/);
});

test("extremes-9 runner preserves local-only safety and creates a checkpoint", () => {
  assert.match(runner, /Assert-UnderDataLocal/);
  assert.match(runner, /publicationStatus -ne "do_not_publish"/);
  assert.match(runner, /humanTrackMutations -ne 0/);
  assert.match(runner, /payloadWrite = \$false/);
  assert.match(runner, /directPostgresqlWrite = \$false/);
  assert.match(runner, /RADAR-WAVE5-HIGH-IMPACT-EXTREMES9-RESEARCH-RESULTS-checkpoint-v01/);
});
