/**
 * Reference implementation of the `set` command in
 * skills/gh-prioritizer/SKILL.md, following the "complete algorithm" in
 * skills/gh-prioritizer/references/priority-detection-rules.md.
 *
 * The documented `determinePriority` loop hands every one-argument rule the
 * labels, the files, the size and the branch in turn, so a rule written for
 * the file list is called with a label string and throws (ambiguity P1).
 * Here each rule receives the input it was written for. Everything else —
 * substring matching, case sensitivity, override order — is kept exactly as
 * documented, defects included, so the gold answers stay faithful to the text.
 *
 * Input:  { title, body, branch, labels: string[], files: string[], additions, deletions }
 * Output: { priority: "P0-Critical" | "P1-High" | "P2-Medium" | "P3-Low" | null,
 *           decidedBy, matches: [{ priority, rule, evidence }] }
 *
 * A null priority means the item is skipped (DO-NOT-MERGE).
 */

import { firstMatch } from "./glob.mjs";

export const PRIORITIES = ["P0-Critical", "P1-High", "P2-Medium", "P3-Low"];
export const DEFAULT_PRIORITY = "P2-Medium";

const RANK = { "P0-Critical": 4, "P1-High": 3, "P2-Medium": 2, "P3-Low": 1 };

const text = (regex) => (pr) => {
  const hit = `${pr.title ?? ""}\n${pr.body ?? ""}`.match(regex);
  return hit ? `text contains "${hit[0]}"` : null;
};
const anyLabel = (names) => (pr) => {
  const hit = pr.labels.find((label) => names.includes(label));
  return hit ? `label ${hit}` : null;
};
const fileContaining = (needles) => (pr) => {
  for (const file of pr.files) {
    const needle = needles.find((n) => file.includes(n)); // case-sensitive, as documented
    if (needle) return `file ${file} contains "${needle}"`;
  }
  return null;
};
const size = (predicate, description) => (pr) =>
  predicate(pr.size) ? `${pr.size} lines (${description})` : null;

export const OVERRIDES = [
  { rule: "override:DO-NOT-MERGE", priority: null, test: anyLabel(["DO-NOT-MERGE"]) },
  { rule: "override:WIP", priority: "P3-Low", test: anyLabel(["WIP"]) },
  {
    rule: "override:hotfix-branch",
    priority: "P0-Critical",
    test: (pr) => (pr.branch.startsWith("hotfix/") ? `branch ${pr.branch}` : null),
  },
  { rule: "override:security-label", priority: "P0-Critical", test: anyLabel(["security"]) },
];

export const RULES = [
  // P0-Critical
  {
    priority: "P0-Critical",
    rule: "p0:text",
    test: text(/critical|urgent|hotfix|security|data loss|production down|outage|blocking|emergency/i),
  },
  { priority: "P0-Critical", rule: "p0:label", test: anyLabel(["hotfix", "critical", "security", "production-down"]) },
  {
    priority: "P0-Critical",
    rule: "p0:files",
    test: fileContaining(["auth", "payment", "security", "encryption", "credential"]),
  },
  {
    priority: "P0-Critical",
    rule: "p0:branch",
    test: (pr) => (/^hotfix\//.test(pr.branch) ? `branch ${pr.branch}` : null),
  },
  { priority: "P0-Critical", rule: "p0:impact", test: anyLabel(["impact/production", "impact/security"]) },

  // P1-High
  { priority: "P1-High", rule: "p1:text", test: text(/bug|fix|user-facing|error|404|500|crash|broken|not working/i) },
  { priority: "P1-High", rule: "p1:label", test: anyLabel(["bug", "feature", "OKR", "user-facing"]) },
  { priority: "P1-High", rule: "p1:files", test: fileContaining(["api", "auth", "payment", "frontend"]) },
  // SKILL.md lists `**/settings/**` → P1; the "complete algorithm" omits it (ambiguity P6).
  {
    priority: "P1-High",
    rule: "p1:settings",
    test: (pr) => {
      const hit = firstMatch(pr.files, ["**/settings/**"]);
      return hit ? `file ${hit.path} matches ${hit.pattern}` : null;
    },
  },
  { priority: "P1-High", rule: "p1:size", test: size((n) => n > 500, "> 500") },
  { priority: "P1-High", rule: "p1:status", test: anyLabel(["status/blocked", "impact/users"]) },

  // P2-Medium
  { priority: "P2-Medium", rule: "p2:text", test: text(/enhancement|improve|refactor|update|optimize|feature/i) },
  { priority: "P2-Medium", rule: "p2:label", test: anyLabel(["enhancement", "refactor", "performance"]) },
  { priority: "P2-Medium", rule: "p2:files", test: fileContaining(["service", "api", "backend"]) },
  { priority: "P2-Medium", rule: "p2:size", test: size((n) => n >= 100 && n <= 500, "100-500") },
  {
    priority: "P2-Medium",
    rule: "p2:type-feature",
    test: (pr) =>
      pr.labels.includes("type/feature") && !pr.labels.includes("impact/users") ? "label type/feature" : null,
  },

  // P3-Low
  { priority: "P3-Low", rule: "p3:text", test: text(/docs|documentation|test|chore|style|typo|readme/i) },
  { priority: "P3-Low", rule: "p3:label", test: anyLabel(["documentation", "testing", "dependencies", "chore"]) },
  { priority: "P3-Low", rule: "p3:files", test: fileContaining([".md", "test", "spec", "__tests__"]) },
  { priority: "P3-Low", rule: "p3:size", test: size((n) => n < 100, "< 100") },
  {
    priority: "P3-Low",
    rule: "p3:small-docs-or-tests",
    test: (pr) =>
      pr.size < 100 &&
      (pr.labels.includes("documentation") || (pr.files.length > 0 && pr.files.every((f) => f.includes("test"))))
        ? "small PR with only docs or tests"
        : null,
  },
];

function normalize(pr) {
  return {
    title: pr.title ?? "",
    body: pr.body ?? "",
    branch: pr.branch ?? "",
    labels: pr.labels ?? [],
    files: pr.files ?? [],
    size: pr.size ?? (pr.additions ?? 0) + (pr.deletions ?? 0),
  };
}

export function prioritize(input) {
  const pr = normalize(input);

  for (const override of OVERRIDES) {
    const evidence = override.test(pr);
    if (evidence) {
      return {
        priority: override.priority,
        decidedBy: override.rule,
        matches: [{ priority: override.priority, rule: override.rule, evidence }],
      };
    }
  }

  const matches = [];
  for (const rule of RULES) {
    const evidence = rule.test(pr);
    if (evidence) matches.push({ priority: rule.priority, rule: rule.rule, evidence });
  }

  // "Use the highest priority that matches"; ties go to the first rule listed.
  let best = null;
  for (const match of matches) {
    if (!best || RANK[match.priority] > RANK[best.priority]) best = match;
  }

  return best
    ? { priority: best.priority, decidedBy: best.rule, matches }
    : { priority: DEFAULT_PRIORITY, decidedBy: "default", matches };
}
