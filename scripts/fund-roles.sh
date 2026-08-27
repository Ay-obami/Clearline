#!/usr/bin/env bash
#
# Seed a small amount of native HSK into every generated role wallet so the
# signer services and custodian relayer can transact after wiring.
#
#   FUNDING_KEY=0x... ./scripts/fund-roles.sh [testnet|mainnet|<label>]
#   AMOUNT_WEI=2000000000000000 RPC_URL=https://testnet.hsk.xyz
#
set -euo pipefail
cd "$(dirname "$0")/.."

LABEL=${1:?usage: fund-roles.sh <label>}
ENVF="deployments/${LABEL}.roles.env"
[ -f "$ENVF" ] || { echo "missing $ENVF"; exit 1; }
# shellcheck disable=SC1090
source "$ENVF"
: "${FUNDING_KEY:?export FUNDING_KEY=<funded wallet private key>}"
RPC_URL=${RPC_URL:-https://testnet.hsk.xyz}
AMOUNT_WEI=${AMOUNT_WEI:-2000000000000000}   # 0.002 HSK default

ROLES=(
  SIGNER_1_ADDRESS SIGNER_2_ADDRESS SIGNER_3_ADDRESS
  BOARD_A_ADDRESS BOARD_B_ADDRESS ATTESTOR_ADDRESS HOLDER_ADDRESS
)

echo "Seeding $(printf '%d' $(( AMOUNT_WEI ))) wei to ${#ROLES[@]} role wallets on chain @ $RPC_URL"
for R in "${ROLES[@]}"; do
  A=${!R}
  cast send "$A" --value "$AMOUNT_WEI" --private-key "$FUNDING_KEY" \
    --rpc-url "$RPC_URL" >/dev/null && printf "  funded %-18s %s\n" "${R%_ADDRESS}" "$A"
done

echo
echo "Balances:"
for R in "${ROLES[@]}"; do
  A=${!R}
  B=$(cast balance "$A" --rpc-url "$RPC_URL")
  printf "  %-18s %-44s %s HSK\n" "${R%_ADDRESS}" "$A" "$(cast from-wei "$B")"
done

B=$(cast balance "$(cast wallet address --private-key "$FUNDING_KEY")" --rpc-url "$RPC_URL")
printf "  %-18s\n" "funder remaining: $(cast from-wei "$B") HSK"
