#!/usr/bin/env node
// Read-only coherence preflight. Dependencies: npm ci --prefix services.
const {JsonRpcProvider, Contract, getAddress, ZeroAddress} = require('../services/node_modules/ethers');
const {readFileSync} = require('node:fs');
const names=['identity','token','registry','directBurn','requestLock','compliance','breaker','signer','settlement'];
function check(ok,message){if(!ok)throw Error(message)}
function address(value,label){try{const a=getAddress(value);check(a!==ZeroAddress,'zero');return a}catch{throw Error(`${label} must be a nonzero Ethereum address`)}}
function integer(value,label){check(Number.isSafeInteger(value)&&value>0,`${label} must be a positive safe integer`);return value}
function validateManifest(m){
 integer(m.chainId,'chainId');check(m.addresses&&typeof m.addresses==='object','addresses is required');
 const addresses=Object.fromEntries(names.map(name=>[name,address(m.addresses[name],name)]));
 check(new Set(Object.values(addresses)).size===names.length,'deployment addresses must be distinct');
 if(m.blockNumber!==undefined)check(Number.isSafeInteger(m.blockNumber)&&m.blockNumber>=0,'blockNumber must be a nonnegative safe integer');
 if(m.finalityDepth!==undefined)integer(m.finalityDepth,'finalityDepth');
 if(m.roles!==undefined){
  check(m.roles&&typeof m.roles==='object','roles must be an object');
  for(const [list,threshold] of [['signers','signerThreshold'],['board','boardThreshold']]){
   if(m.roles[list]!==undefined){check(Array.isArray(m.roles[list])&&m.roles[list].length>0&&m.roles[list].length<=10,`${list} must contain 1..10 addresses`);const members=m.roles[list].map((a,i)=>address(a,`${list}[${i}]`));check(new Set(members).size===members.length,`${list} must be distinct`);integer(m.roles[threshold],threshold);check(m.roles[threshold]<=members.length,`${threshold} exceeds declared membership`)}
   else if(m.roles[threshold]!==undefined)integer(m.roles[threshold],threshold);
  }
  if(m.roles.attestor!==undefined)address(m.roles.attestor,'attestor');
 }
 return addresses;
}
async function verifyDeployment(provider,manifest){
 const a=validateManifest(manifest);
 let network;try{network=await provider.getNetwork()}catch{throw Error('RPC network lookup failed')}
 check(network.chainId===BigInt(manifest.chainId),'RPC chain ID does not match manifest');
 let block;try{block=await provider.getBlock(manifest.blockNumber??'latest')}catch{throw Error('RPC block lookup failed')}
 check(block&&block.hash,'Pinned block is unavailable');const blockTag=block.number;
 const read=async(name,fragment,...args)=>{try{return await new Contract(a[name],[`function ${fragment}`],provider).getFunction(fragment.split('(')[0]).staticCall(...args,{blockTag})}catch{throw Error(`${name}.${fragment.split('(')[0]} read failed at block ${blockTag}`)}};
 const same=async(name,fragment,expected)=>check(getAddress(await read(name,`${fragment}() view returns (address)`))===expected,`${name}.${fragment} wiring mismatch`);
 for(const name of names){let code;try{code=await provider.getCode(a[name],blockTag)}catch{throw Error(`${name} bytecode lookup failed`)}check(code!=='0x',`${name} has no code at pinned block`)}
 check(await read('signer','VERSION() view returns (string)')==='2','InstructionSigner VERSION must be 2');
 for(const [getter,target] of [['complianceModule','compliance'],['circuitBreaker','breaker'],['instructionSigner','signer'],['settlementRecorder','settlement']])await same('registry',getter,a[target]);
 for(const name of ['compliance','breaker','signer','settlement'])await same(name,'registry',a.registry);
 await same('signer','circuitBreaker',a.breaker);
 for(const name of ['directBurn','requestLock']){await same(name,'asset',a.token);await same(name,'redemptionRegistry',a.registry);check(await read('registry','adapters(address) view returns (bool)',a[name]),`${name} is not a registered adapter`)}
 await same('token','identityRegistry',a.identity);await same('compliance','defaultIdentity',a.identity);
 const roleReport={};
 for(const [name,getter,list,threshold,membership,array] of [['signer','threshold','signers','signerThreshold','isSigner','signers'],['breaker','overrideThreshold','board','boardThreshold','isBoardMember','board']]){
  const quorum=await read(name,`${getter}() view returns (uint256)`);check(quorum>0n,`${name} quorum must be positive`);roleReport[threshold]=quorum.toString();
  if(manifest.roles?.[threshold]!==undefined)check(quorum===BigInt(manifest.roles[threshold]),`${name} quorum does not match manifest`);
  if(manifest.roles?.[list]){
   const members=manifest.roles[list].map(getAddress);check(quorum<=BigInt(members.length),`${name} quorum exceeds declared members`);
   for(let i=0;i<members.length;i++){check(await read(name,`${membership}(address) view returns (bool)`,members[i]),`${name} declared member is unauthorized`);check(getAddress(await read(name,`${array}(uint256) view returns (address)`,i))===members[i],`${name} member array differs from manifest`)}
   // These public arrays expose no length getter: index equal to the declared count must revert (compiler-generated getter uses an empty-data revert).
   let exhausted=false;
   try { await new Contract(a[name],[`function ${array}(uint256) view returns (address)`],provider).getFunction(array).staticCall(members.length,{blockTag}); }
   catch(error) {
    exhausted=error.code==='CALL_EXCEPTION'&&typeof error.data==='string'&&(error.data==='0x'||error.data.toLowerCase()==='0x4e487b71'+'0'.repeat(62)+'32');
    check(exhausted,`${name} membership-length check failed without expected array-bound revert`);
   }
   check(exhausted,`${name} has undeclared additional members`);
  }
 }
 const attestorCount=await read('settlement','attestorCount() view returns (uint256)');check(attestorCount>0n,'settlement has no authorized attestor');roleReport.attestorCount=attestorCount.toString();
 if(manifest.roles?.attestor)check(await read('settlement','isAttestor(address) view returns (bool)',getAddress(manifest.roles.attestor)),'declared attestor is unauthorized');
 const finalityDepth=await read('registry','finalityDepthFor(address) view returns (uint256)',a.token);
 if(manifest.finalityDepth!==undefined)check(finalityDepth===BigInt(manifest.finalityDepth),'finality depth differs from manifest');
 let again;try{again=await provider.getBlock(blockTag)}catch{throw Error('Pinned block recheck failed')}check(again&&again.hash===block.hash,'Pinned block changed during preflight; retry');
 return {ok:true,chainId:manifest.chainId,blockNumber:blockTag,blockHash:block.hash,addresses:a,roles:roleReport,finalityDepth:finalityDepth.toString(),scope:'Read-only code presence and configuration coherence; not bytecode or asset certification.'};
}
async function main(){const [file,rpcUrl]=process.argv.slice(2);check(file&&rpcUrl,'Usage: node scripts/verify-deployment.cjs MANIFEST.json RPC_URL');let provider;try{provider=new JsonRpcProvider(rpcUrl,undefined,{cacheTimeout:-1});console.log(JSON.stringify(await verifyDeployment(provider,JSON.parse(readFileSync(file,'utf8'))),null,2))}finally{provider?.destroy()}}
module.exports={verifyDeployment,validateManifest};
if(require.main===module)main().catch(error=>{console.error(`Deployment preflight failed: ${error.message}`);process.exitCode=1});
