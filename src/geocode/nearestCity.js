"use strict";

const gazetteer = require("./gazetteer.json");

const EARTH_RADIUS_KM = 6371;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

/** haversineKm(a, b) -> great-circle distance in km between two {lat, lon} points. Pure math. */
function haversineKm(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_KM * c;
}

/**
 * nearestCity({ lat, lon }, cities = gazetteer) -> { name, lat, lon, distanceKm }
 * Pure function, no I/O -- resolves the closest gazetteer entry by great-circle distance.
 * Throws if lat/lon are not finite numbers, or if the city list is empty.
 */
function nearestCity({ lat, lon }, cities = gazetteer) {
  if (typeof lat !== "number" || typeof lon !== "number" || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error(`nearestCity: lat/lon must be finite numbers, got lat=${lat}, lon=${lon}`);
  }
  if (!Array.isArray(cities) || cities.length === 0) {
    throw new Error("nearestCity: city list is empty");
  }

  let best = null;
  let bestDistance = Infinity;
  for (const city of cities) {
    const distanceKm = haversineKm({ lat, lon }, city);
    if (distanceKm < bestDistance) {
      bestDistance = distanceKm;
      best = city;
    }
  }
  return { ...best, distanceKm: bestDistance };
}

/** slugify(name) -> "new-york" style ascii-lowercase-dashed label for filesystem paths. */
function slugify(name) {
  return String(name)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritical marks
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

module.exports = { nearestCity, haversineKm, slugify, gazetteer };
