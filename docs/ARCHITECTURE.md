# Architecture

## Pipeline stages

```
srcDir/*.jpg
   |
   v
[1] exif/read.js: exiftool -j -G -a -n <files...>   (one batched process, not one per file)
   |
   v
[2] geocode/nearestCity.js: GPS -> nearest gazetteer city (haversine, pure math, offline)
   |
   v
[3] organize/planNames.js: (EXIF + city) -> {YYYY}/{YYYY-MM-DD}_{city}/{...}_{seq}.ext
   |                        PURE function -- no fs, no exec, fully unit-testable
   v
[4] organize/apply.js: copy/move into place, write manifest.json
   |
   v
[5] (optional --watermark-text) imagemagick/watermark.js: convert ... -annotate ...
   |                             then exif/write.js#restampExif: tagsFromFile <src> -all:all <dest>
   v
[6] (optional --contact-sheet) imagemagick/contactSheet.js: montage <all dest files> -> contact-sheet.jpg
   |
   v
[7] (optional --summary) llm/summarize.js: POST manifest's aggregate TEXT metadata to litellm-proxy
```

Everything through stage 4 is the deterministic core the brief asks for. Stages 5-7 are additive
and each individually optional; none of them can make the pipeline fail to produce a correctly
sorted/renamed/manifested output.

## Why EXIF is re-stamped after every ImageMagick write

ImageMagick's EXIF passthrough on write is not something to trust blindly — whether `convert`
preserves the original EXIF profile on a re-encode depends on the IM build, its delegate
libraries, and the output format's own quirks (a JPEG re-encode can legitimately choose to drop
metadata a caller didn't explicitly ask to keep). Rather than discover this the hard way on some
other host/IM version, the pipeline is written so that "the destination file's EXIF is correct"
is **never an assumption about IM internals** — it's a second, explicit, always-run step:

```
exiftool -overwrite_original -tagsFromFile <pre-watermark source> -all:all <watermarked dest>
```

This copies every tag (not just date/GPS) from the pre-watermark source onto the watermarked
destination, unconditionally, every time. `tests/exifReadWrite.test.js`'s
`restampExif copies EXIF...` test deliberately does NOT assert on what watermarking alone did to
the file's EXIF (see the comment in that test) — only on the state *after* the restamp step, which
is the only state the pipeline actually promises.

## Why `-n` on every `exiftool` read

Without `-n`, exiftool prints GPS coordinates as a human-readable DMS string:
`"52 deg 31' 12.00\""`. A naive `parseFloat()` on that string silently truncates to `52` — this
was not a hypothetical worry, it's a bug that was caught live during fixture-generation testing
(the round-trip self-check in `fixtures/generate.js` failed with exactly this symptom on the
first run). `-n` makes exiftool emit a plain signed/unsigned decimal-degrees number instead. See
`src/exif/read.js`'s `readExif`/`toDecimalDegrees` doc comments for the full explanation,
including the further subtlety that even with `-n`, the `EXIF:GPSLatitude` group's value is an
**unsigned magnitude** (sign lives in the separate `GPSLatitudeRef` tag / the derived
`Composite:GPSLatitude`) — verified live against a synthetic southern-hemisphere fixture.

## Location resolution: bundled gazetteer, not a geocoding API

The shared demo LLM (`local-devstral-small2`) is a coding model, not documented as vision-capable,
so it was never a candidate for "look at the photo and guess where it was taken." A live
reverse-geocoding API was also rejected — it would make the acceptance run's correctness depend on
network availability and a third-party service's uptime, which is the opposite of what a
deterministic-core demo should do. Instead: `src/geocode/gazetteer.json` bundles ~20 real cities
with real lat/lon, and `src/geocode/nearestCity.js` resolves each photo's GPS to the closest one by
great-circle (haversine) distance — pure math, zero I/O, offline, and exact for the acceptance
fixture (whose coordinates are copied verbatim from the gazetteer, so the match distance is 0 km,
not "close enough").

## ImageMagick IM6 vs IM7

This host ships legacy IM6 (`convert`, `montage`, `identify` as separate standalone binaries,
`6.9.12-98`). Some newer distros ship IM7-only, where these become subcommands of one `magick`
binary (`magick convert`, `magick montage`). `src/util/shell.js`'s `execImageMagick()` probes once
per process (`convert -version`, falling back to `magick -version`) and caches which form is
available, then dispatches every subsequent IM call accordingly. **Honest gap:** only the IM6 path
has actually been exercised — no IM7 host was available to test the fallback against a real
`magick` binary, so that branch is written defensively (based on IM7's documented subcommand
syntax) but unverified in this repo's test runs.

## Injection safety

`src/util/shell.js`'s `exec()` wraps Node's `execFile` (never `exec`/a shell string) — every
argument is a distinct argv array element, so a filename or watermark text containing shell
metacharacters (`; rm -rf /`, `$(...)`, backticks) is passed to the child process as inert literal
text, never reinterpreted as shell syntax. No module in this codebase ever string-concatenates a
shell command.

## Manifest as the acceptance artifact

`organize/apply.js` writes `<out>/manifest.json` as the single source of truth for what happened:
every entry carries `srcPath`, `destRelPath`, `destPath`, the resolved `dateTimeOriginal`/`lat`/
`lon`/`city`, and (after later stages run) `watermark`/`contactSheet`/`summary` metadata. This is
deliberately the artifact `tests/acceptance.organize.test.js` diffs against a hand-checked oracle
(`fixtures/expected/manifest.sample.json`) rather than re-deriving expectations from scratch in
the test itself — the oracle was built once from a real, manually-inspected run (see
`fixtures/README.md`), not computed by the same code path it's meant to check.
