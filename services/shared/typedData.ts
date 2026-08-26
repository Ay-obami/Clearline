import { TypedDataDomain, TypedDataField } from "ethers";

/**
 * EIP-712 typed data for the release instruction — MUST match the Solidity
 * struct in src/InstructionSigner.sol exactly:
 *
 *   RedemptionInstruction(bytes32 assetId,address holder,uint256 amount,
 *     address destination,uint8 triggerType,bytes32 sourceEventHash,
 *     bytes32 complianceHash,uint256 nonce,uint256 deadline)
 */
export const instructionTypes: Record<string, TypedDataField[]> = {
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
  ],
};

export function instructionDomain(
  chainId: number,
  verifyingContract: string
): TypedDataDomain {
  return {
    name: "Clearline",
    version: "1",
    chainId,
    verifyingContract,
  };
}

export const settlementTypes = { SettlementConfirmation: [
  { name: "redemptionId", type: "uint256" },
  { name: "settlementRef", type: "bytes32" },
] } as Record<string, TypedDataField[]>;

export function settlementDomain(chainId: number, verifyingContract: string): TypedDataDomain {
  return {
    name: "Clearline",
    version: "1",
    chainId,
    verifyingContract,
  };
}

export const EIP712_VERSION = "1";
export const EIP712_NAME = "Clearline";