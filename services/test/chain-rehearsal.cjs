// Local-chain integration rehearsal. Uses only a disposable Anvil process and test keys.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { JsonRpcProvider, ContractFactory, Wallet, TypedDataEncoder, id, ZeroAddress } = require('ethers');
const { ClearlineSigner } = require('../dist/signer/src/signer.js');
const { MockCustodian } = require('../dist/custodian/src/custodian.js');
const { instructionTypes, instructionDomain } = require('../dist/shared/typedData.js');
const { Status } = require('../dist/shared/contracts.js');
const root = path.resolve(__dirname, '../..');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const node = spawn(process.env.ANVIL_BIN || 'anvil', ['--host', '127.0.0.1', '--port', '0', '--chain-id', '31337'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', spawnError;
  node.stdout.on('data', chunk => { output += chunk; });
  node.stderr.on('data', chunk => { output += chunk; });
  node.on('error', error => { spawnError = error; });
  const providers = [];
  try {
    let match;
    for (let i = 0; i < 200; i++) {
      if (spawnError) throw spawnError;
      if (node.exitCode !== null) throw new Error('Anvil exited before readiness');
      match = output.match(/Listening on 127\.0\.0\.1:(\d+)/);
      if (match) break;
      await sleep(50);
    }
    assert.ok(match, 'Anvil must become ready within 10 seconds');
    const rpcUrl = `http://127.0.0.1:${match[1]}`;
    const provider = new JsonRpcProvider(rpcUrl, 31337, { cacheTimeout: -1 });
    providers.push(provider);
    const owner = await provider.getSigner(0);
    const ownerAddress = await owner.getAddress();
    const keys = ['retained', 'removed', 'replacement', 'attestor'].map(label => id(`Clearline local rehearsal ONLY: ${label}`));
    const wallets = keys.map(key => new Wallet(key, provider));
    for (const wallet of wallets) await provider.send('anvil_setBalance', [wallet.address, '0x56BC75E2D63100000']);
    const [a, b, c, attestor] = wallets;
    const send = async tx => (await tx).wait();
    async function deploy(name, args) {
      const artifact = JSON.parse(readFileSync(path.join(root, 'out', `${name}.sol`, `${name}.json`)));
      const contract = await new ContractFactory(artifact.abi, artifact.bytecode.object, owner).deploy(...args);
      await contract.waitForDeployment();
      return contract;
    }
    const registry = await deploy('RedemptionRegistry', [ownerAddress]);
    const identity = await deploy('MockIdentityRegistry', [ownerAddress]);
    const token = await deploy('MockRWAToken', ['Rehearsal RWA', 'TEST', ownerAddress]);
    const adapter = await deploy('DirectBurnAdapter', [token.target, registry.target]);
    const compliance = await deploy('ComplianceRecheck', [registry.target, identity.target]);
    const breaker = await deploy('CircuitBreaker', [registry.target, ownerAddress]);
    const signer = await deploy('InstructionSigner', [registry.target, ownerAddress]);
    const settlement = await deploy('SettlementRecorder', [registry.target, ownerAddress]);
    for (const tx of [
      () => token.setIdentityRegistry(identity.target), () => identity.setVerified(ownerAddress, true),
      () => token.mint(ownerAddress, 1000), () => registry.setAdapter(adapter.target, true),
      () => registry.setDefaultFinalityDepth(2), () => registry.setComplianceModule(compliance.target),
      () => registry.setCircuitBreaker(breaker.target), () => registry.setInstructionSigner(signer.target),
      () => registry.setSettlementRecorder(settlement.target), () => signer.setCircuitBreaker(breaker.target),
      () => signer.setSigners([a.address, b.address], 2), () => breaker.setBoard([a.address, b.address], 2),
      () => settlement.setAttestor(attestor.address, true), () => token.approve(adapter.target, 1000)
    ]) await send(tx());
    assert.equal(await signer.VERSION(), '2');
    const services = keys.slice(0, 3).map(privateKey => new ClearlineSigner({ rpcUrl, privateKey, registryAddress: registry.target, signerContract: signer.target, chainId: 31337 }));
    const custodian = new MockCustodian({ rpcUrl, privateKey: keys[3], registryAddress: registry.target, signerContract: signer.target, settlementAddress: settlement.target, chainId: 31337, delayMs: 0 });
    for (const service of [...services, custodian]) providers.push(service.wallet.provider);

    async function redeem(amount) {
      await send(adapter.redeem(amount, ownerAddress));
      const redemptionId = await registry.redemptionCount();
      assert.equal(await registry.statusOf(redemptionId), BigInt(Status.AwaitingFinality));
      await assert.rejects(registry.confirmFinality.staticCall(redemptionId), /FinalityNotReached/);
      await provider.send('anvil_mine', ['0x2']);
      await send(registry.confirmFinality(redemptionId));
      await send(compliance.runCheck(redemptionId));
      return redemptionId;
    }
    const first = await redeem(100);
    assert.equal(await registry.statusOf(first), BigInt(Status.Approved));
    const [oldInstruction, oldDigest] = await signer.getInstruction(first);
    const value = Object.fromEntries(instructionTypes.RedemptionInstruction.map(field => [field.name, oldInstruction[field.name]]));
    const domain = instructionDomain(31337, signer.target);
    assert.equal(TypedDataEncoder.hash(domain, instructionTypes, value), oldDigest, 'service/Solidity EIP-712 digests match');
    const staleSignature = await a.signTypedData(domain, instructionTypes, value);
    await services[0].scan();
    assert.equal(await signer.signatureCount(first), 1n);
    const oldEpoch = await signer.signerEpoch();
    await send(signer.setSigners([a.address, c.address], 2));
    assert.equal(await signer.signatureCount(first), 0n);
    assert.equal(await signer.isSigner(b.address), false);
    await assert.rejects(signer.submitSignature.staticCall(first, staleSignature), /UnauthorizedSigner/);
    await services[1].scan();
    assert.equal(services[1].signedCount, 0, 'removed service must not submit');
    await services[0].scan();
    assert.equal(await signer.signatureCount(first), 1n, 'retained service rediscovers old pending ID');
    await services[2].scan();
    assert.equal(await registry.statusOf(first), BigInt(Status.Signed));
    const finalized = await registry.getRedemption(first);
    assert.notEqual(finalized.instructionHash, oldDigest);
    assert.equal(finalized.instructionHash, (await signer.getInstruction(first))[1]);
    assert.deepEqual(Array.from(await signer.collectedSignersAtEpoch(first, oldEpoch)), [a.address]);
    const signedDeadline = await signer.deadlineFor(first);
    await send(signer.setSigningWindow(7200));
    await send(signer.setSigners([b.address], 1));
    assert.equal(await signer.deadlineFor(first), signedDeadline);
    assert.equal((await signer.getInstruction(first))[1], finalized.instructionHash);
    assert.deepEqual(Array.from(await signer.collectedSigners(first)), [a.address, c.address]);
    // Historical signed work must survive downtime longer than the former 4000-block log window.
    await provider.send("anvil_mine", ["0x1001"]);
    await custodian.scan();
    assert.equal(await registry.statusOf(first), BigInt(Status.Settled));
    assert.equal(custodian.settleCount, 1);
    const settled = await registry.getRedemption(first);
    assert.equal(settled.instructionHash, finalized.instructionHash);
    assert.notEqual(settled.settlementRef, '0x' + '00'.repeat(32));
    await custodian.scan();
    assert.equal(custodian.settleCount, 1, 'settlement must not repeat');
    console.log('PASS: real service signatures, rotation, stale-payload rejection, historical getters and custodian settlement');

    await send(compliance.configureAsset(token.target, ZeroAddress, 100));
    const second = await redeem(100);
    assert.equal(await registry.statusOf(second), BigInt(Status.InManualReview));
    await send(breaker.connect(a).voteApprove(second));
    const boardEpoch = await breaker.boardEpoch();
    await send(breaker.setBoard([a.address, c.address], 2));
    assert.equal(await breaker.approveCountOf(second), 0n);
    await assert.rejects(breaker.connect(b).voteApprove.staticCall(second), /NotAuthorized/);
    await send(breaker.connect(a).voteApprove(second));
    assert.equal(await registry.statusOf(second), BigInt(Status.InManualReview));
    await send(breaker.connect(c).voteApprove(second));
    assert.equal(await registry.statusOf(second), BigInt(Status.Approved));
    assert.deepEqual(Array.from(await breaker.votesAtEpoch(second, boardEpoch)), [1n, 0n]);
    await send(breaker.setBoard([b.address], 1));
    assert.equal(await breaker.approveCountOf(second), 2n, 'completed board history survives rotation');
    await services[1].scan();
    assert.equal(await registry.statusOf(second), BigInt(Status.Signed));
    await custodian.scan();
    assert.equal(await registry.statusOf(second), BigInt(Status.Settled));
    assert.equal(custodian.settleCount, 2);
    console.log('PASS: partial board quorum reset, removed voter rejection, retained voter reapproval and second settlement');
    await send(compliance.configureAsset(token.target, ZeroAddress, 0));
    const expired = await redeem(100);
    assert.equal(await registry.statusOf(expired), BigInt(Status.Approved));
    const expiredDeadline = await signer.deadlineFor(expired);
    await provider.send('evm_setNextBlockTimestamp', [Number(expiredDeadline) + 1]);
    await provider.send('evm_mine', []);
    const submittedBefore = services[1].signedCount;
    await services[1].scan();
    assert.equal(services[1].signedCount, submittedBefore, 'expired pending work must not submit');
    assert.equal(await signer.signatureCount(expired), 0n);
    assert.equal(await registry.statusOf(expired), BigInt(Status.Approved), 'expiry has no automatic resolution policy');
    console.log('PASS: historical signed backlog and expired pending instruction suppression');

  } finally {
    for (const provider of providers) provider.destroy();
    if (node.exitCode === null && node.pid) {
      const exited = once(node, 'exit');
      node.kill('SIGTERM');
      const killTimer = setTimeout(() => node.kill('SIGKILL'), 2000);
      await exited;
      clearTimeout(killTimer);
    }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
