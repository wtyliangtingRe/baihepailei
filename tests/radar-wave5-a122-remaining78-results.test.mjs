import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const runner = readFileSync(
  new URL("../scripts/radar/run-ai-radar-wave5-a122-remaining78-results-v01.ps1", import.meta.url),
  "utf8",
);

test("remaining-78 runner is bound to the fixed package and complete source chain", () => {
  assert.match(runner, /RADAR-WAVE5-A122-REMAINING78-RESEARCH-RESULTS-v01/);
  assert.match(runner, /8890a2afc4c16e9c90fcf03d6d922dececb129d3c1359931c3cf8155f1de0ee1/);
  assert.match(runner, /903b7eed21748634600394143792fd6b76ed581ae508a4a9f708c0fe7d6469cb/);
  assert.match(runner, /9334cc17004d40837dc3db5182867099e1367e92c0e66e0d4c78290aa3f4771e/);
  assert.match(runner, /2bb8b6f41e89c5dc858a4236d2e7badd9080ef03d7315b439eacbc612ce0c07d/);
  assert.match(runner, /5e23e6da9b767362a1a44580b6f325904e70d44d1028efac7d4c4acbd6ade46e/);
  assert.match(runner, /ebd74a16fa0fec25b794ee84a728ccbcd5009457/);
});

test("remaining-78 runner validates the complete QA and grade counts", () => {
  assert.match(runner, /\$ExpectedRows = 78/);
  assert.match(runner, /\$ExpectedPassedRows = 72/);
  assert.match(runner, /\$ExpectedDeferredRows = 6/);
  assert.match(runner, /\$ExpectedGradeS = 21/);
  assert.match(runner, /\$ExpectedGradeA = 47/);
  assert.match(runner, /\$ExpectedGradeB = 5/);
  assert.match(runner, /\$ExpectedGradeD = 5/);
});

test("remaining-78 runner validates every calibrated rule and change distribution", () => {
  for (const expected of [
    "$ExpectedRuleSRelationship = 19",
    "$ExpectedRuleSMarriage = 2",
    "$ExpectedRuleANearConfirmed = 30",
    "$ExpectedRuleAOngoing = 9",
    "$ExpectedRuleAYuriHarem = 8",
    "$ExpectedRuleBFemaleNtr = 1",
    "$ExpectedRuleBLight = 3",
    "$ExpectedRuleBUnfinishedCreatorRisk = 1",
    "$ExpectedRuleDUnclear = 5",
    "$ExpectedRetained = 36",
    "$ExpectedRuleChanged = 10",
    "$ExpectedGradeAndRuleChanged = 26",
    "$ExpectedDeferredReclassification = 6",
  ]) assert.ok(runner.includes(expected), expected);
});

test("remaining-78 runner hard-binds audit orders and exact identities with canonical digests", () => {
  assert.match(runner, /\$ExpectedAuditStart = 45/);
  assert.match(runner, /\$ExpectedAuditEnd = 122/);
  assert.match(runner, /7a7962bd4efa51d1e7f2eac5bfcd3fe737feb51b3a30748b2c756d6ab335fff1/);
  assert.match(runner, /21380fbdd8d8523aeceb2030b2dbc6ed643b39fd447453ae6b30469367f05653/);
  assert.match(runner, /exact identity set does not match/);
  assert.match(runner, /audit-order identity map does not match/);
});

test("remaining-78 runner verifies nested hashes and exact QA partitions", () => {
  assert.match(runner, /SHA256SUMS\.txt/);
  assert.match(runner, /Package file SHA-256 mismatch/);
  assert.match(runner, /Passed and deferred partitions do not cover all A122 remaining rows/);
  assert.match(runner, /a122-remaining78-ai-qa-passed-v01\.jsonl/);
  assert.match(runner, /a122-remaining78-ai-qa-deferred-v01\.jsonl/);
});

test("remaining-78 runner preserves local-only safety and creates one checkpoint", () => {
  assert.match(runner, /Assert-UnderDataLocal/);
  assert.match(runner, /publicationStatus -ne "do_not_publish"/);
  assert.match(runner, /humanTrackMutations -ne 0/);
  assert.match(runner, /payloadWrite = \$false/);
  assert.match(runner, /directPostgresqlWrite = \$false/);
  assert.match(runner, /RADAR-WAVE5-A122-REMAINING78-RESEARCH-RESULTS-checkpoint-v01/);
});
