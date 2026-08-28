"use strict";

const { execFile } = require("node:child_process");

const MAX_BUFFER = 50 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 60000;

class ExecTimeoutError extends Error {}

/**
 * exec(cmd, args, { cwd, timeoutMs = 60000 } = {})
 *   -> Promise<{ stdout: string, stderr: string, exitCode: number | null }>
 *
 * execFile only -- argv arrays, never a shell string, so no argument can ever be
 * reinterpreted as shell syntax (the injection guard the plan calls for).
 *
 * Never rejects on a nonzero exit -- callers decide what a nonzero exit means for their tool:
 *   - process ran, exited nonzero  -> resolves { stdout, stderr, exitCode: <that code> }
 *   - spawn failure (binary not found, error.code === "ENOENT")
 *                                  -> resolves { stdout: "", stderr: error.message, exitCode: null }
 *   - genuine timeout (error.killed === true)
 *                                  -> REJECTS with ExecTimeoutError
 *
 * opts.env, when provided, replaces (not merges with) the child's environment, matching
 * execFile's own semantics -- pass a full `{ ...process.env, OVERRIDE: "x" }` object, not a
 * partial one, or the child loses everything else (PATH included).
 */
function exec(cmd, args = [], opts = {}) {
  const { cwd, timeoutMs = DEFAULT_TIMEOUT_MS, env } = opts;

  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { cwd, timeout: timeoutMs, maxBuffer: MAX_BUFFER, ...(env ? { env } : {}) },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ stdout: stdout ?? "", stderr: stderr ?? "", exitCode: 0 });
          return;
        }

        if (error.killed) {
          reject(new ExecTimeoutError(`${cmd} timed out after ${timeoutMs}ms`));
          return;
        }

        if (error.code === "ENOENT") {
          resolve({ stdout: "", stderr: error.message, exitCode: null });
          return;
        }

        const exitCode = typeof error.code === "number" ? error.code : (error.errno ?? null);
        resolve({ stdout: stdout ?? "", stderr: stderr ?? "", exitCode });
      }
    );
  });
}

/**
 * Cache of which ImageMagick invocation form works on this host: legacy IM6 standalone
 * binaries (`convert`, `montage`, `identify`) or IM7's single `magick` subcommand form
 * (`magick convert`, `magick montage`, `magick identify`). Resolved once per process via a
 * cheap `-version` probe, then reused -- so a per-call fallback never silently swallows a
 * *different* real failure (a bad file, a bad geometry string) as "must be the other form".
 */
let imFormPromise = null;

async function detectImForm() {
  const legacy = await exec("convert", ["-version"]).catch(() => ({ exitCode: null }));
  if (legacy.exitCode === 0) return "legacy";

  const im7 = await exec("magick", ["-version"]).catch(() => ({ exitCode: null }));
  if (im7.exitCode === 0) return "im7";

  return "unavailable";
}

function imForm() {
  if (!imFormPromise) imFormPromise = detectImForm();
  return imFormPromise;
}

/**
 * execImageMagick(tool, args, opts) -> Promise<{ stdout, stderr, exitCode }>
 * tool is one of "convert" | "montage" | "identify". Resolves the legacy-vs-magick-subcommand
 * form once (cached) and dispatches accordingly. Same resolve-never-reject contract as exec().
 */
async function execImageMagick(tool, args = [], opts = {}) {
  const form = await imForm();
  if (form === "legacy") return exec(tool, args, opts);
  if (form === "im7") return exec("magick", [tool, ...args], opts);
  return {
    stdout: "",
    stderr: `ImageMagick not found: tried 'convert'/'montage'/'identify' (IM6) and 'magick' (IM7)`,
    exitCode: null,
  };
}

/** Test-only escape hatch to force re-detection (e.g. after mocking exec). */
function _resetImFormCache() {
  imFormPromise = null;
}

module.exports = { exec, execImageMagick, ExecTimeoutError, _resetImFormCache };
