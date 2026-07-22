import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const runner = readFileSync(
  new URL(
    "../scripts/radar/run-ai-radar-wave5-e99-final-results-v01.ps1",
    import.meta.url,
  ),
  "utf8",
);

test("final E99 runner is bound to the fixed result package and policy commit", () => {
  assert.match(runner, /\$PackageId = "RADAR-WAVE5-E99-FINAL-RESEARCH-RESULTS-v01"/);
  assert.match(runner, /\$ExpectedPackageZipSha256 = "1e4b12a1b9d57aa86ab42292000fc0d268242c00bf9d543cc88a5c1168c98033"/);
  assert.match(runner, /\$ExpectedPolicyCommit = "1ee8670db0e67b81a7055e3ce9bcbf9e15f9ee11"/);
});

test("final E99 runner binds every completed high-impact source artifact", () => {
  for (const sha of [
    "323229c0d293c030ff4459a618690773663f576ddb49b05381939501b45a22b3",
    "60aeee09bc022fdbb06635a5aa496f93d786832fd05eecdf6b48b3c71a7d19eb",
    "9cc0c9df244135538547582558e70db82afbea3ee221374272c2e2d1a64cc578",
    "73eb281e548b8322c0692615dd4bceb538c9c558d73ef9c27fe19bf691d1579f",
    "903b7eed21748634600394143792fd6b76ed581ae508a4a9f708c0fe7d6469cb",
    "9334cc17004d40837dc3db5182867099e1367e92c0e66e0d4c78290aa3f4771e",
    "2bb8b6f41e89c5dc858a4236d2e7badd9080ef03d7315b439eacbc612ce0c07d",
    "5e23e6da9b767362a1a44580b6f325904e70d44d1028efac7d4c4acbd6ade46e",
    "8890a2afc4c16e9c90fcf03d6d922dececb129d3c1359931c3cf8155f1de0ee1",
    "a1ba9ffb9bfe41ea622ad5510cbe93e099f46e3c8e7b45dbab8b0eebd8b5b17b",
  ]) {
    assert.ok(runner.includes(sha), sha);
  }
});

test("final E99 runner validates all fixed row, QA and grade counts", () => {
  assert.match(runner, /\$ExpectedRows = 99/);
  assert.match(runner, /\$ExpectedPassedRows = 90/);
  assert.match(runner, /\$ExpectedDeferredRows = 9/);
  assert.match(runner, /\$ExpectedGradeA = 1/);
  assert.match(runner, /\$ExpectedGradeB = 4/);
  assert.match(runner, /\$ExpectedGradeD = 54/);
  assert.match(runner, /\$ExpectedGradeE = 40/);
});

test("final E99 runner validates calibrated rule and change distributions", () => {
  for (const token of [
    "A-NEAR-CONFIRMED",
    "B-FEMALE-NTR",
    "B-LIGHT",
    "D-GENERAL",
    "D-QUEER-GENERAL",
    "D-UNCLEAR",
    "E-MALE-INTIMACY",
    "E-MALE-POSSIBILITY",
    "E-MALE-SUBSTITUTE",
    "E-PAST-MALE-ROMANCE",
    "E-ROUTE-CONTAMINATION",
    "E-SPECIAL",
    "E-TOKEN-YURI",
    "retained",
    "grade_and_rule_changed",
    "deferred_reclassification",
  ]) {
    assert.ok(runner.includes(token), token);
  }
});

test("final E99 runner hard-binds exact order-to-identity equality", () => {
  assert.match(
    runner,
    /\$ExpectedOrderedIdentitySha256 = "68e39278315e9687721d12e7f985badc7f5bee94fa0e2fdb5c99244414154e4a"/,
  );
  assert.match(runner, /E99 result orders are not exactly 1\.\.99/);
  assert.match(runner, /E99 exact ordered identity map does not match/);
  assert.match(runner, /E99 QA partitions do not cover all rows/);
});

test("final E99 runner preserves safety and closes the high-impact 230 batch", () => {
  assert.match(runner, /Assert-UnderDataLocal/);
  assert.match(runner, /publicationStatus -ne "do_not_publish"/);
  assert.match(runner, /humanTrackMutations -ne 0/);
  assert.match(runner, /HighImpact230Completed = 230/);
  assert.match(runner, /HighImpact230Remaining = 0/);
  assert.match(
    runner,
    /RADAR-WAVE5-E99-FINAL-RESEARCH-RESULTS-checkpoint-v01/,
  );
});
