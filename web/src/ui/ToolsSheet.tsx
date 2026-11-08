import { useEffect, useState } from "react";
import { formatDistanceShort } from "../utils/formatDistance";
import { formatDurationMinutes } from "./formatEta";
import { shareEtaCard, type EtaShareData } from "./etaShareCard";
import {
  clearTripLog,
  listTripLog,
  tripLogRouteChain,
  tripLogToCsv,
  tripLogTotals,
  type TripLogEntry,
} from "../tripLog/tripLog";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Null when no active trip — the share tool row is disabled with a hint. */
  etaShare: EtaShareData | null;
  /** Miles vs km for trip-log distances + CSV export. */
  useMiles?: boolean;
};

async function shareCsv(csv: string, useMiles: boolean): Promise<void> {
  const unit = useMiles ? "mi" : "km";
  const file = new File([csv], `stormpath-trips-${unit}.csv`, { type: "text/csv" });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    await nav.share({ files: [file], title: "StormPath trip log" });
    return;
  }
  if (nav.share) {
    await nav.share({ text: csv, title: "StormPath trip log" });
    return;
  }
  await navigator.clipboard.writeText(csv);
}

/**
 * StormPath Tools — the extras drawer. Drive HUD stays clean; everything
 * beyond core navigation lives here one tap away (About → Tools).
 */
export function ToolsSheet({ open, onClose, etaShare, useMiles = true }: Props) {
  const [busy, setBusy] = useState(false);
  const [entries, setEntries] = useState<TripLogEntry[]>([]);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    if (open) {
      setEntries(listTripLog());
      setConfirmClear(false);
    }
  }, [open]);

  const totals = tripLogTotals(entries);

  if (!open) return null;

  const onShareEta = async () => {
    if (!etaShare || busy) return;
    setBusy(true);
    try {
      await shareEtaCard(etaShare);
    } catch {
      /* user cancelled share sheet — not an error */
    } finally {
      setBusy(false);
    }
  };

  const onExportCsv = async () => {
    if (busy || entries.length === 0) return;
    setBusy(true);
    try {
      await shareCsv(tripLogToCsv(entries, useMiles), useMiles);
    } catch {
      /* cancelled */
    } finally {
      setBusy(false);
    }
  };

  const onClearLog = () => {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    clearTripLog();
    setEntries([]);
    setConfirmClear(false);
  };

  return (
    <>
      <div className="about-sheet-scrim" role="presentation" onClick={onClose} />
      <div
        className="about-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tools-sheet-title"
      >
        <header className="about-sheet__header">
          <div className="about-sheet__header-top">
            <div className="about-sheet__header-title">
              <h2 id="tools-sheet-title" className="about-sheet__title">
                StormPath Tools
              </h2>
              <p className="about-sheet__tagline">Extras — share, log, and trip utilities.</p>
            </div>
            <button type="button" className="about-sheet__close" onClick={onClose} aria-label="Close tools">
              ×
            </button>
          </div>
        </header>

        <div className="about-sheet__sections">
          <button
            type="button"
            className="about-sheet__panel tools-row"
            onClick={() => void onShareEta()}
            disabled={!etaShare || busy}
          >
            <div className="tools-row__body">
              <div className="tools-row__title">Share ETA</div>
              <div className="tools-row__sub">
                {etaShare
                  ? "Send a StormPath card with destination, ETA, and distance left."
                  : "Start a trip to share your ETA."}
              </div>
            </div>
            <div className="tools-row__chev" aria-hidden>
              {busy ? "…" : "›"}
            </div>
          </button>

          <div className="about-sheet__panel tools-triplog">
            <div className="tools-triplog__head">
              <div>
                <div className="tools-row__title">Trip log</div>
                <div className="tools-row__sub">
                  {entries.length === 0
                    ? "Completed drives are recorded automatically."
                    : `${totals.count} ${totals.count === 1 ? "trip" : "trips"} · ${formatDistanceShort(totals.distanceM, useMiles) || "0"} total`}
                </div>
              </div>
            </div>
            {entries.length > 0 ? (
              <>
                <ul className="tools-triplog__list">
                  {entries.slice(0, 6).map((e) => (
                    <li key={e.id} className="tools-triplog__row">
                      <div className="tools-triplog__main">
                        <span className="tools-triplog__dest" title={tripLogRouteChain(e)}>
                          {tripLogRouteChain(e)}
                        </span>
                        <span className="tools-triplog__meta">
                          {new Date(e.startedAt).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                          })}{" "}
                          · {formatDistanceShort(e.distanceM, useMiles) || "—"} ·{" "}
                          {formatDurationMinutes((e.endedAt - e.startedAt) / 60_000)}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
                <div className="tools-triplog__actions">
                  <button
                    type="button"
                    className="tools-triplog__btn"
                    onClick={() => void onExportCsv()}
                    disabled={busy}
                  >
                    Export CSV
                  </button>
                  <button
                    type="button"
                    className={`tools-triplog__btn${confirmClear ? " tools-triplog__btn--danger" : ""}`}
                    onClick={onClearLog}
                  >
                    {confirmClear ? "Tap again to clear" : "Clear log"}
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}
