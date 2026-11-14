#!/usr/bin/env node
/**
 * Generates src/ui/usStateMap.ts — pre-projected SVG path data for every US
 * state, used by the About sheet's "Road data coverage" map.
 *
 * Paths are baked at generation time (spherical Albers conic, CONUS params;
 * AK/HI scaled into inset boxes like d3's geoAlbersUsa) so the app renders a
 * plain <svg> with zero projection code or dependencies.
 *
 * Usage:  node scripts/gen-us-state-map.mjs [path-to-geojson]
 * Default source: PublicaMundi MappingAPI us-states.json (public domain).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "src", "ui", "usStateMap.ts");
const SRC =
  process.argv[2] ??
  "https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json";

/* States the app knows about (must match US_STATE_NAMES in
 * src/services/dotCoverage.ts). Puerto Rico and other territories are skipped. */
const STATE_KEYS = new Set([
  "alabama", "alaska", "arizona", "arkansas", "california", "colorado",
  "connecticut", "delaware", "district of columbia", "florida", "georgia",
  "hawaii", "idaho", "illinois", "indiana", "iowa", "kansas", "kentucky",
  "louisiana", "maine", "maryland", "massachusetts", "michigan",
  "minnesota", "mississippi", "missouri", "montana", "nebraska", "nevada",
  "new hampshire", "new jersey", "new mexico", "new york",
  "north carolina", "north dakota", "ohio", "oklahoma", "oregon",
  "pennsylvania", "rhode island", "south carolina", "south dakota",
  "tennessee", "texas", "utah", "vermont", "virginia", "washington",
  "west virginia", "wisconsin", "wyoming",
]);

const INSET_STATES = new Set(["alaska", "hawaii"]);

/* Spherical Albers conic — USGS-ish parallels for the conterminous US. */
const PHI1 = (29.5 * Math.PI) / 180;
const PHI2 = (45.5 * Math.PI) / 180;
const PHI0 = (37.5 * Math.PI) / 180;
const LAM0 = (-96 * Math.PI) / 180;

const t = (phi) => Math.tan(Math.PI / 4 - phi / 2);
const m = (phi) => Math.cos(phi);
const N = Math.log(m(PHI1) / m(PHI2)) / Math.log(t(PHI1) / t(PHI2));
const C = m(PHI1) / (N * Math.pow(t(PHI1), N));
const RHO0 = C * Math.pow(t(PHI0), N);

function project(lonLat) {
  const [lon, lat] = lonLat;
  const phi = (lat * Math.PI) / 180;
  const lam = (lon * Math.PI) / 180;
  const rho = C * Math.pow(t(phi), N);
  const theta = N * (lam - LAM0);
  return [rho * Math.sin(theta), RHO0 - rho * Math.cos(theta)];
}

function* ringsOf(geometry) {
  if (!geometry) return;
  if (geometry.type === "Polygon") {
    for (const ring of geometry.coordinates) yield ring;
  } else if (geometry.type === "MultiPolygon") {
    for (const poly of geometry.coordinates) for (const ring of poly) yield ring;
  } else if (geometry.type === "GeometryCollection") {
    for (const g of geometry.geometries) yield* ringsOf(g);
  }
}

const geojson = /^https?:/.test(SRC)
  ? await (await fetch(SRC)).json()
  : JSON.parse(readFileSync(SRC, "utf8"));

/* Pass 1: project every ring, keep per-state point lists. */
const states = new Map(); // key -> { polys: [[[x,y]...]], centroidAccum }
for (const feature of geojson.features ?? []) {
  const name = String(feature.properties?.name ?? "").toLowerCase();
  if (!STATE_KEYS.has(name)) continue;
  const pts = [];
  const polys = [];
  let cx = 0;
  let cy = 0;
  let cn = 0;
  for (const ring of ringsOf(feature.geometry)) {
    const projected = ring.map(project);
    // First ring of each polygon is the shell; rest are holes — keep order.
    polys.push(projected);
    for (const [x, y] of projected) {
      cx += x; cy += y; cn++;
    }
  }
  if (!cn) continue;
  states.set(name, { polys, centroid: [cx / cn, cy / cn] });
}

/* Pass 2: fit CONUS bounds (everything except AK/HI), pad, then place
 * AK/HI into inset boxes at the lower-left like d3's geoAlbersUsa. */
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
for (const [key, s] of states) {
  if (INSET_STATES.has(key)) continue;
  for (const poly of s.polys) for (const [x, y] of poly) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
}
const PAD = 0.04;
const w = maxX - minX;
const h = maxY - minY;
/* Scale projected units (~0.5 across) up to a pixel-friendly viewBox so
 * integer-rounded path coords keep sub-pixel precision. */
const SCALE = 1400;
const viewW = w * (1 + PAD * 2) * SCALE;
const viewH = h * (1 + PAD * 2) * SCALE;
const offX = (-minX + w * PAD) * SCALE;
/* SVG y grows downward — flip the math y so north renders at the top. */
const toView = ([x, y]) => [x * SCALE + offX, (maxY - y + h * PAD) * SCALE];

/* Inset boxes as fractions of the viewBox (x, y, w, h). AK is wide, HI small. */
const INSETS = {
  alaska: { x: 0.015, y: 0.80, w: 0.20, h: 0.19 },
  hawaii: { x: 0.015, y: 0.60, w: 0.11, h: 0.16 },
};

function fitInset(key, s) {
  const box = INSETS[key];
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (const poly of s.polys) for (const [x, y] of poly) {
    const [vx, vy] = toView([x, y]);
    if (vx < bx0) bx0 = vx; if (vx > bx1) bx1 = vx;
    if (vy < by0) by0 = vy; if (vy > by1) by1 = vy;
  }
  const bw = bx1 - bx0 || 1;
  const bh = by1 - by0 || 1;
  const boxW = box.w * viewW;
  const boxH = box.h * viewH;
  const scale = Math.min(boxW / bw, boxH / bh) * 0.94;
  const cx = box.x * viewW + boxW / 2;
  const cy = box.y * viewH + boxH / 2;
  const mx = (bx0 + bx1) / 2;
  const my = (by0 + by1) / 2;
  return (pt) => {
    const [vx, vy] = toView(pt);
    return [cx + (vx - mx) * scale, cy + (vy - my) * scale];
  };
}

const insetFns = new Map();
for (const key of INSET_STATES) {
  const s = states.get(key);
  if (s) insetFns.set(key, fitInset(key, s));
}

const fmt = (n) => String(Math.round(n));

const paths = {};
const centroids = {};
for (const [key, s] of states) {
  const xform = insetFns.get(key) ?? toView;
  const dParts = [];
  for (const poly of s.polys) {
    const ring = poly.map(xform);
    dParts.push(
      "M" + ring.map(([x, y]) => `${fmt(x)} ${fmt(y)}`).join("L") + "Z"
    );
  }
  paths[key] = dParts.join("");
  const [ccx, ccy] = xform(s.centroid);
  centroids[key] = [Math.round(ccx), Math.round(ccy)];
}

const ts = `// GENERATED FILE — do not edit by hand.
// Regenerate: node scripts/gen-us-state-map.mjs
// Source: ${SRC}
// Projection: spherical Albers conic (phi1=29.5, phi2=45.5, lambda0=-96),
// CONUS bounds-fit; Alaska/Hawaii scaled into lower-left insets.

export const US_MAP_VIEWBOX = "0 0 ${fmt(viewW)} ${fmt(viewH)}";

/** lowercase state name -> single <path d> (MultiPolygons joined; use fill-rule="evenodd"). */
export const US_STATE_PATHS: Record<string, string> = ${JSON.stringify(paths, null, 2)};

/** Rough label/badge anchor per state (projected viewBox coords). */
export const US_STATE_CENTROIDS: Record<string, [number, number]> = ${JSON.stringify(centroids)};
`;

writeFileSync(OUT, ts);
console.log(`wrote ${OUT}`);
console.log(`states: ${Object.keys(paths).length}, viewBox 0 0 ${fmt(viewW)} ${fmt(viewH)}`);
