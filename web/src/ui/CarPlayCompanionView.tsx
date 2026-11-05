import { buildCarConditions, type CarConditionsInput } from "../services/carSessionPublish";
import { formatDistanceShort } from "../utils/formatDistance";

type Props = {
  destinationLabel: string | null;
  /** Live minutes-remaining estimate (same source the car sees). */
  etaMinutes: number | null;
  advisoryLine: string | null;
  /** Sourced posted limit only — null hides the chip. */
  speedLimitMph: number | null;
  conditions: CarConditionsInput;
  useMiles: boolean;
  onShowMap: () => void;
};

const SEVERITY_DOT: Record<string, string> = {
  AVOID: "#f87171",
  WARNING: "#f87171",
  CAUTION: "#fbbf24",
  ADVISORY: "#38bdf8",
  INFO: "#38bdf8",
};

function severityDot(title: string): string | null {
  const head = title.split("·")[0]?.trim().toUpperCase() ?? "";
  return SEVERITY_DOT[head] ?? null;
}

/**
 * Phone companion page shown while CarPlay is driving.
 * Renders the same conditions snapshot the car screen summarizes —
 * hazards, route forecast, local forecast — so the two never disagree.
 */
export function CarPlayCompanionView(p: Props) {
  const sections = buildCarConditions(p.conditions);
  const total = Math.max(0, p.conditions.totalMeters);
  const along = Math.min(Math.max(0, p.conditions.userAlongMeters), total);
  const pct = total > 0 ? along / total : 0;
  const remainingM = Math.max(0, total - along);
  const dist = formatDistanceShort(remainingM, p.useMiles);
  const arrive =
    p.etaMinutes != null && Number.isFinite(p.etaMinutes)
      ? new Date(Date.now() + p.etaMinutes * 60_000)
      : null;

  return (
    <div className="cp-companion" role="region" aria-label="CarPlay companion">
      <header className="cp-companion__head">
        <span className="cp-companion__badge">CarPlay driving</span>
        <button type="button" className="cp-companion__mapbtn" onClick={p.onShowMap}>
          Map
        </button>
      </header>

      <section className="cp-companion__eta">
        <div className="cp-companion__dest">{p.destinationLabel || "Active trip"}</div>
        <div className="cp-companion__stats">
          <span>
            {p.etaMinutes != null ? `${Math.max(0, Math.round(p.etaMinutes))} min` : "—"}
            {dist ? ` · ${dist} left` : ""}
          </span>
          {arrive ? (
            <span className="cp-companion__arrive">
              Arrive ~{arrive.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
            </span>
          ) : null}
        </div>
        {p.advisoryLine ? <p className="cp-companion__advisory">{p.advisoryLine}</p> : null}
        <div className="cp-companion__track" aria-hidden>
          <div className="cp-companion__fill" style={{ width: `${Math.round(pct * 100)}%` }} />
        </div>
        <div className="cp-companion__meta">
          {p.speedLimitMph != null && p.speedLimitMph > 0 ? (
            <span className="cp-companion__chip">{Math.round(p.speedLimitMph)} mph limit</span>
          ) : null}
          <span className="cp-companion__chip cp-companion__chip--dim">
            {Math.round(pct * 100)}% there
          </span>
        </div>
      </section>

      {sections.map((section) => (
        <section key={section.title} className="cp-companion__card">
          <h2 className="cp-companion__cardtitle">{section.title}</h2>
          <ul className="cp-companion__list">
            {section.items.map((item, i) => {
              const dot = severityDot(item.title);
              return (
                <li key={`${item.title}-${i}`} className="cp-companion__item">
                  <span
                    className="cp-companion__dot"
                    style={dot ? { background: dot } : undefined}
                    aria-hidden
                  />
                  <div className="cp-companion__itembody">
                    <div className="cp-companion__itemtitle">{item.title}</div>
                    <div className="cp-companion__itemdetail">{item.detail}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
