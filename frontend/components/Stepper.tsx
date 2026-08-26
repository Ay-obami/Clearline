"use client";
import { useEffect, useState } from "react";

/**
 * Redemption timeline/stepper (PRD §5.6): Triggered -> Finality -> Compliance ->
 * Signed -> Settled, current step highlighted. The most-reused pipeline
 * component: the dashboard status view and the landing page's animated
 * "how it works" centerpiece both render this exact component.
 */
const STAGES = [
  { key: "triggered", label: "Triggered" },
  { key: "finality", label: "Finality" },
  { key: "compliance", label: "Compliance" },
  { key: "signed", label: "Signed" },
  { key: "settled", label: "Settled" },
];

/** One-line caption per stage (PRD §5.7.3) — plain language, no hype. */
export const STAGE_CAPTIONS = [
  "A burn or a locked redemption request lands on-chain through a trigger adapter.",
  "The registry waits out the configurable confirmation depth — no instruction can be signed on a non-final trigger.",
  "Destination eligibility and sanctions status are re-checked against the identity registry at redemption time.",
  "An independent 2-of-3 signer set co-signs an EIP-712 release instruction before any value moves.",
  "The custodian settles off-chain on its normal rails, then records confirmation back on-chain.",
];

// Registry Status enum values (src/interfaces/IRedemptionTypes.sol)
const ST_AWAITING_FINALITY = 1;
const ST_REQUESTED = 2;
const ST_FLAGGED = 4;
const ST_IN_REVIEW = 5;
const ST_APPROVED = 3;
const ST_SIGNED = 6;
const ST_SETTLED = 7;

/**
 * Map a registry Status onto the stepper stage currently *in progress*
 * (Triggered=1 … Settled=5). Terminal failure states stay pinned to the stage
 * where they failed — color/type context comes from the StatusBadge beside it.
 */
export function statusToStep(status: number): number {
  switch (status) {
    case ST_AWAITING_FINALITY:
      return 2;
    case ST_REQUESTED:
    case ST_FLAGGED:
    case ST_IN_REVIEW:
      return 3;
    case ST_APPROVED:
      return 4;
    case ST_SIGNED:
    case ST_SETTLED:
      return 5;
    default:
      return 1; // None / Cancelled / unknown
  }
}

type StepState = "done" | "current" | "todo";

export function Stepper({
  /** Registry status enum value; ignored when `step` is given. */
  status,
  /** Explicit step override (1–5). Used by the landing animation. */
  step,
  captions = false,
  animate = false,
}: {
  status?: number;
  step?: number;
  captions?: boolean | string[];
  animate?: boolean;
}) {
  const target = animate ? 0 : (step ?? statusToStep(status ?? 0));
  const [shown, setShown] = useState(target);

  useEffect(() => {
    if (!animate) {
      setShown(step ?? statusToStep(status ?? 0));
      return;
    }
    // Autoplay through the pipeline once — landing "how it works".
    if (shown < STAGES.length) {
      const t = setTimeout(() => setShown((s) => s + 1), 700);
      return () => clearTimeout(t);
    }
  }, [shown, animate, step, status]);

  // A numeric `step` of exactly 5 with no registry status means "render all done"
  // (static usage); otherwise everything up to the in-progress stage fills.
  const display = animate ? shown : Math.max(1, target);
  const complete =
    (!animate && status != null && status === ST_SETTLED) ||
    (!animate && step === STAGES.length && status == null);

  return (
    <div className="w-full">
      <ol className="flex items-start">
        {STAGES.map((s, i) => {
          const idx = i + 1;
          let state: StepState = idx < display ? "done" : idx === display ? "current" : "todo";
          if (complete) state = "done";
          const animatingCurrent = animate && idx === shown;

          const circleCls =
            state === "done"
              ? "border-brand-tint bg-brand-tint text-brand" +
                (complete && i === STAGES.length - 1
                  ? "!border-brand !bg-brand text-white check-in"
                  : "")
              : state === "current"
                ? "border-brand bg-brand text-white" + (animatingCurrent ? " pulse-soft" : "")
                : "border-line bg-card text-mute";

          return (
            <li key={s.key} className="flex flex-1 flex-col items-center">
              <div className="flex w-full items-center">
                <div className={`h-px flex-1 ${idx === 1 ? "bg-transparent" : idx <= display || complete ? "bg-brand" : "bg-line"}`} />
                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-all duration-300 ${circleCls}`}
                >
                  {state === "done" ? "✓" : idx}
                </div>
                <div className={`h-px flex-1 ${idx === STAGES.length ? "bg-transparent" : idx <= display || complete ? "bg-brand" : "bg-line"}`} />
              </div>
              <span
                className={`mt-2 text-xs font-medium ${
                  state === "current" ? "text-ink" : state === "done" ? "text-body" : "text-mute"
                }`}
              >
                {s.label}
              </span>
              {captions && (
                <span className="mt-1 max-w-[170px] text-center text-[11px] leading-relaxed text-mute">
                  {Array.isArray(captions) ? captions[i] : STAGE_CAPTIONS[i]}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}