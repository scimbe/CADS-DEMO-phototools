# Demo fixtures

`fixtures/generate.js` builds the acceptance-test photo batch **from scratch on every run**: it
wipes and recreates `fixtures/.tmp/raw/` (gitignored — nothing binary is committed), generates 6
plain JPEGs with ImageMagick, writes real EXIF onto each with exiftool's own write capability,
then immediately reads every tag back and fails loudly on any mismatch. That self-check exists so
a broken exiftool/ImageMagick install on some other runner is caught at generation time, before
the actual pipeline is even exercised.

## The fixture matrix

3 dates × cities, taken verbatim from `src/geocode/gazetteer.json` so the nearest-city match in
the real pipeline is exact (0 km), not merely "close":

| file | color | date/time | city (GPS) |
|---|---|---|---|
| `img1.jpg` | red `#E74C3C` | 2025-01-15 10:15:00 | Berlin (52.5200, 13.4050) |
| `img2.jpg` | blue `#3498DB` | 2025-01-15 11:30:00 | Berlin (52.5200, 13.4050) |
| `img3.jpg` | green `#2ECC71` | 2025-01-15 09:00:00 | Hamburg (53.5511, 9.9937) |
| `img4.jpg` | yellow `#F1C40F` | 2025-06-02 14:20:00 | Munich (48.1351, 11.5820) |
| `img5.jpg` | purple `#9B59B6` | 2025-06-02 16:45:00 | Hamburg (53.5511, 9.9937) |
| `img6.jpg` | teal `#1ABC9C` | 2025-11-30 08:05:00 | Munich (48.1351, 11.5820) |

`img1`/`img2` share the same (date, city) bucket on purpose — different times, same day, same
city — to exercise `planNames.js`'s `_001`/`_002` collision-suffix logic. Everything else lands in
its own bucket.

## Run it

```bash
npm run fixture:organize
```

which is exactly:

```bash
node fixtures/generate.js
node bin/phototools.js organize fixtures/.tmp/raw --out fixtures/.tmp/sorted \
  --watermark-text "bunsenbrenner.org . demo" --contact-sheet
```

## Expected result (verified live, exiftool 13.59 / ImageMagick 6.9.12-98)

**Before** (`find fixtures/.tmp/raw -type f | sort`):

```
fixtures/.tmp/raw/img1.jpg
fixtures/.tmp/raw/img2.jpg
fixtures/.tmp/raw/img3.jpg
fixtures/.tmp/raw/img4.jpg
fixtures/.tmp/raw/img5.jpg
fixtures/.tmp/raw/img6.jpg
```

**After** (`find fixtures/.tmp/sorted -type f | sort`):

```
fixtures/.tmp/sorted/2025/2025-01-15_berlin/2025-01-15_101500_berlin_001.jpg   <- img1
fixtures/.tmp/sorted/2025/2025-01-15_berlin/2025-01-15_113000_berlin_002.jpg   <- img2 (collision suffix)
fixtures/.tmp/sorted/2025/2025-01-15_hamburg/2025-01-15_090000_hamburg_001.jpg <- img3
fixtures/.tmp/sorted/2025/2025-06-02_hamburg/2025-06-02_164500_hamburg_001.jpg <- img5
fixtures/.tmp/sorted/2025/2025-06-02_munich/2025-06-02_142000_munich_001.jpg   <- img4
fixtures/.tmp/sorted/2025/2025-11-30_munich/2025-11-30_080500_munich_001.jpg   <- img6
fixtures/.tmp/sorted/contact-sheet.jpg
fixtures/.tmp/sorted/manifest.json
```

The exact expected `srcPath -> destRelPath` mapping (plus resolved `city`/`dateTimeOriginal`) is
hand-checked and pinned in `fixtures/expected/manifest.sample.json` — that's what
`tests/acceptance.organize.test.js` diffs the real run's `manifest.json` against.

**EXIF survived sorting + watermarking** (`exiftool -j -DateTimeOriginal -GPSLatitude -GPSLongitude
fixtures/.tmp/sorted/2025/*/*.jpg`) — every destination file's date and GPS still match its
source's exactly (the acceptance test asserts this with a numeric tolerance for the
degrees-minutes-seconds round trip, not just "a value is present"):

```
2025-01-15_berlin/2025-01-15_101500_berlin_001.jpg: 2025:01:15 10:15:00, 52 deg 31' 12.00" N, 13 deg 24' 18.00" E
2025-01-15_berlin/2025-01-15_113000_berlin_002.jpg: 2025:01:15 11:30:00, 52 deg 31' 12.00" N, 13 deg 24' 18.00" E
2025-01-15_hamburg/2025-01-15_090000_hamburg_001.jpg: 2025:01:15 09:00:00, 53 deg 33' 3.96" N, 9 deg 59' 37.32" E
2025-06-02_hamburg/2025-06-02_164500_hamburg_001.jpg: 2025:06:02 16:45:00, 53 deg 33' 3.96" N, 9 deg 59' 37.32" E
2025-06-02_munich/2025-06-02_142000_munich_001.jpg: 2025:06:02 14:20:00, 48 deg 8' 6.36" N, 11 deg 34' 55.20" E
2025-11-30_munich/2025-11-30_080500_munich_001.jpg: 2025:11:30 08:05:00, 48 deg 8' 6.36" N, 11 deg 34' 55.20" E
```

**Contact sheet**: 848x366 JPEG (4 columns × 2 rows at the default `200x150+6+6` geometry — width
is exact/deterministic since it's pure column-count × cell-size arithmetic; height includes IM's
own label-text line height, so the test asserts a loose lower bound there, not an exact pixel
count).

## The optional `--summary` step

```bash
node bin/phototools.js organize fixtures/.tmp/raw --out fixtures/.tmp/sorted --summary
```

With no `LITELLM_API_KEY` configured: prints `summary: skipped (no LITELLM_API_KEY configured)`,
writes no `summary.txt`, still exits `0`.

With a real key (copy `.env.example` to `.env` and fill in real values — see the repo root
README's Quickstart), a real run against the shared demo litellm-proxy produced:

> This batch of 6 photos was taken between January 15, 2025, and November 30, 2025, with 3 photos
> on January 15, 2 on June 2, and 1 on November 30, across Berlin, Hamburg, and Munich.

(counts are correct: Jan 15 = img1+img2+img3 = 3, Jun 2 = img4+img5 = 2, Nov 30 = img6 = 1). If the
shared demo key's budget is exhausted, `organize` still exits `0` and logs the failure to stderr
(`summary: skipped` is only ever printed for "no key configured" — a real call failure logs
`summary step failed, continuing without it: <reason>` instead, so the two cases are never
confused).
