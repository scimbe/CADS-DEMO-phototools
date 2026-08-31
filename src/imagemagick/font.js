"use strict";

const path = require("node:path");

/**
 * src/imagemagick/font.js
 *
 * ImageMagick's text operators (`convert -annotate`, `montage -label`) need a font. On a host
 * with no configured default font -- Homebrew IM7, and potentially a scrubbed/minimal container --
 * calling them WITHOUT an explicit `-font` fails hard with `unable to read font ''`, which took
 * down the whole watermark step (and thus the contact sheet / gallery that follow it) before this.
 *
 * The fix is to always pass a concrete `-font`, defaulting to a font we bundle in-repo so text
 * rendering is host-independent (no reliance on whatever the runner happens to have installed).
 * The bundled face is DejaVu Sans (free/redistributable -- see assets/fonts/LICENSE-DejaVu.txt).
 */

// Resolved from this file's location, so it works regardless of cwd (the installer-engine execs
// run.sh with cwd set to the bundle dir, tests run from the repo root, etc.).
const BUNDLED_FONT = path.join(__dirname, "..", "..", "assets", "fonts", "DejaVuSans.ttf");

/**
 * resolveFont({ font, env } = {}) -> string
 * Precedence, highest first:
 *   1. an explicit `font` (the CLI `--font <path>` flag),
 *   2. the WATERMARK_FONT environment variable,
 *   3. the bundled DejaVu Sans (default -- always present in the repo).
 * A caller-supplied path is passed through as-is (ImageMagick accepts either a font file path or a
 * fontconfig family name); if it's wrong, IM surfaces a clear error rather than this guessing.
 */
function resolveFont({ font, env = process.env } = {}) {
  const explicit = String(font || "").trim();
  if (explicit) return explicit;
  const fromEnv = String((env && env.WATERMARK_FONT) || "").trim();
  if (fromEnv) return fromEnv;
  return BUNDLED_FONT;
}

module.exports = { resolveFont, BUNDLED_FONT };
