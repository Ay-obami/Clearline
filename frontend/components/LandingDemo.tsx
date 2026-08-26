"use client";
import { useEffect, useRef, useState } from "react";
import { Stepper } from "@/components/Stepper";

/**
 * Landing "how it works" centerpiece (PRD §5.7.3): the shared Stepper animated
 * once through the five pipeline stages when scrolled into view. This is the
 * one place richer motion is justified — it is doing the explaining.
 */
export function LandingDemo() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [runKey, setRunKey] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el || visible) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.35 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible]);

  return (
    <div ref={ref} className="card px-6 py-10 sm:px-12">
      <Stepper key={runKey} animate={visible} captions />
      <div className="mt-8 flex justify-center">
        <button
          type="button"
          onClick={() => setRunKey((k) => k + 1)}
          className="text-xs text-mute transition-colors hover:text-ink hover:underline underline-offset-2"
        >
          replay
        </button>
      </div>
    </div>
  );
}