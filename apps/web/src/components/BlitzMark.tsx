/**
 * The Blitz emblem: an angular team-style shield with two fast-forward
 * chevrons. Drawn in the current text colour; decorative (the word "Blitz"
 * always sits next to it).
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
      <path
        d="M12 1.5 21 5.5v6.2c0 5-3.7 9.1-9 10.8-5.3-1.7-9-5.8-9-10.8V5.5z"
        fill="currentColor"
        fillOpacity="0.16"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="miter"
      />
      <path
        d="M6.8 8 10.8 12l-4 4M12.4 8l4 4-4 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
    </svg>
  );
}
