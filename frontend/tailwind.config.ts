import type { Config } from "tailwindcss";

/**
 * Clearline design system (PRD §5). Institutional/fintech minimal:
 * warm-neutral background, 1px borders, restrained stature. The four status
 * colors are the core visual language — used consistently across the whole app.
 */
const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Base
        bg: "#FAFAF9",
        card: "#FFFFFF",
        line: "#E5E5E3",
        // Text
        ink: "#141414",
        body: "#4A4A48",
        mute: "#8A8A87",
        // Primary accent — emerald green (settlement/cleared)
        brand: "#1F6F4A",
        "brand-tint": "#E7F3ED",
        // Status: pending/in-progress (amber)
        pending: "#B7791F",
        "pending-tint": "#FDF3E1",
        // Status: flagged/manual review (red)
        flag: "#B42318",
        "flag-tint": "#FEECEC",
        // Status: awaiting finality (neutral blue-gray)
        finality: "#3B5166",
        "finality-tint": "#EAEEF2",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        mono: ["var(--font-jetbrains)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(0,0,0,0.04)",
      },
    },
  },
  plugins: [],
};
export default config;