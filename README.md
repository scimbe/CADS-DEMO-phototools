# phototools-cli — Foto-Batch-Organizer

A headless CLI demo for the [bunsenbrenner.org](https://bunsenbrenner.org) marketplace catalog,
built for the broadest possible audience: everyday consumers with a folder full of unsorted phone
photos. It uses **real `exiftool` + real ImageMagick** to batch-sort/rename photos by their actual
EXIF date and GPS location, watermark them, and build a contact sheet. An LLM can add a one-line
"what's in this batch" caption, but that's a secondary garnish, not the core: **the deterministic
tool orchestration works with zero LLM/network involvement**, and the tests prove that structurally,
not just by claim.

Tracking issue: [CADS-agent-marketplace#27](https://github.com/scimbe/CADS-agent-marketplace/issues/27).

## Marketplace status

This demo is published to the live **bunsenbrenner.org** registry
(`registry.bunsenbrenner.org`) as a signed manifest. Verified present on 2026-08-29:

- name `phototools`, latest version `0.1.3`, `installer_kind: binary`
- publisher pubkey `1292c0cc…ce69b` (shared across the whole demo portfolio)
- manifest id `e787e750…6194d`

Reproduce the check yourself:

```bash
curl -s https://registry.bunsenbrenner.org/manifests | grep '"name":"phototools"'
```

**Measured vs. claimed:** what is *measured* here is that the manifest — signed metadata
plus a publisher-signed bundle reference — is listed on the registry. The registry's own
guardrail verdict for a binary-kind manifest explicitly notes it is **not** a static bundle
scan; trust rests on the publisher-pubkey allowlist checked at activation time. It is **not**
a claim that an always-on hosted `*.bunsenbrenner.org` service exists — this is a CLI-only
tool, and live tunnel/service deployment would be a separate, later step.

## What this is (and isn't)

Most "AI photo organizer" demos either fake the sorting logic or quietly depend on a vision model
to "look at" the photos. This one does neither:

- **Sorting is driven by real EXIF data**, read with `exiftool`, not filesystem mtime or a
  filename heuristic.
- **Location is resolved offline**, via a small bundled gazetteer of ~20 real cities + haversine
  nearest-neighbor — no geocoding API key, no network dependency, fully deterministic.
- **The `--summary` step never sees pixels.** It sends the model a short *text* description of the
  batch's aggregate metadata (counts per date/city, date range) and asks for a one-line caption —
  it is never asked to describe image content it was never shown. That is a deliberate property of
  the *summary* path and stays true regardless of the model's capabilities.
- **`--vision` is a separate, opt-in step that *does* see pixels.** It sends each organized photo
  (base64-inlined, OpenAI-vision `image_url` format) to the litellm proxy and asks for a one-line
  content caption + a few tags, which enrich `manifest.json` and the HTML gallery. It is meant for
  a real vision model (`local-llava`, Qwen2.5-VL, …) via `LITELLM_VISION_MODEL`. Honest note on the
  shared demo deployment: the demo API key is scoped to exactly one model, `local-devstral-small2`,
  and no dedicated VLM is reachable with it — but that model *as proxied* accepts image input and
  returns per-image, content-accurate captions (verified live against distinct photos plus a
  solid-color control: the captions differ per image and match the actual pixels, not a generic
  hallucination). So `--vision` works out-of-the-box against the shared model, and can be repointed
  at a dedicated VLM on any deployment whose key allows it. See `src/vision/describe.js`.
- **Both network steps are structurally optional**, not just "usually work": `organizeCommand.js`
  only ever calls `--summary`/`--vision` when the flag is passed *and*
  `LITELLM_API_KEY`/`LITELLM_BASE_URL` are set (`isConfigured`). Unset the key and `--summary`
  cleanly no-ops (exit 0, no `summary.txt`) — proven by an automated test that deliberately strips
  the key from the child process's environment. `--vision` degrades the same way (clean skip with
  no key; a per-photo call failure is logged and leaves that photo caption-less, never failing the
  deterministic organize run).

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
phototools organize <srcDir> --out <dir> [--move] [--watermark-text "<text>"] [--vision] [--contact-sheet] [--gallery] [--summary]
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
6. **Vision** (`--vision`, `src/vision/describe.js`): optional, per photo. Base64-inlines each
   organized destination file and POSTs it to `${LITELLM_BASE_URL}/chat/completions` in OpenAI
   vision `image_url` format, asking for a one-line content caption + 3–6 tags as strict JSON
   (parsed defensively: fenced/chatty output still yields a usable caption). Each call is
   independently non-fatal — a failure leaves that photo's `vision` null and is logged, never
   failing the run. Results land on `manifest.entries[].vision` and feed the gallery. Uses
   `LITELLM_VISION_MODEL` (fallback `LITELLM_DEFAULT_MODEL`).
7. **Contact sheet** (`--contact-sheet`, `src/imagemagick/contactSheet.js`): one `montage` call
   over every destination file, labeled by filename.
8. **Gallery** (`--gallery`, `src/gallery/buildGallery.js`): writes a single, self-contained
   `<out>/gallery.html` — a responsive grid grouped by date+city, with an inline
   **click-to-enlarge lightbox** (Esc / backdrop-click to close, ←/→ to step through, focus moved
   into the dialog on open). No external CDN/script/font: all CSS+JS is inlined and the sorted
   photos are referenced by relative path, so it works both opened from disk and served out of the
   `--out` directory. When `--vision` ran, each photo shows its AI caption + tags; without it the
   page still renders cleanly from EXIF date + city.
9. **Summary** (`--summary`, `src/llm/summarize.js`): optional, text-only, degrades to a logged
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
      "destPath": "fixtures/.tmp/sorted/2025/2025-01-15_berlin/2025-01-15_101500_berlin_001.jpg",
      "vision": { "caption": "A city skyline at sunset with a tall tower in the center.",
                  "tags": ["city", "skyline", "tower", "sunset"], "model": "local-devstral-small2" } }
  ],
  "watermark": { "text": "...", "appliedTo": 6 },
  "vision": { "model": "local-devstral-small2", "described": 6, "failed": 0, "total": 6 },
  "contactSheet": "fixtures/.tmp/sorted/contact-sheet.jpg",
  "gallery": "fixtures/.tmp/sorted/gallery.html",
  "summary": null
}
```

## Commands / flags

| Flag | Effect |
|---|---|
| `organize <srcDir> --out <dir>` | Required. Reads every `*.jpg`/`*.jpeg` in `srcDir`, sorts/renames into `<dir>`, writes `manifest.json`. |
| `--move` | Move instead of copy. **Default is copy** — originals are never mutated unless this is explicitly passed. |
| `--watermark-text "<text>"` | Watermarks every destination copy (bottom-right, semi-transparent white), then re-stamps EXIF. |
| `--vision` | Per-photo AI content caption + tags (vision model via the litellm proxy), written to `manifest.entries[].vision`. Non-fatal per photo; no-ops cleanly with no LLM key. See `LITELLM_VISION_MODEL`. |
| `--contact-sheet` | Builds `<out>/contact-sheet.jpg` from every destination file. |
| `--gallery` | Writes a self-contained `<out>/gallery.html` (grid + click-to-enlarge lightbox, no external assets). Shows `--vision` captions/tags when present. |
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
src/vision/                 optional per-photo litellm-proxy vision caption/tags (opt-in --vision)
src/gallery/                self-contained HTML gallery + click-to-enlarge lightbox (--gallery)
src/llm/                    optional litellm-proxy summary
src/util/                   execFile wrapper (argv-array only, no shell string concat), logging
fixtures/                  synthetic-photo generator + hand-checked oracle manifest
tests/                     unit tests (pure logic) + real-binary integration + full acceptance run
docs/ARCHITECTURE.md       pipeline stages, the EXIF-restamp decision, IM6/IM7 handling
```
