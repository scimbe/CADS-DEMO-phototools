"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  describeImage,
  isConfigured,
  visionModel,
  buildDataUrl,
  mimeForPath,
  parseVisionResponse,
} = require("../src/vision/describe");

test("isConfigured requires both base url and api key", () => {
  assert.equal(isConfigured({}), false);
  assert.equal(isConfigured({ LITELLM_BASE_URL: "http://x" }), false);
  assert.equal(isConfigured({ LITELLM_API_KEY: "k" }), false);
  assert.equal(isConfigured({ LITELLM_BASE_URL: " ", LITELLM_API_KEY: "k" }), false);
  assert.equal(isConfigured({ LITELLM_BASE_URL: "http://x", LITELLM_API_KEY: "k" }), true);
});

test("visionModel prefers LITELLM_VISION_MODEL, then DEFAULT, then hard default", () => {
  assert.equal(visionModel({ LITELLM_VISION_MODEL: "vlm", LITELLM_DEFAULT_MODEL: "d" }), "vlm");
  assert.equal(visionModel({ LITELLM_DEFAULT_MODEL: "d" }), "d");
  assert.equal(visionModel({}), "local-devstral-small2");
});

test("mimeForPath maps extensions and defaults to jpeg", () => {
  assert.equal(mimeForPath("a.JPG"), "image/jpeg");
  assert.equal(mimeForPath("a.jpeg"), "image/jpeg");
  assert.equal(mimeForPath("a.png"), "image/png");
  assert.equal(mimeForPath("a.webp"), "image/webp");
  assert.equal(mimeForPath("a.bin"), "image/jpeg");
});

test("buildDataUrl produces a base64 data url", () => {
  const url = buildDataUrl(Buffer.from("hi"), "image/jpeg");
  assert.equal(url, "data:image/jpeg;base64,aGk=");
});

test("parseVisionResponse: clean JSON", () => {
  const r = parseVisionResponse('{"caption":"A red boat at a snowy pier","tags":["boat","pier","snow"]}');
  assert.equal(r.caption, "A red boat at a snowy pier");
  assert.deepEqual(r.tags, ["boat", "pier", "snow"]);
});

test("parseVisionResponse: JSON wrapped in code fences + preamble", () => {
  const r = parseVisionResponse('Sure!\n```json\n{"caption":"Sunset skyline","tags":["city","sunset","tower"]}\n```');
  assert.equal(r.caption, "Sunset skyline");
  assert.deepEqual(r.tags, ["city", "sunset", "tower"]);
});

test("parseVisionResponse: dedupes tags, strips leading #, caps at 8", () => {
  const r = parseVisionResponse(
    '{"caption":"x","tags":["#City","city","CITY","a","b","c","d","e","f","g"]}'
  );
  assert.equal(r.tags.length, 8);
  assert.equal(r.tags[0], "City");
  // "city" and "CITY" are dupes of "City" and dropped.
  assert.ok(!r.tags.slice(1).map((t) => t.toLowerCase()).includes("city"));
});

test("parseVisionResponse: non-JSON prose becomes the caption with no tags", () => {
  const r = parseVisionResponse("A quiet harbor with two red boats.");
  assert.equal(r.caption, "A quiet harbor with two red boats.");
  assert.deepEqual(r.tags, []);
});

test("parseVisionResponse: empty/garbage yields empty caption, empty tags", () => {
  const r = parseVisionResponse("");
  assert.equal(r.caption, "");
  assert.deepEqual(r.tags, []);
});

test("describeImage: builds an OpenAI-vision request and returns parsed caption/tags", async () => {
  let captured = null;
  const fakeFetch = async (url, init) => {
    captured = { url, init, body: JSON.parse(init.body) };
    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          choices: [{ message: { content: '{"caption":"A cat","tags":["cat","indoor"]}' } }],
        }),
    };
  };
  const res = await describeImage("/some/photo.jpg", {
    LITELLM_BASE_URL: "https://proxy.example/v1/",
    LITELLM_API_KEY: "secret",
    LITELLM_DEFAULT_MODEL: "local-devstral-small2",
  }, { fetchImpl: fakeFetch, readFileImpl: async () => Buffer.from("JPEGBYTES") });

  assert.deepEqual(res, { caption: "A cat", tags: ["cat", "indoor"], model: "local-devstral-small2" });
  // trailing slash on base url is trimmed before appending the path
  assert.equal(captured.url, "https://proxy.example/v1/chat/completions");
  assert.equal(captured.init.headers.Authorization, "Bearer secret");
  const userMsg = captured.body.messages.find((m) => m.role === "user");
  const imgPart = userMsg.content.find((c) => c.type === "image_url");
  assert.ok(imgPart.image_url.url.startsWith("data:image/jpeg;base64,"));
  assert.ok(imgPart.image_url.url.includes(Buffer.from("JPEGBYTES").toString("base64")));
});

test("describeImage: non-2xx throws VisionHttpError, never a silent success", async () => {
  const fakeFetch = async () => ({ ok: false, status: 403, text: async () => "denied" });
  await assert.rejects(
    describeImage("/p.jpg", { LITELLM_BASE_URL: "http://x", LITELLM_API_KEY: "k" }, {
      fetchImpl: fakeFetch,
      readFileImpl: async () => Buffer.from("x"),
    }),
    (err) => err.name === "VisionHttpError" && /403/.test(err.message)
  );
});

test("describeImage: network error is wrapped as VisionHttpError", async () => {
  const fakeFetch = async () => {
    throw new Error("ECONNREFUSED");
  };
  await assert.rejects(
    describeImage("/p.jpg", { LITELLM_BASE_URL: "http://x", LITELLM_API_KEY: "k" }, {
      fetchImpl: fakeFetch,
      readFileImpl: async () => Buffer.from("x"),
    }),
    (err) => err.name === "VisionHttpError" && /network error/.test(err.message)
  );
});
