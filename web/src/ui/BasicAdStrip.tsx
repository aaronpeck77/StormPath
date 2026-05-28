import type { AdvisoryPromoLine } from "../config/basicAds";

type Props = {
  lines: AdvisoryPromoLine[];
  /** When true, use `detailText` when available (expanded advisory). */
  expanded?: boolean;
  className?: string;
  "aria-label"?: string;
};

function displayText(line: AdvisoryPromoLine, expanded: boolean): string {
  if (expanded && line.detailText?.trim()) return line.detailText.trim();
  return line.text;
}

export function BasicAdStrip({
  lines,
  expanded = false,
  className = "storm-advisory-bar__basic-strip",
  "aria-label": ariaLabel = "Partner offers and upgrades",
}: Props) {
  if (lines.length === 0) return null;

  return (
    <div className={className} aria-label={ariaLabel}>
      {lines.map((line) => {
        const copy = displayText(line, expanded);
        const href = line.href?.trim();
        if (href) {
          return (
            <a
              key={line.id}
              className="storm-advisory-bar__promo storm-advisory-bar__promo-link"
              href={href}
              target="_blank"
              rel="noopener noreferrer"
            >
              {line.sponsored ? <span className="basic-ad__sponsored">Sponsored · </span> : null}
              {copy}
            </a>
          );
        }
        return (
          <p key={line.id} className="storm-advisory-bar__promo storm-advisory-bar__promo-text">
            {line.sponsored ? <span className="basic-ad__sponsored">Sponsored · </span> : null}
            {copy}
          </p>
        );
      })}
    </div>
  );
}
