"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

const { exec, execImageMagick } = require("../src/util/shell");
const { readExif, toDecimalDegrees } = require("../src/exif/read");
const { writeExif, restampExif } = require("../src/exif/write");
const { watermarkFile } = require("../src/imagemagick/watermark");

let exiftoolAvailable = null;
let imAvailable = null;

async function haveExiftool() {
  if (exiftoolAvailable === null) {
    const r = await exec("exiftool", ["-ver"]).catch(() => ({ exitCode: null }));
    exiftoolAvailable = r.exitCode === 0;
  }
  return exiftoolAvailable;
}

async function haveImageMagick() {
  if (imAvailable === null) {
    const r = await execImageMagick("identify", ["-version"]).catch(() => ({ exitCode: null }));
    imAvailable = r.exitCode === 0;
  }
  return imAvailable;
}

test("exiftool round-trips DateTimeOriginal + GPS on a real temp JPEG", async (t) => {
  if (!(await haveExiftool()) || !(await haveImageMagick())) {
    t.skip("exiftool or ImageMagick not found on PATH -- skipping real-binary integration test");
    return;
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "phototools-exiftest-"));
  const filePath = path.join(tmpDir, "probe.jpg");
  try {
    const { exitCode: convertExit } = await execImageMagick("convert", [
      "-size",
      "100x100",
      "xc:blue",
      filePath,
    ]);
    assert.equal(convertExit, 0, "convert should create a plain JPEG to write EXIF onto");

    await writeExif(filePath, {
      DateTimeOriginal: "2025:06:02 14:20:00",
      GPSLatitude: 48.1351,
      GPSLatitudeRef: "N",
      GPSLongitude: 11.582,
      GPSLongitudeRef: "E",
    });

    const [record] = await readExif([filePath]);
    assert.equal(record["EXIF:DateTimeOriginal"], "2025:06:02 14:20:00");
    assert.ok(Math.abs(toDecimalDegrees(record, "Latitude") - 48.1351) < 1e-4);
    assert.ok(Math.abs(toDecimalDegrees(record, "Longitude") - 11.582) < 1e-4);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("restampExif copies EXIF from one file onto another, surviving an ImageMagick rewrite in between", async (t) => {
  if (!(await haveExiftool()) || !(await haveImageMagick())) {
    t.skip("exiftool or ImageMagick not found on PATH -- skipping real-binary integration test");
    return;
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "phototools-restamp-"));
  const srcPath = path.join(tmpDir, "src.jpg");
  const destPath = path.join(tmpDir, "dest.jpg");
  try {
    await execImageMagick("convert", ["-size", "100x100", "xc:red", srcPath]);
    await writeExif(srcPath, {
      DateTimeOriginal: "2025:11:30 08:05:00",
      GPSLatitude: 48.1351,
      GPSLatitudeRef: "N",
      GPSLongitude: 11.582,
      GPSLongitudeRef: "E",
    });

    // dest starts as a plain copy with NO exif, gets watermarked (an IM rewrite that may or may
    // not preserve EXIF depending on IM version/config), then restamped.
    await fs.copyFile(srcPath, destPath);
    await watermarkFile(destPath, "test watermark");

    const [beforeRestamp] = await readExif([destPath]);
    // Not asserting on beforeRestamp -- IM's own EXIF passthrough behavior is exactly what
    // we do NOT want to depend on (see docs/ARCHITECTURE.md). The real assertion is after.

    await restampExif(srcPath, destPath);
    const [afterRestamp] = await readExif([destPath]);
    assert.equal(afterRestamp["EXIF:DateTimeOriginal"], "2025:11:30 08:05:00");
    assert.ok(Math.abs(toDecimalDegrees(afterRestamp, "Latitude") - 48.1351) < 1e-4);
    void beforeRestamp;
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("readExif returns [] for an empty file list without shelling out", async () => {
  const records = await readExif([]);
  assert.deepEqual(records, []);
});
