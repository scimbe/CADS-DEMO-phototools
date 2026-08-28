"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { planNames, parseExifDateTime } = require("../src/organize/planNames");

test("parseExifDateTime parses exiftool's 'YYYY:MM:DD HH:MM:SS' format", () => {
  assert.deepEqual(parseExifDateTime("2025:01:15 10:15:00"), {
    year: "2025",
    month: "01",
    day: "15",
    hour: "10",
    minute: "15",
    second: "00",
  });
});

test("parseExifDateTime returns null for falsy or malformed input", () => {
  assert.equal(parseExifDateTime(null), null);
  assert.equal(parseExifDateTime(undefined), null);
  assert.equal(parseExifDateTime(""), null);
  assert.equal(parseExifDateTime("not a date"), null);
});

test("planNames: dated + city -> {YYYY}/{YYYY-MM-DD}_{city}/{YYYY-MM-DD}_{HHMMSS}_{city}_001.ext", () => {
  const plan = planNames([
    { srcPath: "/raw/a.jpg", dateTimeOriginal: "2025:01:15 10:15:00", city: "Berlin" },
  ]);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].destRelPath, "2025/2025-01-15_berlin/2025-01-15_101500_berlin_001.jpg");
});

test("planNames: two photos in the SAME (date,city) bucket get _001/_002, ordered by source basename", () => {
  const plan = planNames([
    { srcPath: "/raw/zzz.jpg", dateTimeOriginal: "2025:01:15 11:30:00", city: "Berlin" },
    { srcPath: "/raw/aaa.jpg", dateTimeOriginal: "2025:01:15 10:15:00", city: "Berlin" },
  ]);
  const byBasename = Object.fromEntries(
    plan.map((p) => [require("node:path").basename(p.srcPath), p.destRelPath])
  );
  assert.match(byBasename["aaa.jpg"], /_001\.jpg$/);
  assert.match(byBasename["zzz.jpg"], /_002\.jpg$/);
  // Both land in the same directory (bucket), just different filenames.
  assert.equal(
    require("node:path").dirname(byBasename["aaa.jpg"]),
    require("node:path").dirname(byBasename["zzz.jpg"])
  );
});

test("planNames: same date, DIFFERENT city -> different buckets, both seq 001", () => {
  const plan = planNames([
    { srcPath: "/raw/a.jpg", dateTimeOriginal: "2025:01:15 09:00:00", city: "Hamburg" },
    { srcPath: "/raw/b.jpg", dateTimeOriginal: "2025:01:15 10:15:00", city: "Berlin" },
  ]);
  assert.equal(plan[0].destRelPath, "2025/2025-01-15_hamburg/2025-01-15_090000_hamburg_001.jpg");
  assert.equal(plan[1].destRelPath, "2025/2025-01-15_berlin/2025-01-15_101500_berlin_001.jpg");
});

test("planNames: missing city -> 'unknown-location' bucket", () => {
  const plan = planNames([{ srcPath: "/raw/a.jpg", dateTimeOriginal: "2025:01:15 10:15:00", city: null }]);
  assert.equal(plan[0].destRelPath, "2025/2025-01-15_unknown-location/2025-01-15_101500_unknown-location_001.jpg");
});

test("planNames: missing date -> 'undated/' bucket, independent of city", () => {
  const plan = planNames([
    { srcPath: "/raw/a.jpg", dateTimeOriginal: null, city: "Berlin" },
    { srcPath: "/raw/b.jpg", dateTimeOriginal: null, city: null },
  ]);
  assert.equal(plan[0].destRelPath, "undated/undated_berlin_001.jpg");
  assert.equal(plan[1].destRelPath, "undated/undated_unknown-location_001.jpg");
});

test("planNames: preserves input order in its return value regardless of internal bucket sort", () => {
  const plan = planNames([
    { srcPath: "/raw/zzz.jpg", dateTimeOriginal: "2025:01:15 11:30:00", city: "Berlin" },
    { srcPath: "/raw/aaa.jpg", dateTimeOriginal: "2025:01:15 10:15:00", city: "Berlin" },
  ]);
  assert.equal(plan[0].srcPath, "/raw/zzz.jpg");
  assert.equal(plan[1].srcPath, "/raw/aaa.jpg");
});

test("planNames: preserves original file extension, case-insensitively lowercased", () => {
  const plan = planNames([{ srcPath: "/raw/a.JPEG", dateTimeOriginal: "2025:01:15 10:15:00", city: "Berlin" }]);
  assert.match(plan[0].destRelPath, /\.jpeg$/);
});

test("planNames: is pure -- does not touch the filesystem (no fs/exec calls means it runs fine on nonexistent paths)", () => {
  assert.doesNotThrow(() => {
    planNames([{ srcPath: "/this/path/does/not/exist.jpg", dateTimeOriginal: "2025:01:15 10:15:00", city: "Berlin" }]);
  });
});

test("planNames: even the same srcPath listed twice still gets two distinct, non-colliding seq slots", () => {
  // Per-bucket seq assignment embeds the seq number in the destination filename, so two plan
  // entries in the same bucket always get different destRelPaths -- even when they happen to
  // share a srcPath (e.g. a caller accidentally listing a file twice). This is what makes the
  // destRelPath-collision guard in planNames.js an always-true defensive invariant rather than
  // something reachable through the public API.
  const plan = planNames([
    { srcPath: "/raw/a.jpg", dateTimeOriginal: "2025:01:15 10:15:00", city: "Berlin" },
    { srcPath: "/raw/a.jpg", dateTimeOriginal: "2025:01:15 10:15:00", city: "Berlin" },
  ]);
  assert.equal(plan.length, 2);
  assert.notEqual(plan[0].destRelPath, plan[1].destRelPath);
  assert.match(plan[0].destRelPath, /_001\.jpg$/);
  assert.match(plan[1].destRelPath, /_002\.jpg$/);
});
