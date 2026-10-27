/**
 * Path globs with gitignore / CODEOWNERS semantics. Zero dependencies.
 *
 *   *    any run of characters inside one path segment
 *   **   any number of whole segments, including none
 *   ?    one character that is not "/"
 *
 * A pattern without a "/" (`*.yml`, `*api*`) is tested against every segment
 * of the path, so it matches at any depth. A pattern with a "/" is anchored at
 * the repository root: `frontend/**` matches `frontend/app.ts` but not
 * `apps/frontend/app.ts`. Matching is case-sensitive, like git on Linux.
 */

const cache = new Map();

export function globToRegExp(pattern) {
  let cached = cache.get(pattern);
  if (cached) return cached;

  let source = "";
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === "*" && pattern[i + 1] === "*") {
      const atStart = i === 0 || pattern[i - 1] === "/";
      const followedBySlash = pattern[i + 2] === "/";
      if (atStart && followedBySlash) {
        source += "(?:.*/)?"; // `**/` — zero or more leading segments
        i += 2;
      } else {
        source += ".*"; // trailing `/**`, or `**` inside a segment
        i += 1;
      }
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }

  cached = new RegExp(`^${source}$`);
  cache.set(pattern, cached);
  return cached;
}

/** True when `path` matches `pattern` (see the module comment for semantics). */
export function matchGlob(path, pattern) {
  const regex = globToRegExp(pattern);
  if (pattern.includes("/")) return regex.test(path);
  return path.split("/").some((segment) => regex.test(segment));
}

/** The first path in `paths` that matches any of `patterns`, or null. */
export function firstMatch(paths, patterns) {
  for (const path of paths) {
    for (const pattern of patterns) {
      if (matchGlob(path, pattern)) return { path, pattern };
    }
  }
  return null;
}
