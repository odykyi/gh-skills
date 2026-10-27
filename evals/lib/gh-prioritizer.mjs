/**
 * Reference implementation of the `set` command in
 * skills/gh-prioritizer/SKILL.md, following the "complete algorithm" in
 * skills/gh-prioritizer/references/priority-detection-rules.md.
 *
 * It is a second, independent encoding of that text: rules carry an id and
 * return the evidence that fired them, which the documented code does not.
 * test/gh-prioritizer.test.mjs checks that both give the same answer.
 *
 * Matching is by whole word, in any case (ambiguities P2, P3): title words and
 * path words are compared for equality, never as substrings. The PR body is
 * never read, and title words raise a PR to P1 at most (P8).
 *
 * Input:  { title, body, branch, labels: string[], files: string[], additions, deletions }
 * Output: { priority: "P0-Critical" | "P1-High" | "P2-Medium" | "P3-Low" | null,
 *           decidedBy, matches: [{ priority, rule, evidence }] }
 *
 * A null priority means the item is skipped (DO-NOT-MERGE).
 */

export const PRIORITIES = ["P0-Critical", "P1-High", "P2-Medium", "P3-Low"];
export const DEFAULT_PRIORITY = "P2-Medium";

const RANK = { "P0-Critical": 4, "P1-High": 3, "P2-Medium": 2, "P3-Low": 1 };

export const CRITICAL_PATH_WORDS = [
  "auth", "authentication", "authorization", "oauth", "payment", "payments",
  "security", "encryption", "credential", "credentials",
];
export const CUSTOMER_FACING_PATH_WORDS = [
  "api", "auth", "authentication", "payment", "payments", "frontend", "settings", "tsx", "jsx",
];
const TEST_WORDS = ["test", "tests", "spec", "specs"];

/** Lower-cased words of a title; hyphens and underscores inside a word stay in it. */
export const words = (text) => text.toLowerCase().match(/[a-z0-9]+(?:[-_][a-z0-9]+)*/g) ?? [];
/** Lower-cased words of a path, split at / . _ and - */
export const pathWords = (path) => path.toLowerCase().split(/[/._-]+/).filter(Boolean);
const isDoc = (path) => /\.(md|mdx|rst|txt)$/i.test(path);

function phraseIn(titleWords, phrase) {
  const p = phrase.split(" ");
  return titleWords.some((_, i) => p.every((w, j) => titleWords[i + j] === w));
}

const title = (phrases) => (pr) => {
  const t = words(pr.title);
  const hit = phrases.find((phrase) => phraseIn(t, phrase));
  return hit ? `title contains the word "${hit}"` : null;
};
const anyLabel = (names) => (pr) => {
  const hit = pr.labels.find((label) => names.includes(label.toLowerCase()));
  return hit ? `label ${hit}` : null;
};
const pathWord = (names, { codeOnly }) => (pr) => {
  for (const file of pr.files) {
    if (codeOnly && isDoc(file)) continue;
    const hit = pathWords(file).find((w) => names.includes(w));
    if (hit) return `file ${file} has the word "${hit}"`;
  }
  return null;
};
const size = (predicate, description) => (pr) =>
  predicate(pr.size) ? `${pr.size} lines (${description})` : null;

export const OVERRIDES = [
  { rule: "override:DO-NOT-MERGE", priority: null, test: anyLabel(["do-not-merge"]) },
  {
    rule: "override:hotfix-branch",
    priority: "P0-Critical",
    test: (pr) => (pr.branch.toLowerCase().startsWith("hotfix/") ? `branch ${pr.branch}` : null),
  },
  { rule: "override:security-label", priority: "P0-Critical", test: anyLabel(["security"]) },
  { rule: "override:WIP", priority: "P3-Low", test: anyLabel(["wip", "status/wip"]) },
];

export const RULES = [
  // P0-Critical: nothing the author can type into the title or body
  {
    priority: "P0-Critical",
    rule: "p0:label",
    test: anyLabel(["hotfix", "critical", "security", "production-down", "impact/production", "impact/security"]),
  },
  { priority: "P0-Critical", rule: "p0:files", test: pathWord(CRITICAL_PATH_WORDS, { codeOnly: true }) },

  // P1-High
  {
    priority: "P1-High",
    rule: "p1:title",
    test: title([
      "bug", "bugs", "fix", "fixes", "fixed", "error", "errors", "404", "500", "crash", "crashes", "crashed",
      "broken", "not working", "user-facing",
      // the old P0 words: a title can raise a PR to P1 at most
      "critical", "urgent", "emergency", "outage", "blocking", "hotfix", "security", "data loss", "production down",
    ]),
  },
  { priority: "P1-High", rule: "p1:label", test: anyLabel(["bug", "okr", "user-facing", "status/blocked", "impact/users"]) },
  { priority: "P1-High", rule: "p1:files", test: pathWord(CUSTOMER_FACING_PATH_WORDS, { codeOnly: true }) },
  { priority: "P1-High", rule: "p1:size", test: size((n) => n >= 500, ">= 500, size/XL") },

  // P2-Medium
  {
    priority: "P2-Medium",
    rule: "p2:title",
    test: title([
      "enhancement", "improve", "improves", "improved", "update", "updates", "updated", "optimize", "optimizes",
      "optimized", "feature", "features",
    ]),
  },
  { priority: "P2-Medium", rule: "p2:label", test: anyLabel(["enhancement", "performance", "feature", "type/feature"]) },
  { priority: "P2-Medium", rule: "p2:files", test: pathWord(["service", "services", "api", "backend"], { codeOnly: true }) },

  // P3-Low
  {
    priority: "P3-Low",
    rule: "p3:title",
    test: title([
      "doc", "docs", "documentation", "test", "tests", "chore", "style", "typo", "readme", "refactor", "refactors",
      "refactored",
    ]),
  },
  { priority: "P3-Low", rule: "p3:label", test: anyLabel(["documentation", "testing", "dependencies", "chore", "refactor"]) },
  { priority: "P3-Low", rule: "p3:files", test: pathWord(["md", "test", "tests", "spec", "specs"], { codeOnly: false }) },
  {
    priority: "P3-Low",
    rule: "p3:small-docs-or-tests",
    test: (pr) =>
      pr.size < 100 &&
      (pr.labels.some((l) => l.toLowerCase() === "documentation") ||
        (pr.files.length > 0 && pr.files.every((f) => pathWords(f).some((w) => TEST_WORDS.includes(w)))))
        ? "small PR with only docs or tests"
        : null,
  },
];

function normalize(pr) {
  return {
    title: pr.title ?? "",
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
