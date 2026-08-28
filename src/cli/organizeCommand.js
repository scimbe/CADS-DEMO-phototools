"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const { parseOrganizeArgs } = require("../util/argv");
const { readExif, toDecimalDegrees } = require("../exif/read");
const { restampExif } = require("../exif/write");
const { nearestCity } = require("../geocode/nearestCity");
const { planNames } = require("../organize/planNames");
const { applyPlan } = require("../organize/apply");
const { watermarkFile } = require("../imagemagick/watermark");
const { buildContactSheet } = require("../imagemagick/contactSheet");
const { summarize, isConfigured } = require("../llm/summarize");
const log = require("../util/log");

const IMAGE_EXT_RE = /\.(jpe?g)$/i;

/** listImages(srcDir) -> Promise<string[]> sorted, srcDir-relative-joined paths to *.jpg/*.jpeg (case-insensitive), files only. */
async function listImages(srcDir) {
  const dirents = await fs.readdir(srcDir, { withFileTypes: true });
  return dirents
    .filter((d) => d.isFile() && IMAGE_EXT_RE.test(d.name))
    .map((d) => path.join(srcDir, d.name))
    .sort();
}

/**
 * organizeCommand(argv) -> Promise<number> (exit code)
 * The full deterministic pipeline (plan step 4): read EXIF -> resolve GPS to nearest gazetteer
 * city -> plan dest names -> copy/move into place + write manifest.json -> optional watermark
 * (+EXIF re-stamp) -> optional contact sheet -> optional (fully independent, non-fatal) LLM
 * one-line summary. Every step after "plan+apply" is opt-in via a flag; none of them can make
 * the deterministic core fail or block.
 */
async function organizeCommand(argv) {
  const opts = parseOrganizeArgs(argv);

  const srcFiles = await listImages(opts.srcDir);
  if (srcFiles.length === 0) {
    log.warn(`no .jpg/.jpeg files found in ${opts.srcDir}`);
  }

  const exifRecords = await readExif(srcFiles);
  if (exifRecords.length !== srcFiles.length) {
    throw new Error(
      `organizeCommand: exiftool returned ${exifRecords.length} records for ${srcFiles.length} input files`
    );
  }

  const planInput = exifRecords.map((rec, i) => {
    const srcPath = srcFiles[i];
    const dateTimeOriginal = firstDefined(rec, ["EXIF:DateTimeOriginal", "Composite:DateTimeOriginal", "EXIF:CreateDate"]);
    const lat = toDecimalDegrees(rec, "Latitude");
    const lon = toDecimalDegrees(rec, "Longitude");
    let city = null;
    if (lat !== null && lon !== null) {
      city = nearestCity({ lat, lon }).name;
    }
    return { srcPath, dateTimeOriginal, lat, lon, city };
  });

  const plan = planNames(
    planInput.map(({ srcPath, dateTimeOriginal, city }) => ({ srcPath, dateTimeOriginal, city }))
  );

  // Re-attach the metadata planNames doesn't need but the manifest/summary do.
  const enrichedPlan = plan.map((entry, i) => ({ ...entry, ...omit(planInput[i], ["srcPath"]) }));

  const { manifest, manifestPath } = await applyPlan(enrichedPlan, { outDir: opts.out, move: opts.move });
  log.info(`organized ${manifest.count} photo(s) into ${opts.out} (${manifest.mode})`);

  if (opts.watermarkText) {
    for (const entry of manifest.entries) {
      await watermarkFile(entry.destPath, opts.watermarkText, pickDefined({ pointsize: opts.pointsize }));
      await restampExif(entry.srcPath, entry.destPath);
    }
    manifest.watermark = { text: opts.watermarkText, appliedTo: manifest.entries.length };
    log.info(`watermarked ${manifest.entries.length} photo(s): "${opts.watermarkText}"`);
  } else {
    manifest.watermark = null;
  }

  if (opts.contactSheet) {
    const contactSheetPath = path.join(opts.out, "contact-sheet.jpg");
    const destPaths = manifest.entries.map((e) => e.destPath).sort();
    await buildContactSheet(destPaths, contactSheetPath, pickDefined({ tile: opts.tile, geometry: opts.geometry }));
    manifest.contactSheet = contactSheetPath;
    log.info(`contact sheet: ${contactSheetPath}`);
  } else {
    manifest.contactSheet = null;
  }

  if (opts.summary) {
    if (!isConfigured(process.env)) {
      log.info("summary: skipped (no LITELLM_API_KEY configured)");
      manifest.summary = null;
    } else {
      try {
        const text = await summarize(manifest, process.env);
        const summaryPath = path.join(opts.out, "summary.txt");
        await fs.writeFile(summaryPath, text + "\n", "utf8");
        manifest.summary = summaryPath;
        log.info(`summary: ${text}`);
      } catch (err) {
        // The LLM summary is explicitly optional/secondary (see README) -- a failed call
        // (network, auth, exhausted budget) must never fail the deterministic organize run.
        // It IS surfaced loudly on stderr, not swallowed, so a real outage is still visible.
        log.warn(`summary step failed, continuing without it: ${err.message}`);
        manifest.summary = null;
        manifest.summaryError = err.message;
      }
    }
  } else {
    manifest.summary = null;
  }

  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");

  return 0;
}

function firstDefined(obj, keys) {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
  }
  return null;
}

function omit(obj, keys) {
  const out = { ...obj };
  for (const k of keys) delete out[k];
  return out;
}

function pickDefined(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

module.exports = organizeCommand;
