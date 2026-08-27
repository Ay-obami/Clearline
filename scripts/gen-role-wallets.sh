#!/usr/bin/env bash
#
# Generate fresh dedicated role wallets for a Clearline deployment.
#
#   ./scripts/gen-role-wallets.sh [testnet|mainnet|<other-label>]
#
# Output: deployments/<label>.roles.env  (mode 600, gitignored)
# Roles emitted:
#   SIGNER_1..3     InstructionSigner set members (threshold configured at deploy)
#   BOARD_A/B       CircuitBreaker board members (override votes)
#   ATTESTOR        SettlementRecorder attestor (custodian relayer)
#   HOLDER          demo token holder / redeemer (testnet only)
#
# SECURITY: private keys are printed once below and stored ONLY in the env
# file above. The file is .gitignored (/deployments/*.env). Back it up to a
# password manager before closing this terminal — this script cannot recover
# keys later. Never reuse these on any other network or project.
set -euo pipefail
cd "$(dirname "$0")/.."

LABEL=${1:?usage: gen-role-wallets.sh <label>}
OUT="deployments/${LABEL}.roles.env"
mkdir -p deployments
umask 077

LABELS=(SIGNER_1 SIGNER_2 SIGNER_3 BOARD_A BOARD_B ATTESTOR HOLDER)

: > "$OUT"
echo "# Clearline role wallets — ${LABEL}" >> "$OUT"
echo "# generated $(date -u '+%Y-%m-%dT%H:%M:%SZ') — SECRET, never commit" >> "$OUT"

printf "\n%-18s %-44s %s\n" "ROLE" "ADDRESS" "PRIVATE KEY (print once)"
echo "-------------------------------------------------------------------------------------------"
for L in "${LABELS[@]}"; do
  J=$(cast wallet new --json)
  ADDR=$(printf '%s' "$J" | grep -oE '"address"[ ]*:[ ]*"0x[0-9a-fA-F]{40}"' | head -1 | grep -oE '0x[0-9a-fA-F]{40}')
  PK=$(printf '%s' "$J" | grep -oE '"private_key"[ ]*:[ ]*"0x[0-9a-fA-F]{64}"' | head -1 | grep -oE '0x[0-9a-fA-F]{64}')
  [ -n "$ADDR" ] && [ -n "$PK" ] || { echo "wallet generation failed for $L"; exit 1; }
  echo "${L}_ADDRESS=$ADDR" >> "$OUT"
  echo "${L}_KEY=$PK"      >> "$OUT"
  printf "%-18s %-44s %s\n" "$L" "$ADDR" "$PK"
done
chmod 600 "$OUT"

cat <<EOF

-------------------------------------------------------------------------------------------
Wrote ${OUT} (mode 600, gitignored).

Next steps:
  1. Fund each ADDRESS with testnet HSK via faucet/bridge (gas only; holder may also receive tokens).
  2. Deploy wiring them in: export SIGNER_ADDRS=<S1>,<S2>,<S3> BOARD_ADDRS=<A>,<B> \\
        ATTESTOR_ADDR=<ATTESTOR> HOLDER=<HOLDER> DEPLOYER_KEY=... \\
        forge script script/Deploy.s.sol:ClearlineDeploy --rpc-url hsk_testnet --broadcast
  3. Signer service i uses PRIVATE_KEY=<Si KEY>; custodian relayer = ATTESTOR key.
  4. Store $OUT in your password manager NOW; delete local copy if you prefer.
EOF