"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const REQUEST_TIMEOUT_MS = 60000;
// Vision is served through the same litellm proxy as the text summary. On the shared demo
// deployment the configured API key is scoped to exactly one model (local-devstral-small2), and
// that model -- as proxied -- genuinely accepts OpenAI-vision `image_url` content and describes
// real image pixels (verified live against distinct photos + a solid-color control: the captions
// differ per image and match the actual content, not a generic hallucination). So the DEFAULT
// vision model is the same shared model, overridable via LITELLM_VISION_MODEL for a deployment
// that exposes a dedicated VLM (local-llava, Qwen2.5-VL, ...) under a differently-scoped key.
const DEFAULT_VISION_MODEL = "local-devstral-small2";

class VisionHttpError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = "VisionHttpError";
    this.status = status;
    this.body = body;
  }
}

/**
 * isConfigured(env = process.env) -> boolean
 * Same structural gate as the text summary: true only if LITELLM_BASE_URL and LITELLM_API_KEY
 * are both non-empty. organizeCommand.js only ever calls describeImage() when the caller passed
 * --vision AND this returns true, so "vision is optional" is a property of the wiring, not a hope.
 * A deployment with no key set gets a clean skip (no network, no error), exactly like --summary.
 */
function isConfigured(env = process.env) {
  return (
    Boolean(String(env.LITELLM_BASE_URL || "").trim()) &&
    Boolean(String(env.LITELLM_API_KEY || "").trim())
  );
}

/** visionModel(env) -> the model id to use: LITELLM_VISION_MODEL wins, else LITELLM_DEFAULT_MODEL, else the shared default. */
function visionModel(env = process.env) {
  return String(env.LITELLM_VISION_MODEL || env.LITELLM_DEFAULT_MODEL || DEFAULT_VISION_MODEL);
}

const MIME_BY_EXT = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

/** mimeForPath(p) -> an image/* mime string from the file extension, defaulting to image/jpeg. */
function mimeForPath(p) {
  return MIME_BY_EXT[path.extname(p).toLowerCase()] || "image/jpeg";
}

/**
 * buildDataUrl(buffer, mime) -> "data:<mime>;base64,<...>"
 * A base64 data: URL is used (not a public http URL) on purpose: the organized photos are local
 * files with no reachable URL, and inlining keeps the whole vision path offline-of-CDN and free
 * of any "upload the user's photos somewhere" step -- the bytes go only to the same litellm proxy
 * the text summary already talks to.
 */
function buildDataUrl(buffer, mime) {
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

/**
 * parseVisionResponse(text) -> { caption: string, tags: string[] }
 * The model is asked for a strict JSON object {"caption": "...", "tags": ["...", ...]}, but small
 * local models wander -- they wrap JSON in ``` fences, add a preamble, or answer in prose. This
 * degrades instead of throwing:
 *   - pulls the first {...} block out of the text and parses it,
 *   - normalizes caption (string) and tags (array of non-empty strings, deduped, capped),
 *   - if no usable JSON is found, treats the whole trimmed text as the caption with no tags.
 * So a chatty model still yields a usable caption rather than failing the photo.
 */
function parseVisionResponse(text) {
  const raw = String(text == null ? "" : text).trim();
  const fromJson = extractJsonObject(raw);

  let caption = "";
  let tags = [];
  if (fromJson && typeof fromJson === "object") {
    if (typeof fromJson.caption === "string") caption = fromJson.caption.trim();
    else if (typeof fromJson.description === "string") caption = fromJson.description.trim();
    if (Array.isArray(fromJson.tags)) tags = fromJson.tags;
  }

  if (!caption) caption = stripFences(raw);

  const cleanTags = [];
  const seen = new Set();
  for (const t of tags) {
    const s = String(t == null ? "" : t).trim().replace(/^#/, "");
    const key = s.toLowerCase();
    if (s && !seen.has(key)) {
      seen.add(key);
      cleanTags.push(s);
    }
    if (cleanTags.length >= 8) break;
  }

  return { caption: caption.slice(0, 500), tags: cleanTags };
}

function stripFences(s) {
  return s.replace(/^```[a-z]*\s*/i, "").replace(/\s*```$/i, "").trim();
}

function extractJsonObject(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  const slice = text.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch {
    return null;
  }
}

const SYSTEM_PROMPT =
  "You are a photo cataloguer. Look at the image and reply with ONLY a compact JSON object of the " +
  'form {"caption": "<one short factual sentence describing what is visible>", "tags": ["<lowercase noun>", ...]}. ' +
  "Give 3 to 6 tags: concrete visible subjects, setting, or scene type. Describe only what you can actually " +
  "see. No prose outside the JSON, no code fences.";

/**
 * describeImage(imagePath, env = process.env, opts = {}) -> Promise<{ caption, tags, model }>
 * Reads the image, base64-inlines it as a data: URL, and POSTs an OpenAI-vision chat/completions
 * request to `${LITELLM_BASE_URL}/chat/completions` asking for a JSON {caption, tags}. Throws
 * VisionHttpError on any non-2xx / network / timeout / malformed response -- the caller (the CLI)
 * decides how to surface that; this module never swallows a real failure into a fake success.
 * Use isConfigured() first for the clean "no key -> skip" behavior, exactly as with summarize().
 *
 * opts.fetchImpl / opts.readFileImpl are injectable for tests (default: global fetch / fs.readFile).
 */
async function describeImage(imagePath, env = process.env, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const readFileImpl = opts.readFileImpl || fs.readFile;

  const baseUrl = String(env.LITELLM_BASE_URL || "").replace(/\/+$/, "");
  const apiKey = String(env.LITELLM_API_KEY || "");
  const model = visionModel(env);

  const buffer = await readFileImpl(imagePath);
  const dataUrl = buildDataUrl(Buffer.from(buffer), mimeForPath(imagePath));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    let response;
    try {
      response = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: [
                { type: "text", text: "Describe this photo as instructed." },
                { type: "image_url", image_url: { url: dataUrl } },
              ],
            },
          ],
          temperature: 0,
          max_tokens: 200,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      throw new VisionHttpError("vision request failed: network error", {
        status: undefined,
        body: String(err && err.message ? err.message : err).slice(0, 500),
      });
    }

    const bodyText = await response.text().catch(() => "");
    if (!response.ok) {
      throw new VisionHttpError(`vision request failed: ${response.status}`, {
        status: response.status,
        body: bodyText.slice(0, 500),
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      throw new VisionHttpError("vision request failed: response body was not valid JSON", {
        status: response.status,
        body: bodyText.slice(0, 500),
      });
    }

    const content = parsed?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.trim() === "") {
      throw new VisionHttpError("vision request failed: response missing choices[0].message.content", {
        status: response.status,
        body: bodyText.slice(0, 500),
      });
    }

    const { caption, tags } = parseVisionResponse(content);
    return { caption, tags, model };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  describeImage,
  isConfigured,
  visionModel,
  buildDataUrl,
  mimeForPath,
  parseVisionResponse,
  VisionHttpError,
  DEFAULT_VISION_MODEL,
};
