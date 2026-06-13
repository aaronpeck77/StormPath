import type { AdvisoryPromoLine } from "../config/basicAds";

type Props = {
  line: AdvisoryPromoLine;
  expanded?: boolean;
};

function displayCopy(line: AdvisoryPromoLine, expanded: boolean): string {
  if (expanded && line.detailText?.trim()) return line.detailText.trim();
  return line.text;
}

/** Reserved partner / programmatic banner between forecast and StormPath Plus on Basic status. */
export function BasicStatusAdSlot({ line, expanded = true }: Props) {
  const href = line.href?.trim();
  const copy = displayCopy(line, expanded);
  const ctaLabel = line.ctaLabel?.trim() || "Learn more";

  if (href) {
    return (
      <a
        className="basic-status-ad-slot basic-status-ad-slot--filled"
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Sponsored — ${copy}`}
      >
        <span className="basic-status-ad-slot__label">Sponsored</span>
        <span className="basic-status-ad-slot__copy">{copy}</span>
        <span className="basic-status-ad-slot__cta">{ctaLabel}</span>
      </a>
    );
  }

  return (
    <div
      className="basic-status-ad-slot basic-status-ad-slot--reserved"
      role="img"
      aria-label="Advertisement space reserved for partner content"
    >
      <span className="basic-status-ad-slot__label">Advertisement</span>
    </div>
  );
}
