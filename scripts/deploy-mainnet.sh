#!/usr/bin/env bash
#
# Clearline mainnet deploy — run ONCE after filling deployments/mainnet.env.
#
#   SKIP_FUND=1  skip the role-wallet gas seeding (if already funded)
#
# Sequence: guards -> balances -> (optional) fund roles -> SIMULATE (no
# broadcast) -> broadcast -> capture contract addresses.
set -euo pipefail
cd "$(dirname "$0")/.."

ENVF="deployments/mainnet.env"
ROLES="deployments/mainnet.roles.env"
for f in "$ENVF" "$ROLES"; do
  [ -f "$f" ] || { echo "FATAL: missing $f"; exit 1; }
done

# Load config + role keys (keys stay local; never echoed)
set -a
# shellcheck disable=SC1090
source "$ENVF"
# shellcheck disable=SC1090
source "$ROLES"
set +a

# ------------------------------------------------------------------ guards
[ -n "${DEPLOYER_KEY:-}" ] || { echo "FATAL: DEPLOYER_KEY is empty — fill $ENVF"; exit 1; }
case "${DEPLOYER_KEY:-}" in 0x[0-9a-fA-F]*) ;; *) echo "FATAL: DEPLOYER_KEY must be 0x…"; exit 1;; esac
[ "${CONFIRM_MAINNET:-}" = "true" ] || { echo "FATAL: CONFIRM_MAINNET!=true"; exit 1; }

DEPLOYER=$(cast wallet address --private-key "$DEPLOYER_KEY")
CHAIN=$(cast chain-id --rpc-url "$RPC_URL")
echo "deployer: $DEPLOYER"
echo "chain-id: $CHAIN (expect 177)"
[ "$CHAIN" = "177" ] || { echo "FATAL: not HSK mainnet — aborting"; exit 1; }

BAL=$(cast balance "$DEPLOYER" --rpc-url "$RPC_URL")
echo "deployer balance: $(cast from-wei "$BAL") HSK"
[ "$BAL" = "0" ] && { echo "FATAL: deployer has 0 HSK — fund it first"; exit 1; }

# --------------------------------------------------- can we afford it? (dry-run)
export HSK_MAINNET_RPC="$RPC_URL"
echo "== estimating deployment cost (dry-run, no broadcast) =="
SIM_LOG=$(mktemp)
forge script script/Deploy.s.sol:ClearlineDeploy --rpc-url hsk_mainnet > "$SIM_LOG" 2>&1 \
  || { echo "FATAL: deployment simulation failed:"; tail -5 "$SIM_LOG"; rm -f "$SIM_LOG"; exit 1; }
GAS_TOTAL=$(grep -oE 'Estimated total gas used for script: [0-9]+' "$SIM_LOG" | grep -oE '[0-9]+' || true)
GP=$(cast gas-price --rpc-url "$RPC_URL")
if [ -n "$GAS_TOTAL" ]; then
  # big-int math via python3 to avoid 64-bit overflow
  REQUIRED_WEI=$(python3 -c "print($GAS_TOTAL * $GP)")
  REQUIRED_HSK=$(python3 -c "print(f'{$REQUIRED_WEI / 10**18:.6f}')")
  echo "required ≈ $REQUIRED_HSK HSK (${GAS_TOTAL} gas × ${GP} wei)"
  python3 -c "
import sys
bal, req = $BAL, $REQUIRED_WEI
if bal < req:
    print(f'FATAL: deployer balance {bal/10**18:.6f} HSK < required {req/10**18:.6f} HSK — top up the deployer');
    sys.exit(1)
" || { rm -f "$SIM_LOG"; exit 1; }
else
  echo "WARN: could not parse gas estimate — proceeding (simulation passed)."
fi
rm -f "$SIM_LOG"

# ------------------------------------------------- fund role wallets (gas)
if [ "${SKIP_FUND:-0}" != "1" ]; then
  echo "== seeding role wallets =="
  FUNDING_KEY="$DEPLOYER_KEY" RPC_URL="$RPC_URL" AMOUNT_WEI="${AMOUNT_WEI:-2000000000000000}" \
    ./scripts/fund-roles.sh mainnet
fi

# ---------------------------------------------------------- simulate first
export HSK_MAINNET_RPC="$RPC_URL"
echo "== SIMULATE (no broadcast) =="
forge script script/Deploy.s.sol:ClearlineDeploy --rpc-url hsk_mainnet

# ----------------------------------------------------------------- broadcast
echo "== BROADCAST to mainnet (chain 177) =="
forge script script/Deploy.s.sol:ClearlineDeploy --rpc-url hsk_mainnet --broadcast \
  | tee /tmp/mainnet-deploy.log

# ------------------------------------------------------- capture addresses
echo "== contract addresses =="
grep -oE '^(TOKEN_ADDRESS|REGISTRY_ADDRESS|IDENTITY_ADDRESS|DIRECT_BURN_ADAPTER|REQUEST_LOCK_ADAPTER|COMPLIANCE_ADDRESS|SIGNER_ADDRESS|BREAKER_ADDRESS|SETTLEMENT_ADDRESS|ATTESTOR_ADDR|HOLDER_ADDR)=0x[0-9a-fA-F]{40}' \
  /tmp/mainnet-deploy.log | tee deployments/mainnet.addresses.env

echo "DONE — next: frontend env (clearline-mainnet) + Railway services."
