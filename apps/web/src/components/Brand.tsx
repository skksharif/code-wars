export const BRAND_NAME = "Clash of Coders";

/**
 * The CLASH of CODERS lettering, drawn as text so it stays sharp at any size
 * and can be renamed without new artwork. Decorative: pair it with a label.
 */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex items-baseline gap-[0.28em] font-display leading-none font-bold tracking-[0.06em] whitespace-nowrap uppercase italic ${className}`}
    >
      <span className="text-you">Clash</span>
      <span className="text-[0.6em] text-muted">of</span>
      <span className="text-rival">Coders</span>
    </span>
  );
}
