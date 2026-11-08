import { formatDistanceShort } from "../utils/formatDistance";
import { formatMinutesAsHoursMinutes } from "./formatEta";

export type EtaShareData = {
  destinationLabel: string | null;
  etaMinutes: number | null;
  distanceRemainingM: number;
  useMiles: boolean;
};

const CARD_W = 1080;
const CARD_H = 1350;
const NAVY = "#081a26";
const PANEL = "#0f2a3a";
const INK = "#e8eef2";
const MUTED = "#9db4c0";
const ACCENT = "#f59e0b";

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lineH: number) {
  const words = text.split(" ");
  let line = "";
  let yy = y;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, yy);
      line = w;
      yy += lineH;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, yy);
}

/** Branded StormPath ETA card rendered to PNG for sharing. */
function drawEtaCard(d: EtaShareData): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = NAVY;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  /* Accent bar */
  ctx.fillStyle = ACCENT;
  ctx.fillRect(0, 0, CARD_W, 18);

  /* Wordmark */
  ctx.fillStyle = ACCENT;
  ctx.font = "700 64px -apple-system, 'Segoe UI', sans-serif";
  ctx.fillText("StormPath", 72, 150);
  ctx.fillStyle = MUTED;
  ctx.font = "400 30px -apple-system, 'Segoe UI', sans-serif";
  ctx.fillText("DRIVE WEATHER-AWARE", 74, 195);

  /* Destination */
  ctx.fillStyle = MUTED;
  ctx.font = "500 34px -apple-system, 'Segoe UI', sans-serif";
  ctx.fillText("HEADING TO", 72, 320);
  ctx.fillStyle = INK;
  ctx.font = "700 72px -apple-system, 'Segoe UI', sans-serif";
  const dest = (d.destinationLabel || "Destination").toUpperCase();
  wrapText(ctx, dest, 72, 410, CARD_W - 144, 84);

  /* Stats panel — vertical list: ARRIVING over DISTANCE LEFT. The old
   * side-by-side columns let a long ETA ("1 hr 45 min" at 110px) paint over
   * the distance read-out. */
  const panelY = 685;
  const panelH = 465;
  ctx.fillStyle = PANEL;
  roundRect(ctx, 72, panelY, CARD_W - 144, panelH, 36);
  ctx.fill();

  const dist = formatDistanceShort(d.distanceRemainingM, d.useMiles);
  const eta =
    d.etaMinutes != null && Number.isFinite(d.etaMinutes)
      ? d.etaMinutes >= 60
        ? formatMinutesAsHoursMinutes(Math.round(d.etaMinutes))
        : `${Math.max(0, Math.round(d.etaMinutes))} min`
      : "—";
  const arrive =
    d.etaMinutes != null && Number.isFinite(d.etaMinutes)
      ? new Date(Date.now() + d.etaMinutes * 60_000).toLocaleTimeString(undefined, {
          hour: "numeric",
          minute: "2-digit",
        })
      : null;

  ctx.fillStyle = MUTED;
  ctx.font = "500 32px -apple-system, 'Segoe UI', sans-serif";
  ctx.fillText("ARRIVING", 120, panelY + 75);
  ctx.fillStyle = INK;
  ctx.font = "700 110px -apple-system, 'Segoe UI', sans-serif";
  ctx.fillText(eta, 120, panelY + 195);

  if (arrive) {
    ctx.fillStyle = MUTED;
    ctx.font = "500 30px -apple-system, 'Segoe UI', sans-serif";
    ctx.fillText(`Around ${arrive}`, 120, panelY + 260);
  }

  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(120, panelY + 310);
  ctx.lineTo(CARD_W - 120, panelY + 310);
  ctx.stroke();

  ctx.fillStyle = MUTED;
  ctx.font = "500 32px -apple-system, 'Segoe UI', sans-serif";
  ctx.fillText("DISTANCE LEFT", 120, panelY + 365);
  ctx.fillStyle = INK;
  ctx.font = "700 80px -apple-system, 'Segoe UI', sans-serif";
  ctx.fillText(dist || "—", 120, panelY + 445);

  /* Footer */
  ctx.fillStyle = "#5b7a89";
  ctx.font = "400 28px -apple-system, 'Segoe UI', sans-serif";
  ctx.fillText("Weather · hazards · traffic-aware routing", 72, CARD_H - 80);
  ctx.fillText("stormpath.app", CARD_W - 240, CARD_H - 80);

  return canvas;
}

/** Share the branded card via the Web Share API; falls back to text, then clipboard. */
export async function shareEtaCard(d: EtaShareData): Promise<void> {
  const dist = formatDistanceShort(d.distanceRemainingM, d.useMiles);
  const text = `StormPath — heading to ${d.destinationLabel || "destination"}. ${dist} left${
    d.etaMinutes != null ? `, ~${Math.max(0, Math.round(d.etaMinutes))} min` : ""
  }.`;

  const canvas = drawEtaCard(d);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (blob) {
    const file = new File([blob], "stormpath-eta.png", { type: "image/png" });
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (nav.canShare?.({ files: [file] })) {
      await nav.share({ files: [file], text, title: "StormPath ETA" });
      return;
    }
  }
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share) {
    await nav.share({ text, title: "StormPath ETA" });
    return;
  }
  await navigator.clipboard.writeText(text);
}
