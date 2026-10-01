import { validateConfig, verifyChain, envInteger } from "../../shared/config";
import { JsonRpcProvider, Wallet, Contract } from "ethers";
import { registryAbi, signerAbi, Status } from "../../shared/contracts";
import { instructionTypes, instructionDomain } from "../../shared/typedData";

/** Plain value object matching the Solidity RedemptionInstruction struct. */
interface InstructionValue {
  assetId: string;
  holder: string;
  amount: bigint;
  destination: string;
  triggerType: number;
  sourceEventHash: string;
  complianceHash: string;
  nonce: bigint;
  deadline: bigint;
  signerEpoch: bigint;
}

/**
 * Clearline signer service — one process per custodian/agent key.
 *
 * Watches the registry for Approved redemptions, builds the EIP-712 typed
 * RedemptionInstruction exactly as the on-chain verifier expects, signs it with
 * its own key, and submits it. When the threshold of distinct configured signers
 * is met, the on-chain InstructionSigner marks the redemption Signed and emits
 * InstructionSigned for custodian systems to consume.
 *
 * Railway env:
 *   RPC_URL            HSK testnet RPC (use the dedicated Chainstack node for judging)
 *   CHAIN_ID            133
 *   PRIVATE_KEY         this signer's key (never committed)
 *   REGISTRY_ADDRESS    RedemptionRegistry
 *   SIGNER_CONTRACT     InstructionSigner
 *   POLL_MS             optional poll interval (default 4000)
 */
export class ClearlineSigner {
  private readonly registry: Contract;
  private readonly signerContract: Contract;
  private readonly wallet: Wallet;
  private readonly chainId: number;
  public signedCount = 0;
  private nextRedemptionId = 1n;
  private scanning = false;

  constructor(cfg: {
    rpcUrl: string;
    privateKey: string;
    registryAddress: string;
    signerContract: string;
    chainId: number;
  }) {
    validateConfig(cfg);
    const provider = new JsonRpcProvider(cfg.rpcUrl);
    this.wallet = new Wallet(cfg.privateKey, provider);
    this.signerContract = new Contract(cfg.signerContract, signerAbi, this.wallet);
    this.registry = new Contract(cfg.registryAddress, registryAbi, this.wallet);
    this.chainId = cfg.chainId;
  }

  async start(): Promise<void> {
    if (await this.signerContract.VERSION() !== "2") {
      throw new Error("This service requires the Clearline v2 InstructionSigner; migrate addresses before starting.");
    }
    await verifyChain(this.wallet, this.chainId);
    const pollMs = envInteger("POLL_MS", 4000, 1, 2147483647);
    const isSigner = await this.signerContract.isSigner(this.wallet.address);
    console.log(
      `[signer ${this.wallet.address}] ${isSigner ? "registered" : "NOT in signer set"} — watching for Approved redemptions`
    );

    const tick = async () => {
      try {
        await this.scan();
      } catch (e) {
        console.error(`[signer] poll error: ${e}`);
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
      // Revisit every ID over bounded sweeps: rotations do not emit another
      // RedemptionRequested event, and old pending work must remain discoverable.
      for (let visited = 0; visited < 50 && this.nextRedemptionId <= count; visited++) {
        const id = this.nextRedemptionId++;
        try {
          await this.trySign(id);
        } catch (e) {
          console.error(`[signer] redemption #${id}: ${e}`);
        }
      }
    } finally {
      this.scanning = false;
    }
  }

  private async trySign(id: bigint): Promise<void> {
    const status = Number(await this.registry.statusOf(id));
    if (status !== Status.Approved) return;

    if (!await this.signerContract.isSigner(this.wallet.address)) return;
    if (await this.signerContract.hasSigned(id, this.wallet.address)) return;

    const [instr, digest] = await this.signerContract.getInstruction(id);
    const block = await this.wallet.provider!.getBlock("latest");
    if (!block) throw new Error("Latest chain block is unavailable");
    // Match Solidity: equality is still valid; only strictly later timestamps expire.
    if (BigInt(block.timestamp) > BigInt(instr.deadline)) return;

    const value: InstructionValue = {
      assetId: instr.assetId,
      holder: instr.holder,
      amount: instr.amount as bigint,
      destination: instr.destination,
      triggerType: Number(instr.triggerType),
      sourceEventHash: instr.sourceEventHash,
      complianceHash: instr.complianceHash,
      nonce: instr.nonce as bigint,
      deadline: instr.deadline as bigint,
      signerEpoch: instr.signerEpoch as bigint,
    };

    const signature = await this.wallet.signTypedData(
      instructionDomain(this.chainId, await this.signerContract.getAddress()),
      instructionTypes,
      value
    );

    const tx = await this.signerContract.submitSignature(id, signature);
    const rcpt = await tx.wait();
    this.signedCount += 1;
    console.log(
      `[signer ${this.wallet.address}] signed redemption #${id} tx=${rcpt.hash} digest=${digest.slice(0, 10)}`
    );
  }
}