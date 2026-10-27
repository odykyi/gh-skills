/**
 * Scores a set of answers for one skill against the gold answers in the
 * fixtures, overall and split by documented ambiguity ("trap").
 */

import { categorize } from "./pr-labeler.mjs";
import { PRIORITIES } from "./gh-prioritizer.mjs";
import { classificationReport, multiLabelReport } from "./metrics.mjs";

// Which ambiguity ids belong to which skill (see evals/README.md).
const TRAP_PREFIX = { "pr-labeler": ["L", "I"], "gh-prioritizer": ["P", "I"] };

export function trapsFor(skill, fixture) {
  return (fixture.traps ?? []).filter((id) => TRAP_PREFIX[skill].includes(id[0]));
}

const sorted = (labels) => [...labels].sort();

export function sameAnswer(skill, gold, answer) {
  if (answer === undefined) return false;
  if (skill === "pr-labeler") return JSON.stringify(sorted(gold)) === JSON.stringify(sorted(answer));
  return gold === answer;
}

/**
 * @param skill     "pr-labeler" | "gh-prioritizer"
 * @param fixtures  fixture objects with gold answers
 * @param answers   Map(id → answer); a missing id or `undefined` is an invalid answer
 */
export function scoreSkill(skill, fixtures, answers) {
  const gold = fixtures.map((f) => f.gold[skill]);
  const predicted = fixtures.map((f) => answers.get(f.id));
  const agree = fixtures.map((f, i) => sameAnswer(skill, gold[i], predicted[i]));

  const subset = (keep) => {
    const idx = fixtures.map((f, i) => (keep(f) ? i : -1)).filter((i) => i >= 0);
    return { n: idx.length, agree: idx.filter((i) => agree[i]).length };
  };

  const byTrap = {};
  for (const f of fixtures) {
    for (const id of trapsFor(skill, f)) byTrap[id] ??= subset((g) => trapsFor(skill, g).includes(id));
  }

  const summary = {
    n: fixtures.length,
    agree: agree.filter(Boolean).length,
    invalid: predicted.filter((p) => p === undefined).length,
    clean: subset((f) => trapsFor(skill, f).length === 0),
    traps: subset((f) => trapsFor(skill, f).length > 0),
    byTrap: Object.fromEntries(Object.entries(byTrap).sort(([a], [b]) => a.localeCompare(b))),
    disagreements: fixtures
      .map((f, i) => ({
        id: f.id,
        gold: gold[i],
        answer: predicted[i] === undefined ? "invalid" : predicted[i], // null is a real answer: skip
        traps: trapsFor(skill, f),
      }))
      .filter((_, i) => !agree[i]),
  };

  if (skill === "pr-labeler") {
    summary.labels = multiLabelReport(gold, predicted);
    summary.byCategory = {};
    for (const category of ["type", "priority", "size", "team", "domain"]) {
      const ok = fixtures.filter((f, i) => {
        if (predicted[i] === undefined) return false;
        return JSON.stringify(categorize(gold[i])[category]) === JSON.stringify(categorize(predicted[i])[category]);
      }).length;
      summary.byCategory[category] = { n: fixtures.length, agree: ok };
    }
  } else {
    summary.priority = classificationReport(gold, predicted, [...PRIORITIES, null]);
  }

  return summary;
}
