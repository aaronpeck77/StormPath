import { describe, expect, it } from "vitest";
import {
  mapboxVectorTileUrl,
  readMapVectorTilesetGroups,
  styleMatchedTileUrl,
  vectorTilesetGroupsFromStyleSources,
} from "../mapStyleTileSources";
import type { Map } from "mapbox-gl";

describe("vectorTilesetGroupsFromStyleSources", () => {
  it("keeps a composite source as one comma-joined request group", () => {
    const groups = vectorTilesetGroupsFromStyleSources({
      composite: {
        type: "vector",
        url: "mapbox://mapbox.mapbox-streets-v8,mapbox.mapbox-terrain-v2,mapbox.mapbox-bathymetry-v2",
      },
    });
    expect(groups).toEqual([
      "mapbox.mapbox-streets-v8,mapbox.mapbox-terrain-v2,mapbox.mapbox-bathymetry-v2",
    ]);
  });

  it("accepts the mapbox://tiles/ spelling", () => {
    expect(
      vectorTilesetGroupsFromStyleSources({
        c: { type: "vector", url: "mapbox://tiles/mapbox.mapbox-streets-v8" },
      })
    ).toEqual(["mapbox.mapbox-streets-v8"]);
  });

  it("skips raster / geojson sources and app-owned vector layers without a mapbox url", () => {
    const groups = vectorTilesetGroupsFromStyleSources({
      composite: { type: "vector", url: "mapbox://mapbox.mapbox-streets-v8" },
      radar: { type: "raster", tiles: ["https://example.test/{z}/{x}/{y}.png"] },
      route: { type: "geojson" },
      hosted: { type: "vector", tiles: ["https://example.test/{z}/{x}/{y}.pbf"] },
    });
    expect(groups).toEqual(["mapbox.mapbox-streets-v8"]);
  });

  it("dedupes repeated groups and survives a missing style", () => {
    expect(
      vectorTilesetGroupsFromStyleSources({
        a: { type: "vector", url: "mapbox://mapbox.mapbox-streets-v8" },
        b: { type: "vector", url: "mapbox://mapbox.mapbox-streets-v8" },
      })
    ).toEqual(["mapbox.mapbox-streets-v8"]);
    expect(vectorTilesetGroupsFromStyleSources(null)).toEqual([]);
  });
});

describe("readMapVectorTilesetGroups", () => {
  it("returns empty instead of throwing when the style is unreadable", () => {
    const map = {
      getStyle: () => {
        throw new Error("style not loaded");
      },
    } as unknown as Map;
    expect(readMapVectorTilesetGroups(map)).toEqual([]);
  });
});

describe("mapboxVectorTileUrl", () => {
  it("builds the v4 vector URL for a group", () => {
    expect(
      mapboxVectorTileUrl({ group: "mapbox.a,mapbox.b", z: 16, x: 1, y: 2, token: "tok en" })
    ).toBe("https://api.mapbox.com/v4/mapbox.a,mapbox.b/16/1/2.vector.pbf?access_token=tok%20en");
  });
});

describe("styleMatchedTileUrl", () => {
  it("uses GL JS's transformed URL so the warm hits the renderer's cache entry", () => {
    const map = {
      _requestManager: {
        transformRequest: (url: string) => ({ url: `${url}&sku=abc123` }),
      },
    } as unknown as Map;
    expect(styleMatchedTileUrl(map, "https://api.mapbox.com/v4/x/1/2/3.vector.pbf")).toBe(
      "https://api.mapbox.com/v4/x/1/2/3.vector.pbf&sku=abc123"
    );
  });

  it("falls back to the plain URL when the internal transform is gone", () => {
    const url = "https://api.mapbox.com/v4/x/1/2/3.vector.pbf";
    expect(styleMatchedTileUrl({} as unknown as Map, url)).toBe(url);
    const throwing = {
      _requestManager: {
        transformRequest: () => {
          throw new Error("moved in a GL JS bump");
        },
      },
    } as unknown as Map;
    expect(styleMatchedTileUrl(throwing, url)).toBe(url);
  });
});
