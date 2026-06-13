import type { AdvisoryPromoLine } from "../config/basicAds";

type Props = {
  lines: AdvisoryPromoLine[];
  /** When true, use `detailText` when available (expanded advisory). */
  expanded?: boolean;
  className?: string;
  "aria-label"?: string;
  /** Opens About → Subscription when a line uses `action: "open-subscription"`. */
  onOpenSubscription?: () => void;
};

function displayText(line: AdvisoryPromoLine, expanded: boolean): string {
  if (expanded && line.detailText?.trim()) return line.detailText.trim();
  return line.text;
}

function PromoRow({
  line,
  expanded,
  onOpenSubscription,
}: {
  line: AdvisoryPromoLine;
  expanded: boolean;
  onOpenSubscription?: () => void;
}) {
  const copy = displayText(line, expanded);
  const href = line.href?.trim();
  const ctaLabel = line.ctaLabel?.trim() || (line.featured ? "Learn more" : "Open");
  const className = [
    "storm-advisory-bar__promo",
    line.featured ? "storm-advisory-bar__promo--featured" : "",
    line.prominent ? "storm-advisory-bar__promo--sitebible" : "",
    href ? "storm-advisory-bar__promo-link" : "storm-advisory-bar__promo-text",
  ]
    .filter(Boolean)
    .join(" ");

  if (line.action === "open-subscription" && onOpenSubscription) {
    return (
      <button
        type="button"
        key={line.id}
        className={`${className} storm-advisory-bar__promo-action`}
        onClick={onOpenSubscription}
      >
        <span className="storm-advisory-bar__promo-body">
          {line.featured ? <span className="basic-ad__featured-tag">StormPath Plus</span> : null}
          {line.sponsored ? <span className="basic-ad__sponsored">Sponsored · </span> : null}
          {copy}
        </span>
        {expanded ? <span className="storm-advisory-bar__promo-cta">{ctaLabel}</span> : null}
      </button>
    );
  }

  if (href) {
    return (
      <a
        key={line.id}
        className={className}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
      >
        <span className="storm-advisory-bar__promo-body">
          {line.featured ? <span className="basic-ad__featured-tag">StormPath Plus</span> : null}
          {line.sponsored ? <span className="basic-ad__sponsored">Sponsored · </span> : null}
          {copy}
        </span>
        {expanded ? <span className="storm-advisory-bar__promo-cta">{ctaLabel}</span> : null}
      </a>
    );
  }

  return (
    <p key={line.id} className={className}>
      <span className="storm-advisory-bar__promo-body">
        {line.sponsored ? <span className="basic-ad__sponsored">Sponsored · </span> : null}
        {copy}
      </span>
    </p>
  );
}

export function BasicAdStrip({
  lines,
  expanded = false,
  className = "storm-advisory-bar__basic-strip",
  "aria-label": ariaLabel = "Partner offers and upgrades",
  onOpenSubscription,
}: Props) {
  if (lines.length === 0) return null;

  return (
    <div className={className} aria-label={ariaLabel}>
      {lines.map((line) => (
        <PromoRow
          key={line.id}
          line={line}
          expanded={expanded}
          onOpenSubscription={onOpenSubscription}
        />
      ))}
    </div>
  );
}
