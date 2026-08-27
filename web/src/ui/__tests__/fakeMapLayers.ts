import type { Map as MapboxMap } from "mapbox-gl";

export type FakeLayer = { id: string; type: string };

/** In-memory Mapbox layer list for restack unit tests. */
export function createFakeMap(initial: FakeLayer[]) {
  const layers = initial.map((layer) => ({ ...layer }));
  const map = {
    getStyle: () => ({ layers }),
    getLayer: (id: string) => layers.find((layer) => layer.id === id),
    moveLayer: (id: string, beforeId?: string) => {
      const from = layers.findIndex((layer) => layer.id === id);
      if (from < 0) return;
      const [layer] = layers.splice(from, 1);
      if (!layer) return;
      if (!beforeId) {
        layers.push(layer);
        return;
      }
      const before = layers.findIndex((item) => item.id === beforeId);
      if (before < 0) {
        layers.push(layer);
        return;
      }
      layers.splice(before, 0, layer);
    },
  };
  return { map: map as unknown as MapboxMap, layers };
}
