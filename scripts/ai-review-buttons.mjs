#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

export const MARKER = "<!-- ai-review-buttons -->";
export const LEGACY_MARKER = "<!-- grok-review-button -->";
export const MARKERS = [MARKER, LEGACY_MARKER];

export function buildPrompt(prUrl) {
  return `Review this pull request. Read the title and diff at ${prUrl}.`;
}

export function buildButtonsHtml(prUrl) {
  const q = encodeURIComponent(buildPrompt(prUrl));
  const badge = (name, color, logo) =>
    `https://img.shields.io/badge/${encodeURIComponent(name)}-${color}?style=for-the-badge&logo=${logo}&logoColor=white`;
  const codexLogo = encodeURIComponent(
    "data:image/svg+xml;base64," +
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#fff" d="M22.28 9.82a6 6 0 0 0-.52-4.91 6.05 6.05 0 0 0-6.51-2.9A6.07 6.07 0 0 0 4.98 4.18a6 6 0 0 0-4 2.9 6.05 6.05 0 0 0 .74 7.1 6 6 0 0 0 .51 4.91 6.05 6.05 0 0 0 6.52 2.9A6 6 0 0 0 13.26 24a6.06 6.06 0 0 0 5.77-4.21 6 6 0 0 0 4-2.9 6.06 6.06 0 0 0-.75-7.07z"/></svg>`,
      ).toString("base64"),
  );
  return [
    `[![Grok](${badge("Grok", "111111", "x")})](https://grok.com/?q=${q})`,
    `[![Claude](${badge("Claude", "D97757", "anthropic")})](https://claude.ai/new?q=${q})`,
    `[![Codex](${badge("Codex", "10A37F", codexLogo)})](https://chatgpt.com/?q=${q})`,
  ].join("&nbsp;");
}

export function buildGeneratedSection(prUrl) {
  return [MARKER, "", "---", "", "# Review this PR in", buildButtonsHtml(prUrl), "", "<sub>Shared by [@tdk-landscape](https://github.com/tdk-landscape) · [tdk-cli-core](https://github.com/tdk-landscape/tdk-cli-core) · If this helps, please ⭐ [star tdk-cli-core](https://github.com/tdk-landscape/tdk-cli-core)</sub>", ""].join("\n");
}

export function joinAuthorAndSection(authorBody, section) {
  if (authorBody === "") return section;
  if (authorBody.endsWith("\n\n")) return `${authorBody}${section}`;
  if (authorBody.endsWith("\n")) return `${authorBody}\n${section}`;
  return `${authorBody}\n\n${section}`;
}

function markerIndex(body) {
  let idx = -1;
  for (const m of MARKERS) {
    const i = body.indexOf(m);
    if (i !== -1 && (idx === -1 || i < idx)) idx = i;
  }
  return idx;
}

export function transformBody(body, prUrl) {
  const url = (prUrl ?? "").trim();
  if (!url) return { action: "skip", body, reason: "missing pr url" };

  const section = buildGeneratedSection(url);
  const idx = markerIndex(body);
  if (idx === -1) {
    return { action: "patch", body: joinAuthorAndSection(body, section), reason: "append review buttons" };
  }
  const authorPart = body.slice(0, idx);
  const existing = body.slice(idx).replace(/\s+$/, "");
  if (existing === section.replace(/\s+$/, "")) {
    return { action: "skip", body, reason: "marker present and prompt matches" };
  }
  return {
    action: "patch",
    body: joinAuthorAndSection(authorPart, section),
    reason: "regenerate review buttons for current url",
  };
}

const bodyFile = process.env.BODY_FILE;
const outFile = process.env.OUT_FILE;
if (bodyFile && outFile) {
  const result = transformBody(readFileSync(bodyFile, "utf8"), process.env.PR_URL ?? "");
  writeFileSync(outFile, result.body, "utf8");
  console.log(`${result.action}: ${result.reason}`);
}
