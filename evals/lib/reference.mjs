/**
 * The deterministic half of the eval: the reference implementations and the
 * verbatim documented algorithm, scored against the gold answers.
 */

import { labelPullRequest } from "./pr-labeler.mjs";
import { prioritize } from "./gh-prioritizer.mjs";
import { loadDocumentedAlgorithm, runDocumented } from "./documented-algorithm.mjs";
import { skillInput } from "./fixtures.mjs";
import { scoreSkill } from "./score.mjs";

export function referenceAnswer(skill, fixture) {
  const pr = skillInput(skill, fixture);
  return skill === "pr-labeler" ? labelPullRequest(pr).labels : prioritize(pr).priority;
}

export function referenceResults(fixtures) {
  const answers = (skill) => new Map(fixtures.map((f) => [f.id, referenceAnswer(skill, f)]));

  const determinePriority = loadDocumentedAlgorithm();
  const documentedAnswers = new Map();
  const errors = {};
  for (const f of fixtures) {
    const run = runDocumented(determinePriority, skillInput("gh-prioritizer", f));
    if (run.error) errors[run.error] = (errors[run.error] ?? 0) + 1;
    else documentedAnswers.set(f.id, run.priority);
  }

  // pr-labeler also assigns a priority label. How often does it disagree with
  // the gh-prioritizer answer for the same pull request?
  const differ = fixtures.filter((f) => {
    const labelerPriority = f.gold["pr-labeler"].find((label) => /^P\d-/.test(label)) ?? null; // no label: skipped
    return labelerPriority !== f.gold["gh-prioritizer"];
  });

  return {
    "pr-labeler": scoreSkill("pr-labeler", fixtures, answers("pr-labeler")),
    "gh-prioritizer": scoreSkill("gh-prioritizer", fixtures, answers("gh-prioritizer")),
    documented: {
      ...scoreSkill("gh-prioritizer", fixtures, documentedAnswers),
      errors,
    },
    crossSkill: { n: fixtures.length, differ: differ.length },
  };
}
