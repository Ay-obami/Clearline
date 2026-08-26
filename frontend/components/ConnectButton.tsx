"use client";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { injected } from "wagmi/connectors";
import { shortAddr } from "@/lib/contracts";

/** Standard, unobtrusive connect button — top-right, not a hero element (PRD §5.6). */
export function ConnectButton() {
  const { address, isConnected } = useAccount();
  const { connect } = useConnect();
  const { disconnect } = useDisconnect();

  if (isConnected && address) {
    return (
      <button className="btn-secondary font-mono text-[13px]" onClick={() => disconnect()}>
        {shortAddr(address)}
      </button>
    );
  }
  return (
    <button className="btn-primary" onClick={() => connect({ connector: injected() })}>
      Connect wallet
    </button>
  );
}