import { test } from "node:test";
import assert from "node:assert/strict";
import { firstMatch, globToRegExp, matchGlob } from "../evals/lib/glob.mjs";

const cases = [
  // pattern, path, expected
  ["*.yml", ".github/workflows/ci.yml", true], // slash-less: any depth
  ["*.yml", "ci.yaml", false],
  ["*.tsx", "frontend/src/App.tsx", true],
  ["*api*", "src/rapid/x.ts", true], // a glob, not a word match
  ["*api*", "src/client.ts", false],
  ["*ui*", "scripts/deploy.sh", false],
  ["*ui*", ".github/workflows/build.yml", true], // b-ui-ld
  ["frontend/**", "frontend/src/App.tsx", true],
  ["frontend/**", "apps/frontend/src/App.tsx", false], // anchored at the root
  ["**/auth/**", "auth/session.go", true], // `**/` matches zero segments
  ["**/auth/**", "server/auth/session.go", true],
  ["**/auth/**", "server/oauth/session.go", false],
  ["**/*.test.*", "Button.test.tsx", true],
  ["**/*.test.*", "src/a/b/Button.test.tsx", true],
  ["**/*.test.*", "src/test_button.py", false],
  ["**/*.spec.*", "src/payment.spec.ts", true],
  ["docs/?.md", "docs/a.md", true],
  ["docs/?.md", "docs/ab.md", false],
  ["*.TSX", "App.tsx", false], // case-sensitive
];

for (const [pattern, path, expected] of cases) {
  test(`${pattern} ${expected ? "matches" : "does not match"} ${path}`, () => {
    assert.equal(matchGlob(path, pattern), expected);
  });
}

test("regex metacharacters in a pattern are literal", () => {
  assert.equal(matchGlob("a+b(c).md", "a+b(c).md"), true);
  assert.equal(matchGlob("aab(c)xmd", "a+b(c).md"), false);
});

test("compiled patterns are cached", () => {
  assert.equal(globToRegExp("src/**"), globToRegExp("src/**"));
});

test("firstMatch reports which path and pattern matched", () => {
  assert.deepEqual(firstMatch(["README.md", "infra/main.tf"], ["docker/**", "infra/**"]), {
    path: "infra/main.tf",
    pattern: "infra/**",
  });
  assert.equal(firstMatch(["README.md"], ["infra/**"]), null);
});
