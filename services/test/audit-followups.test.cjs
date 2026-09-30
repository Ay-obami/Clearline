const test = require('node:test');
const assert = require('node:assert/strict');
const { ClearlineSigner } = require('../dist/signer/src/signer.js');
const { MockCustodian } = require('../dist/custodian/src/custodian.js');
const valid={rpcUrl:'http://localhost:8545',privateKey:'0x'+'01'.repeat(32),registryAddress:'0x'+'11'.repeat(20),signerContract:'0x'+'22'.repeat(20),settlementAddress:'0x'+'33'.repeat(20),chainId:31337};
test('constructors reject invalid network and numeric configuration before polling',()=>{
 for(const C of [ClearlineSigner,MockCustodian]) {
  for(const chainId of [NaN,0,-1,1.5,Infinity,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>new C({...valid,chainId}),/chainId/);
  assert.throws(()=>new C({...valid,registryAddress:'bad-address'}),/registryAddress/);
 }
 for(const delayMs of [-1,NaN,Infinity,1.5])assert.throws(()=>new MockCustodian({...valid,delayMs}),/delayMs/);
});
test('expired pending work does not submit signatures and chain timestamp is authoritative',async()=>{
 const service=Object.create(ClearlineSigner.prototype);let submissions=0;
 Object.assign(service,{registry:{statusOf:async()=>3},wallet:{address:valid.registryAddress,provider:{getBlock:async()=>({timestamp:101})},signTypedData:async()=>{throw Error('must not sign expired work')}},signerContract:{isSigner:async()=>true,hasSigned:async()=>false,getAddress:async()=>valid.signerContract,getInstruction:async()=>[{deadline:100n}],submitSignature:async()=>{submissions++}}});
 await service.trySign(1n);assert.equal(submissions,0);
});
function custodianFixture(){const service=Object.create(MockCustodian.prototype);Object.assign(service,{nextRedemptionId:1n,scanning:false,registry:{redemptionCount:async()=>3n,runner:{provider:{getBlockNumber:async()=>10000}}},signerContract:{filters:{InstructionSigned:()=>{}},queryFilter:async()=>[]}});return service;}
test('custodian rediscovers historical Signed IDs and isolates failed work',async()=>{
 const service=custodianFixture(),visited=[];service.process=async id=>{visited.push(id);if(id===1n)throw Error('expected failure')};
 await service.scan();assert.deepEqual(visited,[1n,2n,3n]);visited.length=0;await service.scan();assert.deepEqual(visited,[1n,2n,3n]);
});
test('custodian scans cannot overlap delayed settlement',async()=>{
 const service=custodianFixture();let release,reads=0;service.registry.redemptionCount=async()=>{reads++;await new Promise(r=>release=r);return 0n};
 const first=service.scan();await Promise.resolve();await service.scan();assert.equal(reads,1);release();await first;
});
test('custodian sweep is bounded and keeps IDs as bigint',async()=>{
 const service=custodianFixture(),visited=[];service.registry.redemptionCount=async()=>9007199254741050n;service.nextRedemptionId=9007199254740993n;service.process=async id=>visited.push(id);
 await service.scan();assert.equal(visited.length,50);assert.equal(visited[0],9007199254740993n);assert.equal(visited.at(-1),9007199254741042n);
});
const {envInteger,verifyChain}=require('../dist/shared/config.js');
test('environment parsing rejects empty, fractional and coercible values',()=>{
 const previous=process.env.CLEARLINE_TEST_NUMBER;
 try {for(const value of ['', ' ', '1e3','0x10','-1','1.5','Infinity']){process.env.CLEARLINE_TEST_NUMBER=value;assert.throws(()=>envInteger('CLEARLINE_TEST_NUMBER',4000,1),/CLEARLINE_TEST_NUMBER/)}
 process.env.CLEARLINE_TEST_NUMBER='4000';assert.equal(envInteger('CLEARLINE_TEST_NUMBER',1),4000);
 }finally{if(previous===undefined)delete process.env.CLEARLINE_TEST_NUMBER;else process.env.CLEARLINE_TEST_NUMBER=previous}
});
test('startup rejects an RPC chain that differs from signing domain',async()=>{
 await assert.rejects(verifyChain({provider:{getNetwork:async()=>({chainId:1n})}},133),/does not match/);
 await verifyChain({provider:{getNetwork:async()=>({chainId:133n})}},133);
});
test('custodian rechecks Signed state after delay before submitting',async()=>{
 const service=Object.create(MockCustodian.prototype);let reads=0;
 Object.assign(service,{delayMs:0,registry:{statusOf:async()=>++reads===1?6:8},settlement:{settlementDigest:async()=>{throw Error('must not settle rejected work')}}});
 await service.process(1n);assert.equal(reads,2);
});
test('unknown service role fails before loading a signing process',()=>{
 const {spawnSync}=require('node:child_process');
 const result=spawnSync(process.execPath,['dist/scripts/start.js'],{cwd:require('node:path').resolve(__dirname,'..'),env:{...process.env,SERVICE_ROLE:'custodain'},encoding:'utf8'});
 assert.notEqual(result.status,0);assert.match(result.stderr,/SERVICE_ROLE must be signer or custodian/);assert.doesNotMatch(result.stderr,/Missing required env/);
});
