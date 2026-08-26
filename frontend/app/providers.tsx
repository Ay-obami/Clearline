"use client";
import { useEffect, useState, ReactNode } from "react";
import { http, createConfig, WagmiProvider } from "wagmi";
import { defineChain } from "viem";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { config } from "@/lib/contracts";

// HSK Chain is OP-stack, EVM-compatible. We define it from the public config so
// every read/write targets the configured RPC (dedicated Chainstack node for
// judging, public testnet otherwise).
const hsk = defineChain({
  id: config.chainId,
  name: "HSK Chain Testnet",
  nativeCurrency: { name: "HSK", symbol: "HSK", decimals: 18 },
  rpcUrls: { default: { http: [config.rpcUrl] } },
});

const wagmiConfig = createConfig({
  chains: [hsk],
  transports: { [hsk.id]: http(config.rpcUrl) },
});

const queryClient = new QueryClient({
  // Every contract read polls gently — status changes (finality reached,
  // signatures collected, settlement recorded) surface without user reloads.
  defaultOptions: { queries: { refetchInterval: 3000, retry: false, staleTime: 1500 } },
});

export function Providers({ children }: { children: ReactNode }) {
  // Hydration guard so server/client rendering stays pre-render-stable.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}