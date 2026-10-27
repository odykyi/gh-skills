#!/usr/bin/env node
/**
 * Scores the reference implementations of pr-labeler and gh-prioritizer, and
 * the gh-prioritizer algorithm exactly as documented, against the gold answers.
 * Zero dependencies, no network. Exits 1 when a reference implementation
 * disagrees with a gold answer.
 *
 *   node evals/run-reference.mjs          human-readable summary
 *   node evals/run-reference.mjs --json   full results as JSON
 */

import { loadFixtures } from "./lib/fixtures.mjs";
import { referenceResults } from "./lib/reference.mjs";

const { fixtures } = loadFixtures();
const results = referenceResults(fixtures);

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(results, null, 2));
} else {
  const line = (name, s) => console.log(`${name.padEnd(40)} ${s.agree}/${s.n} agree with gold`);
  console.log(`${fixtures.length} fixtures\n`);
  line("pr-labeler reference", results["pr-labeler"]);
  line("gh-prioritizer reference", results["gh-prioritizer"]);
  line("gh-prioritizer documented (verbatim)", results.documented);
  for (const [error, count] of Object.entries(results.documented.errors)) {
    console.log(`${"".padEnd(40)} ${count} threw ${error}`);
  }
  console.log(
    `\npr-labeler's priority label differs from gh-prioritizer's priority on ` +
      `${results.crossSkill.differ}/${results.crossSkill.n} pull requests`,
  );
}

let failed = false;
for (const skill of ["pr-labeler", "gh-prioritizer"]) {
  for (const d of results[skill].disagreements) {
    failed = true;
    console.error(`error    ${skill} ${d.id}: gold ${JSON.stringify(d.gold)}, reference ${JSON.stringify(d.answer)}`);
  }
}
process.exit(failed ? 1 : 0);
