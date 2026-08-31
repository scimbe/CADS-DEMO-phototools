"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const { resolveFont, BUNDLED_FONT } = require("../src/imagemagick/font");

test("the bundled DejaVu Sans font actually exists in the repo", () => {
  assert.equal(fs.existsSync(BUNDLED_FONT), true, `expected bundled font at ${BUNDLED_FONT}`);
  const stat = fs.statSync(BUNDLED_FONT);
  assert.equal(stat.size > 10000, true, "bundled font looks too small to be a real ttf");
});

test("resolveFont defaults to the bundled font when nothing is set", () => {
  assert.equal(resolveFont({ env: {} }), BUNDLED_FONT);
  assert.equal(resolveFont({ font: "", env: {} }), BUNDLED_FONT);
  assert.equal(resolveFont({ font: "   ", env: { WATERMARK_FONT: "  " } }), BUNDLED_FONT);
});

test("WATERMARK_FONT env overrides the bundled default", () => {
  assert.equal(resolveFont({ env: { WATERMARK_FONT: "/fonts/MyFace.ttf" } }), "/fonts/MyFace.ttf");
});

test("an explicit font (CLI --font) wins over env and default", () => {
  assert.equal(
    resolveFont({ font: "/cli/Chosen.ttf", env: { WATERMARK_FONT: "/env/Other.ttf" } }),
    "/cli/Chosen.ttf"
  );
});

test("BUNDLED_FONT is an absolute path (cwd-independent)", () => {
  assert.equal(require("node:path").isAbsolute(BUNDLED_FONT), true);
});
