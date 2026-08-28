"use strict";

const { exec } = require("../util/shell");

/**
 * readExif(filePaths) -> Promise<Array<object>>
 * Batch-shells `exiftool -j -G -a -n <files...>` (one process for the whole batch, not one per
 * file) and returns the parsed JSON array exactly as exiftool emits it -- one object per file,
 * each key group-prefixed (e.g. "EXIF:DateTimeOriginal", "EXIF:GPSLatitude") because of -G.
 * `-n` is load-bearing, not cosmetic: without it exiftool prints GPS coordinates as a DMS
 * string ("52 deg 31' 12.00\"") instead of a signed decimal-degrees number, which silently
 * truncates under a naive parseFloat (caught live during fixture generation -- see git history).
 *
 * Throws if exiftool isn't on PATH (exitCode === null) or if it produced non-JSON stdout.
 * Does NOT throw on a per-file warning -- exiftool still emits JSON for the other files and
 * folds the warning into that file's "Warning" key, which callers can inspect if they care.
 */
async function readExif(filePaths) {
  if (!Array.isArray(filePaths) || filePaths.length === 0) return [];

  const { stdout, stderr, exitCode } = await exec("exiftool", ["-j", "-G", "-a", "-n", ...filePaths]);

  if (exitCode === null) {
    throw new Error(`readExif: exiftool not found on PATH (${stderr.trim()})`);
  }

  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (err) {
    throw new Error(`readExif: exiftool produced non-JSON output: ${stdout.slice(0, 300)}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`readExif: expected a JSON array from exiftool, got ${typeof parsed}`);
  }
  return parsed;
}

/**
 * toDecimalDegrees(record, axis) -> number | null
 * With `-n`, exiftool's EXIF-group GPSLatitude/GPSLongitude is an UNSIGNED magnitude (the sign
 * lives only in the separate *Ref tag / in the derived Composite:GPS* value) -- verified live
 * against exiftool 13.59 with a southern-hemisphere fixture (EXIF:GPSLatitude=33.8688,
 * GPSLatitudeRef=S, while Composite:GPSLatitude=-33.8688). This prefers the exact
 * "EXIF:GPS<axis>" key so it always reads the unsigned form and applies the Ref sign itself,
 * rather than depending on JSON key ordering to avoid picking up the already-signed
 * Composite:GPS<axis> and double-flipping it. Falls back to any group's "GPS<axis>" key
 * (excluding *Ref) if EXIF: specifically isn't present. Returns null if the tag is absent.
 * axis: "Latitude" | "Longitude".
 */
function toDecimalDegrees(record, axis) {
  const keys = Object.keys(record);
  const valueKey =
    keys.find((k) => k === `EXIF:GPS${axis}`) ??
    keys.find((k) => k.endsWith(`GPS${axis}`) && !k.endsWith("Ref"));
  const refKey = keys.find((k) => k.endsWith(`GPS${axis}Ref`));
  if (valueKey === undefined) return null;

  const raw = record[valueKey];
  let value = typeof raw === "number" ? raw : parseFloat(String(raw));
  if (!Number.isFinite(value)) return null;

  const ref = refKey ? String(record[refKey]).trim().toUpperCase() : null;
  const negativeRef = axis === "Latitude" ? "S" : "W";
  if (ref === negativeRef) value = -Math.abs(value);
  else if (ref) value = Math.abs(value);

  return value;
}

module.exports = { readExif, toDecimalDegrees };
