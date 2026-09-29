"use strict";
// Minimal ABI fragments for the Clearline contracts the off-chain services touch.
// Keep in sync with src/IRedemptionTypes.sol / registry events.
Object.defineProperty(exports, "__esModule", { value: true });
exports.TriggerType = exports.Status = exports.requestLockAbi = exports.directBurnAbi = exports.tokenAbi = exports.identityAbi = exports.settlementAbi = exports.breakerAbi = exports.signerAbi = exports.registryAbi = void 0;
exports.statusLabel = statusLabel;
exports.triggerLabel = triggerLabel;
exports.registryAbi = [
    "event RedemptionTriggered(uint256 indexed id, address indexed asset, address indexed holder, uint256 amount, address destination, uint8 triggerType, bytes32 sourceEventHash)",
    "event FinalityConfirmed(uint256 indexed id, uint256 triggerBlock, uint256 depth, uint256 confirmedAtBlock)",
    "event RedemptionRequested(uint256 indexed id, address indexed asset, address indexed holder, uint256 amount, address destination, uint8 triggerType)",
    "event ComplianceApproved(uint256 indexed id, bytes32 complianceHash)",
    "event ComplianceFlagged(uint256 indexed id, bytes32 complianceHash, bytes32 reason)",
    "event ManualReviewOpened(uint256 indexed id, bytes32 reason)",
    "event SignatureCollected(uint256 indexed id, address indexed signer, uint256 collected, uint256 threshold)",
    "event InstructionSigned(uint256 indexed id, bytes32 instructionHash, address[] signers)",
    "event SettlementConfirmed(uint256 indexed id, bytes32 settlementRef)",
    "event RedemptionRejected(uint256 indexed id)",
    "event RedemptionCancelled(uint256 indexed id)",
    "function redemptionCount() external view returns (uint256)",
    "function statusOf(uint256 id) external view returns (uint8)",
    "function getRedemption(uint256 id) external view returns (tuple(uint256 id,address asset,address holder,uint256 amount,address destination,uint8 triggerType,bytes32 sourceEventHash,bytes32 complianceHash,bytes32 instructionHash,bytes32 settlementRef,uint64 triggerBlock,uint64 requestedAt,uint64 settledAt,uint8 status))",
    "function holderRedemptions(address h) external view returns (uint256[])",
    "function assetRedemptions(address asset) external view returns (uint256[])",
    "function finalityDepthFor(address asset) external view returns (uint256)"
];
exports.signerAbi = [
    "event SignatureCollected(uint256 indexed id, address indexed signer, uint256 collected, uint256 threshold)",
    "event InstructionSigned(uint256 indexed id, bytes32 instructionHash, address[] signers)",
    "function getInstruction(uint256 id) external view returns (tuple(bytes32 assetId,address holder,uint256 amount,address destination,uint8 triggerType,bytes32 sourceEventHash,bytes32 complianceHash,uint256 nonce,uint256 deadline,uint256 signerEpoch), bytes32 digest)",
    "function submitSignature(uint256 id, bytes calldata sig)",
    "function threshold() external view returns (uint256)",
    "function signers(uint256) external view returns (address)",
    "function isSigner(address) external view returns (bool)",
    "function hasSigned(uint256 id, address account) external view returns (bool)",
    "function VERSION() external view returns (string)",
    "function signingWindow() external view returns (uint64)"
];
exports.breakerAbi = [
    "function voteApprove(uint256 id) external",
    "function voteReject(uint256 id) external",
    "function paused() external view returns (bool)"
];
exports.settlementAbi = [
    "function settlementDigest(uint256 id, bytes32 ref) external view returns (bytes32)",
    "function confirmSettlement(uint256 id, bytes32 ref, bytes sig) external"
];
exports.identityAbi = [
    "function isVerified(address) external view returns (bool)",
    "function setVerified(address,bool) external",
    "function setSanctioned(address,bool) external"
];
exports.tokenAbi = [
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function balanceOf(address) external view returns (uint256)",
    "function mint(address to, uint256 amt) external"
];
exports.directBurnAbi = [
    "function redeem(uint256 amount, address destination) external returns (uint256)",
    "function triggerType() external pure returns (uint8)"
];
exports.requestLockAbi = [
    "function requestRedemption(uint256 amount, address destination) external returns (uint256)",
    "function finalizeRedemption(uint256 requestId) external returns (uint256)",
    "function cancelRequest(uint256 requestId) external",
    "function nextRequestId() external view returns (uint256)",
    "function requests(uint256) external view returns (address holder, uint256 amount, address destination, bool finalized, bool cancelled)"
];
// Status enum values (must match IRedemptionTypes.Status)
exports.Status = {
    None: 0,
    AwaitingFinality: 1,
    Requested: 2,
    Approved: 3,
    Flagged: 4,
    InManualReview: 5,
    Signed: 6,
    Settled: 7,
    Rejected: 8,
    Cancelled: 9,
};
// TriggerType enum values
exports.TriggerType = {
    DirectBurn: 0,
    RequestLock: 1,
    Scheduled: 2,
    IssuerInitiated: 3,
    Threshold: 4,
};
function statusLabel(s) {
    const labels = {
        [exports.Status.None]: "None",
        [exports.Status.AwaitingFinality]: "Awaiting finality",
        [exports.Status.Requested]: "Requested",
        [exports.Status.Approved]: "Approved",
        [exports.Status.Flagged]: "Flagged",
        [exports.Status.InManualReview]: "Manual review",
        [exports.Status.Signed]: "Signed",
        [exports.Status.Settled]: "Settled",
        [exports.Status.Rejected]: "Rejected",
        [exports.Status.Cancelled]: "Cancelled",
    };
    return labels[s] ?? `Unknown(${s})`;
}
function triggerLabel(t) {
    const labels = {
        [exports.TriggerType.DirectBurn]: "Direct burn",
        [exports.TriggerType.RequestLock]: "Request & lock",
        [exports.TriggerType.Scheduled]: "Scheduled",
        [exports.TriggerType.IssuerInitiated]: "Issuer-initiated",
        [exports.TriggerType.Threshold]: "Threshold",
    };
    return labels[t] ?? `Unknown(${t})`;
}
