#!/usr/bin/env node
/**
 * Prints the eval results as markdown, or keeps the generated blocks in
 * README.md and evals/README.md in sync with them.
 *
 *   node evals/report.mjs           print the summary and detail tables
 *   node evals/report.mjs --write   rewrite the generated blocks in the READMEs
 *   node evals/report.mjs --check   exit 1 if a generated block is out of date
 */

import { readFileSync, writeFileSync } from "node:fs";
import { loadFixtures } from "./lib/fixtures.mjs";
import { referenceResults } from "./lib/reference.mjs";
import { blockStatus, loadBaseline, loadResults, renderDelta, renderDetail, renderSummary, replaceBlock } from "./lib/report.mjs";

const { fixtures } = loadFixtures();
const data = { fixtures, reference: referenceResults(fixtures), results: loadResults(), baseline: loadBaseline() };

if (process.argv.includes("--write")) {
  for (const block of blockStatus(data)) {
    if (block.current === block.expected) continue;
    writeFileSync(block.path, replaceBlock(readFileSync(block.path, "utf8"), block.name, block.expected));
    console.log(`updated ${block.file} (${block.name})`);
  }
} else if (process.argv.includes("--check")) {
  const stale = blockStatus(data).filter((block) => block.current !== block.expected);
  for (const block of stale) {
    console.error(`error    ${block.file}: the ${block.name} block is out of date — run node evals/report.mjs --write`);
  }
  process.exit(stale.length ? 1 : 0);
} else {
  console.log(renderSummary(data));
  console.log();
  console.log(renderDelta(data));
  console.log();
  console.log(renderDetail(data));
}
