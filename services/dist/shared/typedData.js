"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EIP712_NAME = exports.EIP712_VERSION = exports.settlementTypes = exports.instructionTypes = void 0;
exports.instructionDomain = instructionDomain;
exports.settlementDomain = settlementDomain;
/**
 * EIP-712 typed data for the release instruction — MUST match the Solidity
 * struct in src/InstructionSigner.sol exactly:
 *
 *   RedemptionInstruction(bytes32 assetId,address holder,uint256 amount,
 *     address destination,uint8 triggerType,bytes32 sourceEventHash,
 *     bytes32 complianceHash,uint256 nonce,uint256 deadline,uint256 signerEpoch)
 */
exports.instructionTypes = {
    RedemptionInstruction: [
        { name: "assetId", type: "bytes32" },
        { name: "holder", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "destination", type: "address" },
        { name: "triggerType", type: "uint8" },
        { name: "sourceEventHash", type: "bytes32" },
        { name: "complianceHash", type: "bytes32" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
        { name: "signerEpoch", type: "uint256" },
    ],
};
function instructionDomain(chainId, verifyingContract) {
    return {
        name: "Clearline",
        version: "2",
        chainId,
        verifyingContract,
    };
}
exports.settlementTypes = { SettlementConfirmation: [
        { name: "redemptionId", type: "uint256" },
        { name: "settlementRef", type: "bytes32" },
    ] };
function settlementDomain(chainId, verifyingContract) {
    return {
        name: "Clearline",
        version: "1",
        chainId,
        verifyingContract,
    };
}
// Release-instruction version; settlement confirmations remain version 1.
exports.EIP712_VERSION = "2";
exports.EIP712_NAME = "Clearline";
