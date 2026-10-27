import { test } from "node:test";
import assert from "node:assert/strict";
import { loadFixtures } from "../evals/lib/fixtures.mjs";
import { referenceResults } from "../evals/lib/reference.mjs";
import { blockStatus, loadResults } from "../evals/lib/report.mjs";
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
  for (const block of blockStatus({ reference: referenceResults(fixtures), results })) {
    assert.ok(block.current !== null, `${block.file}: missing the ${block.name} markers`);
    assert.equal(block.current, block.expected, `${block.file} (${block.name}) is stale — run node evals/report.mjs --write`);
  }
});
