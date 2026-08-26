import { createServer } from "http";
import { MockCustodian } from "./custodian";

/**
 * Entrypoint for the Clearline mock custodian / settlement service.
 * Requires (Railway env):
 *   PRIVATE_KEY, RPC_URL, REGISTRY_ADDRESS, SIGNER_CONTRACT, SETTLEMENT_ADDRESS
 * Optional:
 *   CHAIN_ID (default 133), SETTLEMENT_DELAY_MS, HEALTH_PORT (default 8081)
 */
async function main() {
  const required = [
    "PRIVATE_KEY",
    "RPC_URL",
    "REGISTRY_ADDRESS",
    "SIGNER_CONTRACT",
    "SETTLEMENT_ADDRESS",
  ];
  for (const k of required) {
    if (!process.env[k]) {
      console.error(`Missing required env: ${k}`);
      process.exit(1);
    }
  }

  const custodian = new MockCustodian({
    rpcUrl: process.env.RPC_URL!,
    privateKey: process.env.PRIVATE_KEY!,
    registryAddress: process.env.REGISTRY_ADDRESS!,
    signerContract: process.env.SIGNER_CONTRACT!,
    settlementAddress: process.env.SETTLEMENT_ADDRESS!,
    chainId: Number(process.env.CHAIN_ID || 133),
    delayMs: Number(process.env.SETTLEMENT_DELAY_MS ?? 15000),
  });

  const port = Number(process.env.HEALTH_PORT || 8081);
  createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "custodian", settleCount: custodian.settleCount }));
  }).listen(port, () => console.log(`[custodian] health on :${port}`));

  await custodian.start();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});