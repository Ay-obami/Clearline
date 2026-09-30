import { validateConfig, verifyChain, envInteger } from "../../shared/config";
import { JsonRpcProvider, Wallet, Contract, ethers } from "ethers";
import {
  registryAbi,
  signerAbi,
  settlementAbi,
  Status,
} from "../../shared/contracts";
import { settlementTypes, settlementDomain } from "../../shared/typedData";

/**
 * Clearline mock custodian / settlement service (PRD 9.4).
 *
 * Watches the registry for `InstructionSigned` events (release authorized by the
 * multi-sig signer set), then simulates real-world settlement — a configurable
 * delay and status flip — and finally posts a signed settlement confirmation
 * back on-chain via the SettlementRecorder, closing the audit loop.
 *
 * Railway env:
 *   RPC_URL, CHAIN_ID, PRIVATE_KEY (custodian attestor key),
 *   REGISTRY_ADDRESS, SIGNER_CONTRACT, SETTLEMENT_ADDRESS
 *   SETTLEMENT_DELAY_MS  optional simulated processing delay (default 15000)
 *   HEALTH_PORT          optional (default 8081)
 */
export class MockCustodian {
  private readonly registry: Contract;
  private readonly signerContract: Contract;
  private readonly settlement: Contract;
  private readonly wallet: Wallet;
  private readonly chainId: number;
  private readonly delayMs: number;
  public settleCount = 0;
  private nextRedemptionId = 1n;
  private scanning = false;

  constructor(cfg: {
    rpcUrl: string;
    privateKey: string;
    registryAddress: string;
    signerContract: string;
    settlementAddress: string;
    chainId: number;
    delayMs?: number;
  }) {
    validateConfig(cfg);
    const provider = new JsonRpcProvider(cfg.rpcUrl);
    this.wallet = new Wallet(cfg.privateKey, provider);
    this.registry = new Contract(cfg.registryAddress, registryAbi, this.wallet);
    this.signerContract = new Contract(cfg.signerContract, signerAbi, this.wallet);
    this.settlement = new Contract(cfg.settlementAddress, settlementAbi, this.wallet);
    this.chainId = cfg.chainId;
    this.delayMs = cfg.delayMs ?? 15000;
  }

  async start(): Promise<void> {
    await verifyChain(this.wallet, this.chainId);
    const pollMs = envInteger("POLL_MS", 4000, 1, 2147483647);
    console.log(`[custodian ${this.wallet.address}] watching for InstructionSigned`);
    const tick = async () => {
      try {
        await this.scan();
      } catch (e) {
        console.error(`[custodian] poll error: ${e}`);
      }
    };
    // Startup validation is complete; a slow initial sweep must not delay health binding.
    void tick();
    setInterval(tick, pollMs);
  }

  private async scan(): Promise<void> {
    if (this.scanning) return;
    this.scanning = true;
    try {
      const count = BigInt(await this.registry.redemptionCount());
      if (this.nextRedemptionId > count) this.nextRedemptionId = 1n;
      // Reconcile registry state, including work signed before the former log window.
      for (let visited = 0; visited < 50 && this.nextRedemptionId <= count; visited++) {
        const id = this.nextRedemptionId++;
        try { await this.process(id); }
        catch (e) { console.error(`[custodian] redemption #${id}: ${e}`); }
      }
    } finally { this.scanning = false; }
  }

  private async process(id: bigint): Promise<void> {
    const status = Number(await this.registry.statusOf(id));
    if (status !== Status.Signed) return; // already settled or not yet signed

    // Simulated real-world settlement: wait, then flip status.
    await new Promise((r) => setTimeout(r, this.delayMs));

    // Re-check: an operator may have rejected/paused meanwhile.
    const now = Number(await this.registry.statusOf(id));
    if (now !== Status.Signed) {
      console.log(`[custodian] redemption #${id} no longer Signed (status=${now}); skipping settlement`);
      return;
    }

    const ref = ethers.id(`clearline settlement #${id} @${Date.now()}`); // 32-byte hex
    const digest = await this.settlement.settlementDigest(id, ref);
    const sig = await this.wallet.signTypedData(
      settlementDomain(this.chainId, await this.settlement.getAddress()),
      settlementTypes,
      { redemptionId: id, settlementRef: ref }
    );

    const tx = await this.settlement.confirmSettlement(id, ref, sig);
    const rcpt = await tx.wait();
    this.settleCount += 1;
    console.log(`[custodian] settled redemption #${id} tx=${rcpt.hash}`);
  }
}