import { test } from "node:test";
import assert from "node:assert/strict";
import { categorize, labelPullRequest, sizeLabel } from "../evals/lib/pr-labeler.mjs";
import { loadFixtures, skillInput } from "../evals/lib/fixtures.mjs";

const { fixtures } = loadFixtures();
const pr = (overrides) => ({ branch: "chore/x", files: [], additions: 0, deletions: 0, ...overrides });

for (const fixture of fixtures) {
  test(`gold: ${fixture.id}`, () => {
    const result = labelPullRequest(skillInput("pr-labeler", fixture));
    assert.deepEqual(result.labels, [...fixture.gold["pr-labeler"]].sort());
  });
}

test("size buckets follow the table, 500 lines is size/XL (L6)", () => {
  const expected = [
    [0, "size/XS"], [49, "size/XS"], [50, "size/S"], [99, "size/S"], [100, "size/M"],
    [299, "size/M"], [300, "size/L"], [499, "size/L"], [500, "size/XL"], [10_000, "size/XL"],
  ];
  for (const [lines, label] of expected) assert.equal(sizeLabel(lines), label, `${lines} lines`);
});

test("size counts additions and deletions", () => {
  assert.equal(labelPullRequest(pr({ additions: 30, deletions: 20 })).size, "size/S");
});

test("type labels come from the branch prefix", () => {
  const expected = {
    "feature/x": ["feature"],
    "fix/x": ["bug"],
    "bugfix/x": ["bug"],
    "hotfix/x": ["hotfix"],
    "refactor/x": ["refactor"],
    "docs/x": ["documentation"],
    "security/x": ["security", "security-review"],
    "performance/x": ["performance"],
    "deps/x": ["dependencies"],
    "feat/x": [], // unmapped prefix (L4)
    "Feature/x": [], // prefixes are case-sensitive
  };
  for (const [branch, type] of Object.entries(expected)) {
    assert.deepEqual(labelPullRequest(pr({ branch })).type, type, branch);
  }
});

test("a branch prefix spans later slashes", () => {
  assert.deepEqual(labelPullRequest(pr({ branch: "feature/auth/login" })).type, ["feature"]);
});

test("priority: hotfix P0, customer-facing feature P1, internal feature P2, docs/refactor P3, else P2", () => {
  const priority = (branch, files = []) => labelPullRequest(pr({ branch, files })).priority;
  assert.equal(priority("hotfix/x"), "P0-Critical");
  assert.equal(priority("feature/x", ["web/Button.jsx"]), "P1-High");
  assert.equal(priority("feature/x", ["services/api/users.go"]), "P1-High");
  assert.equal(priority("feature/x", ["backend/jobs/export.py"]), "P2-Medium");
  assert.equal(priority("docs/x"), "P3-Low");
  assert.equal(priority("refactor/x"), "P3-Low");
  assert.equal(priority("security/x"), "P2-Medium"); // no rule: default
  assert.equal(priority("fix/x"), "P2-Medium");
});

test("every pull request gets exactly one priority and one size label", () => {
  for (const fixture of fixtures) {
    const { labels } = labelPullRequest(skillInput("pr-labeler", fixture));
    assert.equal(labels.filter((l) => /^P\d-/.test(l)).length, 1, fixture.id);
    assert.equal(labels.filter((l) => l.startsWith("size/")).length, 1, fixture.id);
  }
});

test("team rules use root-anchored paths (L2) and literal extensions (L5)", () => {
  const team = (files) => labelPullRequest(pr({ files })).team;
  assert.deepEqual(team(["frontend/a.ts"]), ["team/frontend"]);
  assert.deepEqual(team(["apps/frontend/a.ts"]), []);
  assert.deepEqual(team(["deep/nested/Widget.tsx"]), ["team/frontend"]);
  assert.deepEqual(team(["web/Widget.jsx"]), []);
  assert.deepEqual(team(["ci/deploy.yml"]), ["team/devops"]);
  assert.deepEqual(team(["ci/deploy.yaml"]), []);
  assert.deepEqual(team(["lib/auth/token.go"]), ["team/security"]);
  assert.deepEqual(team(["tests/a.py", "src/b.spec.js"]), ["team/qa"]);
});

test("domain globs are substring globs over the branch and every path segment (L3)", () => {
  const domain = (branch, files = []) => labelPullRequest(pr({ branch, files })).domain;
  assert.deepEqual(domain("feature/payment-retry"), ["domain/payment"]);
  assert.deepEqual(domain("chore/build"), ["domain/ui"]);
  assert.deepEqual(domain("chore/x", ["src/rapid.ts"]), ["domain/api"]);
  assert.deepEqual(domain("chore/x", ["src/authors.ts"]), ["domain/auth"]);
  assert.deepEqual(domain("chore/x", ["src/OAuth.ts"]), []); // case-sensitive
});

test("the result does not depend on file order", () => {
  for (const fixture of fixtures) {
    const input = skillInput("pr-labeler", fixture);
    const reversed = { ...input, files: [...input.files].reverse() };
    assert.deepEqual(labelPullRequest(reversed).labels, labelPullRequest(input).labels, fixture.id);
  }
});

test("every applied label has evidence", () => {
  for (const fixture of fixtures) {
    const result = labelPullRequest(skillInput("pr-labeler", fixture));
    for (const label of result.labels) {
      const key = /^P\d-/.test(label) ? "priority" : label;
      assert.ok(result.evidence[key], `${fixture.id}: no evidence for ${label}`);
    }
  }
});

test("categorize sorts a flat label list into the skill's categories", () => {
  assert.deepEqual(categorize(["team/qa", "P1-High", "bug", "size/S", "domain/api", "security-review"]), {
    type: ["bug", "security-review"],
    priority: ["P1-High"],
    size: ["size/S"],
    team: ["team/qa"],
    domain: ["domain/api"],
  });
});
