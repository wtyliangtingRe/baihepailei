import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const runner = readFileSync(
  new URL("../scripts/radar/run-ai-radar-wave5-high-impact-a122-start-v01.ps1", import.meta.url),
  "utf8",
);

test("A122 runner is bound to the fixed package and full source chain", () => {
  assert.match(runner, /\$PackageId = "RADAR-WAVE5-HIGH-IMPACT-A122-input-v01"/);
  assert.match(runner, /\$ExpectedPackageZipSha256 = "903b7eed21748634600394143792fd6b76ed581ae508a4a9f708c0fe7d6469cb"/);
  assert.match(runner, /\$ExpectedSourceInputZipSha256 = "323229c0d293c030ff4459a618690773663f576ddb49b05381939501b45a22b3"/);
  assert.match(runner, /\$ExpectedSourceInputCheckpointSha256 = "60aeee09bc022fdbb06635a5aa496f93d786832fd05eecdf6b48b3c71a7d19eb"/);
  assert.match(runner, /\$ExpectedExtremesResultZipSha256 = "9cc0c9df244135538547582558e70db82afbea3ee221374272c2e2d1a64cc578"/);
  assert.match(runner, /\$ExpectedExtremesCheckpointSha256 = "73eb281e548b8322c0692615dd4bceb538c9c558d73ef9c27fe19bf691d1579f"/);
});

test("A122 runner validates fixed row, chunk and rule counts", () => {
  assert.match(runner, /\$ExpectedRows = 122/);
  assert.match(runner, /\$ExpectedChunks = 25/);
  assert.match(runner, /\$ExpectedFullChunks = 24/);
  assert.match(runner, /\$ExpectedFinalChunkRows = 2/);
  assert.match(runner, /\$ExpectedRuleNearConfirmed = 81/);
  assert.match(runner, /\$ExpectedRuleOngoing = 29/);
  assert.match(runner, /\$ExpectedRuleOpenEnd = 2/);
  assert.match(runner, /\$ExpectedRuleYuriHarem = 11/);
});

test("A122 runner validates audit risk and evidence distributions", () => {
  assert.match(runner, /\$ExpectedRiskCritical = 7/);
  assert.match(runner, /\$ExpectedRiskHigh = 37/);
  assert.match(runner, /\$ExpectedRiskMedium = 57/);
  assert.match(runner, /\$ExpectedRiskStandard = 21/);
  assert.match(runner, /\$ExpectedEvidencePrimary = 3/);
  assert.match(runner, /\$ExpectedEvidenceMultipleSecondary = 8/);
  assert.match(runner, /\$ExpectedEvidenceSingleSecondary = 111/);
  assert.match(runner, /prior_route_conflict_summary/);
  assert.match(runner, /male_or_heterosexual_term_present/);
});

test("A122 runner validates nested hashes, exact identities and audit order coverage", () => {
  assert.match(runner, /SHA256SUMS\.txt/);
  assert.match(runner, /Package file SHA-256 mismatch/);
  assert.match(runner, /Aggregate identity missing from A122 chunks/);
  assert.match(runner, /Unexpected identity in A122 chunks/);
  assert.match(runner, /A122 audit order is incomplete/);
});

test("A122 runner enforces row-level local-only safety", () => {
  assert.match(runner, /previousGrade -ne "A"/);
  assert.match(runner, /publicationStatus -ne "do_not_publish"/);
  assert.match(runner, /humanTrackMutations -ne 0/);
  assert.match(runner, /a_grade_safety_audit_then_calibrated_ai_qa/);
  assert.match(runner, /Assert-UnderDataLocal/);
});

test("A122 runner installs locally and creates a compact checkpoint", () => {
  assert.match(runner, /wave5-high-impact-a122-v01/);
  assert.match(runner, /RADAR-WAVE5-HIGH-IMPACT-A122-input-checkpoint-v01/);
  assert.match(runner, /payloadWrite = \$false/);
  assert.match(runner, /directPostgresqlWrite = \$false/);
});
