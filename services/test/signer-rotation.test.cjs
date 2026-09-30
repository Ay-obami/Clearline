const test = require('node:test');
const assert = require('node:assert/strict');
const { Wallet, TypedDataEncoder, verifyTypedData } = require('ethers');
const { ClearlineSigner } = require('../dist/signer/src/signer.js');
const { instructionTypes, instructionDomain, settlementDomain } = require('../dist/shared/typedData.js');
const contractAddress = '0x0000000000000000000000000000000000000123';
const wallet = new Wallet('0x' + '01'.repeat(32)); // deterministic test-only key
const instruction = {assetId:'0x'+'11'.repeat(32),holder:wallet.address,amount:100n,destination:wallet.address,triggerType:0,sourceEventHash:'0x'+'22'.repeat(32),complianceHash:'0x'+'33'.repeat(32),nonce:1n,deadline:100000n,signerEpoch:2n};
function fixture({member=true, signed=false, version='2'}={}) {
  const service=Object.create(ClearlineSigner.prototype);
  const submitted=[];
  Object.assign(service,{registry:{statusOf:async()=>3,runner:{provider:{getBlockNumber:async()=>10000}},queryFilter:async()=>[],filters:{RedemptionRequested:()=>"request"}},wallet:{address:wallet.address,signTypedData:wallet.signTypedData.bind(wallet),provider:{getBlock:async()=>({timestamp:100})}},chainId:133,signedCount:0,nextRedemptionId:1n,scanning:false,signerContract:{
    VERSION:async()=>version,isSigner:async()=>member,hasSigned:async()=>signed,getAddress:async()=>contractAddress,
    getInstruction:async()=>[instruction,TypedDataEncoder.hash(instructionDomain(133,contractAddress),instructionTypes,instruction)],
    submitSignature:async(id,signature)=>{submitted.push({id,signature});return {wait:async()=>({hash:'test-tx'})};}
  }});
  return {service,submitted};
}
test('signer refuses the v1 deployment before starting polling',async()=>{
 const {service}=fixture({version:'1'});
 await assert.rejects(service.start(),/requires the Clearline v2/);
});
test('removed signer does not submit',async()=>{
 const {service,submitted}=fixture({member:false});await service.trySign(1);assert.equal(submitted.length,0);
});
test('already-collected signer does not repeatedly submit',async()=>{
 const {service,submitted}=fixture({signed:true});await service.trySign(1);assert.equal(submitted.length,0);
});
test('current epoch reaches the signed EIP-712 payload',async()=>{
 const {service,submitted}=fixture();await service.trySign(1);assert.equal(submitted.length,1);
 const domain=instructionDomain(133,contractAddress);
 assert.equal(verifyTypedData(domain,instructionTypes,instruction,submitted[0].signature),wallet.address);
 assert.notEqual(verifyTypedData(domain,instructionTypes,{...instruction,signerEpoch:1n},submitted[0].signature),wallet.address);
 assert.equal(settlementDomain(133,contractAddress).version,'1');
});

test('registry sweep discovers pending IDs without relying on recent event logs',async()=>{
 const {service}=fixture();const visited=[];
 service.registry.redemptionCount=async()=>55n;
 service.trySign=async id=>{visited.push(id)};
 await service.scan();assert.equal(visited.length,50);assert.equal(visited[0],1n);assert.equal(visited.at(-1),50n);
 visited.length=0;await service.scan();assert.deepEqual(visited,[51n,52n,53n,54n,55n]);
 visited.length=0;await service.scan();assert.equal(visited[0],1n);
});
test('a failing redemption does not starve later IDs',async()=>{
 const {service}=fixture();const visited=[];
 service.registry.redemptionCount=async()=>3n;
 service.trySign=async id=>{visited.push(id);if(id===1n)throw Error('test failure')};
 await service.scan();assert.deepEqual(visited,[1n,2n,3n]);
});
test('a slow scan cannot overlap another polling tick',async()=>{
 const {service}=fixture();let release;let reads=0;
 service.registry.redemptionCount=async()=>{reads++;await new Promise(resolve=>{release=resolve});return 0n};
 const first=service.scan();await Promise.resolve();await service.scan();assert.equal(reads,1);release();await first;
});
test('deadline equality remains signable, matching Solidity boundary',async()=>{
 const {service,submitted}=fixture();service.wallet.provider.getBlock=async()=>({timestamp:100000});
 await service.trySign(1n);assert.equal(submitted.length,1);
});
test('missing latest block prevents signing with an unknown expiry',async()=>{
 const {service,submitted}=fixture();service.wallet.provider.getBlock=async()=>null;
 await assert.rejects(service.trySign(1n),/Latest chain block is unavailable/);assert.equal(submitted.length,0);
});
