import { useEffect, useState } from "react";
import type { AdvisoryPromoLine } from "../config/basicAds";

type Props = {
  lines: AdvisoryPromoLine[];
};

const ROTATE_MS = 14_000;

function displayText(line: AdvisoryPromoLine): string {
  return line.detailText?.trim() || line.text;
}

/** Compact rotating promo above bottom chrome — Basic tier only, hidden while driving. */
export function BasicIdleAdBanner({ lines }: Props) {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    setIdx(0);
  }, [lines.length]);

  useEffect(() => {
    if (lines.length <= 1) return;
    const id = window.setInterval(() => {
      setIdx((v) => (v + 1) % lines.length);
    }, ROTATE_MS);
    return () => window.clearInterval(id);
  }, [lines.length]);

  if (lines.length === 0) return null;

  const line = lines[idx] ?? lines[0];
  const copy = displayText(line);
  const href = line.href?.trim();

  const inner = (
    <>
      {line.sponsored ? <span className="basic-idle-ad__tag">Sponsored</span> : null}
      <span className="basic-idle-ad__text">{copy}</span>
    </>
  );

  return (
    <div className="basic-idle-ad" role="region" aria-label="Partner offer" aria-live="polite">
      {href ? (
        <a className="basic-idle-ad__link" href={href} target="_blank" rel="noopener noreferrer">
          {inner}
        </a>
      ) : (
        <div className="basic-idle-ad__body">{inner}</div>
      )}
    </div>
  );
}
