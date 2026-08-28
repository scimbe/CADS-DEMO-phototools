"use strict";

const { exec } = require("../util/shell");

/**
 * writeExif(filePath, tags) -> Promise<void>
 * Shells `exiftool -overwrite_original <-Tag=value...> <filePath>`. Fixture-generation-only
 * (see fixtures/generate.js) -- the runtime organize pipeline never rewrites source EXIF, only
 * re-stamps it onto watermarked copies via tagsFromFile (see imagemagick/watermark.js).
 *
 * `tags` is a plain object, e.g. { DateTimeOriginal: "2025:01:15 10:30:00", GPSLatitude: 52.52,
 * GPSLatitudeRef: "N", GPSLongitude: 13.405, GPSLongitudeRef: "E" }. Values are passed as
 * `-Tag=value` argv entries (never string-concatenated into a shell command).
 */
async function writeExif(filePath, tags) {
  const args = ["-overwrite_original"];
  for (const [tag, value] of Object.entries(tags)) {
    args.push(`-${tag}=${value}`);
  }
  args.push(filePath);

  const { stderr, exitCode } = await exec("exiftool", args);
  if (exitCode === null) {
    throw new Error(`writeExif: exiftool not found on PATH (${stderr.trim()})`);
  }
  if (exitCode !== 0) {
    throw new Error(`writeExif: exiftool exited ${exitCode} for ${filePath}: ${stderr.trim()}`);
  }
}

/**
 * restampExif(srcPath, destPath) -> Promise<void>
 * Copies ALL tags from srcPath onto destPath in place: `exiftool -overwrite_original
 * -tagsFromFile <srcPath> -all:all <destPath>`. Used after every ImageMagick write to
 * guarantee EXIF (date + GPS) survives the pipeline regardless of what IM's own EXIF
 * passthrough did or didn't preserve -- see docs/ARCHITECTURE.md.
 */
async function restampExif(srcPath, destPath) {
  const { stderr, exitCode } = await exec("exiftool", [
    "-overwrite_original",
    "-tagsFromFile",
    srcPath,
    "-all:all",
    destPath,
  ]);
  if (exitCode === null) {
    throw new Error(`restampExif: exiftool not found on PATH (${stderr.trim()})`);
  }
  if (exitCode !== 0) {
    throw new Error(`restampExif: exiftool exited ${exitCode} restamping ${srcPath} -> ${destPath}: ${stderr.trim()}`);
  }
}

module.exports = { writeExif, restampExif };
