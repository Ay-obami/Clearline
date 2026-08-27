import { createServer } from "http";
import { ClearlineSigner } from "./signer";

/**
 * Entrypoint for one Clearline signer process.
 * Requires (Railway env):
 *   PRIVATE_KEY, RPC_URL, CHAIN_ID, REGISTRY_ADDRESS, SIGNER_CONTRACT
 * Optional:
 *   HEALTH_PORT (default 8080)
 */
async function main() {
  const required = [
    "PRIVATE_KEY",
    "RPC_URL",
    "REGISTRY_ADDRESS",
    "SIGNER_CONTRACT",
  ];
  for (const k of required) {
    if (!process.env[k]) {
      console.error(`Missing required env: ${k}`);
      process.exit(1);
    }
  }

  const signer = new ClearlineSigner({
    rpcUrl: process.env.RPC_URL!,
    privateKey: process.env.PRIVATE_KEY!,
    registryAddress: process.env.REGISTRY_ADDRESS!,
    signerContract: process.env.SIGNER_CONTRACT!,
    chainId: Number(process.env.CHAIN_ID || 133),
  });

  // Health endpoint (Railway-friendly, no secret exposure).
  // Railway injects PORT and healthchecks it; HEALTH_PORT is our own override.
  const port = Number(process.env.HEALTH_PORT || process.env.PORT || 8080);
  createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "signer", signedCount: signer.signedCount }));
  }).listen(port, () => console.log(`[signer] health on :${port}`));

  await signer.start();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});