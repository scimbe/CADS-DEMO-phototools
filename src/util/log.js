"use strict";

/* Minimal stdout/stderr logger -- kept as a single module so tests/CLI output stay consistent
 * and so a future "--json" machine-output mode has one place to redirect. */

function info(msg) {
  process.stdout.write(`${msg}\n`);
}

function warn(msg) {
  process.stderr.write(`warning: ${msg}\n`);
}

function error(msg) {
  process.stderr.write(`error: ${msg}\n`);
}

module.exports = { info, warn, error };
