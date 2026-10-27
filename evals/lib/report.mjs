/**
 * Renders the eval results as markdown and keeps the generated blocks in the
 * READMEs in sync. Every number in those blocks comes from here: the
 * reference results are recomputed, the LLM results are read from the
 * committed evals/results/*.json files.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { EVALS_DIR, ROOT } from "./fixtures.mjs";
import { PRIORITIES } from "./gh-prioritizer.mjs";
import { SKIP } from "./metrics.mjs";

export const RESULTS_DIR = join(EVALS_DIR, "results");

const MODEL_ORDER = ["haiku", "sonnet", "opus"];

export function loadResults(dir = RESULTS_DIR) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => ({ file: name, ...JSON.parse(readFileSync(join(dir, name), "utf8")) }))
    .sort((a, b) => {
      if (a.skill !== b.skill) return a.skill === "pr-labeler" ? -1 : 1;
      const rank = (m) => (MODEL_ORDER.includes(m) ? MODEL_ORDER.indexOf(m) : MODEL_ORDER.length);
      return rank(a.model) - rank(b.model) || a.model.localeCompare(b.model);
    });
}

const pct = ({ agree, n }) => (n === 0 ? "—" : `${agree}/${n} (${Math.round((agree / n) * 100)}%)`);
const num = (x) => (x === null || x === undefined ? "—" : x.toFixed(2));
const cell = (text) => String(text).replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");
const code = (value) => (value === null ? "`null`" : `\`${value}\``);

function table(header, rows) {
  return [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`),
  ].join("\n");
}

export function renderSummary({ reference, results }) {
  const rows = [];
  const add = (skill, by, s, note = "") => rows.push([skill, by, pct(s), pct(s.clean), pct(s.traps), note]);

  add("pr-labeler", "reference implementation", reference["pr-labeler"]);
  for (const r of results.filter((r) => r.skill === "pr-labeler")) {
    add("pr-labeler", `${r.resolvedModel} (LLM)`, r.summary, `$${r.totals.costUsd.toFixed(2)} for the run`);
  }
  const thrown = Object.entries(reference.documented.errors).map(([e, c]) => `throws \`${e.split(":")[0]}\` on ${c}`);
  add("gh-prioritizer", "documented algorithm, run verbatim", reference.documented, thrown.join(", "));
  add("gh-prioritizer", "reference implementation", reference["gh-prioritizer"]);
  for (const r of results.filter((r) => r.skill === "gh-prioritizer")) {
    add("gh-prioritizer", `${r.resolvedModel} (LLM)`, r.summary, `$${r.totals.costUsd.toFixed(2)} for the run`);
  }

  return [
    table(["Skill", "Answered by", "Agrees with gold", "Clean fixtures", "Trap fixtures", "Notes"], rows),
    "",
    `On the same ${reference.crossSkill.n} pull requests, pr-labeler's priority label and gh-prioritizer's priority ` +
      `differ ${reference.crossSkill.differ} times.`,
  ].join("\n");
}

function labelerDetail(r) {
  const s = r.summary;
  const out = [];
  out.push(
    table(
      ["Category", "Agrees with gold"],
      Object.entries(s.byCategory).map(([category, c]) => [category, pct(c)]),
    ),
  );
  out.push("");
  out.push(
    `Label-level micro precision ${num(s.labels.micro.precision)}, recall ${num(s.labels.micro.recall)}, ` +
      `F1 ${num(s.labels.micro.f1)} over every (pull request, label) pair.`,
  );
  out.push("");
  out.push(
    table(
      ["Label", "Gold count", "Precision", "Recall", "F1"],
      Object.entries(s.labels.perLabel)
        .filter(([, c]) => c.fp + c.fn > 0)
        .map(([label, c]) => [`\`${label}\``, c.support, num(c.precision), num(c.recall), num(c.f1)]),
    ),
  );
  out.push("");
  out.push("Labels not listed above were applied with precision and recall 1.00.");
  return out;
}

function prioritizerDetail(r) {
  const p = r.summary.priority;
  const classes = [...PRIORITIES, SKIP];
  const shown = [...classes, "invalid"].filter(
    (c) => c !== "invalid" || classes.some((g) => p.confusion[g].invalid > 0),
  );
  return [
    `Accuracy ${num(p.accuracy)}, macro F1 ${num(p.macroF1)}, Cohen's κ ${num(p.kappa)}.`,
    "",
    table(
      ["Gold ↓ / model →", ...shown.map((c) => `\`${c}\``)],
      classes.map((g) => [`\`${g}\``, ...shown.map((c) => p.confusion[g][c] || "·")]),
    ),
  ];
}

function disagreementRows(r) {
  const reasons = new Map(r.predictions.map((p) => [p.id, p.reason ?? p.error ?? ""]));
  return r.summary.disagreements.map((d) => {
    const traps = d.traps.length ? d.traps.join(", ") : "—";
    if (r.skill === "pr-labeler") {
      const answer = d.answer === "invalid" ? [] : d.answer;
      const missing = d.gold.filter((l) => !answer.includes(l));
      const extra = answer.filter((l) => !d.gold.includes(l));
      return [
        `\`${d.id}\``,
        traps,
        missing.map((l) => `\`${l}\``).join(" ") || "—",
        d.answer === "invalid" ? "invalid answer" : extra.map((l) => `\`${l}\``).join(" ") || "—",
        reasons.get(d.id),
      ];
    }
    return [`\`${d.id}\``, traps, code(d.gold), d.answer === "invalid" ? "invalid" : code(d.answer), reasons.get(d.id)];
  });
}

export function renderDetail({ results }) {
  if (results.length === 0) return "_No LLM run has been recorded yet. Run `npm run eval:llm`._";
  const out = [];
  for (const r of results) {
    const s = r.summary;
    out.push(`### ${r.skill} × ${r.resolvedModel}`);
    out.push("");
    out.push(
      `${r.date} · ${r.runner} · ${s.n} fixtures · $${r.totals.costUsd.toFixed(2)} · ` +
        `${s.invalid} invalid answers · fixtures \`${r.fixturesSha256.slice(0, 12)}\``,
    );
    out.push("");
    out.push(`Agrees with gold on ${pct(s)}: ${pct(s.clean)} of clean fixtures, ${pct(s.traps)} of trap fixtures.`);
    out.push("");
    out.push(...(r.skill === "pr-labeler" ? labelerDetail(r) : prioritizerDetail(r)));
    out.push("");
    out.push(table(["Trap", "Fixtures", "Agrees with gold"], Object.entries(s.byTrap).map(([id, t]) => [id, t.n, pct(t)])));
    out.push("");
    out.push(`<details><summary>${s.disagreements.length} disagreements, with the model's own reason</summary>`);
    out.push("");
    const header =
      r.skill === "pr-labeler"
        ? ["Fixture", "Traps", "Missing", "Extra", "Model's reason"]
        : ["Fixture", "Traps", "Gold", "Model", "Model's reason"];
    out.push(table(header, disagreementRows(r)));
    out.push("");
    out.push("</details>");
    out.push("");
  }
  return out.join("\n").trimEnd();
}

export const BLOCKS = [
  { file: "README.md", name: "evals-summary", render: renderSummary },
  { file: "evals/README.md", name: "evals-summary", render: renderSummary },
  { file: "evals/README.md", name: "evals-detail", render: renderDetail },
];

const markers = (name) => [`<!-- ${name}:start -->`, `<!-- ${name}:end -->`];

export function readBlock(text, name) {
  const [start, end] = markers(name);
  const i = text.indexOf(start);
  const j = text.indexOf(end);
  if (i < 0 || j < i) return null;
  return text.slice(i + start.length, j).trim();
}

export function replaceBlock(text, name, content) {
  const [start, end] = markers(name);
  const i = text.indexOf(start);
  const j = text.indexOf(end);
  if (i < 0 || j < i) throw new Error(`missing ${start} … ${end} markers`);
  return `${text.slice(0, i + start.length)}\n${content}\n${text.slice(j)}`;
}

/** Every generated block with its current and expected content. */
export function blockStatus(data) {
  return BLOCKS.map((block) => {
    const path = join(ROOT, block.file);
    const text = readFileSync(path, "utf8");
    return { ...block, path, current: readBlock(text, block.name), expected: block.render(data).trim() };
  });
}
