import { test } from "node:test";
import assert from "node:assert/strict";
import { loadFixtures } from "../evals/lib/fixtures.mjs";
import { referenceResults } from "../evals/lib/reference.mjs";
import { blockStatus, loadBaseline, loadResults } from "../evals/lib/report.mjs";
import { scoreSkill } from "../evals/lib/score.mjs";

const { fixtures, sha256 } = loadFixtures();
const results = loadResults();

for (const r of results) {
  test(`${r.file}: one prediction per fixture`, (t) => {
    if (r.fixturesSha256 !== sha256) return t.skip("fixtures changed since this run — re-run npm run eval:llm");
    assert.deepEqual(r.predictions.map((p) => p.id).sort(), fixtures.map((f) => f.id).sort());
  });

  test(`${r.file}: the recorded summary recomputes from the recorded answers`, (t) => {
    if (r.fixturesSha256 !== sha256) return t.skip("fixtures changed since this run — re-run npm run eval:llm");
    const answers = new Map(r.predictions.filter((p) => p.answer !== undefined).map((p) => [p.id, p.answer]));
    assert.deepEqual(scoreSkill(r.skill, fixtures, answers), r.summary);
  });
}

test("the generated result blocks in the READMEs are up to date", () => {
  for (const block of blockStatus({ fixtures, reference: referenceResults(fixtures), results, baseline: loadBaseline() })) {
    assert.ok(block.current !== null, `${block.file}: missing the ${block.name} markers`);
    assert.equal(block.current, block.expected, `${block.file} (${block.name}) is stale — run node evals/report.mjs --write`);
  }
});

test("the PR #7 baseline is intact: four runs over the 51 original fixtures", () => {
  const baseline = loadBaseline();
  assert.equal(baseline.results.length, 4);
  for (const r of baseline.results) {
    assert.equal(r.predictions.length, 51, r.file);
    assert.equal(r.summary.n, 51, r.file);
    assert.ok(Object.keys(baseline.gold).length === 51);
    assert.ok(r.predictions.every((p) => p.id in baseline.gold), `${r.file}: unknown fixture id`);
  }
  assert.equal(baseline.traps["gh-prioritizer"].length, 15);
  assert.equal(baseline.traps["pr-labeler"].length, 20);
});
