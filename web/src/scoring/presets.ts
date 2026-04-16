export type PresetId = "quiet" | "balanced" | "protective";

export const PRESETS: {
  id: PresetId;
  label: string;
  description: string;
}[] = [
  {
    id: "quiet",
    label: "Quiet",
    description: "Fewer route highlights unless traffic or weather signal is strong.",
  },
  {
    id: "balanced",
    label: "Balanced",
    description: "Standard fusion of traffic, radar, forecast, and hazards.",
  },
  {
    id: "protective",
    label: "Protective",
    description: "Surfaces weather and traffic differences between routes earlier.",
  },
];
