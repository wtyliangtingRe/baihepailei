import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const runner = readFileSync(
  new URL("../scripts/radar/run-ai-radar-wave5-a122-critical-high44-results-v01.ps1", import.meta.url),
  "utf8",
);

test("A122 critical/high-44 runner is bound to the fixed package and source chain", () => {
  assert.match(runner, /RADAR-WAVE5-A122-CRITICAL-HIGH44-RESEARCH-RESULTS-v01/);
  assert.match(runner, /2bb8b6f41e89c5dc858a4236d2e7badd9080ef03d7315b439eacbc612ce0c07d/);
  assert.match(runner, /903b7eed21748634600394143792fd6b76ed581ae508a4a9f708c0fe7d6469cb/);
  assert.match(runner, /9334cc17004d40837dc3db5182867099e1367e92c0e66e0d4c78290aa3f4771e/);
  assert.match(runner, /0091143a6417d28b08a731bbe659cc506e0efa08/);
});

test("A122 critical/high-44 runner validates fixed QA and grade counts", () => {
  assert.match(runner, /\$ExpectedRows = 44/);
  assert.match(runner, /\$ExpectedPassedRows = 39/);
  assert.match(runner, /\$ExpectedDeferredRows = 5/);
  assert.match(runner, /\$ExpectedGradeS = 3/);
  assert.match(runner, /\$ExpectedGradeA = 33/);
  assert.match(runner, /\$ExpectedGradeB = 5/);
  assert.match(runner, /\$ExpectedGradeD = 2/);
  assert.match(runner, /\$ExpectedGradeF = 1/);
});

test("A122 critical/high-44 runner validates calibrated rules and change types", () => {
  for (const token of [
    "$ExpectedRuleSRelationship = 3",
    "$ExpectedRuleANearConfirmed = 20",
    "$ExpectedRuleAOngoing = 11",
    "$ExpectedRuleAYuriHarem = 3",
    "$ExpectedRuleBFemaleNtr = 2",
    "$ExpectedRuleBPowerImbalance = 2",
    "$ExpectedRuleBUnfinishedCreatorRisk = 1",
    "$ExpectedRuleDUnclear = 2",
    "$ExpectedRuleFHetEnd = 1",
    "$ExpectedRetained = 15",
    "$ExpectedRuleChanged = 15",
    "$ExpectedGradeAndRuleChanged = 9",
    "$ExpectedDeferredReclassification = 5",
  ]) assert.ok(runner.includes(token), token);
});

test("A122 critical/high-44 runner hard-binds every identity and audit order", () => {
  const identityLines = runner.match(/"\d+\|[^"]+"/g) ?? [];
  assert.equal(identityLines.length, 44);
  assert.match(runner, /Expected identity missing from critical\/high-44 results/);
  assert.match(runner, /Expected auditOrder missing from critical\/high-44 results/);
  assert.match(runner, /for \(\$Order = 1; \$Order -le \$ExpectedRows; \$Order \+= 1\)/);
});

test("A122 critical/high-44 runner verifies hashes and exact QA partitions", () => {
  assert.match(runner, /SHA256SUMS\.txt/);
  assert.match(runner, /Package file SHA-256 mismatch/);
  assert.match(runner, /Passed and deferred partitions do not cover all critical\/high-44 rows/);
  assert.match(runner, /ai_qa_passed/);
  assert.match(runner, /ai_qa_deferred/);
});

test("A122 critical/high-44 runner preserves local-only safety and creates a checkpoint", () => {
  assert.match(runner, /Assert-UnderDataLocal/);
  assert.match(runner, /publicationStatus -ne "do_not_publish"/);
  assert.match(runner, /humanTrackMutations -ne 0/);
  assert.match(runner, /payloadWrite = \$false/);
  assert.match(runner, /directPostgresqlWrite = \$false/);
  assert.match(runner, /RADAR-WAVE5-A122-CRITICAL-HIGH44-RESEARCH-RESULTS-checkpoint-v01/);
});
