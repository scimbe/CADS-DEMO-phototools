"use strict";

const path = require("node:path");
const { slugify } = require("../geocode/nearestCity");

const EXIF_DATETIME_RE = /^(\d{4}):(\d{2}):(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/;

function pad3(n) {
  return String(n).padStart(3, "0");
}

/**
 * parseExifDateTime(str) -> { year, month, day, hour, minute, second } | null
 * Parses exiftool's "YYYY:MM:DD HH:MM:SS" DateTimeOriginal/CreateDate format. Returns null for
 * anything falsy or non-matching -- an unparseable/missing date is the "undated" fallback path,
 * not an error, since a consumer's real photo library will genuinely have some of these.
 */
function parseExifDateTime(str) {
  if (!str) return null;
  const m = EXIF_DATETIME_RE.exec(String(str));
  if (!m) return null;
  const [, year, month, day, hour, minute, second] = m;
  return { year, month, day, hour, minute, second };
}

/**
 * planNames(records, opts = {}) -> Array<{ srcPath, destRelPath, bucketKey }>
 *
 * Pure function, NO I/O (no fs, no exec) -- everything it needs is passed in, so it is fully
 * unit-testable with fixed synthetic input. Each input record is:
 *   { srcPath: string, dateTimeOriginal: string|null, city: string|null }
 * `city` is the already-geocode-resolved label (or null for "no GPS tag"/"no gazetteer match
 * requested" -- see geocode/nearestCity.js), NOT raw lat/lon -- resolving GPS to a city name is
 * a separate, earlier step (see docs/ARCHITECTURE.md's pipeline stages) so this function stays
 * decoupled from the gazetteer.
 *
 * Layout produced:
 *   dated:   {YYYY}/{YYYY-MM-DD}_{city-slug}/{YYYY-MM-DD}_{HHMMSS}_{city-slug}_{seq:03d}.{ext}
 *   undated: undated/undated_{city-slug}_{seq:03d}.{ext}
 * `city-slug` is "unknown-location" when city is null. `seq` increments per (date,city) bucket,
 * ordered by source basename, so two photos in the same second/bucket never collide and the
 * ordering is deterministic regardless of input array order.
 *
 * Throws if two DIFFERENT source paths would resolve to the exact same destRelPath (should be
 * unreachable given the seq scheme, but asserted defensively -- a silent collision would mean
 * two photos, one of them the wrong one, land at the same filesystem path).
 */
function planNames(records, opts = {}) {
  if (!Array.isArray(records)) throw new Error("planNames: records must be an array");

  const parsed = records.map((record, index) => {
    const date = parseExifDateTime(record.dateTimeOriginal);
    const citySlug = record.city ? slugify(record.city) : "unknown-location";
    const ext = (path.extname(record.srcPath).replace(/^\./, "") || "jpg").toLowerCase();
    const bucketKey = date
      ? `${date.year}-${date.month}-${date.day}|${citySlug}`
      : `undated|${citySlug}`;
    return { index, record, date, citySlug, ext, bucketKey };
  });

  // Group by bucketKey, ordering members within a bucket by source basename for determinism.
  const buckets = new Map();
  for (const item of parsed) {
    if (!buckets.has(item.bucketKey)) buckets.set(item.bucketKey, []);
    buckets.get(item.bucketKey).push(item);
  }
  for (const items of buckets.values()) {
    items.sort((a, b) => path.basename(a.record.srcPath).localeCompare(path.basename(b.record.srcPath)));
    items.forEach((item, i) => {
      item.seq = i + 1;
    });
  }

  const plan = parsed.map((item) => {
    const { date, citySlug, ext, seq } = item;
    let destRelPath;
    if (date) {
      const dateStr = `${date.year}-${date.month}-${date.day}`;
      const timeStr = `${date.hour}${date.minute}${date.second}`;
      const destDir = path.posix.join(date.year, `${dateStr}_${citySlug}`);
      const destFilename = `${dateStr}_${timeStr}_${citySlug}_${pad3(seq)}.${ext}`;
      destRelPath = path.posix.join(destDir, destFilename);
    } else {
      const destFilename = `undated_${citySlug}_${pad3(seq)}.${ext}`;
      destRelPath = path.posix.join("undated", destFilename);
    }
    return { srcPath: item.record.srcPath, destRelPath, bucketKey: item.bucketKey };
  });

  const seen = new Map();
  for (const entry of plan) {
    const prior = seen.get(entry.destRelPath);
    if (prior !== undefined && prior !== entry.srcPath) {
      throw new Error(
        `planNames: destination collision at "${entry.destRelPath}" between "${prior}" and "${entry.srcPath}"`
      );
    }
    seen.set(entry.destRelPath, entry.srcPath);
  }

  return plan;
}

module.exports = { planNames, parseExifDateTime };
