# phototools-cli — Foto-Batch-Organizer

A headless CLI demo for the [bunsenbrenner.org](https://bunsenbrenner.org) marketplace catalog,
built for the broadest possible audience: everyday consumers with a folder full of unsorted phone
photos. It uses **real `exiftool` + real ImageMagick** to batch-sort/rename photos by their actual
EXIF date and GPS location, watermark them, and build a contact sheet. An LLM can add a one-line
"what's in this batch" caption, but that's a secondary garnish, not the core: **the deterministic
tool orchestration works with zero LLM/network involvement**, and the tests prove that structurally,
not just by claim.

## What this is (and isn't)

Most "AI photo organizer" demos either fake the sorting logic or quietly depend on a vision model
to "look at" the photos. This one does neither:

- **Sorting is driven by real EXIF data**, read with `exiftool`, not filesystem mtime or a
  filename heuristic.
- **Location is resolved offline**, via a small bundled gazetteer of ~20 real cities + haversine
  nearest-neighbor — no geocoding API key, no network dependency, fully deterministic.
- **The LLM never sees pixels.** `local-devstral-small2` (the shared demo model) is a coding
  model, not documented as vision-capable, so the optional `--summary` step sends it a short
  *text* description of the batch's aggregate metadata (counts per date/city, date range) and
  asks for a one-line caption. It is never asked to describe image content it was never shown.
- **The LLM step is structurally optional**, not just "usually works": `organizeCommand.js` only
  ever calls it when `--summary` is passed *and* `LITELLM_API_KEY`/`LITELLM_BASE_URL` are set
  (`src/llm/summarize.js#isConfigured`). Unset the key and `--summary` cleanly no-ops (exit 0, no
  `summary.txt`) — proven by an automated test that deliberately strips the key from the child
  process's environment, not just by "nobody happened to set it this run."

## Quickstart

```bash
npm install
cp .env.example .env   # only needed for the optional --summary step, see below

# Generate a small synthetic photo batch with real, distinct EXIF (date + GPS), then run the
# full pipeline against it:
npm run fixture:organize

# See the before/after for yourself:
find fixtures/.tmp/raw    -type f | sort
find fixtures/.tmp/sorted -type f | sort
exiftool -j -DateTimeOriginal -GPSLatitude -GPSLongitude fixtures/.tmp/sorted/**/*.jpg

npm test
```

See `fixtures/README.md` for exactly what the fixture batch contains and why.

## How it works

```
phototools organize <srcDir> --out <dir> [--move] [--watermark-text "<text>"] [--contact-sheet] [--summary]
```

1. **Read EXIF** (`src/exif/read.js`): one batched `exiftool -j -G -a -n <files...>` call for the
   whole directory (not one process per file). `-n` is load-bearing: without it, exiftool prints
   GPS as a DMS string (`52 deg 31' 12.00"`) instead of a decimal-degrees number — this was caught
   live during fixture-generation testing and is called out in the code comment, not just fixed
   silently.
2. **Resolve location** (`src/geocode/nearestCity.js`): each photo's GPS gets matched to the
   nearest city in the bundled `gazetteer.json` by great-circle (haversine) distance — pure math,
   no I/O, unit-tested. No GPS tag → `unknown-location`.
3. **Plan destination names** (`src/organize/planNames.js`): a pure function (no filesystem, no
   `exec`) that maps EXIF+location records to
   `{YYYY}/{YYYY-MM-DD}_{city}/{YYYY-MM-DD}_{HHMMSS}_{city}_{seq:03d}.{ext}`, with `seq`
   incrementing per (date, city) bucket — ordered by source filename — so two photos in the same
   second/bucket never collide. No date tag → `undated/undated_{city}_{seq}.{ext}`.
4. **Apply the plan** (`src/organize/apply.js`): copies (default) or moves (`--move`) each source
   into place, creates directories as needed, and writes `<out>/manifest.json` — the full
   before→after mapping, which is also the acceptance test's machine-checkable oracle.
5. **Watermark** (`--watermark-text`, `src/imagemagick/watermark.js`): runs ImageMagick `convert`
   with `-gravity SouthEast -annotate` on every destination copy, **then immediately re-stamps
   EXIF from the original source** via `exiftool -tagsFromFile ... -all:all` (`src/exif/write.js`
   `restampExif`). This is deliberate, not paranoia: ImageMagick's own EXIF passthrough on write
   is version/config-dependent, so "EXIF survives watermarking" is made a guaranteed property of
   the pipeline instead of an assumption about IM internals — see `docs/ARCHITECTURE.md`.
6. **Contact sheet** (`--contact-sheet`, `src/imagemagick/contactSheet.js`): one `montage` call
   over every destination file, labeled by filename.
7. **Summary** (`--summary`, `src/llm/summarize.js`): optional, text-only, degrades to a logged
   skip (not an error) with no key configured; a real call failure (network, auth, exhausted
   budget) is caught and logged loudly to stderr — never silently swallowed as a false "skipped."

`manifest.json` ends up with the full before→after mapping plus per-run metadata:

```json
{
  "mode": "copy",
  "count": 6,
  "entries": [
    { "srcPath": "fixtures/.tmp/raw/img1.jpg",
      "destRelPath": "2025/2025-01-15_berlin/2025-01-15_101500_berlin_001.jpg",
      "dateTimeOriginal": "2025:01:15 10:15:00", "city": "Berlin", "lat": 52.52, "lon": 13.405,
      "destPath": "fixtures/.tmp/sorted/2025/2025-01-15_berlin/2025-01-15_101500_berlin_001.jpg" }
  ],
  "watermark": { "text": "...", "appliedTo": 6 },
  "contactSheet": "fixtures/.tmp/sorted/contact-sheet.jpg",
  "summary": null
}
```

## Commands / flags

| Flag | Effect |
|---|---|
| `organize <srcDir> --out <dir>` | Required. Reads every `*.jpg`/`*.jpeg` in `srcDir`, sorts/renames into `<dir>`, writes `manifest.json`. |
| `--move` | Move instead of copy. **Default is copy** — originals are never mutated unless this is explicitly passed. |
| `--watermark-text "<text>"` | Watermarks every destination copy (bottom-right, semi-transparent white), then re-stamps EXIF. |
| `--contact-sheet` | Builds `<out>/contact-sheet.jpg` from every destination file. |
| `--summary` | Attempts a one-line LLM caption of the batch's aggregate metadata → `<out>/summary.txt`. No-ops cleanly if no LLM key is configured. |
| `--pointsize <n>`, `--tile <spec>`, `--geometry <spec>` | Override the ImageMagick watermark/contact-sheet defaults. |

## Environment setup

**exiftool** — Debian/Ubuntu: `apt-get install -y libimage-exiftool-perl` (candidate
`12.76+dfsg-1` at the time of writing). macOS: `brew install exiftool`.

**ImageMagick** — Debian/Ubuntu: `apt-get install -y imagemagick`. macOS: `brew install
imagemagick`. This repo was built and tested against **IM6** (legacy standalone `convert` /
`montage` / `identify` binaries — `6.9.12-98` on the dev host). `src/util/shell.js` also detects
and falls back to IM7's single-binary form (`magick convert`, `magick montage`) when `convert`
isn't found but `magick` is — **that fallback path is written defensively but has not been
exercised on real IM7**, since no IM7 host was available to test against. Flagging this honestly
rather than claiming untested coverage.

**No root in this dev sandbox, honestly:** the sandbox this repo was built in has no passwordless
`sudo`, so `apt-get install libimage-exiftool-perl` wasn't possible here. exiftool was instead
vendored from its real upstream distribution (`exiftool.org` → SourceForge mirror,
`Image-ExifTool-13.59.tar.gz`, the exact same Perl project apt would have installed) and symlinked
onto `PATH`. This is a same-tool, different-install-channel workaround for a sandbox constraint,
not a substitute or a mock — every test in this repo ran against that real binary. A normal
deploy target with root should just use `apt-get`/`brew`.

## Known limitations / honest gaps

- **`undated` / `unknown-location` fallback buckets are unit-tested (`planNames.test.js`) but not
  exercised end-to-end through the CLI** — the acceptance fixture always has both a date and a GPS
  tag on every photo, per the brief. A real consumer photo library will have gaps; the code paths
  exist and are tested at the `planNames` layer, just not proven through a full `organize` run.
- **IM7 fallback is untested** (see above).
- **No collision handling across repeated `organize` runs into the same `--out` dir**: re-running
  `organize` twice into the same output directory will overwrite files with the same computed
  destination name (a second run of an identical source batch produces identical filenames) —
  there's no "already organized, skip" state tracking yet. Fine for a one-shot demo; a real
  incremental-import tool would need this.
- **No batch size / progress reporting** beyond a final summary line — fine for a demo-sized
  batch, would want a progress indicator for thousands of photos.
- **`--summary` costs a real LLM call per run** — the shared demo key is budget-capped; see
  `fixtures/README.md` for what a real run looked like and what to expect if the budget is
  exhausted.

## Project layout

```
bin/phototools.js          CLI entry (dotenv + dispatch)
src/cli/                   argv parsing + organize orchestration
src/exif/                  exiftool read/write wrappers
src/geocode/                gazetteer + haversine nearest-city
src/organize/               pure name-planning + filesystem apply
src/imagemagick/            convert (watermark) / montage (contact sheet) wrappers
src/llm/                    optional litellm-proxy summary
src/util/                   execFile wrapper (argv-array only, no shell string concat), logging
fixtures/                  synthetic-photo generator + hand-checked oracle manifest
tests/                     unit tests (pure logic) + real-binary integration + full acceptance run
docs/ARCHITECTURE.md       pipeline stages, the EXIF-restamp decision, IM6/IM7 handling
```
