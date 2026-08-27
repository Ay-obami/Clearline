"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MockCustodian = void 0;
const ethers_1 = require("ethers");
const contracts_1 = require("../../shared/contracts");
const typedData_1 = require("../../shared/typedData");
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
class MockCustodian {
    registry;
    signerContract;
    settlement;
    wallet;
    chainId;
    delayMs;
    settleCount = 0;
    constructor(cfg) {
        const provider = new ethers_1.JsonRpcProvider(cfg.rpcUrl);
        this.wallet = new ethers_1.Wallet(cfg.privateKey, provider);
        this.registry = new ethers_1.Contract(cfg.registryAddress, contracts_1.registryAbi, this.wallet);
        this.signerContract = new ethers_1.Contract(cfg.signerContract, contracts_1.signerAbi, this.wallet);
        this.settlement = new ethers_1.Contract(cfg.settlementAddress, contracts_1.settlementAbi, this.wallet);
        this.chainId = cfg.chainId;
        this.delayMs = cfg.delayMs ?? 15000;
    }
    async start() {
        console.log(`[custodian ${this.wallet.address}] watching for InstructionSigned`);
        const tick = async () => {
            try {
                await this.scan();
            }
            catch (e) {
                console.error(`[custodian] poll error: ${e}`);
            }
        };
        await tick();
        setInterval(tick, Number(process.env.POLL_MS || 4000));
    }
    async scan() {
        const latest = await this.registry.runner.provider.getBlockNumber();
        const from = Math.max(0, latest - 4000);
        const events = await this.signerContract.queryFilter(this.signerContract.filters.InstructionSigned(), from, latest);
        for (const e of events) {
            if (!("args" in e))
                continue;
            const id = Number(e.args.id);
            await this.process(id);
        }
    }
    async process(id) {
        const status = Number(await this.registry.statusOf(id));
        if (status !== contracts_1.Status.Signed)
            return; // already settled or not yet signed
        // Simulated real-world settlement: wait, then flip status.
        await new Promise((r) => setTimeout(r, this.delayMs));
        // Re-check: an operator may have rejected/paused meanwhile.
        const now = Number(await this.registry.statusOf(id));
        if (now !== contracts_1.Status.Signed) {
            console.log(`[custodian] redemption #${id} no longer Signed (status=${now}); skipping settlement`);
            return;
        }
        const ref = ethers_1.ethers.id(`clearline settlement #${id} @${Date.now()}`); // 32-byte hex
        const digest = await this.settlement.settlementDigest(id, ref);
        const sig = await this.wallet.signTypedData((0, typedData_1.settlementDomain)(this.chainId, await this.settlement.getAddress()), typedData_1.settlementTypes, { redemptionId: id, settlementRef: ref });
        const tx = await this.settlement.confirmSettlement(id, ref, sig);
        const rcpt = await tx.wait();
        this.settleCount += 1;
        console.log(`[custodian] settled redemption #${id} tx=${rcpt.hash}`);
    }
}
exports.MockCustodian = MockCustodian;
