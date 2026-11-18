/**
 * The Blitz mark: a sharp, angular lightning bolt (esports-logo style, not
 * the emoji), with a cut-out inner edge for depth. Drawn in the current text
 * colour; decorative (the word "Blitz" always sits next to it).
 */
export function BlitzMark({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={`inline-block flex-none align-[-0.15em] ${className}`}
    >
      {/* The bolt: hard angles, slanted forward. */}
      <path d="M15.6 0.8 4.2 13.6h6.3L7.6 23.2 20.2 9.4h-6.4z" fill="currentColor" />
      {/* A thin cut along the upper edge gives it a two-tone, logo-like finish. */}
      <path
        d="M14.2 3.6 7.4 11.6h3.1"
        fill="none"
        stroke="#05060A"
        strokeOpacity="0.55"
        strokeWidth="1.1"
        strokeLinejoin="miter"
      />
    </svg>
  );
}
