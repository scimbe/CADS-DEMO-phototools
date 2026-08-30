"use strict";

/**
 * src/util/concurrency.js
 *
 * A tiny bounded-concurrency worker pool. The organize pipeline's per-photo steps (vision calls to
 * the litellm proxy, ImageMagick watermark+restamp) have NO cross-photo dependency, so running them
 * strictly one-at-a-time just serializes N independent round-trips. This runs them with at most
 * `limit` in flight -- bounded on purpose (never one-promise-per-item unbounded), so a large batch
 * can't flood the vision backend or fork an unbounded number of ImageMagick processes.
 *
 * Guarantees the callers rely on:
 *   - Results are returned in INPUT ORDER (results[i] is worker(items[i], i)), regardless of the
 *     order tasks actually finish -- so manifest order / provenance is never reordered.
 *   - At most `limit` workers run concurrently (clamped to >=1 and <= items.length).
 *   - If a worker throws, no NEW task is started, in-flight tasks are awaited to settle (no dangling
 *     work / unhandled rejections), and then the EARLIEST-by-index error is rethrown. A worker that
 *     handles its own errors (returns instead of throwing) makes the whole map non-fatal -- which is
 *     exactly how the vision step opts into "never fail the run."
 */
async function mapWithConcurrency(items, limit, worker) {
  const list = Array.isArray(items) ? items : [];
  const results = new Array(list.length);
  if (list.length === 0) return results;

  const effLimit = Math.max(1, Math.min(Number(limit) || 1, list.length));

  let nextIndex = 0;
  let firstErrorIndex = Infinity;
  let firstError = null;

  async function runner() {
    // Stop claiming NEW work once any worker has failed; in-flight tasks in other runners still
    // finish before Promise.all below resolves.
    while (firstError === null) {
      const i = nextIndex;
      nextIndex += 1;
      if (i >= list.length) return;
      try {
        results[i] = await worker(list[i], i);
      } catch (err) {
        if (i < firstErrorIndex) {
          firstErrorIndex = i;
          firstError = err;
        }
        return;
      }
    }
  }

  const runners = [];
  for (let r = 0; r < effLimit; r += 1) runners.push(runner());
  await Promise.all(runners);

  if (firstError !== null) throw firstError;
  return results;
}

module.exports = { mapWithConcurrency };
