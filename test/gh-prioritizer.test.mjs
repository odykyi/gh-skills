import { test } from "node:test";
import assert from "node:assert/strict";
import { PRIORITIES, RULES, prioritize } from "../evals/lib/gh-prioritizer.mjs";
import { loadDocumentedAlgorithm, runDocumented } from "../evals/lib/documented-algorithm.mjs";
import { loadFixtures, skillInput } from "../evals/lib/fixtures.mjs";

const { fixtures } = loadFixtures();
const RANK = { "P0-Critical": 4, "P1-High": 3, "P2-Medium": 2, "P3-Low": 1 };
const pr = (overrides) => ({ title: "", body: "", branch: "chore/x", labels: [], files: [], additions: 0, deletions: 0, ...overrides });

for (const fixture of fixtures) {
  test(`gold: ${fixture.id}`, () => {
    assert.equal(prioritize(skillInput("gh-prioritizer", fixture)).priority, fixture.gold["gh-prioritizer"]);
  });
}

test("overrides apply in the documented order", () => {
  const priority = (overrides) => prioritize(pr(overrides)).priority;
  assert.equal(priority({ labels: ["DO-NOT-MERGE", "security"] }), null);
  // WIP is checked before the hotfix branch (P5).
  assert.equal(priority({ labels: ["WIP"], branch: "hotfix/x" }), "P3-Low");
  assert.equal(priority({ branch: "hotfix/x", additions: 900 }), "P0-Critical");
  assert.equal(priority({ labels: ["security"], title: "typo" }), "P0-Critical");
  // pr-labeler's status label is not the WIP label the override looks for (P6).
  assert.equal(priority({ labels: ["status/wip"], additions: 10 }), "P3-Low");
  assert.equal(prioritize(pr({ labels: ["status/wip"], additions: 10 })).decidedBy, "p3:size");
});

test("the highest matching rule wins", () => {
  const result = prioritize(pr({ title: "Fix docs typo", files: ["src/payment/a.ts"], additions: 10 }));
  assert.equal(result.priority, "P0-Critical");
  assert.equal(result.decidedBy, "p0:files");
  assert.deepEqual(
    result.matches.map((m) => m.rule),
    ["p0:files", "p1:text", "p1:files", "p3:text", "p3:size"],
  );
});

test("text and file rules are substring matches, as documented (P2, P3)", () => {
  const decided = (overrides) => prioritize(pr({ additions: 10, ...overrides })).decidedBy;
  assert.equal(decided({ title: "Prefix cache keys" }), "p1:text");
  assert.equal(decided({ title: "Add debug logs" }), "p1:text");
  assert.equal(decided({ title: "Make it non-blocking" }), "p0:text");
  assert.equal(decided({ files: ["docs/authors.md"] }), "p0:files");
  assert.equal(decided({ files: ["src/OAuthButton.tsx"] }), "p3:size"); // case-sensitive
});

test("the size rules cover every size, so the P2-Medium default is unreachable (P4)", () => {
  for (const lines of [0, 1, 99, 100, 500, 501, 100_000]) {
    assert.notEqual(prioritize(pr({ additions: lines })).decidedBy, "default", `${lines} lines`);
  }
  assert.equal(prioritize(pr({ size: Number.NaN })).decidedBy, "default");
});

test("size thresholds: > 500 is P1, 100-500 is P2, < 100 is P3 (P9)", () => {
  const priority = (lines) => prioritize(pr({ additions: lines })).priority;
  assert.equal(priority(99), "P3-Low");
  assert.equal(priority(100), "P2-Medium");
  assert.equal(priority(500), "P2-Medium");
  assert.equal(priority(501), "P1-High");
});

test("**/settings/** from SKILL.md is a P1 rule (P7)", () => {
  assert.equal(prioritize(pr({ files: ["web/settings/Theme.vue"], additions: 5 })).decidedBy, "p1:settings");
});

test("every rule has a unique id and a known priority", () => {
  const ids = RULES.map((r) => r.rule);
  assert.equal(new Set(ids).size, ids.length);
  for (const rule of RULES) assert.ok(PRIORITIES.includes(rule.priority), rule.rule);
});

// ------------------------------------------------------------ properties

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const POOL = {
  titles: ["Add export", "Fix crash on save", "Update deps", "Refactor parser", "Docs: typo", "Urgent: outage", "Tidy logs"],
  branches: ["feature/a", "fix/b", "hotfix/c", "docs/d", "refactor/e", "chore/f", "deps/g"],
  labels: ["bug", "feature", "documentation", "refactor", "performance", "OKR", "impact/users", "status/blocked", "type/feature", "chore", "critical", "size/M"],
  files: ["src/api/users.ts", "src/auth/token.go", "README.md", "backend/service.py", "web/settings/a.vue", "tests/a.test.ts", "lib/util.c", "frontend/App.tsx"],
};

function randomPr(random) {
  const pick = (list) => list[Math.floor(random() * list.length)];
  const some = (list) => list.filter(() => random() < 0.25);
  return pr({
    title: pick(POOL.titles),
    branch: pick(POOL.branches),
    labels: some(POOL.labels),
    files: some(POOL.files),
    additions: Math.floor(random() * 800),
    deletions: Math.floor(random() * 200),
  });
}

test("property: the decision is the highest-ranked match", () => {
  const random = mulberry32(1);
  for (let i = 0; i < 500; i++) {
    const result = prioritize(randomPr(random));
    if (result.decidedBy.startsWith("override:")) continue;
    const top = Math.max(...result.matches.map((m) => RANK[m.priority]));
    assert.equal(RANK[result.priority], top);
  }
});

test("property: adding a label (other than WIP / DO-NOT-MERGE) or a file never lowers the priority", () => {
  const random = mulberry32(2);
  for (let i = 0; i < 500; i++) {
    const base = randomPr(random);
    const before = prioritize(base).priority;
    if (before === null) continue;
    const label = POOL.labels[Math.floor(random() * POOL.labels.length)];
    const file = POOL.files[Math.floor(random() * POOL.files.length)];
    for (const grown of [{ ...base, labels: [...base.labels, label] }, { ...base, files: [...base.files, file] }]) {
      const after = prioritize(grown).priority;
      assert.ok(RANK[after] >= RANK[before], `${JSON.stringify(grown)}: ${before} → ${after}`);
    }
  }
});

// ------------------------------------------- the algorithm as documented

const documented = loadDocumentedAlgorithm();

test("the documented algorithm agrees with the reference wherever it returns", () => {
  const random = mulberry32(3);
  const inputs = [...fixtures.map((f) => skillInput("gh-prioritizer", f)), ...Array.from({ length: 300 }, () => randomPr(random))];
  let returned = 0;
  for (const input of inputs) {
    const run = runDocumented(documented, input);
    if (run.error) continue;
    returned += 1;
    assert.equal(run.priority, prioritize(input).priority, JSON.stringify(input));
  }
  assert.ok(returned > 0);
});

test("the documented algorithm still throws once it reaches the rules (P1) — update evals/README.md when it stops", () => {
  for (const fixture of fixtures) {
    const input = skillInput("gh-prioritizer", fixture);
    if (prioritize(input).decidedBy.startsWith("override:")) continue;
    const run = runDocumented(documented, input);
    assert.match(run.error ?? "", /^TypeError: files\.some is not a function/, fixture.id);
  }
});
