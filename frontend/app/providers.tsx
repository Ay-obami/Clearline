"use client";
import { useEffect, useState, ReactNode } from "react";
import { http, createConfig, WagmiProvider, useReadContract } from "wagmi";
import { defineChain } from "viem";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { config, signerVersionAbi } from "@/lib/contracts";

// HSK Chain is OP-stack, EVM-compatible. We define it from the public config so
// every read/write targets the configured RPC (dedicated Chainstack node for
// judging, public testnet otherwise).
const hsk = defineChain({
  id: config.ready ? config.chainId : 31337,
  name: config.chainName,
  nativeCurrency: { name: "HSK", symbol: "HSK", decimals: 18 },
  rpcUrls: { default: { http: [config.ready ? config.rpcUrl! : "http://127.0.0.1:8545"] } },
});

const wagmiConfig = createConfig({
  chains: [hsk],
  transports: { [hsk.id]: http(config.ready ? config.rpcUrl! : "http://127.0.0.1:8545") },
});

const queryClient = new QueryClient({
  // Every contract read polls gently — status changes (finality reached,
  // signatures collected, settlement recorded) surface without user reloads.
  defaultOptions: { queries: { refetchInterval: 3000, retry: false, staleTime: 1500 } },
});

export function DeploymentGuard({ children }: { children: ReactNode }) {
  const version = useReadContract({ address: config.signer, abi: signerVersionAbi, functionName: "VERSION", query: { enabled: config.ready } });
  if (!config.ready) return <main className="p-8"><h1>Deployment unconfigured</h1><p>Set the public chain, RPC and deployed contract addresses, then rebuild.</p><ul>{config.issues.map(issue => <li key={issue}>{issue}</li>)}</ul></main>;
  if (version.data !== "2") return <main className="p-8"><h1>Deployment verification required</h1><p>{version.isPending ? "Checking InstructionSigner version…" : "InstructionSigner version 2 could not be verified. Transactions are disabled. Check the chain, RPC and signer address."}</p></main>;
  return <>{children}</>;
}

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