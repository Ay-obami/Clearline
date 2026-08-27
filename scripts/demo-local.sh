#!/usr/bin/env bash
#
# Clearline local end-to-end demo (PRD §9.9 rehearsal).
#
# Replays every pipeline path against a running local chain with deployed
# contracts — happy path, KYC-revoked mid-flight rejection path, board
# override-approve path, and the request/lock lifecycle.
#
# Prereqs:
#   1. anvil running ($RPC, default http://127.0.0.1:8545)
#   2. forge script script/Deploy.s.sol:ClearlineDeploy executed once
#   3. addresses saved in ${1:-deployments/local.env}
#      (copy deployments/local.env.example or capture deploy output)
#   4. OPTIONAL: the 3 signer processes + mock custodian running per README.
#      Without them the demo halts at Approved/Flagged — all pre-signing steps
#      remain fully verifiable; final settlement waits for services.
#
set -euo pipefail
cd "$(dirname "$0")/.."

RPC=${RPC:-http://127.0.0.1:8545}
ENV_FILE=${1:-deployments/local.env}
[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE — deploy first and save printed addresses."; exit 1; }
# shellcheck disable=SC1090
source "$ENV_FILE"

# Anvil well-known dev keys (zero value — NEVER use on a real network).
# deployments/local.env may override any of these.
KEEPER_KEY=${KEEPER_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}   # #0
HOLDER_KEY=${HOLDER_KEY:-0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d}    # #1
BOARD_KEY_A=${BOARD_KEY_A:-0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e}  # #6 = 0x976EA740…
BOARD_KEY_B=${BOARD_KEY_B:-0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356}  # #7 = 0x14dC7996…

HOLDER_ADDR=0x70997970C51812dc3A010C7d01b50e0d17dc79C8   # account #1
DEST_REJECT=0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65    # #4 — KYC'd then revoked
DEST_OVERRIDE=0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc  # #9 — never verified

say()  { printf "\n\033[1m=== %s ===\033[0m\n" "$*"; }
step() { printf "  · %s\n" "$*"; }
hexid(){ printf '0x%064x' "$1"; }
to_int(){ printf '%d' "$(( $1 ))"; }                      # hex word -> decimal
next_id(){ local c; c=$(count); printf '%d' $(( c + 1 )); } # id the next trigger will get

REG="$REGISTRY_ADDRESS"
count() { cast call "$REG" "redemptionCount()" --rpc-url "$RPC"; }
status_of() { cast call "$REG" "statusOf(uint256)" "$(hexid "$1")" --rpc-url "$RPC"; }
wait_status() {
  local id=$1 want=$2
  local tries=${3:-${POLL_TRIES:-20}}
  local i s
  for i in $(seq 1 "$tries"); do
    s=$(status_of "$id")
    step "poll$i redemption #$id status=$s"
    case "$s" in *"$want") return 0 ;; esac
    sleep "${POLL_SEC:-5}"
  done
  echo "Timed out waiting for status $want (are services running?)" >&2
  return 1
}

confirm_finality_and_check() { # id_decimal, label
  local idd=$1 idh; idh=$(hexid "$idd")
  cast rpc anvil_mine 15 --rpc-url "$RPC" >/dev/null
  cast send "$REG" "confirmFinality(uint256)" "$idh" \
    --private-key "$KEEPER_KEY" --rpc-url "$RPC" >/dev/null && step "finality confirmed → Requested [$2]"
  cast send "$COMPLIANCE_ADDRESS" "runCheck(uint256)" "$idh" \
    --private-key "$KEEPER_KEY" --rpc-url "$RPC" >/dev/null && step "compliance re-check fired [$2]"
}

burn_to() { # amount_wei destination label
  cast send "$TOKEN_ADDRESS" "approve(address,uint256)" "$DIRECT_BURN_ADAPTER" "$1" \
    --private-key "$HOLDER_KEY" --rpc-url "$RPC" >/dev/null
  cast send "$DIRECT_BURN_ADAPTER" "redeem(uint256,address)" "$1" "$2" \
    --private-key "$HOLDER_KEY" --rpc-url "$RPC" >/dev/null
}

# --------------------------------------------------------------- seed holder
say "Seed: verify holder + re-mint so the demo can repeat"
cast send "$IDENTITY_ADDRESS" "setVerified(address,bool)" "$HOLDER_ADDR" true \
  --private-key "$KEEPER_KEY" --rpc-url "$RPC" >/dev/null && step "holder KYC verified"
cast send "$TOKEN_ADDRESS" "mint(address,uint256)" "$HOLDER_ADDR" "20000ether" \
  --private-key "$KEEPER_KEY" --rpc-url "$RPC" >/dev/null && step "minted 20000 CLRWA"
step "balance: $(cast call "$TOKEN_ADDRESS" "balanceOf(address)" "$HOLDER_ADDR" --rpc-url "$RPC" | cast from-wei)"

# ---------------------------------------------------------------- happy path
say "Path 1 — direct burn, compliant destination, auto-settle (FR1)"
N=$(next_id)   # next registry id this burn will create
AMT="500000000000000000000"
burn_to "$AMT" "$HOLDER_ADDR" && step "burned 500 → redemption #$N triggered"
confirm_finality_and_check "$N" "#$N" "expect Approved"
wait_status "$N" "0007" || true

# ----------------------------------------------------- freshness + reject path
say "Path 2 — compliance freshness at redemption time (FR3): revoke mid-flight"
N=$(next_id); AMT2="100000000000000000000"
cast send "$IDENTITY_ADDRESS" "setVerified(address,bool)" "$DEST_REJECT" true \
  --private-key "$KEEPER_KEY" --rpc-url "$RPC" >/dev/null
burn_to "$AMT2" "$DEST_REJECT" && step "burned 100 toward freshly-verified dest → #$N"
IDH=$(hexid "$N")
cast rpc anvil_mine 15 --rpc-url "$RPC" >/dev/null
cast send "$REG" "confirmFinality(uint256)" "$IDH" --private-key "$KEEPER_KEY" --rpc-url "$RPC" >/dev/null
cast send "$IDENTITY_ADDRESS" "setVerified(address,bool)" "$DEST_REJECT" false \
  --private-key "$KEEPER_KEY" --rpc-url "$RPC" >/dev/null && step "KYC revoked AFTER trigger, BEFORE re-check"
cast send "$COMPLIANCE_ADDRESS" "runCheck(uint256)" "$IDH" --private-key "$KEEPER_KEY" --rpc-url "$RPC" >/dev/null \
  && step "re-check reads CURRENT identity state → expect Flagged"
wait_status "$N" "0004" 10 || true
case "$(status_of "$N")" in
  *"0004")
    cast send "$BREAKER_ADDRESS" "voteReject(uint256)" "$IDH" --private-key "$BOARD_KEY_A" --rpc-url "$RPC" >/dev/null
    cast send "$BREAKER_ADDRESS" "voteReject(uint256)" "$IDH" --private-key "$BOARD_KEY_B" --rpc-url "$RPC" >/dev/null
    step "board rejected 2-of-2 → closed, never signed" ;;
  *) step "unexpected status after re-check: $(status_of "$N")" ;;
esac

# ---------------------------------------------- circuit breaker approve branch
say "Path 3 — manual review override APPROVE (FR7/FR8) recovers the flow"
N=$(next_id); AMT3="75000000000000000000"
burn_to "$AMT3" "$DEST_OVERRIDE" && step "burned 75 toward NEVER-verified dest → #$N"
IDH=$(hexid "$N")
confirm_finality_and_check "$N" "#$N"
wait_status "$N" "0004" 10 || true
case "$(status_of "$N")" in
  *"0004")
    cast send "$BREAKER_ADDRESS" "voteApprove(uint256)" "$IDH" --private-key "$BOARD_KEY_A" --rpc-url "$RPC" >/dev/null
    cast send "$BREAKER_ADDRESS" "voteApprove(uint256)" "$IDH" --private-key "$BOARD_KEY_B" --rpc-url "$RPC" >/dev/null
    step "board approved 2-of-2 → flow resumes automatically"
    wait_status "$N" "0007" || true ;;
  *) step "unexpected status: $(status_of "$N")" ;;
esac

# ----------------------------------------------------------- request / lock
say "Path 4 — request & lock lifecycle (FR2): finalize branch, then cancel branch"
RQL_NEXT=$(cast call "$REQUEST_LOCK_ADAPTER" "nextRequestId()" --rpc-url "$RPC")
AMT4="250000000000000000000"
BAL_PRE=$(cast call "$TOKEN_ADDRESS" "balanceOf(address)" "$HOLDER_ADDR" --rpc-url "$RPC")
cast send "$TOKEN_ADDRESS" "approve(address,uint256)" "$REQUEST_LOCK_ADAPTER" "$AMT4" \
  --private-key "$HOLDER_KEY" --rpc-url "$RPC" >/dev/null
cast send "$REQUEST_LOCK_ADAPTER" "requestRedemption(uint256,address)" "$AMT4" "$HOLDER_ADDR" \
  --private-key "$HOLDER_KEY" --rpc-url "$RPC" >/dev/null && step "requested 250 → locked, non-transferable"
step "balance delta proves custody lock: $BAL_PRE → $(cast call "$TOKEN_ADDRESS" "balanceOf(address)" "$HOLDER_ADDR" --rpc-url "$RPC")"
step "registry entries before finalize (lock alone must trigger nothing): $(count)"
cast send "$REQUEST_LOCK_ADAPTER" "finalizeRedemption(uint256)" "$(to_int "$RQL_NEXT")" \
  --private-key "$HOLDER_KEY" --rpc-url "$RPC" >/dev/null && step "finalize burned + emitted trigger"
N=$(to_int "$(count)")
confirm_finality_and_check "$N" "#$N finalize-branch"
wait_status "$N" "0007" || true

CXL_NEXT=$(cast call "$REQUEST_LOCK_ADAPTER" "nextRequestId()" --rpc-url "$RPC")
CXL_ID=$(to_int "$CXL_NEXT")
cast send "$TOKEN_ADDRESS" "approve(address,uint256)" "$REQUEST_LOCK_ADAPTER" "50000000000000000000" \
  --private-key "$HOLDER_KEY" --rpc-url "$RPC" >/dev/null   # fresh approval: prior ones were exact-amount
cast send "$REQUEST_LOCK_ADAPTER" "requestRedemption(uint256,address)" "50000000000000000000" "$HOLDER_ADDR" \
  --private-key "$HOLDER_KEY" --rpc-url "$RPC" >/dev/null
cast send "$REQUEST_LOCK_ADAPTER" "cancelRequest(uint256)" "$CXL_ID" \
  --private-key "$HOLDER_KEY" --rpc-url "$RPC" >/dev/null && step "cancel branch: requested 50 then cancelled pre-finalize"
step "cancelled record: $(cast call "$REQUEST_LOCK_ADAPTER" "requests(uint256)" "$CXL_ID" --rpc-url "$RPC" | cut -c1-98)…"
step "registry count after cancel (unchanged): $(count)"

# ------------------------------------------------------------------- summary
say "Final audit trail (FR9) — every redemption, tagged and queryable"
TOTAL=$(to_int "$(count)")
for i in $(seq 1 "$TOTAL"); do
  S=$(status_of "$i"); LBL=None
  case "$S" in
    *"0001") LBL=AwaitingFinality;; *"0002") LBL=Requested;; *"0003") LBL=Approved;;
    *"0004") LBL=Flagged;;      *"0005") LBL=InReview;;  *"0006") LBL=Signed;;
    *"0007") LBL=Settled;;      *"0008") LBL=Rejected;;  *"0009") LBL=Cancelled;;
  esac
  printf "  #%d %-17s\n" "$i" "$LBL"
done
echo
echo "  holder final balance : $(cast call "$TOKEN_ADDRESS" "balanceOf(address)" "$HOLDER_ADDR" --rpc-url "$RPC" | cast from-wei) CLRWA"
echo "  full record example  : cast call $REG 'getRedemption(uint256)' $TOTAL --rpc-url $RPC"
echo
echo "Dashboard: http://localhost:3000/app   (start with: cd frontend && npm run dev)"