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

  constructor(cfg: {
    rpcUrl: string;
    privateKey: string;
    registryAddress: string;
    signerContract: string;
    settlementAddress: string;
    chainId: number;
    delayMs?: number;
  }) {
    const provider = new JsonRpcProvider(cfg.rpcUrl);
    this.wallet = new Wallet(cfg.privateKey, provider);
    this.registry = new Contract(cfg.registryAddress, registryAbi, this.wallet);
    this.signerContract = new Contract(cfg.signerContract, signerAbi, this.wallet);
    this.settlement = new Contract(cfg.settlementAddress, settlementAbi, this.wallet);
    this.chainId = cfg.chainId;
    this.delayMs = cfg.delayMs ?? 15000;
  }

  async start(): Promise<void> {
    console.log(`[custodian ${this.wallet.address}] watching for InstructionSigned`);
    const tick = async () => {
      try {
        await this.scan();
      } catch (e) {
        console.error(`[custodian] poll error: ${e}`);
      }
    };
    await tick();
    setInterval(tick, Number(process.env.POLL_MS || 4000));
  }

  private async scan(): Promise<void> {
    const latest = await this.registry.runner!.provider!.getBlockNumber();
    const from = Math.max(0, latest - 4000);
    const events = await this.signerContract.queryFilter(
      this.signerContract.filters.InstructionSigned(),
      from,
      latest
    );
    for (const e of events) {
      if (!("args" in e)) continue;
      const id = Number(e.args.id);
      await this.process(id);
    }
  }

  private async process(id: number): Promise<void> {
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