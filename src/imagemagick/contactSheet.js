"use strict";

const { execImageMagick } = require("../util/shell");
const { resolveFont } = require("./font");

const DEFAULTS = {
  tile: "4x",
  geometry: "200x150+6+6",
  label: "%f",
};

/**
 * buildContactSheet(filePaths, outPath, opts = {}) -> Promise<void>
 * Runs ImageMagick `montage -label '<label>' -font <font> <filePaths...> -tile <tile>
 * -geometry <geometry> <outPath>`. `-label`/`-font` set before the file list are global IM
 * settings applied to every subsequent input, so every tile gets a filename caption rendered with
 * a concrete font. `-font` is load-bearing for the same reason as in watermark.js: montage renders
 * the `-label` text and fails with `unable to read font ''` on a host with no default font.
 * `opts.font` (CLI `--font`) / WATERMARK_FONT override the bundled default -- see font.js. Throws
 * if filePaths is empty (montage has no meaningful single-call output for zero images) or if the
 * tool call fails.
 */
async function buildContactSheet(filePaths, outPath, opts = {}) {
  if (!Array.isArray(filePaths) || filePaths.length === 0) {
    throw new Error("buildContactSheet: filePaths must be a non-empty array");
  }
  const { tile, geometry, label } = { ...DEFAULTS, ...opts };
  const font = resolveFont({ font: opts.font });

  const { stderr, exitCode } = await execImageMagick("montage", [
    "-label",
    label,
    "-font",
    font,
    ...filePaths,
    "-tile",
    tile,
    "-geometry",
    geometry,
    outPath,
  ]);

  if (exitCode === null) {
    throw new Error(`buildContactSheet: ImageMagick not found (${stderr.trim()})`);
  }
  if (exitCode !== 0) {
    throw new Error(`buildContactSheet: montage exited ${exitCode}: ${stderr.trim()}`);
  }
}

module.exports = { buildContactSheet };
