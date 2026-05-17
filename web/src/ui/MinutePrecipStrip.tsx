import type { MinutePrecipForecast } from "../services/tomorrowIo";

function precipColor(mmh: number, prob: number): string {
  const effective = mmh * Math.max(0.3, prob);
  if (effective === 0) return "rgba(255,255,255,0.08)";
  if (effective < 0.1) return "#93c5fd";
  if (effective < 0.5) return "#60a5fa";
  if (effective < 2.5) return "#3b82f6";
  if (effective < 7.5) return "#7c3aed";
  return "#ef4444";
}

/** 60-minute precip at the driver's position (Tomorrow.io). */
export function MinutePrecipStrip({ forecast }: { forecast: MinutePrecipForecast }) {
  const minutes = forecast.minutes.slice(0, 60);
  if (!minutes.length) return null;

  const hasAnyPrecip = minutes.some((m) => m.precipIntensityMmh > 0 || m.precipProbability > 0.1);
  const firstWet = minutes.findIndex((m) => m.precipIntensityMmh > 0.1);
  const lastWet = minutes.reduceRight<number>(
    (acc, m, i) => (acc === -1 && m.precipIntensityMmh > 0.1 ? i : acc),
    -1
  );

  let summaryText: string;
  if (!hasAnyPrecip) {
    summaryText = "Dry";
  } else if (firstWet === 0 && lastWet >= 55) {
    summaryText = "Rain throughout";
  } else if (firstWet === 0) {
    summaryText = `Stopping around ${lastWet + 1} min`;
  } else if (firstWet <= 5) {
    summaryText = "Starting soon";
  } else {
    summaryText = `Rain in ${firstWet} min`;
  }

  return (
    <div className="mps">
      <div className="mps__header">
        <span className="mps__title">At your current location</span>
        <span className="mps__summary">Next hour — {summaryText}</span>
      </div>
      <div
        className="mps__bar"
        aria-label="Minute-by-minute precipitation at your current location for the next 60 minutes"
      >
        {minutes.map((m, i) => (
          <div
            key={i}
            className="mps__cell"
            style={{ background: precipColor(m.precipIntensityMmh, m.precipProbability) }}
            title={`${i + 1} min: ${m.precipIntensityMmh.toFixed(1)} mm/hr`}
          />
        ))}
      </div>
      <div className="mps__axis">
        <span>Now</span>
        <span>30 min</span>
        <span>60 min</span>
      </div>
    </div>
  );
}
