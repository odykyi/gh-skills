/**
 * Runs the priority algorithm exactly as it is printed in
 * skills/gh-prioritizer/references/priority-detection-rules.md.
 *
 * The `javascript` blocks under "Detection Logic" and "Standard Overrides"
 * are extracted from the markdown and evaluated in a fresh V8 context, so the
 * eval measures the text an agent actually reads, not a paraphrase of it.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { ROOT } from "./fixtures.mjs";

export const DOC_PATH = join(ROOT, "skills", "gh-prioritizer", "references", "priority-detection-rules.md");

export function extractAlgorithm(markdown = readFileSync(DOC_PATH, "utf8")) {
  const blocks = [...markdown.matchAll(/```javascript\n([\s\S]*?)```/g)].map((m) => m[1]);
  const rules = blocks.find((block) => block.includes("const priorityRules"));
  const overrides = blocks.find((block) => block.includes("function determinePriority"));
  if (!rules || !overrides) {
    throw new Error(`${DOC_PATH}: could not find the priorityRules and determinePriority blocks`);
  }
  return `${rules}\n${overrides}\n;determinePriority`;
}

/** Returns determinePriority({ title, labels, files, size, branch }) from the doc. */
export function loadDocumentedAlgorithm(markdown) {
  const context = vm.createContext({});
  return vm.runInContext(extractAlgorithm(markdown), context, { filename: "priority-detection-rules.md" });
}

/** Calls the documented function on a PR; returns { priority } or { error }. */
export function runDocumented(determinePriority, pr) {
  const size = (pr.additions ?? 0) + (pr.deletions ?? 0);
  try {
    const priority = determinePriority({
      title: pr.title ?? "",
      labels: pr.labels ?? [],
      files: pr.files ?? [],
      size,
      branch: pr.branch ?? "",
    });
    return { priority };
  } catch (error) {
    return { error: `${error.name}: ${error.message}` };
  }
}
