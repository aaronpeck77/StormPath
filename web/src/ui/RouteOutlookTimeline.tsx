import type { RouteOutlookStep } from "../nav/routeForecastTimeline";
import { precipBarHeight, routeOutlookAriaLabel } from "../nav/routeForecastTimeline";

type Props = {
  steps: RouteOutlookStep[];
  /** 0..1 — current position along the route for the YOU marker */
  userAlongT?: number;
  stripTint?: string;
};

function precipBarColor(step: RouteOutlookStep): string {
  const h = precipBarHeight(step);
  if (h >= 70) return "#7c3aed";
  if (h >= 45) return "#3b82f6";
  if (h >= 18) return "#60a5fa";
  if (h > 0) return "#93c5fd";
  return "rgba(148, 163, 184, 0.35)";
}

export function RouteOutlookTimeline({ steps, userAlongT = 0, stripTint = "#3b82f6" }: Props) {
  if (steps.length === 0) return null;

  const youPct = Math.min(100, Math.max(0, userAlongT * 100));
  const aria = routeOutlookAriaLabel(steps);

  return (
    <div className="rotl" role="img" aria-label={aria}>
      <div className="rotl__header">
        <span className="rotl__title">Route outlook</span>
      </div>

      <div className="rotl__graph">
        <div className="rotl__rail" aria-hidden />
        {userAlongT > 0.01 && userAlongT < 0.995 ? (
          <div
            className="rotl__you"
            style={{ left: `${youPct}%`, backgroundColor: stripTint }}
            aria-hidden
            title="You are here"
          />
        ) : null}

        <div className="rotl__steps">
          {steps.map((step) => {
            const barH = precipBarHeight(step);
            const tooltip = [
              step.shortLabel,
              step.etaLabel ? `~${step.etaLabel} into trip` : null,
              step.tempF != null ? `${step.tempF}°F` : null,
              step.conditions,
              step.precipPct != null && step.precipPct > 0 ? `${step.precipPct}% precip` : null,
            ]
              .filter(Boolean)
              .join(" · ");

            return (
              <div
                key={step.key}
                className="rotl__step"
                style={{ left: `${step.fraction * 100}%` }}
                title={tooltip}
              >
                <span className="rotl__icon" aria-hidden>
                  {step.icon}
                </span>
                <span className="rotl__temp">{step.tempF != null ? `${step.tempF}°` : "—"}</span>
                <span className="rotl__precip-wrap" aria-hidden>
                  <span
                    className="rotl__precip-bar"
                    style={{
                      height: `${Math.max(barH > 0 ? 14 : 6, barH * 0.22)}px`,
                      backgroundColor: precipBarColor(step),
                    }}
                  />
                </span>
                <span className="rotl__label">{step.shortLabel}</span>
                {step.etaLabel ? (
                  <span className="rotl__eta">{step.etaLabel}</span>
                ) : step.fraction === 0 ? (
                  <span className="rotl__eta">Now</span>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
