"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildGalleryHtml,
  toGalleryData,
  escapeHtml,
  prettyDate,
  groupKeyLabel,
} = require("../src/gallery/buildGallery");

const sampleManifest = {
  mode: "copy",
  count: 2,
  entries: [
    {
      srcPath: "raw/img1.jpg",
      destRelPath: "2025/2025-01-15_berlin/2025-01-15_101500_berlin_001.jpg",
      destPath: "/out/2025/2025-01-15_berlin/2025-01-15_101500_berlin_001.jpg",
      dateTimeOriginal: "2025:01:15 10:15:00",
      city: "Berlin",
      vision: { caption: "A sunset skyline with a tall tower", tags: ["city", "sunset", "tower"], model: "m" },
    },
    {
      srcPath: "raw/img3.jpg",
      destRelPath: "2025/2025-01-15_hamburg/2025-01-15_090000_hamburg_001.jpg",
      destPath: "/out/2025/2025-01-15_hamburg/2025-01-15_090000_hamburg_001.jpg",
      dateTimeOriginal: "2025:01:15 09:00:00",
      city: "Hamburg",
      // no vision on this one -- must still render from EXIF date + city
    },
  ],
};

test("escapeHtml neutralizes angle brackets, quotes, ampersands", () => {
  assert.equal(escapeHtml(`<img src=x onerror="y">&'`), "&lt;img src=x onerror=&quot;y&quot;&gt;&amp;&#39;");
});

test("prettyDate formats EXIF datetime and passes through undated", () => {
  assert.equal(prettyDate("2025:01:15 10:15:00"), "2025-01-15 10:15");
  assert.equal(prettyDate(null), "undated");
  assert.equal(prettyDate(undefined), "undated");
});

test("groupKeyLabel buckets by date + city", () => {
  assert.equal(groupKeyLabel({ dateTimeOriginal: "2025:01:15 10:15:00", city: "Berlin" }), "2025-01-15 · Berlin");
  assert.equal(groupKeyLabel({}), "undated · unknown-location");
});

test("toGalleryData projects entries with and without vision", () => {
  const data = toGalleryData(sampleManifest);
  assert.equal(data.count, 2);
  assert.equal(data.photos[0].caption, "A sunset skyline with a tall tower");
  assert.deepEqual(data.photos[0].tags, ["city", "sunset", "tower"]);
  assert.equal(data.photos[1].caption, null);
  assert.deepEqual(data.photos[1].tags, []);
  assert.equal(data.photos[1].src, "2025/2025-01-15_hamburg/2025-01-15_090000_hamburg_001.jpg");
});

test("buildGalleryHtml is a self-contained document with a lightbox and no external assets", () => {
  const html = buildGalleryHtml(sampleManifest);
  assert.match(html, /^<!doctype html>/);
  // lightbox scaffolding + keyboard-accessible controls
  assert.match(html, /id="lb"/);
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /id="lb-close"/);
  assert.match(html, /id="lb-prev"/);
  assert.match(html, /id="lb-next"/);
  // click targets carry a flat index
  assert.match(html, /data-idx="0"/);
  assert.match(html, /data-idx="1"/);
  // references photos by relative path (not base64-inlined full images)
  assert.match(html, /src="2025\/2025-01-15_berlin\/2025-01-15_101500_berlin_001\.jpg"/);
  // NO external CDN / remote script / stylesheet / font
  assert.doesNotMatch(html, /https?:\/\/[^"']*\.(js|css)/);
  assert.doesNotMatch(html, /<link[^>]+stylesheet/);
  assert.doesNotMatch(html, /cdn\./);
});

test("buildGalleryHtml renders vision caption/tags and the plain card alike", () => {
  const html = buildGalleryHtml(sampleManifest);
  assert.match(html, /A sunset skyline with a tall tower/);
  assert.match(html, /class="tag">city</);
  // the vision-less photo still shows its filename as the caption line
  assert.match(html, /2025-01-15_090000_hamburg_001\.jpg/);
});

test("buildGalleryHtml groups by date+city heading", () => {
  const html = buildGalleryHtml(sampleManifest);
  assert.match(html, /<h2>2025-01-15 · Berlin<\/h2>/);
  assert.match(html, /<h2>2025-01-15 · Hamburg<\/h2>/);
});

test("buildGalleryHtml carries the required support/legal footer links", () => {
  const html = buildGalleryHtml(sampleManifest);
  for (const url of [
    "https://steady.page/plans/77a32d9c-c399-4ca1-9515-7a628c7a9413",
    "https://buymeacoffee.com/bunsenbrenner",
    "https://github.com/scimbe/CADS-Tunnel",
    "https://bunsenbrenner.org/legal-notice",
    "https://bunsenbrenner.org/privacy-policy",
    "https://bunsenbrenner.org/terms-of-use",
  ]) {
    assert.ok(html.includes(url), `footer must link ${url}`);
  }
});

test("buildGalleryHtml escapes a malicious caption so it cannot break out of markup", () => {
  const evil = {
    count: 1,
    entries: [
      {
        destRelPath: "x/y.jpg",
        destPath: "/out/x/y.jpg",
        dateTimeOriginal: "2025:01:15 10:15:00",
        city: "Berlin",
        vision: { caption: '</script><img src=x onerror=alert(1)>', tags: ["</script>"], model: "m" },
      },
    ],
  };
  const html = buildGalleryHtml(evil);
  // raw closing script tag / event handler must not appear unescaped in the rendered card
  assert.doesNotMatch(html, /<img src=x onerror=alert\(1\)>/);
  // and the injected JSON must escape the < so it can't terminate the data <script>
  assert.match(html, /\\u003c\/script>/);
});
