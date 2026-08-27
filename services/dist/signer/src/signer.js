"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClearlineSigner = void 0;
const ethers_1 = require("ethers");
const contracts_1 = require("../../shared/contracts");
const typedData_1 = require("../../shared/typedData");
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
class ClearlineSigner {
    registry;
    signerContract;
    wallet;
    chainId;
    signedCount = 0;
    constructor(cfg) {
        const provider = new ethers_1.JsonRpcProvider(cfg.rpcUrl);
        this.wallet = new ethers_1.Wallet(cfg.privateKey, provider);
        this.signerContract = new ethers_1.Contract(cfg.signerContract, contracts_1.signerAbi, this.wallet);
        this.registry = new ethers_1.Contract(cfg.registryAddress, contracts_1.registryAbi, this.wallet);
        this.chainId = cfg.chainId;
    }
    async start() {
        const isSigner = await this.signerContract.isSigner(this.wallet.address);
        console.log(`[signer ${this.wallet.address}] ${isSigner ? "registered" : "NOT in signer set"} — watching for Approved redemptions`);
        const tick = async () => {
            try {
                await this.scan();
            }
            catch (e) {
                console.error(`[signer] poll error: ${e}`);
            }
        };
        await tick();
        setInterval(tick, Number(process.env.POLL_MS || 4000));
    }
    async scan() {
        const provider = this.registry.runner.provider;
        const latest = await provider.getBlockNumber();
        const from = Math.max(0, latest - 4000);
        const events = await this.registry.queryFilter(this.registry.filters.RedemptionRequested(), from, latest);
        for (const e of events) {
            if (!("args" in e))
                continue;
            const id = Number(e.args.id);
            await this.trySign(id);
        }
    }
    async trySign(id) {
        const status = Number(await this.registry.statusOf(id));
        if (status !== contracts_1.Status.Approved)
            return;
        const [instr, digest] = await this.signerContract.getInstruction(id);
        const value = {
            assetId: instr.assetId,
            holder: instr.holder,
            amount: instr.amount,
            destination: instr.destination,
            triggerType: Number(instr.triggerType),
            sourceEventHash: instr.sourceEventHash,
            complianceHash: instr.complianceHash,
            nonce: instr.nonce,
            deadline: instr.deadline,
        };
        const signature = await this.wallet.signTypedData((0, typedData_1.instructionDomain)(this.chainId, await this.signerContract.getAddress()), typedData_1.instructionTypes, value);
        const tx = await this.signerContract.submitSignature(id, signature);
        const rcpt = await tx.wait();
        this.signedCount += 1;
        console.log(`[signer ${this.wallet.address}] signed redemption #${id} tx=${rcpt.hash} digest=${digest.slice(0, 10)}`);
    }
}
exports.ClearlineSigner = ClearlineSigner;
