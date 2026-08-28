"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

/**
 * applyPlan(plan, { outDir, move = false }) -> Promise<{ manifest, manifestPath }>
 *
 * Executes a planNames() plan against the filesystem:
 *   - creates every destination directory under outDir
 *   - copies each srcPath to outDir/destRelPath (fs.copyFile) by default; with move: true,
 *     renames instead (fs.rename) -- the CLI's --move flag is the only way to opt into this,
 *     so a consumer's original photos are never mutated/deleted unless explicitly asked.
 *   - writes outDir/manifest.json: the full before->after mapping, plus per-entry metadata the
 *     caller supplies (city/date), which is the acceptance test's machine-checkable artifact.
 *
 * `plan` entries must carry { srcPath, destRelPath } (from planNames) and MAY carry extra
 * fields (e.g. dateTimeOriginal, city) which are passed through into the manifest verbatim.
 */
async function applyPlan(plan, { outDir, move = false } = {}) {
  if (!outDir) throw new Error("applyPlan: outDir is required");
  if (!Array.isArray(plan)) throw new Error("applyPlan: plan must be an array");

  await fs.mkdir(outDir, { recursive: true });

  const entries = [];
  for (const item of plan) {
    const destPath = path.join(outDir, item.destRelPath);
    await fs.mkdir(path.dirname(destPath), { recursive: true });

    if (move) {
      await fs.rename(item.srcPath, destPath);
    } else {
      await fs.copyFile(item.srcPath, destPath);
    }

    entries.push({
      ...item,
      destPath,
    });
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    mode: move ? "move" : "copy",
    outDir,
    count: entries.length,
    entries,
  };

  const manifestPath = path.join(outDir, "manifest.json");
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");

  return { manifest, manifestPath };
}

module.exports = { applyPlan };
