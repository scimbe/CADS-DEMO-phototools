#!/usr/bin/env node
"use strict";

/**
 * fixtures/generate.js
 *
 * Builds the acceptance-test photo batch from scratch, every time it's run:
 *   1. wipes+recreates fixtures/.tmp/raw/
 *   2. generates 6 plain JPEGs with ImageMagick (distinct solid color + label per photo, so
 *      they're visually distinguishable in the resulting contact sheet)
 *   3. writes real, distinct EXIF (DateTimeOriginal/CreateDate + GPS lat/lon) onto each via
 *      exiftool's own write capability -- NOT filesystem mtime, NOT a fake heuristic
 *   4. self-verifies every tag round-tripped by reading it back with exiftool -j and diffing
 *      against what was written -- fails loudly (nonzero exit) on any mismatch, so a broken
 *      exiftool/ImageMagick install on a runner is caught here, before the pipeline even starts
 *
 * Matrix: 3 dates x cities picked verbatim from src/geocode/gazetteer.json (so the nearest-city
 * match in the real pipeline is exact, not approximate), with img1/img2 sharing one (date,city)
 * bucket on purpose -- that's what exercises planNames.js's _001/_002 collision-suffix logic.
 */

const fs = require("node:fs/promises");
const path = require("node:path");

const { execImageMagick } = require("../src/util/shell");
const { writeExif } = require("../src/exif/write");
const { readExif, toDecimalDegrees } = require("../src/exif/read");

const RAW_DIR = path.join(__dirname, ".tmp", "raw");
const GPS_TOLERANCE_DEG = 1e-4; // ~11m -- generous vs exiftool's rational-degree round-trip

const SPECS = [
  { name: "img1.jpg", color: "#E74C3C", label: "IMG_01", date: "2025:01:15 10:15:00", lat: 52.5200, lon: 13.4050 }, // Berlin
  { name: "img2.jpg", color: "#3498DB", label: "IMG_02", date: "2025:01:15 11:30:00", lat: 52.5200, lon: 13.4050 }, // Berlin (same date+city as img1 -> seq collision)
  { name: "img3.jpg", color: "#2ECC71", label: "IMG_03", date: "2025:01:15 09:00:00", lat: 53.5511, lon: 9.9937 }, // Hamburg
  { name: "img4.jpg", color: "#F1C40F", label: "IMG_04", date: "2025:06:02 14:20:00", lat: 48.1351, lon: 11.5820 }, // Munich
  { name: "img5.jpg", color: "#9B59B6", label: "IMG_05", date: "2025:06:02 16:45:00", lat: 53.5511, lon: 9.9937 }, // Hamburg
  { name: "img6.jpg", color: "#1ABC9C", label: "IMG_06", date: "2025:11:30 08:05:00", lat: 48.1351, lon: 11.5820 }, // Munich
];

async function main() {
  await fs.rm(RAW_DIR, { recursive: true, force: true });
  await fs.mkdir(RAW_DIR, { recursive: true });

  for (const spec of SPECS) {
    const filePath = path.join(RAW_DIR, spec.name);

    const { stderr, exitCode } = await execImageMagick("convert", [
      "-size",
      "800x600",
      `xc:${spec.color}`,
      "-gravity",
      "center",
      "-pointsize",
      "48",
      "-fill",
      "white",
      "-annotate",
      "0",
      spec.label,
      filePath,
    ]);
    if (exitCode !== 0) {
      throw new Error(`fixtures/generate.js: convert failed for ${spec.name} (exit ${exitCode}): ${stderr}`);
    }

    await writeExif(filePath, {
      DateTimeOriginal: spec.date,
      CreateDate: spec.date,
      GPSLatitude: spec.lat,
      GPSLatitudeRef: "N",
      GPSLongitude: spec.lon,
      GPSLongitudeRef: "E",
    });
  }

  // Self-verify: read every tag back and diff against what we wrote. This is the fixture
  // generator's own honesty check, independent of the acceptance test.
  const files = SPECS.map((s) => path.join(RAW_DIR, s.name));
  const records = await readExif(files);
  if (records.length !== SPECS.length) {
    throw new Error(`fixtures/generate.js: expected ${SPECS.length} exiftool records, got ${records.length}`);
  }

  const problems = [];
  records.forEach((rec, i) => {
    const spec = SPECS[i];
    const gotDate = rec["EXIF:DateTimeOriginal"];
    if (gotDate !== spec.date) {
      problems.push(`${spec.name}: DateTimeOriginal round-trip mismatch: wrote "${spec.date}", read "${gotDate}"`);
    }
    const gotLat = toDecimalDegrees(rec, "Latitude");
    const gotLon = toDecimalDegrees(rec, "Longitude");
    if (gotLat === null || Math.abs(gotLat - spec.lat) > GPS_TOLERANCE_DEG) {
      problems.push(`${spec.name}: GPSLatitude round-trip mismatch: wrote ${spec.lat}, read ${gotLat}`);
    }
    if (gotLon === null || Math.abs(gotLon - spec.lon) > GPS_TOLERANCE_DEG) {
      problems.push(`${spec.name}: GPSLongitude round-trip mismatch: wrote ${spec.lon}, read ${gotLon}`);
    }
  });

  if (problems.length > 0) {
    throw new Error(`fixtures/generate.js: EXIF round-trip verification FAILED:\n  ${problems.join("\n  ")}`);
  }

  process.stdout.write(`fixtures/generate.js: generated + verified ${SPECS.length} photos in ${RAW_DIR}\n`);
}

main().catch((err) => {
  process.stderr.write(`${err.message}\n`);
  process.exitCode = 1;
});
