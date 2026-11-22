import { useEffect, useRef, useState } from "react";
import { AD_CLIENT, adUnitId, type AdUnit } from "../lib/ads";

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

/** Space kept for the ad before it loads, so the page never jumps under a finger. */
const RESERVED_HEIGHT = "min-h-[250px]";

/**
 * One AdSense display ad. Renders nothing until its unit id is filled in
 * (lib/ads.ts). It reserves its space, waits until it is near the screen
 * before loading, and is labelled so it is never mistaken for game content.
 */
export function AdSlot({ unit, className = "" }: { unit: AdUnit; className?: string }) {
  const id = adUnitId(unit);
  if (!id) return null;
  return <LoadedAd id={id} unit={unit} className={className} />;
}

function LoadedAd({ id, unit, className }: { id: string; unit: AdUnit; className: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const requested = useRef(false);

  // Load only when the slot is about to scroll into view.
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Ask AdSense to fill the slot once (React may run effects twice in development).
  useEffect(() => {
    if (!near || requested.current) return;
    requested.current = true;
    try {
      (window.adsbygoogle = window.adsbygoogle ?? []).push({});
    } catch {
      // Blocked or not approved yet: the reserved space simply stays empty.
    }
  }, [near]);

  return (
    <aside aria-label="Advertisement" data-ad-unit={unit} className={`w-full ${className}`}>
      <p className="m-0 mb-1 text-center text-[10px] tracking-[0.2em] text-muted/70 uppercase">
        Advertisement
      </p>
      <div ref={box} className={`${RESERVED_HEIGHT} w-full overflow-hidden`}>
        {near ? (
          <ins
            className="adsbygoogle"
            style={{ display: "block" }}
            data-ad-client={AD_CLIENT}
            data-ad-slot={id}
            data-ad-format="auto"
            data-full-width-responsive="true"
          />
        ) : null}
      </div>
    </aside>
  );
}
