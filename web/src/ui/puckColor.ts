/** Drive puck colors. Blue matches the route line, so the others are there to stand off it. */
export type PuckColorId = "blue" | "orange" | "gold" | "white";

export type PuckColor = {
  id: PuckColorId;
  label: string;
  highlight: string;
  fill: string;
  edge: string;
  stroke: string;
};

export const PUCK_COLORS: readonly PuckColor[] = [
  {
    id: "blue",
    label: "Blue",
    highlight: "#6bb8ff",
    fill: "#1a73e8",
    edge: "#0a3d91",
    stroke: "#ffffff",
  },
  {
    id: "orange",
    label: "Orange",
    highlight: "#fdba74",
    fill: "#f97316",
    edge: "#c2410c",
    stroke: "#ffffff",
  },
  {
    id: "gold",
    label: "Gold",
    highlight: "#fde047",
    fill: "#eab308",
    edge: "#a16207",
    stroke: "#ffffff",
  },
  {
    id: "white",
    label: "White",
    highlight: "#ffffff",
    fill: "#f8fafc",
    edge: "#cbd5e1",
    stroke: "#0f172a",
  },
];

export function puckColorById(id: string | null | undefined): PuckColor {
  return PUCK_COLORS.find((color) => color.id === id) ?? PUCK_COLORS[0]!;
}

/** Paint every puck (map and route overview) from the Info choice. */
export function applyPuckColor(id: string | null | undefined): void {
  if (typeof document === "undefined") return;
  const color = puckColorById(id);
  const root = document.documentElement;
  root.style.setProperty("--puck-highlight", color.highlight);
  root.style.setProperty("--puck-fill", color.fill);
  root.style.setProperty("--puck-edge", color.edge);
  root.style.setProperty("--puck-stroke", color.stroke);
}
