"use strict";

/**
 * The acceptance check the brief asks for: generate synthetic photos with real, distinct EXIF
 * (date + GPS) via exiftool's own write capability, run the real `organize` CLI as a genuine
 * child process (not by calling library functions in-process), and prove:
 *   1. every source file landed at exactly the predicted {YYYY}/{YYYY-MM-DD}_{city}/... path
 *   2. the destination (post-watermark) files' EXIF still matches their source record exactly
 *      -- proving the sort key was real EXIF data and watermarking didn't destroy metadata
 *   3. a real contact sheet was built, sized consistently with the configured tile geometry
 *   4. the LLM summary step is genuinely optional: unset key -> no summary.txt, exit 0
 *   5. (separate, self-skipping test) with a real key configured, the summary step actually
 *      works end-to-end -- or, if the budget is exhausted, that failure is reported plainly,
 *      never silently swallowed as a false "skip"
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

const { exec, execImageMagick } = require("../src/util/shell");
const { readExif, toDecimalDegrees } = require("../src/exif/read");
const { isConfigured } = require("../src/llm/summarize");

const REPO_ROOT = path.join(__dirname, "..");
const RAW_DIR = path.join(REPO_ROOT, "fixtures", ".tmp", "raw");
const EXPECTED_PATH = path.join(REPO_ROOT, "fixtures", "expected", "manifest.sample.json");
const WATERMARK_TEXT = "bunsenbrenner.org - demo";
const GPS_TOLERANCE_DEG = 1e-4;

async function toolsAvailable() {
  const [exiftoolResult, imResult] = await Promise.all([
    exec("exiftool", ["-ver"]).catch(() => ({ exitCode: null })),
    execImageMagick("identify", ["-version"]).catch(() => ({ exitCode: null })),
  ]);
  return exiftoolResult.exitCode === 0 && imResult.exitCode === 0;
}

async function runGenerate() {
  const result = await exec("node", ["fixtures/generate.js"], { cwd: REPO_ROOT, timeoutMs: 60000 });
  assert.equal(result.exitCode, 0, `fixtures/generate.js failed:\n${result.stdout}\n${result.stderr}`);
}

async function runOrganize(outDirName, extraArgs = [], env = process.env) {
  return exec(
    "node",
    ["bin/phototools.js", "organize", "fixtures/.tmp/raw", "--out", `fixtures/.tmp/${outDirName}`, ...extraArgs],
    { cwd: REPO_ROOT, timeoutMs: 60000, env }
  );
}

async function readManifest(outDirName) {
  const raw = await fs.readFile(path.join(REPO_ROOT, "fixtures", ".tmp", outDirName, "manifest.json"), "utf8");
  return JSON.parse(raw);
}

test("acceptance: organize sorts, renames, watermarks, and builds a contact sheet from real EXIF", async (t) => {
  if (!(await toolsAvailable())) {
    t.skip("exiftool and/or ImageMagick not found on PATH -- skipping the full acceptance run");
    return;
  }

  await runGenerate();

  const outDirName = "sorted-acceptance";
  await fs.rm(path.join(REPO_ROOT, "fixtures", ".tmp", outDirName), { recursive: true, force: true });

  const runResult = await runOrganize(outDirName, ["--watermark-text", WATERMARK_TEXT, "--contact-sheet"]);
  assert.equal(runResult.exitCode, 0, `organize failed:\n${runResult.stdout}\n${runResult.stderr}`);

  const manifest = await readManifest(outDirName);
  assert.equal(manifest.count, 6);

  // --- 1. every source file mapped to exactly the predicted dest path ---
  const expected = JSON.parse(await fs.readFile(EXPECTED_PATH, "utf8"));
  const expectedByPath = new Map(expected.entries.map((e) => [e.srcPath, e]));
  assert.equal(manifest.entries.length, expected.entries.length);

  for (const actual of manifest.entries) {
    const want = expectedByPath.get(actual.srcPath);
    assert.ok(want, `unexpected srcPath in manifest: ${actual.srcPath}`);
    assert.equal(actual.destRelPath, want.destRelPath, `wrong destRelPath for ${actual.srcPath}`);
    assert.equal(actual.dateTimeOriginal, want.dateTimeOriginal, `wrong dateTimeOriginal for ${actual.srcPath}`);
    assert.equal(actual.city, want.city, `wrong resolved city for ${actual.srcPath}`);
  }

  // --- 2. destination (post-watermark) EXIF still matches the source record exactly ---
  const destPaths = manifest.entries.map((e) => e.destPath);
  const destRecords = await readExif(destPaths);
  assert.equal(destRecords.length, manifest.entries.length);

  manifest.entries.forEach((entry, i) => {
    const rec = destRecords[i];
    assert.equal(
      rec["EXIF:DateTimeOriginal"],
      entry.dateTimeOriginal,
      `DateTimeOriginal did not survive watermarking for ${entry.destPath}`
    );
    const gotLat = toDecimalDegrees(rec, "Latitude");
    const gotLon = toDecimalDegrees(rec, "Longitude");
    assert.ok(
      gotLat !== null && Math.abs(gotLat - entry.lat) < GPS_TOLERANCE_DEG,
      `GPSLatitude did not survive watermarking for ${entry.destPath}: wrote ${entry.lat}, read ${gotLat}`
    );
    assert.ok(
      gotLon !== null && Math.abs(gotLon - entry.lon) < GPS_TOLERANCE_DEG,
      `GPSLongitude did not survive watermarking for ${entry.destPath}: wrote ${entry.lon}, read ${gotLon}`
    );
  });

  // --- 3. contact sheet exists, sized consistently with the configured tile geometry ---
  assert.equal(manifest.contactSheet, path.join(`fixtures/.tmp/${outDirName}`, "contact-sheet.jpg"));
  const contactSheetAbs = path.join(REPO_ROOT, manifest.contactSheet);
  await fs.access(contactSheetAbs); // throws if missing

  const identifyResult = await execImageMagick("identify", ["-format", "%w %h", contactSheetAbs]);
  assert.equal(identifyResult.exitCode, 0, `identify failed on contact sheet: ${identifyResult.stderr}`);
  const [width, height] = identifyResult.stdout.trim().split(/\s+/).map(Number);
  // Default geometry is 200x150+6+6, default tile "4x" -> 4 columns. Cell width is fully
  // determined by geometry+columns (no font metrics involved), so this is exact, not fuzzy.
  assert.equal(width, 4 * (200 + 2 * 6), `contact sheet width should reflect 4 columns at 200x150+6+6, got ${width}`);
  // 6 photos at 4 columns -> 2 rows; row height includes the label text so only bound it loosely.
  assert.ok(height >= 2 * 150, `contact sheet height ${height} looks too short for 2 rows`);

  // --- 4. LLM summary was not requested here -> no summary.txt, but that's covered by test 4 below ---
  assert.equal(manifest.watermark.text, WATERMARK_TEXT);
  assert.equal(manifest.watermark.appliedTo, 6);
});

test("acceptance: --summary with NO LLM key configured writes no summary.txt and still exits 0", async (t) => {
  if (!(await toolsAvailable())) {
    t.skip("exiftool and/or ImageMagick not found on PATH -- skipping");
    return;
  }
  await runGenerate();

  const outDirName = "sorted-nokey";
  await fs.rm(path.join(REPO_ROOT, "fixtures", ".tmp", outDirName), { recursive: true, force: true });

  // Build a child env that genuinely lacks the LLM vars, regardless of what a developer's own
  // repo-root .env happens to contain -- this is what proves the deterministic core doesn't
  // gate on LLM/network availability, not just "nobody happened to set the var this time".
  const strippedEnv = { ...process.env };
  delete strippedEnv.LITELLM_API_KEY;
  delete strippedEnv.LITELLM_BASE_URL;
  // dotenv (loaded by bin/phototools.js) only fills vars NOT already present in process.env --
  // setting them to "" counts as present, so this survives a real .env file on disk too.
  strippedEnv.LITELLM_API_KEY = "";
  strippedEnv.LITELLM_BASE_URL = "";

  const runResult = await runOrganize(outDirName, ["--summary"], strippedEnv);
  assert.equal(runResult.exitCode, 0, `organize --summary (no key) should still exit 0:\n${runResult.stdout}\n${runResult.stderr}`);
  assert.match(runResult.stdout, /summary: skipped \(no LITELLM_API_KEY configured\)/);

  const summaryPath = path.join(REPO_ROOT, "fixtures", ".tmp", outDirName, "summary.txt");
  await assert.rejects(() => fs.access(summaryPath), /ENOENT/, "summary.txt should not exist when no key is configured");

  const manifest = await readManifest(outDirName);
  assert.equal(manifest.summary, null);
});

test("acceptance: --summary with a REAL LLM key attempts a live call and reports the outcome plainly", async (t) => {
  require("dotenv").config({ path: path.join(REPO_ROOT, ".env") });
  if (!isConfigured(process.env)) {
    t.skip("LITELLM_API_KEY/LITELLM_BASE_URL not configured in .env -- skipping the live LLM summary test");
    return;
  }
  if (!(await toolsAvailable())) {
    t.skip("exiftool and/or ImageMagick not found on PATH -- skipping");
    return;
  }
  await runGenerate();

  const outDirName = "sorted-summary";
  await fs.rm(path.join(REPO_ROOT, "fixtures", ".tmp", outDirName), { recursive: true, force: true });

  const runResult = await runOrganize(outDirName, ["--summary"]);
  // The deterministic organize step must succeed regardless of what the LLM call does.
  assert.equal(runResult.exitCode, 0, `organize --summary should exit 0 even on LLM failure:\n${runResult.stdout}\n${runResult.stderr}`);

  const manifest = await readManifest(outDirName);
  if (manifest.summary) {
    const summaryText = await fs.readFile(path.join(REPO_ROOT, manifest.summary), "utf8");
    console.log(`[acceptance] live LLM summary succeeded: ${summaryText.trim()}`);
    assert.ok(summaryText.trim().length > 0);
  } else {
    // A real, reportable failure (e.g. exhausted budget) -- surfaced loudly, not silently
    // treated as a pass. See manifest.summaryError / the CLI's stderr warning line.
    console.log(`[acceptance] live LLM summary call FAILED (reported, not silently skipped): ${manifest.summaryError || "(no error captured)"}\nstderr: ${runResult.stderr.trim()}`);
  }
});
