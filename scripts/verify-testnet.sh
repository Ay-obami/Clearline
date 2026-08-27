#!/usr/bin/env bash
#
# Verify all Clearline testnet deployments on the Blockscout explorer.
#
#   ./scripts/verify-testnet.sh            # submits all contracts
#   ./scripts/verify-testnet.sh --check     # prints GUID statuses for resubmission
#
set -euo pipefail
cd "$(dirname "$0")/.."
source deployments/testnet.env

VERIFIER_URL=https://testnet-explorer.hskchain.net/api
DEPLOYER=0xF40003d36567478489BcCF1a1fEd094f87EeC9a5

verify() {
  local addr=$1 contract=$2 args=${3:-}
  echo "== $contract @ $addr"
  # shellcheck disable=SC2086
  forge verify-contract "$addr" "$contract" \
    --verifier blockscout --verifier-url "$VERIFIER_URL" \
    --chain 133 ${args:+--constructor-args "$args"} 2>&1 | grep -E "Response|GUID|already|error|Error" | head -3 || true
}

# Registry (constructor: owner)
verify "$REGISTRY_ADDRESS" src/RedemptionRegistry.sol:RedemptionRegistry "$(cast abi-encode 'constructor(address)' "$DEPLOYER")"
# MockIdentityRegistry (constructor: owner)
verify "$IDENTITY_ADDRESS" src/mocks/MockIdentityRegistry.sol:MockIdentityRegistry "$(cast abi-encode 'constructor(address)' "$DEPLOYER")"
# MockRWAToken (constructor: name, symbol, owner)
verify "$TOKEN_ADDRESS" src/mocks/MockRWAToken.sol:MockRWAToken "$(cast abi-encode 'constructor(string,string,address)' 'Clearline RWA Token' 'CLRWA' "$DEPLOYER")"
# DirectBurnAdapter (constructor: asset, registry)
verify "$DIRECT_BURN_ADAPTER" src/adapters/DirectBurnAdapter.sol:DirectBurnAdapter "$(cast abi-encode 'constructor(address,address)' "$TOKEN_ADDRESS" "$REGISTRY_ADDRESS")"
# RequestLockAdapter (constructor: asset, registry)
verify "$REQUEST_LOCK_ADAPTER" src/adapters/RequestLockAdapter.sol:RequestLockAdapter "$(cast abi-encode 'constructor(address,address)' "$TOKEN_ADDRESS" "$REGISTRY_ADDRESS")"
# ComplianceRecheck (constructor: registry, identity)
verify "$COMPLIANCE_ADDRESS" src/ComplianceRecheck.sol:ComplianceRecheck "$(cast abi-encode 'constructor(address,address)' "$REGISTRY_ADDRESS" "$IDENTITY_ADDRESS")"
# InstructionSigner (constructor: registry, owner)
verify "$SIGNER_ADDRESS" src/InstructionSigner.sol:InstructionSigner "$(cast abi-encode 'constructor(address,address)' "$REGISTRY_ADDRESS" "$DEPLOYER")"
# CircuitBreaker (constructor: registry, owner)
verify "$BREAKER_ADDRESS" src/CircuitBreaker.sol:CircuitBreaker "$(cast abi-encode 'constructor(address,address)' "$REGISTRY_ADDRESS" "$DEPLOYER")"
# SettlementRecorder (constructor: registry, owner)
verify "$SETTLEMENT_ADDRESS" src/SettlementRecorder.sol:SettlementRecorder "$(cast abi-encode 'constructor(address,address)' "$REGISTRY_ADDRESS" "$DEPLOYER")"

echo
echo "Verify status at: $VERIFIER_URL/address/0x..."
echo "Explorer: https://testnet-explorer.hskchain.net/address/0x..."
