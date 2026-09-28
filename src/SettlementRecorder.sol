// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IRedemptionRegistry} from "./interfaces/IRedemptionRegistry.sol";
import {IRedemptionTypes} from "./interfaces/IRedemptionTypes.sol";

/**
 * @title SettlementRecorder
 * @notice Closes the audit loop (FR14). After off-chain settlement completes on
 * the custodian's normal rails (T+1/T+2 as applicable — NFR4), the custodian
 * service posts a signed confirmation here:
 *
 *   SettlementConfirmation {
 *       uint256 redemptionId;
 *       bytes32 settlementRef;   // custodian reference for the real-world release
 *   }
 *
 * signed with EIP-712 by an authorized custodian attestor key. The signature is
 * verified on-chain against the attestor set before the redemption is marked
 * Settled, so the on-chain record always ends with a cryptographically
 * attributable confirmation rather than an arbitrary write.
 */
contract SettlementRecorder {
    bytes32 public constant SETTLEMENT_TYPEHASH =
        keccak256("SettlementConfirmation(uint256 redemptionId,bytes32 settlementRef)");

    bytes32 public constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    string public constant NAME = "Clearline";
    string public constant VERSION = "1";

    IRedemptionRegistry public immutable registry;

    address public owner;
    mapping(address => bool) public isAttestor;
    uint256 public attestorCount;

    event AttestorUpdated(address indexed attestor, bool enabled);
    event SettlementRecorded(uint256 indexed redemptionId, address indexed attestor, bytes32 settlementRef);

    error NotAuthorized();
    error ZeroAddress();
    error InvalidStatus();
    error UnauthorizedAttestor(address recovered);
    error InvalidSignatureLength();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotAuthorized();
        _;
    }

    constructor(address registry_, address owner_) {
        if (registry_ == address(0)) revert ZeroAddress();
        registry = IRedemptionRegistry(registry_);
        owner = owner_;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        owner = newOwner;
    }

    function setAttestor(address attestor, bool enabled) external onlyOwner {
        if (attestor == address(0)) revert ZeroAddress();
        if (isAttestor[attestor] == enabled) return;
        isAttestor[attestor] = enabled;
        if (enabled) {
            attestorCount++;
        } else {
            attestorCount--;
        }
        emit AttestorUpdated(attestor, enabled);
    }

    /// @dev The exact digest custodian services must sign.
    function settlementDigest(uint256 redemptionId, bytes32 settlementRef)
        public
        view
        returns (bytes32)
    {
        bytes32 domainSeparator = keccak256(
            abi.encode(
                DOMAIN_TYPEHASH,
                keccak256(bytes(NAME)),
                keccak256(bytes(VERSION)),
                block.chainid,
                address(this)
            )
        );
        bytes32 structHash = keccak256(abi.encode(SETTLEMENT_TYPEHASH, redemptionId, settlementRef));
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }

    /**
     * @notice Record custodian-confirmed settlement for a Signed redemption.
     * @param signature 65-byte EIP-712 signature over SettlementConfirmation
     *        by an authorized custodian attestor.
     */
    function confirmSettlement(uint256 redemptionId, bytes32 settlementRef, bytes calldata signature)
        external
    {
        if (settlementRef == bytes32(0)) revert ZeroAddress();
        if (registry.statusOf(redemptionId) != IRedemptionTypes.Status.Signed) revert InvalidStatus();
        if (signature.length != 65) revert InvalidSignatureLength();

        bytes32 digest = settlementDigest(redemptionId, settlementRef);
        address recovered = _recoverSigner(digest, signature);
        if (!isAttestor[recovered]) revert UnauthorizedAttestor(recovered);

        registry.confirmSettlement(redemptionId, settlementRef);
        emit SettlementRecorded(redemptionId, recovered, settlementRef);
    }
/// @dev Extract (v,r,s) from a 65-byte calldata signature and run ecrecover.
    function _recoverSigner(bytes32 digest, bytes calldata sig) internal pure returns (address) {
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 0x20))
            v := byte(0, calldataload(add(sig.offset, 0x40)))
        }
        if (v < 27) v += 27;
        return ecrecover(digest, v, r, s);
    }
}
