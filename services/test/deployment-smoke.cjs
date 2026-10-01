// Broadcast the repository's actual Deploy.s.sol to a disposable, local-only chain.
const assert=require('node:assert/strict');
const {spawn,execFile}=require('node:child_process');
const {promisify}=require('node:util');
const {once}=require('node:events');
const {mkdtempSync,readFileSync,writeFileSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const path=require('node:path');
const {JsonRpcProvider,Wallet}=require('ethers');
const {verifyDeployment}=require('../../scripts/verify-deployment.cjs');
const root=path.resolve(__dirname,'../..');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function runForge(rpcUrl,environment){
 const child=spawn(process.env.FORGE_BIN||'forge',['script','script/Deploy.s.sol:ClearlineDeploy','--rpc-url',rpcUrl,'--broadcast'],{cwd:root,env:{...process.env,...environment},stdio:['ignore','pipe','pipe']});
 // Capture privately; do not print raw tool output or environment on failure.
 let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
 const timer=setTimeout(()=>child.kill('SIGKILL'),120000);
 try{const [code]=await once(child,'exit');assert.equal(code,0,'actual Forge deployment script must exit successfully (output intentionally withheld)')}finally{clearTimeout(timer)}
}
async function main(){
 const work=mkdtempSync(path.join(tmpdir(),'clearline-deployment-'));
 const node=spawn(process.env.ANVIL_BIN||'anvil',['--host','127.0.0.1','--port','0','--chain-id','31337'],{stdio:['ignore','pipe','pipe']});
 let output='',spawnError;node.stdout.on('data',b=>output+=b);node.stderr.on('data',b=>output+=b);node.on('error',e=>spawnError=e);
 let provider;
 try{
  let match;for(let i=0;i<200;i++){if(spawnError)throw Error('Anvil could not start');if(node.exitCode!==null)throw Error('Anvil exited before readiness');match=output.match(/Listening on 127\.0\.0\.1:(\d+)/);if(match)break;await sleep(50)}
  assert.ok(match,'Anvil readiness timeout');const rpcUrl=`http://127.0.0.1:${match[1]}`;
  provider=new JsonRpcProvider(rpcUrl,31337,{cacheTimeout:-1});assert.equal((await provider.getNetwork()).chainId,31337n);
  const deployer=Wallet.createRandom();await provider.send('anvil_setBalance',[deployer.address,'0x56BC75E2D63100000']);
  const roles={signers:Array.from({length:3},()=>Wallet.createRandom().address),board:Array.from({length:2},()=>Wallet.createRandom().address),attestor:Wallet.createRandom().address,signerThreshold:2,boardThreshold:2};
  await runForge(rpcUrl,{DEPLOYER_KEY:deployer.privateKey,SIGNER_COUNT:'3',SIGNER_THRESHOLD:'2',SIGNER_ADDRS:roles.signers.join(','),BOARD_COUNT:'2',BOARD_THRESHOLD:'2',BOARD_ADDRS:roles.board.join(','),ATTESTOR_ADDR:roles.attestor,HOLDER:deployer.address,MINT_AMOUNT:'0',FINALITY_DEPTH:'12',CONFIRM_MAINNET:'false',FOUNDRY_BROADCAST:path.join(work,'broadcast')});
  const broadcast=JSON.parse(readFileSync(path.join(work,'broadcast','Deploy.s.sol','31337','run-latest.json'),'utf8'));
  const map={MockIdentityRegistry:'identity',MockRWAToken:'token',RedemptionRegistry:'registry',DirectBurnAdapter:'directBurn',RequestLockAdapter:'requestLock',ComplianceRecheck:'compliance',CircuitBreaker:'breaker',InstructionSigner:'signer',SettlementRecorder:'settlement'};
  const addresses={};for(const tx of broadcast.transactions){if(tx.transactionType==='CREATE'&&map[tx.contractName])addresses[map[tx.contractName]]=tx.contractAddress}
  assert.equal(Object.keys(addresses).length,9,'actual broadcast contains nine contracts');
  const manifest={chainId:31337,addresses,roles,finalityDepth:12};
  const report=await verifyDeployment(provider,manifest);assert.equal(report.ok,true);
  assert.equal((await verifyDeployment(provider,{...manifest,blockNumber:report.blockNumber})).blockHash,report.blockHash,'explicit pinned block is reproducible');
  const manifestPath=path.join(work,'manifest.json');writeFileSync(manifestPath,JSON.stringify({...manifest,blockNumber:report.blockNumber}));
  const cli=await promisify(execFile)(process.execPath,[path.join(root,'scripts/verify-deployment.cjs'),manifestPath,rpcUrl],{timeout:30000});
  assert.equal(JSON.parse(cli.stdout).blockHash,report.blockHash,'read-only CLI verifies the pinned public manifest');
  console.log('PASS: actual Deploy.s.sol broadcast, nine contracts, module/adapter/pause wiring and declared roles at one pinned block');
  await assert.rejects(verifyDeployment(provider,{...manifest,chainId:133}),/chain ID/);
  await assert.rejects(verifyDeployment(provider,{...manifest,addresses:{...addresses,identity:deployer.address}}),/has no code/);
  await assert.rejects(verifyDeployment(provider,{...manifest,addresses:{...addresses,compliance:addresses.settlement,settlement:addresses.compliance}}),/wiring mismatch/);
  await assert.rejects(verifyDeployment(provider,{...manifest,roles:{...roles,signerThreshold:1}}),/quorum does not match/);
  await assert.rejects(verifyDeployment(provider,{...manifest,roles:{...roles,attestor:deployer.address}}),/attestor is unauthorized/);
  await assert.rejects(verifyDeployment(provider,{...manifest,roles:{...roles,signers:roles.signers.slice(0,2)}}),/undeclared additional members/);
  await assert.rejects(verifyDeployment(provider,{...manifest,finalityDepth:13}),/finality depth differs/);
  await assert.rejects(verifyDeployment(provider,{...manifest,blockNumber:report.blockNumber+1000}),/Pinned block is unavailable/);
  // Deliberately replace only local test code with a VERSION() response of "1".
  await provider.send('anvil_setCode',[addresses.signer,'0x60206000526001602052603160405260606000f3']);await provider.send('evm_mine',[]);
  await assert.rejects(verifyDeployment(provider,manifest),/VERSION must be 2/);
  console.log('PASS: wrong-chain, empty-code, swapped-module, wrong-quorum, undeclared-member, unauthorized-attestor, finality, unavailable-block and v1 negative gates');
 }finally{
  provider?.destroy();if(node.exitCode===null&&node.pid){const exited=once(node,'exit');node.kill('SIGTERM');const timer=setTimeout(()=>node.kill('SIGKILL'),2000);await exited;clearTimeout(timer)}
  rmSync(work,{recursive:true,force:true});
 }
}
main().catch(error=>{console.error(`Deployment smoke failed: ${error.message}`);process.exitCode=1});
