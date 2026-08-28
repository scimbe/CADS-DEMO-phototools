"use strict";

/**
 * parseOrganizeArgs(argv) -> { srcDir, out, move, watermarkText, contactSheet, summary,
 *                               pointsize, tile, geometry }
 * Minimal hand-rolled parser for the one subcommand this CLI has -- deliberately not pulling in
 * a full argv-parsing dependency for a handful of flags. `argv` is process.argv.slice(3) (i.e.
 * with node/script/"organize" already stripped by the caller).
 *
 * Throws a plain Error with a human-readable message on missing/malformed required args --
 * bin/phototools.js prints err.message to stderr and exits nonzero.
 */
function parseOrganizeArgs(argv) {
  const opts = {
    srcDir: null,
    out: null,
    move: false,
    watermarkText: null,
    contactSheet: false,
    summary: false,
    pointsize: undefined,
    tile: undefined,
    geometry: undefined,
  };

  const positionals = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--out":
        opts.out = argv[++i];
        break;
      case "--move":
        opts.move = true;
        break;
      case "--watermark-text":
        opts.watermarkText = argv[++i];
        break;
      case "--contact-sheet":
        opts.contactSheet = true;
        break;
      case "--summary":
        opts.summary = true;
        break;
      case "--pointsize":
        opts.pointsize = Number(argv[++i]);
        break;
      case "--tile":
        opts.tile = argv[++i];
        break;
      case "--geometry":
        opts.geometry = argv[++i];
        break;
      default:
        if (arg.startsWith("--")) {
          throw new Error(`unknown option: ${arg}`);
        }
        positionals.push(arg);
    }
  }

  if (positionals.length === 0) throw new Error("missing required argument: <srcDir>");
  opts.srcDir = positionals[0];
  if (!opts.out) throw new Error("missing required option: --out <dir>");

  return opts;
}

module.exports = { parseOrganizeArgs };
