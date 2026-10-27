import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreSkill, trapsFor } from "../evals/lib/score.mjs";

const fixture = (id, traps, labels, priority) => ({ id, traps, gold: { "pr-labeler": labels, "gh-prioritizer": priority } });
const fixtures = [
  fixture("a", [], ["P2-Medium", "size/XS"], "P3-Low"),
  fixture("b", ["L3", "P2"], ["P1-High", "domain/ui", "feature", "size/M"], null),
  fixture("c", ["P8"], ["P3-Low", "size/S"], "P1-High"),
];

test("traps are split by skill; I* traps count for both", () => {
  const f = { traps: ["L1", "P5", "I1", "X1"] };
  assert.deepEqual(trapsFor("pr-labeler", f), ["L1", "I1"]);
  assert.deepEqual(trapsFor("gh-prioritizer", f), ["P5", "I1"]);
});

test("gh-prioritizer: a null answer is a real answer, a missing one is invalid", () => {
  const s = scoreSkill("gh-prioritizer", fixtures, new Map([["a", null], ["b", null]]));
  assert.equal(s.agree, 1);
  assert.equal(s.invalid, 1);
  assert.deepEqual(s.disagreements, [
    { id: "a", gold: "P3-Low", answer: null, traps: [] },
    { id: "c", gold: "P1-High", answer: "invalid", traps: ["P8"] },
  ]);
  assert.deepEqual(s.clean, { n: 1, agree: 0 });
  assert.deepEqual(s.traps, { n: 2, agree: 1 });
  assert.deepEqual(s.byTrap, { P2: { n: 1, agree: 1 }, P8: { n: 1, agree: 0 } });
});

test("pr-labeler: label order does not matter; categories are scored separately", () => {
  const answers = new Map([
    ["a", ["size/XS", "P2-Medium"]],
    ["b", ["feature", "P1-High", "size/M"]], // misses domain/ui
    ["c", ["P3-Low", "size/S"]],
  ]);
  const s = scoreSkill("pr-labeler", fixtures, answers);
  assert.equal(s.agree, 2);
  assert.deepEqual(s.byCategory.domain, { n: 3, agree: 2 });
  assert.deepEqual(s.byCategory.size, { n: 3, agree: 3 });
  assert.deepEqual(s.byTrap, { L3: { n: 1, agree: 0 } });
  assert.equal(s.labels.perLabel["domain/ui"].recall, 0);
});
