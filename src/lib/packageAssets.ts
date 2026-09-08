import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/**
 * Locates a file inside an installed package.
 *
 * `require.resolve` is tried first, but bundlers rewrite it, so fall back to
 * walking up from the working directory looking for node_modules. Returns null
 * when the asset is genuinely absent.
 */
export function findPackageAsset(relativePath: string): string | null {
  try {
    const resolved = require.resolve(/* turbopackIgnore: true */ relativePath);
    if (fs.statSync(resolved).isFile()) return resolved;
  } catch {
    /* bundled builds rewrite require.resolve; fall through */
  }

  let dir = process.cwd();
  for (let depth = 0; depth < 6; depth++) {
    const candidate = path.join(dir, "node_modules", relativePath);
    try {
      if (fs.statSync(/* turbopackIgnore: true */ candidate).isFile()) return candidate;
    } catch {
      /* keep walking up */
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const warned = new Set<string>();

export function readPackageAsset(relativePath: string): string {
  const resolved = findPackageAsset(relativePath);
  if (!resolved) {
    // Degrading silently here once cost us correctly typeset maths, so say so.
    if (!warned.has(relativePath)) {
      warned.add(relativePath);
      console.warn(`[assets] could not locate ${relativePath}; continuing without it.`);
    }
    return "";
  }
  try {
    return fs.readFileSync(/* turbopackIgnore: true */ resolved, "utf8");
  } catch {
    return "";
  }
}
