"use strict";

const REQUEST_TIMEOUT_MS = 30000;
const DEFAULT_MODEL = "local-devstral-small2";

class LlmHttpError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = "LlmHttpError";
    this.status = status;
    this.body = body;
  }
}

/**
 * isConfigured(env = process.env) -> boolean
 * True only if LITELLM_BASE_URL and LITELLM_API_KEY are both set to a non-empty string.
 * The deterministic organize/watermark/contact-sheet pipeline NEVER calls this module's
 * summarize() unless the caller passed --summary AND this returns true -- see
 * src/cli/organizeCommand.js. That's what makes "LLM is optional" a structural property
 * instead of a hope.
 */
function isConfigured(env = process.env) {
  return Boolean(String(env.LITELLM_BASE_URL || "").trim()) && Boolean(String(env.LITELLM_API_KEY || "").trim());
}

/**
 * buildAggregateText(manifest) -> string
 * Turns the organize manifest into a short plain-text description (counts per date, counts per
 * city, date range, total count) -- TEXT, not pixels. The shared demo model
 * (local-devstral-small2) is a coding model, not documented as vision-capable, so summarizing
 * manifest metadata is the honest choice here rather than pretending to "look at" the photos.
 */
function buildAggregateText(manifest) {
  const entries = manifest.entries || [];
  const byDate = new Map();
  const byCity = new Map();
  const dates = [];

  for (const e of entries) {
    const dateKey = (e.dateTimeOriginal || "undated").slice(0, 10).replace(/:/g, "-");
    byDate.set(dateKey, (byDate.get(dateKey) || 0) + 1);
    if (e.dateTimeOriginal) dates.push(e.dateTimeOriginal);

    const cityKey = e.city || "unknown-location";
    byCity.set(cityKey, (byCity.get(cityKey) || 0) + 1);
  }

  dates.sort();
  const range = dates.length > 0 ? `${dates[0].slice(0, 10)} to ${dates[dates.length - 1].slice(0, 10)}` : "unknown";

  const dateLines = [...byDate.entries()].map(([d, n]) => `${d}: ${n} photo(s)`).join("; ");
  const cityLines = [...byCity.entries()].map(([c, n]) => `${c}: ${n} photo(s)`).join("; ");

  return [
    `Total photos: ${entries.length}.`,
    `Date range: ${range}.`,
    `By date: ${dateLines || "none"}.`,
    `By location: ${cityLines || "none"}.`,
  ].join(" ");
}

/**
 * summarize(manifest, env = process.env) -> Promise<string>
 * POSTs the manifest's aggregate metadata to `${LITELLM_BASE_URL}/chat/completions` asking for
 * a one-line caption of the batch. Throws LlmHttpError on any non-2xx/network/timeout/malformed
 * response -- callers (the CLI) decide how to surface that; this module never silently
 * swallows a real failure into a fake "skipped" result. Call isConfigured() first if you want
 * the clean-skip behavior for "no key set" -- that is a caller decision, not this function's.
 */
async function summarize(manifest, env = process.env) {
  const baseUrl = String(env.LITELLM_BASE_URL || "").replace(/\/+$/, "");
  const apiKey = String(env.LITELLM_API_KEY || "");
  const model = String(env.LITELLM_DEFAULT_MODEL || DEFAULT_MODEL);

  const aggregateText = buildAggregateText(manifest);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    let response;
    try {
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "system",
              content:
                "You summarize a batch of organized consumer photos in exactly one short sentence, based only on the metadata given (counts, dates, locations). Do not invent visual content -- you were not shown the images.",
            },
            { role: "user", content: aggregateText },
          ],
          temperature: 0,
          max_tokens: 120,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      throw new LlmHttpError("LLM request failed: network error", {
        status: undefined,
        body: String(err && err.message ? err.message : err).slice(0, 500),
      });
    }

    const bodyText = await response.text().catch(() => "");
    if (!response.ok) {
      throw new LlmHttpError(`LLM request failed: ${response.status}`, {
        status: response.status,
        body: bodyText.slice(0, 500),
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      throw new LlmHttpError(`LLM request failed: response body was not valid JSON`, {
        status: response.status,
        body: bodyText.slice(0, 500),
      });
    }

    const content = parsed?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.trim() === "") {
      throw new LlmHttpError("LLM request failed: response missing choices[0].message.content", {
        status: response.status,
        body: bodyText.slice(0, 500),
      });
    }

    return content.trim();
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { summarize, isConfigured, buildAggregateText, LlmHttpError };
