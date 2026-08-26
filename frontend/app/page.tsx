import Link from "next/link";
import { ConnectButton } from "@/components/ConnectButton";
import { LandingDemo } from "@/components/LandingDemo";

const NAV_LINKS = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#why", label: "Why this exists" },
  { href: "#architecture", label: "Architecture" },
];

const TRUST_ITEMS = [
  "Built on HSK Chain",
  "ERC-3643 compatible",
  "Multi-sig verified",
  "Foundry-tested",
];

const TRIGGER_CHIPS = [
  { title: "Direct burn", sub: "Holder-initiated, on-demand" },
  { title: "Request & lock", sub: "NAV-priced funds, two-step" },
  { title: "Scheduled", sub: "Maturity or cutoff batch" },
  { title: "Issuer-initiated", sub: "Agent-scoped corporate actions" },
  { title: "Threshold", sub: "NAV / peg boundary breach" },
];

const PIPELINE_STEPS = [
  { n: "01", title: "Finality watcher", body: "Waits the configured confirmation depth before treating any trigger as irreversible." },
  { n: "02", title: "Compliance re-check", body: "Re-validates the destination against the ERC-3643 identity registry at redemption time." },
  { n: "03", title: "EIP-712 instruction signer", body: "A 2-of-3 signer set co-signs the release instruction — no single relayer key." },
  { n: "04", title: "Settlement recorder", body: "The custodian settles off-chain, then posts confirmation back on-chain." },
];

export default function Home() {
  return (
    <main>
      {/* Nav — minimal links, single CTA */}
      <header className="sticky top-0 z-40 border-b border-line bg-bg/90 backdrop-blur">
        <nav className="mx-auto flex h-14 max-w-[1120px] items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-[2px] bg-brand" aria-hidden />
            <span className="text-[15px] font-semibold tracking-tight text-ink">Clearline</span>
          </Link>
          <div className="hidden items-center gap-6 md:flex">
            {NAV_LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="text-sm text-body transition-colors hover:text-ink"
              >
                {l.label}
              </a>
            ))}
            <a
              href="https://github.com/ayobami/Clearline"
              target="_blank"
              rel="noreferrer"
              className="text-sm text-body transition-colors hover:text-ink"
            >
              GitHub
            </a>
          </div>
          <Link href="/app" className="btn-primary py-1.5 text-[13px]">
            Launch App
          </Link>
        </nav>
      </header>

      {/* Hero — name the problem precisely (PRD §5.7.2) */}
      <section className="mx-auto max-w-[1120px] px-6 pb-16 pt-20 md:pt-24">
        <p className="font-mono text-xs uppercase tracking-widest text-mute">
          Redemption &amp; custody attestation · HSK Chain
        </p>
        <h1 className="mt-4 max-w-3xl text-3xl font-semibold leading-tight tracking-tight text-ink sm:text-[38px] sm:leading-[1.15]">
          The missing redemption layer for tokenized real-world assets.
        </h1>
        <p className="mt-5 max-w-2xl text-[17px] leading-relaxed text-body">
          Clearline connects an on-chain token burn to the release of the underlying asset —
          waiting out block finality, re-checking compliance at redemption time, and
          co-signing every instruction with an independent multi-sig set before any
          custodian releases value.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link href="/app" className="btn-primary h-11 px-6 text-[15px]">
            Launch App
          </Link>
          <a href="#how-it-works" className="btn-secondary h-11 px-6 text-[15px]">
            See how it works
          </a>
          <ConnectButton />
        </div>
        <p className="mt-6 font-mono text-xs text-mute">
          Hackathon build on HSK Chain testnet — mock RWA token, mock custodian, real contracts.
        </p>
      </section>

      {/* Trust bar — understated credibility (PRD §5.7.4) */}
      <section className="border-y border-line bg-card">
        <div className="mx-auto flex max-w-[1120px] flex-wrap items-center justify-center gap-x-8 gap-y-2 px-6 py-4">
          {TRUST_ITEMS.map((t, i) => (
            <span
              key={t}
              className="flex items-center gap-8 text-xs uppercase tracking-widest text-mute"
            >
              {i > 0 && <span aria-hidden className="hidden sm:inline">·</span>}
              {t}
            </span>
          ))}
        </div>
      </section>

      {/* How it works — the stepper is the explainer (PRD §5.7.3) */}
      <section id="how-it-works" className="mx-auto max-w-[1120px] scroll-mt-20 px-6 py-20">
        <p className="text-center font-mono text-xs uppercase tracking-widest text-mute">
          How it works
        </p>
        <h2 className="mx-auto mt-3 max-w-xl text-center text-2xl font-semibold tracking-tight text-ink">
          Every trigger converges on one auditable pipeline.
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-center text-[15px] leading-relaxed text-body">
          The entry points vary by product shape — on-demand treasuries, NAV-priced funds,
          maturity schedules. What happens next never does.
        </p>
        <div className="mt-10">
          <LandingDemo />
        </div>
      </section>

      {/* Why this exists — distilled problem statement (PRD §1.2, §5.7.5) */}
      <section id="why" className="border-y border-line bg-card scroll-mt-20">
        <div className="mx-auto max-w-[1120px] px-6 py-20">
          <p className="font-mono text-xs uppercase tracking-widest text-mute">
            Why this exists
          </p>
          <h2 className="mt-3 max-w-2xl text-2xl font-semibold tracking-tight text-ink">
            Tokenization solved issuance. Redemption stayed in the back office.
          </h2>
          <div className="mt-8 grid gap-10 md:grid-cols-3">
            <div>
              <h3 className="text-[15px] font-semibold text-ink">
                A token is a representation, not the claim itself
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-body">
                Burning a token does not legally extinguish the underlying bond, fund share,
                or credit instrument. That record lives with a custodian or transfer agent —
                and nothing today automatically links the two systems.
              </p>
            </div>
            <div>
              <h3 className="text-[15px] font-semibold text-ink">
                Chains cannot observe real-world custody
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-body">
                A blockchain can only trust what is written to it. A bank wire or title
                transfer happens off-chain, so someone must observe it and attest — and that
                reporting step is precisely where automation currently breaks down.
              </p>
            </div>
            <div>
              <h3 className="text-[15px] font-semibold text-ink">
                Liability keeps a human in the loop
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-body">
                Custodians carry legal liability for mis-burned tokens, so they will not hand
                authorization to one script. Clearline keeps the accountability checkpoint —
                multi-sig signers and a circuit breaker — while removing the opacity.
              </p>
            </div>
          </div>
          <p className="mt-8 max-w-2xl border-l-2 border-brand pl-4 text-sm leading-relaxed text-body">
            <span className="font-medium text-ink">What Clearline automates is the initiation,
            not the completion.</span>{" "}
            Real settlement still runs on custodians&apos; normal rails — T+1/T+2, banking
            hours — and the system makes its timeline legible rather than pretending otherwise.
          </p>
        </div>
      </section>

      {/* Architecture glance — simplified PRD §4.1 diagram (PRD §5.7.6) */}
      <section id="architecture" className="mx-auto max-w-[1120px] scroll-mt-20 px-6 py-20">
        <p className="font-mono text-xs uppercase tracking-widest text-mute">Architecture</p>
        <h2 className="mt-3 max-w-2xl text-2xl font-semibold tracking-tight text-ink">
          Pluggable triggers. One pipeline. A closed audit loop.
        </h2>

        <div className="card mt-10 p-6 sm:p-8">
          <p className="font-mono text-[11px] uppercase tracking-widest text-mute">
            Trigger layer — pluggable via ITriggerAdapter
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {TRIGGER_CHIPS.map((c) => (
              <div key={c.title} className="rounded-[8px] border border-line bg-bg p-3">
                <p className="text-[13px] font-medium text-ink">{c.title}</p>
                <p className="mt-1 text-xs leading-snug text-mute">{c.sub}</p>
              </div>
            ))}
          </div>

          <div className="my-6 flex justify-center">
            <svg width="16" height="36" viewBox="0 0 16 36" fill="none" aria-hidden>
              <path d="M8 0v28m0 0l6-6m-6 6l-6-6" stroke="#B9C0B4" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>

          <p className="font-mono text-[11px] uppercase tracking-widest text-mute">
            Shared pipeline — every step on-chain
          </p>
          <div className="mt-4 grid gap-3 lg:grid-cols-4">
            {PIPELINE_STEPS.map((s) => (
              <div key={s.n} className="rounded-[8px] border border-line p-4">
                <p className="font-mono text-xs text-mute">{s.n}</p>
                <p className="mt-1.5 text-[13px] font-semibold text-ink">{s.title}</p>
                <p className="mt-1.5 text-xs leading-relaxed text-body">{s.body}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-[8px] border border-dashed border-flag/40 bg-flag-tint/50 p-4">
            <p className="text-[13px] font-semibold text-flag">If anything looks wrong → circuit breaker</p>
            <p className="mt-1 text-xs leading-relaxed text-body">
              Failed compliance checks, threshold-exceeded amounts, or sanctioned destinations route
              to a manual review queue resolved only by a multi-sig board — never auto-approved.
            </p>
          </div>
        </div>
      </section>

      {/* Footer (PRD §5.7.7) */}
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1120px] flex-col items-start justify-between gap-4 px-6 py-10 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-[2px] bg-brand" aria-hidden />
            <span className="text-sm font-semibold tracking-tight text-ink">Clearline</span>
            <span className="ml-2 text-xs text-mute">
              © 2026 Ayobami · HSK Chain Horizon Hackathon
            </span>
          </div>
          <div className="flex items-center gap-6 text-sm text-body">
            <a href="https://github.com/ayobami/Clearline" target="_blank" rel="noreferrer" className="hover:text-ink">
              GitHub
            </a>
            <Link href="/app" className="hover:text-ink">
              Launch App
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}