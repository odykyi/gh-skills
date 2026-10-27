import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const EVALS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const ROOT = resolve(EVALS_DIR, "..");
export const FIXTURES_PATH = join(EVALS_DIR, "fixtures", "pull-requests.json");

export const SKILLS = ["pr-labeler", "gh-prioritizer"];

export function loadFixtures(path = FIXTURES_PATH) {
  const raw = readFileSync(path, "utf8");
  return { fixtures: JSON.parse(raw).fixtures, sha256: sha256(raw) };
}

export function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * The pull request each skill is asked about.
 *
 * gh-prioritizer is "called by pr-labeler (after labeling completes)" and
 * "labels inform priority detection", so it sees the PR's own labels plus the
 * gold pr-labeler labels. Using the gold labels (not a model's) keeps the two
 * evals independent: a labelling mistake cannot leak into the priority score.
 */
export function skillInput(skill, fixture) {
  const pr = {
    title: fixture.title,
    body: fixture.body,
    branch: fixture.branch,
    labels: fixture.labels,
    files: fixture.files,
    additions: fixture.additions,
    deletions: fixture.deletions,
  };
  if (skill === "gh-prioritizer") {
    pr.labels = [...new Set([...fixture.labels, ...fixture.gold["pr-labeler"]])];
  }
  return pr;
}
