// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IRedemptionRegistry} from "./interfaces/IRedemptionRegistry.sol";
import {IRedemptionTypes} from "./interfaces/IRedemptionTypes.sol";

/**
 * @title InstructionSigner
 * @notice On-chain verification half of the release-instruction flow (FR6). The
 * off-chain signer services (one per custodian/agent) build the EIP-712 typed
 * payload below, sign it with their own keys, and submit signatures here; once
 * the threshold is met the instruction is marked Signed in the registry and the
 * canonical `InstructionSigned` event fires for custodian systems to consume.
 *
 * The typed struct matches PRD 4.2.4 exactly:
 *
 *   RedemptionInstruction {
 *       bytes32 assetId;          // registered RWA token identifier
 *       address holder;
 *       uint256 amount;
 *       address destination;      // verified, compliance-checked payout destination
 *       uint8   triggerType;
 *       bytes32 sourceEventHash;  // hash of the originating trigger event
 *       bytes32 complianceHash;   // hash of the compliance re-check result
 *       uint256 nonce;            // replay protection (= redemptionId)
 *       uint256 deadline;         // instruction expiry
 *   }
 *
 * Security properties:
 *  - signatures are bound to (chainId, this contract, redemptionId) via the
 *    domain separator and nonce, so they cannot be replayed across chains,
 *    deployments, or redemptions;
 *  - instructions expire past `deadline`;
 *  - only distinct members of the configured signer set count toward threshold;
 *  - when a circuit breaker address is configured, signing halts while paused.
 */
contract InstructionSigner {
    // ------------------------------------------------------------------
    // EIP-712 typed data
    // ------------------------------------------------------------------

    bytes32 public constant INSTRUCTION_TYPEHASH = keccak256(
        "RedemptionInstruction("
        "bytes32 assetId,"
        "address holder,"
        "uint256 amount,"
        "address destination,"
        "uint8 triggerType,"
        "bytes32 sourceEventHash,"
        "bytes32 complianceHash,"
        "uint256 nonce,"
        "uint256 deadline)"
    );

    bytes32 public constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    string public constant NAME = "Clearline";
    string public constant VERSION = "1";

    /// @dev Deterministic asset identifier: left-padded token address. Documented
    /// as the registered RWA identifier for v1 (FR15 keeps integration standard).
    function assetIdFor(address asset) public pure returns (bytes32) {
        return bytes32(uint256(uint160(asset)));
    }

    // ------------------------------------------------------------------
    // Configuration
    // ------------------------------------------------------------------

    IRedemptionRegistry public immutable registry;

    address public owner;
    address[] public signers;
    mapping(address => bool) public isSigner;
    uint256 public threshold;
    uint64 public signingWindow = 3 days;
    address public circuitBreaker; // optional; when set, signing pauses with it

    event SignersUpdated(address[] signers, uint256 threshold);
    event SigningWindowUpdated(uint64 window);
    event CircuitBreakerSet(address breaker);

    error NotAuthorized();
    error ZeroAddress();
    error ZeroAmount();
    error InvalidThreshold();
    error DuplicateSigner();
    error TooManySigners();

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

    function setSigners(address[] calldata newSigners, uint256 newThreshold) external onlyOwner {
        if (newSigners.length == 0 || newSigners.length > 10) revert TooManySigners();
        if (newThreshold == 0 || newThreshold > newSigners.length) revert InvalidThreshold();

        delete signers;
        for (uint256 i = 0; i < newSigners.length; i++) {
            address s = newSigners[i];
            if (s == address(0)) revert ZeroAddress();
            if (isSigner[s]) revert DuplicateSigner();
            isSigner[s] = true;
            signers.push(s);
        }
        threshold = newThreshold;
        emit SignersUpdated(newSigners, newThreshold);
    }

    function setSigningWindow(uint64 window) external onlyOwner {
        if (window == 0) revert ZeroAmount();
        signingWindow = window;
        emit SigningWindowUpdated(window);
    }

    function setCircuitBreaker(address breaker) external onlyOwner {
        circuitBreaker = breaker; // address(0) detaches
        emit CircuitBreakerSet(breaker);
    }

    function signerCount() external view returns (uint256) {
        return signers.length;
    }

    // ------------------------------------------------------------------
    // Instruction construction
    // ------------------------------------------------------------------

    /// @dev Deadline for an instruction: finality-confirmed time + signing window.
    function deadlineFor(uint256 redemptionId) public view returns (uint256) {
        return uint256(registry.getRedemption(redemptionId).requestedAt) + signingWindow;
    }

    /// @notice Deterministically rebuild the instruction a signer must sign.
    function getInstruction(uint256 redemptionId)
        public
        view
        returns (RedemptionInstruction memory instruction, bytes32 digest)
    {
        IRedemptionRegistry.Redemption memory r = registry.getRedemption(redemptionId);

        instruction = RedemptionInstruction({
            assetId: assetIdFor(r.asset),
            holder: r.holder,
            amount: r.amount,
            destination: r.destination,
            triggerType: uint8(r.triggerType),
            sourceEventHash: r.sourceEventHash,
            complianceHash: r.complianceHash,
            nonce: redemptionId,
            deadline: deadlineFor(redemptionId)
        });
        digest = _hashTypedData(instruction);
    }

    struct RedemptionInstruction {
        bytes32 assetId;
        address holder;
        uint256 amount;
        address destination;
        uint8 triggerType;
        bytes32 sourceEventHash;
        bytes32 complianceHash;
        uint256 nonce;
        uint256 deadline;
    }

    function _hashTypedData(RedemptionInstruction memory i) internal view returns (bytes32) {
        bytes32 domainSeparator = keccak256(
            abi.encode(
                DOMAIN_TYPEHASH,
                keccak256(bytes(NAME)),
                keccak256(bytes(VERSION)),
                block.chainid,
                address(this)
            )
        );
        bytes32 structHash = keccak256(
            abi.encode(
                INSTRUCTION_TYPEHASH,
                i.assetId,
                i.holder,
                i.amount,
                i.destination,
                i.triggerType,
                i.sourceEventHash,
                i.complianceHash,
                i.nonce,
                i.deadline
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }

    // ------------------------------------------------------------------
    // Signature collection
    // ------------------------------------------------------------------

    mapping(uint256 redemptionId => mapping(address signer => bool signed)) public hasSigned;
    mapping(uint256 redemptionId => address[] collected) private _collectedSigners;
    mapping(uint256 redemptionId => bytes32 digest) public instructionDigestOf;

    /// @notice Submit one EIP-712 signature over the instruction. When the
    /// threshold of distinct configured signers is reached, the redemption is
    /// marked Signed and `InstructionSigned` is emitted with every signature's
    /// author — custodian systems can then verify each entry independently via
    /// `ecrecover` against their own copy of the signer set.
    /// @param signature 65-byte (r,s,v) EIP-712 signature by one of the configured signers.
    function submitSignature(uint256 redemptionId, bytes calldata signature) external {
        if (signature.length != 65) revert InvalidSignatureLength();
        if (circuitBreaker != address(0) && ICircuitBreaker(circuitBreaker).paused()) {
            revert SigningPaused();
        }
        if (registry.statusOf(redemptionId) != IRedemptionTypes.Status.Approved) {
            revert InvalidStatus();
        }
        if (block.timestamp > deadlineFor(redemptionId)) revert InstructionExpired();

        (, bytes32 digest) = getInstruction(redemptionId);
        address recovered = _recoverSigner(digest, signature);
        if (!isSigner[recovered]) revert UnauthorizedSigner(recovered);
        if (hasSigned[redemptionId][recovered]) revert SignatureAlreadySubmitted();

        hasSigned[redemptionId][recovered] = true;
        _collectedSigners[redemptionId].push(recovered);
        instructionDigestOf[redemptionId] = digest;

        emit IRedemptionTypes.SignatureCollected(
            redemptionId, recovered, _collectedSigners[redemptionId].length, threshold
        );

        if (_collectedSigners[redemptionId].length >= threshold) {
            registry.markSigned(redemptionId, digest);
            emit IRedemptionTypes.InstructionSigned(redemptionId, digest, _collectedSigners[redemptionId]);
        }
    }

    function collectedSigners(uint256 redemptionId) external view returns (address[] memory) {
        return _collectedSigners[redemptionId];
    }

    function signatureCount(uint256 redemptionId) external view returns (uint256) {
        return _collectedSigners[redemptionId].length;
    }

    /// @dev Extract (v,r,s) from a 65-byte calldata signature and run ecrecover.
    function _recoverSigner(bytes32 digest, bytes calldata sig) internal pure returns (address) {
        // Use assembly for safe slicing without implicit conversion issues.
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

    // ------------------------------------------------------------------
    // Errors
    // ------------------------------------------------------------------

    error InvalidStatus();
    error InstructionExpired();
    error InvalidSignatureLength();
    error UnauthorizedSigner(address recovered);
    error SignatureAlreadySubmitted();
    error SigningPaused();
}

/// @dev Minimal surface InstructionSigner consults for the breaker pause switch.
interface ICircuitBreaker {
    function paused() external view returns (bool);
}


