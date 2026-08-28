"use strict";

const { execImageMagick } = require("../util/shell");

const DEFAULTS = {
  gravity: "SouthEast",
  pointsize: 28,
  fill: "rgba(255,255,255,0.65)",
  offset: "+20+20",
};

/**
 * watermarkFile(filePath, text, opts = {}) -> Promise<void>
 * Runs ImageMagick `convert <filePath> -gravity <g> -pointsize <n> -fill <color>
 * -annotate <offset> "<text>" <filePath>` -- in place: IM reads the whole image into memory
 * before writing, so same-path in/out is safe for a single-frame JPEG.
 *
 * IMPORTANT (see docs/ARCHITECTURE.md): this alone does NOT guarantee EXIF survives -- IM's
 * EXIF passthrough on write is version/config-dependent. Callers MUST follow this with
 * exif/write.js's restampExif(originalSrcPath, filePath) to re-stamp date+GPS from the
 * pre-watermark source. This function does not do that itself so it stays a single-purpose,
 * independently-testable IM wrapper.
 */
async function watermarkFile(filePath, text, opts = {}) {
  const { gravity, pointsize, fill, offset } = { ...DEFAULTS, ...opts };

  const { stderr, exitCode } = await execImageMagick("convert", [
    filePath,
    "-gravity",
    gravity,
    "-pointsize",
    String(pointsize),
    "-fill",
    fill,
    "-annotate",
    offset,
    text,
    filePath,
  ]);

  if (exitCode === null) {
    throw new Error(`watermarkFile: ImageMagick not found (${stderr.trim()})`);
  }
  if (exitCode !== 0) {
    throw new Error(`watermarkFile: convert exited ${exitCode} for ${filePath}: ${stderr.trim()}`);
  }
}

module.exports = { watermarkFile };
