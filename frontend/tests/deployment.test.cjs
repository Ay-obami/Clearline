const { test } = require('node:test');
const assert = require('node:assert/strict');
const { deploymentConfig, requireDeploymentReady } = require('../lib/deployment.ts');
const address = '0x1111111111111111111111111111111111111111';
const fields = ['token','registry','identity','directBurn','requestLock','compliance','signer','breaker','settlement'];
const valid = () => ({ chainId: '133', rpcUrl: 'https://testnet.hsk.xyz', ...Object.fromEntries(fields.map(k => [k,address])) });
test('valid deployment preserves supplied addresses', () => assert.equal(deploymentConfig(valid()).ready,true));
for(const value of [undefined,'0x','0x0000000000000000000000000000000000000000',address+'\\n']) {
  test(`missing, zero or malformed address fails closed: ${value}`, () => {
    const c=deploymentConfig({...valid(),token:value}); assert.equal(c.ready,false); assert.equal(c.token,undefined);
  });
}
for(const chainId of [undefined,'0','-1','wat','133.5','1']) {
  test(`invalid or unsupported chain fails closed: ${chainId}`, () => assert.equal(deploymentConfig({...valid(),chainId}).ready,false));
}
test('invalid RPC fails closed', () => assert.equal(deploymentConfig({...valid(),rpcUrl:'file:///tmp/rpc'}).ready,false));
test('signer version 1 blocks transactions', () => assert.throws(() => requireDeploymentReady(deploymentConfig(valid()),'1',133),/version 2/i));
test('missing version and wrong wallet chain block transactions', () => {
  assert.throws(() => requireDeploymentReady(deploymentConfig(valid()),undefined,133),/version 2/i);
  assert.throws(() => requireDeploymentReady(deploymentConfig(valid()),'2',177),/chain/i);
});
test('version 2 on configured chain enables transactions', () => assert.doesNotThrow(() => requireDeploymentReady(deploymentConfig(valid()),'2',133)));

for (const field of fields) {
  test(`missing ${field} blocks all actions`, () => assert.throws(() => requireDeploymentReady(deploymentConfig({...valid(),[field]:undefined}),'2',133),/unconfigured/i));
}
for (const chainId of ['177','31337']) {
  test(`explicit deployment supports chain ${chainId}`, () => assert.equal(deploymentConfig({...valid(),chainId}).ready,true));
}
