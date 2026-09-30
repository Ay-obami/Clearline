"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClearlineSigner = void 0;
const config_1 = require("../../shared/config");
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
    nextRedemptionId = 1n;
    scanning = false;
    constructor(cfg) {
        (0, config_1.validateConfig)(cfg);
        const provider = new ethers_1.JsonRpcProvider(cfg.rpcUrl);
        this.wallet = new ethers_1.Wallet(cfg.privateKey, provider);
        this.signerContract = new ethers_1.Contract(cfg.signerContract, contracts_1.signerAbi, this.wallet);
        this.registry = new ethers_1.Contract(cfg.registryAddress, contracts_1.registryAbi, this.wallet);
        this.chainId = cfg.chainId;
    }
    async start() {
        if (await this.signerContract.VERSION() !== "2") {
            throw new Error("This service requires the Clearline v2 InstructionSigner; migrate addresses before starting.");
        }
        await (0, config_1.verifyChain)(this.wallet, this.chainId);
        const pollMs = (0, config_1.envInteger)("POLL_MS", 4000, 1, 2147483647);
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
        // Startup validation is complete; a slow initial sweep must not delay health binding.
        void tick();
        setInterval(tick, pollMs);
    }
    async scan() {
        if (this.scanning)
            return;
        this.scanning = true;
        try {
            const count = BigInt(await this.registry.redemptionCount());
            if (this.nextRedemptionId > count)
                this.nextRedemptionId = 1n;
            // Revisit every ID over bounded sweeps: rotations do not emit another
            // RedemptionRequested event, and old pending work must remain discoverable.
            for (let visited = 0; visited < 50 && this.nextRedemptionId <= count; visited++) {
                const id = this.nextRedemptionId++;
                try {
                    await this.trySign(id);
                }
                catch (e) {
                    console.error(`[signer] redemption #${id}: ${e}`);
                }
            }
        }
        finally {
            this.scanning = false;
        }
    }
    async trySign(id) {
        const status = Number(await this.registry.statusOf(id));
        if (status !== contracts_1.Status.Approved)
            return;
        if (!await this.signerContract.isSigner(this.wallet.address))
            return;
        if (await this.signerContract.hasSigned(id, this.wallet.address))
            return;
        const [instr, digest] = await this.signerContract.getInstruction(id);
        const block = await this.wallet.provider.getBlock("latest");
        if (!block)
            throw new Error("Latest chain block is unavailable");
        // Match Solidity: equality is still valid; only strictly later timestamps expire.
        if (BigInt(block.timestamp) > BigInt(instr.deadline))
            return;
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
            signerEpoch: instr.signerEpoch,
        };
        const signature = await this.wallet.signTypedData((0, typedData_1.instructionDomain)(this.chainId, await this.signerContract.getAddress()), typedData_1.instructionTypes, value);
        const tx = await this.signerContract.submitSignature(id, signature);
        const rcpt = await tx.wait();
        this.signedCount += 1;
        console.log(`[signer ${this.wallet.address}] signed redemption #${id} tx=${rcpt.hash} digest=${digest.slice(0, 10)}`);
    }
}
exports.ClearlineSigner = ClearlineSigner;
