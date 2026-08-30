"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { mapWithConcurrency } = require("../src/util/concurrency");

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

test("returns results in input order regardless of completion order", async () => {
  // Later items resolve sooner, so completion order != input order.
  const items = [40, 30, 20, 10, 0];
  const out = await mapWithConcurrency(items, 3, async (ms, i) => {
    await tick(ms);
    return `#${i}:${ms}`;
  });
  assert.deepEqual(out, ["#0:40", "#1:30", "#2:20", "#3:10", "#4:0"]);
});

test("never exceeds the concurrency limit and still processes every item", async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const n = 20;
  const items = Array.from({ length: n }, (_, i) => i);
  const out = await mapWithConcurrency(items, 4, async (i) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await tick(3);
    inFlight -= 1;
    return i * 2;
  });
  assert.equal(maxInFlight <= 4, true, `maxInFlight was ${maxInFlight}, expected <= 4`);
  assert.equal(out.length, n);
  assert.deepEqual(out, items.map((i) => i * 2));
});

test("empty input resolves to an empty array without calling the worker", async () => {
  let calls = 0;
  const out = await mapWithConcurrency([], 4, async () => {
    calls += 1;
  });
  assert.deepEqual(out, []);
  assert.equal(calls, 0);
});

test("limit is clamped to at least 1 (limit 0 still runs, serially)", async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const out = await mapWithConcurrency([1, 2, 3], 0, async (x) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await tick(2);
    inFlight -= 1;
    return x;
  });
  assert.deepEqual(out, [1, 2, 3]);
  assert.equal(maxInFlight, 1);
});

test("a throwing worker rejects the map with the earliest-by-index error", async () => {
  // Two workers throw; index 1 throws later in wall-clock but is the lower index, so it must win.
  const err1 = new Error("fail-1");
  const err3 = new Error("fail-3");
  await assert.rejects(
    mapWithConcurrency([0, 1, 2, 3, 4], 2, async (x) => {
      if (x === 3) {
        await tick(1);
        throw err3;
      }
      if (x === 1) {
        await tick(10);
        throw err1;
      }
      await tick(2);
      return x;
    }),
    (e) => e === err1
  );
});

test("after a failure, no NEW tasks start (in-flight ones settle)", async () => {
  const started = [];
  await assert.rejects(
    mapWithConcurrency([0, 1, 2, 3, 4, 5, 6, 7], 2, async (x) => {
      started.push(x);
      if (x === 0) {
        await tick(2);
        throw new Error("boom");
      }
      await tick(50);
      return x;
    }),
    /boom/
  );
  // With limit 2, items 0 and 1 start immediately; 0 fails fast. No further items (2..7) should
  // have been claimed once the error was recorded.
  assert.equal(started.includes(2), false, `started should not include 2, got ${started}`);
  assert.equal(started.length <= 2, true, `expected <=2 started, got ${started}`);
});

test("a worker that handles its own error makes the whole map non-fatal", async () => {
  // This is exactly how the vision step uses it: worker returns an outcome, never throws.
  const out = await mapWithConcurrency([0, 1, 2], 2, async (x) => {
    try {
      if (x === 1) throw new Error("photo 1 failed");
      return { ok: true, x };
    } catch (err) {
      return { ok: false, x, error: err.message };
    }
  });
  assert.deepEqual(out, [
    { ok: true, x: 0 },
    { ok: false, x: 1, error: "photo 1 failed" },
    { ok: true, x: 2 },
  ]);
});
