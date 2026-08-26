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

  constructor(cfg: {
    rpcUrl: string;
    privateKey: string;
    registryAddress: string;
    signerContract: string;
    chainId: number;
  }) {
    const provider = new JsonRpcProvider(cfg.rpcUrl);
    this.wallet = new Wallet(cfg.privateKey, provider);
    this.signerContract = new Contract(cfg.signerContract, signerAbi, this.wallet);
    this.registry = new Contract(cfg.registryAddress, registryAbi, this.wallet);
    this.chainId = cfg.chainId;
  }

  async start(): Promise<void> {
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
    await tick();
    setInterval(tick, Number(process.env.POLL_MS || 4000));
  }

  private async scan(): Promise<void> {
    const provider = this.registry.runner!.provider!;
    const latest = await provider.getBlockNumber();
    const from = Math.max(0, latest - 4000);
    const events = await this.registry.queryFilter(
      this.registry.filters.RedemptionRequested(),
      from,
      latest
    );
    for (const e of events) {
      if (!("args" in e)) continue;
      const id = Number(e.args.id);
      await this.trySign(id);
    }
  }

  private async trySign(id: number): Promise<void> {
    const status = Number(await this.registry.statusOf(id));
    if (status !== Status.Approved) return;

    const [instr, digest] = await this.signerContract.getInstruction(id);
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