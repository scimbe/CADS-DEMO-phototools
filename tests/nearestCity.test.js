"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { nearestCity, haversineKm, slugify } = require("../src/geocode/nearestCity");

test("haversineKm(x, x) is 0", () => {
  const berlin = { lat: 52.52, lon: 13.405 };
  assert.equal(haversineKm(berlin, berlin), 0);
});

test("haversineKm(Berlin, Hamburg) is approximately 255km (verified against known great-circle distance)", () => {
  const berlin = { lat: 52.52, lon: 13.405 };
  const hamburg = { lat: 53.5511, lon: 9.9937 };
  const km = haversineKm(berlin, hamburg);
  assert.ok(km > 250 && km < 260, `expected ~255km, got ${km}`);
});

test("nearestCity returns the exact gazetteer entry when given its own coordinates", () => {
  const result = nearestCity({ lat: 48.1351, lon: 11.582 });
  assert.equal(result.name, "Munich");
  assert.equal(result.distanceKm, 0);
});

test("nearestCity picks the closer of two nearby candidates", () => {
  // A point roughly between Cologne and Frankfurt, but closer to Cologne.
  const result = nearestCity({ lat: 50.85, lon: 7.2 }, [
    { name: "Cologne", lat: 50.9375, lon: 6.9603 },
    { name: "Frankfurt", lat: 50.1109, lon: 8.6821 },
  ]);
  assert.equal(result.name, "Cologne");
});

test("nearestCity throws on non-finite lat/lon", () => {
  assert.throws(() => nearestCity({ lat: NaN, lon: 13.4 }), /finite numbers/);
  assert.throws(() => nearestCity({ lat: 52.5, lon: undefined }), /finite numbers/);
});

test("nearestCity throws on an empty city list", () => {
  assert.throws(() => nearestCity({ lat: 52.5, lon: 13.4 }, []), /empty/);
});

test("slugify lowercases, dashes, and strips diacritics", () => {
  assert.equal(slugify("New York"), "new-york");
  assert.equal(slugify("München"), "munchen");
  assert.equal(slugify("Sao Paulo"), "sao-paulo");
});

test("gazetteer entries all have finite lat/lon within valid ranges", () => {
  const { gazetteer } = require("../src/geocode/nearestCity");
  assert.ok(gazetteer.length >= 15, `expected a real bundled gazetteer, got ${gazetteer.length} entries`);
  for (const city of gazetteer) {
    assert.ok(Number.isFinite(city.lat) && city.lat >= -90 && city.lat <= 90, `${city.name}: bad lat`);
    assert.ok(Number.isFinite(city.lon) && city.lon >= -180 && city.lon <= 180, `${city.name}: bad lon`);
  }
});
