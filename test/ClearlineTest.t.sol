// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/RedemptionRegistry.sol";
import "../src/ComplianceRecheck.sol";
import "../src/InstructionSigner.sol";
import "../src/CircuitBreaker.sol";
import "../src/SettlementRecorder.sol";
import "../src/adapters/DirectBurnAdapter.sol";
import "../src/adapters/RequestLockAdapter.sol";
import "../src/mocks/MockIdentityRegistry.sol";
import "../src/mocks/MockRWAToken.sol";

/// @dev Simple sanctions reference for exercising the second-resource path.
contract MockSanctions is ISanctionsReference {
    mapping(address => bool) public sanctioned;
    function set(address a, bool b) external { sanctioned[a] = b; }
    function isSanctioned(address account) external view override returns (bool) {
        return sanctioned[account];
    }
}

contract ClearlineTest is Test {
    // ------------------------------------------------------------------
    // Core contracts
    // ------------------------------------------------------------------
    RedemptionRegistry public registry;
    MockIdentityRegistry public idRegistry;
    MockRWAToken public token;
    DirectBurnAdapter public directBurn;
    RequestLockAdapter public requestLock;
    ComplianceRecheck public compliance;
    InstructionSigner public signer;
    CircuitBreaker public breaker;
    SettlementRecorder public settlement;

    // ------------------------------------------------------------------
    // Keys & accounts (private keys known so vm.sign works)
    // ------------------------------------------------------------------
    uint256 constant PK_OWNER   = 0xA11CE;
    uint256 constant PK_ALICE   = 0xA11CE1;
    uint256 constant PK_BOB     = 0xB0B;
    uint256 constant PK_SIG1    = 0x511;
    uint256 constant PK_SIG2    = 0x522;
    uint256 constant PK_SIG3    = 0x533;
    uint256 constant PK_BOARD1  = 0xB0A401;
    uint256 constant PK_BOARD2  = 0xB0A402;
    uint256 constant PK_ATTEST  = 0xA77E;
    uint256 constant PK_STR     = 0x573;

    address owner        = vm.addr(PK_OWNER);
    address alice        = vm.addr(PK_ALICE);
    address bob          = vm.addr(PK_BOB);
    address signer1      = vm.addr(PK_SIG1);
    address signer2      = vm.addr(PK_SIG2);
    address signer3      = vm.addr(PK_SIG3);
    address boardMember1 = vm.addr(PK_BOARD1);
    address boardMember2 = vm.addr(PK_BOARD2);
    address attestor     = vm.addr(PK_ATTEST);
    address stranger     = vm.addr(PK_STR);

    uint256 constant FINALITY_DEPTH = 2;
    uint256 constant MINT_AMOUNT    = 1000 ether;
    uint256 constant REDEEM_AMOUNT  = 100 ether;

    // ------------------------------------------------------------------
    // Setup
    // ------------------------------------------------------------------
    function setUp() public {
        vm.startPrank(owner);

        idRegistry = new MockIdentityRegistry(owner);

        token = new MockRWAToken("CLRWA", "CLRWA", owner);
        token.setIdentityRegistry(address(idRegistry));
        token.addAgent(owner);

        registry = new RedemptionRegistry(owner);
        registry.setDefaultFinalityDepth(FINALITY_DEPTH);

        directBurn = new DirectBurnAdapter(address(token), address(registry));
        requestLock = new RequestLockAdapter(address(token), address(registry));
        registry.setAdapter(address(directBurn), true);
        registry.setAdapter(address(requestLock), true);

        compliance = new ComplianceRecheck(address(registry), address(idRegistry));
        registry.setComplianceModule(address(compliance));

        signer = new InstructionSigner(address(registry), owner);
        address[] memory sigs = new address[](3);
        sigs[0] = signer1; sigs[1] = signer2; sigs[2] = signer3;
        signer.setSigners(sigs, 2);
        registry.setInstructionSigner(address(signer));

        breaker = new CircuitBreaker(address(registry), owner);
        address[] memory board = new address[](2);
        board[0] = boardMember1; board[1] = boardMember2;
        breaker.setBoard(board, 2);
        registry.setCircuitBreaker(address(breaker));

        settlement = new SettlementRecorder(address(registry), owner);
        settlement.setAttestor(attestor, true);
        registry.setSettlementRecorder(address(settlement));

        // Verify holder accounts and **adapters** in the identity registry
        // (adapters need isVerified=true because MockRWAToken._transfer checks
        //  both sender and recipient every time)
        idRegistry.setVerified(alice, true);
        idRegistry.setVerified(bob, true);
        idRegistry.setVerified(address(directBurn), true);
        idRegistry.setVerified(address(requestLock), true);

        vm.stopPrank();

        vm.prank(owner);
        token.mint(alice, MINT_AMOUNT);
    }

    // ==================================================================
    // 1. DIRECT-BURN HAPPY PATH
    // ==================================================================
    function test_DirectBurn_HappyPath() public {
        vm.prank(alice);
        token.approve(address(directBurn), REDEEM_AMOUNT);

        vm.prank(alice);
        uint256 id = directBurn.redeem(REDEEM_AMOUNT, bob);

        assertEq(id, 1, "first redemption");
        assertEq(uint8(registry.statusOf(id)), uint8(IRedemptionTypes.Status.AwaitingFinality));

        vm.roll(block.number + FINALITY_DEPTH);
        registry.confirmFinality(id);
        assertEq(uint8(registry.statusOf(id)), uint8(IRedemptionTypes.Status.Requested));

        compliance.runCheck(id);
        assertEq(uint8(registry.statusOf(id)), uint8(IRedemptionTypes.Status.Approved));

        _sign(id, PK_SIG1);
        _sign(id, PK_SIG2);
        assertEq(uint8(registry.statusOf(id)), uint8(IRedemptionTypes.Status.Signed));

        _settle(id, keccak256("SETTLEMENT-123"));
        assertEq(uint8(registry.statusOf(id)), uint8(IRedemptionTypes.Status.Settled));

        // Verify full audit record
        IRedemptionRegistry.Redemption memory r = registry.getRedemption(id);
        assertEq(r.holder, alice);
        assertEq(r.amount, REDEEM_AMOUNT);
        assertEq(r.destination, bob);
        assertEq(uint8(r.triggerType), uint8(IRedemptionTypes.TriggerType.DirectBurn));
        assertEq(uint8(r.status), uint8(IRedemptionTypes.Status.Settled));
    }

    // ==================================================================
    // 2. REQUEST-LOCK HAPPY PATH (two-step)
    // ==================================================================
    function test_RequestLock_HappyPath() public {
        vm.prank(alice);
        token.approve(address(requestLock), REDEEM_AMOUNT);

        vm.prank(alice);
        uint256 reqId = requestLock.requestRedemption(REDEEM_AMOUNT, bob);

        assertEq(token.balanceOf(alice), MINT_AMOUNT - REDEEM_AMOUNT);
        assertEq(token.balanceOf(address(requestLock)), REDEEM_AMOUNT);

        vm.prank(alice);
        uint256 id = requestLock.finalizeRedemption(reqId);
        assertEq(id, 1);
        assertEq(uint8(registry.statusOf(id)), uint8(IRedemptionTypes.Status.AwaitingFinality));

        vm.roll(block.number + FINALITY_DEPTH);
        registry.confirmFinality(id);
        compliance.runCheck(id);
        _sign(id, PK_SIG1);
        _sign(id, PK_SIG2);
        _settle(id, keccak256("REF-REQ-LOCK"));

        IRedemptionRegistry.Redemption memory r = registry.getRedemption(id);
        assertEq(uint8(r.triggerType), uint8(IRedemptionTypes.TriggerType.RequestLock));
        assertEq(uint8(r.status), uint8(IRedemptionTypes.Status.Settled));
        assertEq(token.balanceOf(address(requestLock)), 0);
        assertEq(token.totalSupply(), MINT_AMOUNT - REDEEM_AMOUNT);
    }

    // ==================================================================
    // 3. FINALITY DEPTH ENFORCEMENT (FR5, NFR3)
    // ==================================================================
    function test_Finality_TooEarlyReverts() public {
        vm.prank(alice);
        token.approve(address(directBurn), REDEEM_AMOUNT);
        vm.prank(alice);
        uint256 id = directBurn.redeem(REDEEM_AMOUNT, alice);

        vm.roll(block.number + FINALITY_DEPTH - 1);
        vm.expectRevert(
            abi.encodeWithSelector(RedemptionRegistry.FinalityNotReached.selector, id, block.number, block.number + 1)
        );
        registry.confirmFinality(id);
    }

    function test_Finality_DifferentDepthsPerAsset() public {
        vm.prank(owner);
        registry.setAssetFinalityDepth(address(token), 5);

        vm.prank(alice);
        token.approve(address(directBurn), REDEEM_AMOUNT);
        vm.prank(alice);
        uint256 id = directBurn.redeem(REDEEM_AMOUNT, alice);

        vm.roll(block.number + 2);
        vm.expectRevert();
        registry.confirmFinality(id);

        vm.roll(block.number + 3); // total blocks since trigger: 2+3 = 5
        registry.confirmFinality(id);
    }

    function test_Finality_AlreadyFinalizedReverts() public {
        vm.prank(alice);
        token.approve(address(directBurn), REDEEM_AMOUNT);
        vm.prank(alice);
        uint256 id = directBurn.redeem(REDEEM_AMOUNT, alice);

        vm.roll(block.number + FINALITY_DEPTH);
        registry.confirmFinality(id);

        vm.expectRevert(abi.encodeWithSelector(IRedemptionTypes.InvalidStatus.selector, IRedemptionTypes.Status.Requested));
        registry.confirmFinality(id);
    }

    // ==================================================================
    // 4. COMPLIANCE RE-CHECK (FR3, FR7)
    // ==================================================================
    function test_Compliance_FlaggedWhenNotVerified() public {
        vm.prank(alice);
        token.approve(address(directBurn), REDEEM_AMOUNT);
        vm.prank(alice);
        uint256 id = directBurn.redeem(REDEEM_AMOUNT, alice);

        vm.roll(block.number + FINALITY_DEPTH);
        registry.confirmFinality(id);

        vm.prank(owner);
        idRegistry.setVerified(alice, false);
        compliance.runCheck(id);
        assertEq(uint8(registry.statusOf(id)), uint8(IRedemptionTypes.Status.Flagged));
    }

    function test_Compliance_FlaggedWhenSanctioned() public {
        vm.prank(alice);
        token.approve(address(directBurn), REDEEM_AMOUNT);
        vm.prank(alice);
        uint256 id = directBurn.redeem(REDEEM_AMOUNT, bob);

        vm.roll(block.number + FINALITY_DEPTH);
        registry.confirmFinality(id);

        vm.prank(owner);
        idRegistry.setSanctioned(bob, true);
        compliance.runCheck(id);
        assertEq(uint8(registry.statusOf(id)), uint8(IRedemptionTypes.Status.Flagged));
    }

    function test_Compliance_FlaggedWhenFrozen() public {
        vm.prank(alice);
        token.approve(address(directBurn), REDEEM_AMOUNT);
        vm.prank(alice);
        uint256 id = directBurn.redeem(REDEEM_AMOUNT, alice);

        vm.roll(block.number + FINALITY_DEPTH);
        registry.confirmFinality(id);

        vm.prank(owner);
        idRegistry.setFrozen(alice, true);
        compliance.runCheck(id);
        assertEq(uint8(registry.statusOf(id)), uint8(IRedemptionTypes.Status.Flagged));
    }

    // ==================================================================
    // 5. MANUAL REVIEW / CIRCUIT BREAKER (FR7, FR8)
    // ==================================================================
    function test_ManualReview_ThresholdExceeded() public {
        vm.prank(owner);
        compliance.configureAsset(address(token), address(0), 50 ether);

        vm.prank(alice);
        token.approve(address(directBurn), 100 ether);
        vm.prank(alice);
        uint256 id = directBurn.redeem(100 ether, alice);

        vm.roll(block.number + FINALITY_DEPTH);
        registry.confirmFinality(id);
        compliance.runCheck(id);
        assertEq(uint8(registry.statusOf(id)), uint8(IRedemptionTypes.Status.InManualReview));
    }

    function test_CircuitBreaker_ApproveOverrides() public {
        vm.prank(alice);
        token.approve(address(directBurn), REDEEM_AMOUNT);
        vm.prank(alice);
        uint256 id = directBurn.redeem(REDEEM_AMOUNT, alice);

        vm.roll(block.number + FINALITY_DEPTH);
        registry.confirmFinality(id);

        // Sanction destination to force Flagged
        vm.prank(owner);
        idRegistry.setSanctioned(alice, true);
        compliance.runCheck(id);
        assertEq(uint8(registry.statusOf(id)), uint8(IRedemptionTypes.Status.Flagged));

        // Board approve: 2-of-2
        vm.prank(boardMember1);
        breaker.voteApprove(id);
        // First vote doesn't meet threshold (1 < 2)
        assertEq(uint8(registry.statusOf(id)), uint8(IRedemptionTypes.Status.Flagged));

        vm.prank(boardMember2);
        breaker.voteApprove(id);
        assertEq(uint8(registry.statusOf(id)), uint8(IRedemptionTypes.Status.Approved));
    }

    function test_CircuitBreaker_RejectFlagged() public {
        vm.prank(alice);
        token.approve(address(directBurn), REDEEM_AMOUNT);
        vm.prank(alice);
        uint256 id = directBurn.redeem(REDEEM_AMOUNT, alice);

        vm.roll(block.number + FINALITY_DEPTH);
        registry.confirmFinality(id);

        vm.prank(owner);
        idRegistry.setSanctioned(alice, true);
        compliance.runCheck(id);
        assertEq(uint8(registry.statusOf(id)), uint8(IRedemptionTypes.Status.Flagged));

        vm.prank(boardMember1);
        breaker.voteReject(id);
        vm.prank(boardMember2);
        breaker.voteReject(id);
        assertEq(uint8(registry.statusOf(id)), uint8(IRedemptionTypes.Status.Rejected));
    }

    function test_CircuitBreaker_NonMemberReverts() public {
        vm.prank(alice);
        token.approve(address(directBurn), REDEEM_AMOUNT);
        vm.prank(alice);
        uint256 id = directBurn.redeem(REDEEM_AMOUNT, alice);

        vm.roll(block.number + FINALITY_DEPTH);
        registry.confirmFinality(id);
        vm.prank(owner);
        idRegistry.setSanctioned(alice, true);
        compliance.runCheck(id);

        vm.expectRevert(CircuitBreaker.NotAuthorized.selector);
        vm.prank(stranger);
        breaker.voteApprove(id);
    }

    function test_CircuitBreaker_NoDoubleVote() public {
        vm.prank(alice);
        token.approve(address(directBurn), REDEEM_AMOUNT);
        vm.prank(alice);
        uint256 id = directBurn.redeem(REDEEM_AMOUNT, alice);
        vm.roll(block.number + FINALITY_DEPTH);
        registry.confirmFinality(id);
        vm.prank(owner);
        idRegistry.setSanctioned(alice, true);
        compliance.runCheck(id);

        vm.prank(boardMember1);
        breaker.voteApprove(id);
        vm.expectRevert(CircuitBreaker.AlreadyVoted.selector);
        vm.prank(boardMember1);
        breaker.voteApprove(id);
    }

    // ==================================================================
    // 6. SIGNATURE COLLECTION (FR6)
    // ==================================================================
    function test_Signature_ReplayProtection() public {
        vm.prank(alice);
        token.approve(address(directBurn), REDEEM_AMOUNT);
        vm.prank(alice);
        uint256 id = directBurn.redeem(REDEEM_AMOUNT, alice);
        vm.roll(block.number + FINALITY_DEPTH);
        registry.confirmFinality(id);
        compliance.runCheck(id);

        // Submit signer1's signature (status becomes Approved, 1 of 2)
        _sign(id, PK_SIG1);
        assertEq(uint8(registry.statusOf(id)), uint8(IRedemptionTypes.Status.Approved));

        // Replaying the SAME signer's signature must revert
        (, bytes32 digest) = signer.getInstruction(id);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(PK_SIG1, digest);
        vm.expectRevert(InstructionSigner.SignatureAlreadySubmitted.selector);
        vm.prank(signer1);
        signer.submitSignature(id, abi.encodePacked(r, s, v));
    }

    function test_Signature_UnauthorizedSignerReverts() public {
        vm.prank(alice);
        token.approve(address(directBurn), REDEEM_AMOUNT);
        vm.prank(alice);
        uint256 id = directBurn.redeem(REDEEM_AMOUNT, alice);
        vm.roll(block.number + FINALITY_DEPTH);
        registry.confirmFinality(id);
        compliance.runCheck(id);

        // Stranger is not a configured signer -> UnauthorizedSigner
        (, bytes32 digest) = signer.getInstruction(id);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(PK_STR, digest);
        vm.expectRevert(abi.encodeWithSelector(InstructionSigner.UnauthorizedSigner.selector, stranger));
        vm.prank(stranger);
        signer.submitSignature(id, abi.encodePacked(r, s, v));
    }

    function test_Signature_InvalidLengthReverts() public {
        vm.prank(alice);
        token.approve(address(directBurn), REDEEM_AMOUNT);
        vm.prank(alice);
        uint256 id = directBurn.redeem(REDEEM_AMOUNT, alice);
        vm.roll(block.number + FINALITY_DEPTH);
        registry.confirmFinality(id);
        compliance.runCheck(id);

        vm.prank(signer1);
        vm.expectRevert(InstructionSigner.InvalidSignatureLength.selector);
        signer.submitSignature(id, bytes("short"));
    }

    function test_Signature_RevertsBeforeApproved() public {
        vm.prank(alice);
        token.approve(address(directBurn), REDEEM_AMOUNT);
        vm.prank(alice);
        uint256 id = directBurn.redeem(REDEEM_AMOUNT, alice);
        // Still AwaitingFinality -> signer reverts with InstructionSigner.InvalidStatus()
        (, bytes32 digest) = signer.getInstruction(id);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(PK_SIG1, digest);
        vm.expectRevert(InstructionSigner.InvalidStatus.selector);
        vm.prank(signer1);
        signer.submitSignature(id, abi.encodePacked(r, s, v));
    }

    // ==================================================================
    // 7. SETTLEMENT RECORDING (FR14)
    // ==================================================================
    function test_Settlement_UnauthorizedAttestorReverts() public {
        _primeForSettlement();
        uint256 id = 1;

        bytes32 ref = keccak256("x");
        bytes32 digest = settlement.settlementDigest(id, ref);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(PK_STR, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        vm.expectRevert(abi.encodeWithSelector(SettlementRecorder.UnauthorizedAttestor.selector, vm.addr(PK_STR)));
        settlement.confirmSettlement(id, ref, sig);
    }

    function test_Settlement_WrongStatusReverts() public {
        vm.prank(alice);
        token.approve(address(directBurn), REDEEM_AMOUNT);
        vm.prank(alice);
        uint256 id = directBurn.redeem(REDEEM_AMOUNT, alice);
        // Status is AwaitingFinality — not Signed

        bytes32 ref = keccak256("NOPE");
        bytes32 digest = settlement.settlementDigest(id, ref);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(PK_ATTEST, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        vm.expectRevert(abi.encodeWithSelector(SettlementRecorder.InvalidStatus.selector));
        settlement.confirmSettlement(id, ref, sig);
    }

    // ==================================================================
    // 8. CANCELLATION (request-lock)
    // ==================================================================
    function test_CancelRequestLock() public {
        vm.prank(alice);
        token.approve(address(requestLock), REDEEM_AMOUNT);

        vm.prank(alice);
        uint256 reqId = requestLock.requestRedemption(REDEEM_AMOUNT, bob);
        assertEq(token.balanceOf(address(requestLock)), REDEEM_AMOUNT);

        vm.prank(alice);
        requestLock.cancelRequest(reqId);
        assertEq(token.balanceOf(alice), MINT_AMOUNT);
        assertEq(token.balanceOf(address(requestLock)), 0);
    }

    function test_CancelAfterFinalizeReverts() public {
        vm.prank(alice);
        token.approve(address(requestLock), REDEEM_AMOUNT);

        vm.prank(alice);
        uint256 reqId = requestLock.requestRedemption(REDEEM_AMOUNT, bob);

        vm.prank(alice);
        requestLock.finalizeRedemption(reqId);

        vm.expectRevert(RequestLockAdapter.RequestNotOpen.selector);
        vm.prank(alice);
        requestLock.cancelRequest(reqId);
    }

    // ==================================================================
    // 9. AUDIT TRAIL / EDGE CASES
    // ==================================================================
    function test_AuditTrail_TwoRedemptions() public {
        vm.startPrank(alice);
        token.approve(address(directBurn), REDEEM_AMOUNT);
        uint256 id1 = directBurn.redeem(REDEEM_AMOUNT, alice);

        token.approve(address(requestLock), REDEEM_AMOUNT * 2);
        uint256 reqId = requestLock.requestRedemption(REDEEM_AMOUNT, bob);
        uint256 id2 = requestLock.finalizeRedemption(reqId);
        vm.stopPrank();

        assertEq(id1, 1);
        assertEq(id2, 2);

        uint256[] memory aliceIds = registry.holderRedemptions(alice);
        assertEq(aliceIds.length, 2);
        assertEq(aliceIds[0], 1);
        assertEq(aliceIds[1], 2);

        uint256[] memory assetIds = registry.assetRedemptions(address(token));
        assertEq(assetIds.length, 2);
        assertEq(registry.redemptionCount(), 2);
    }

    function test_AuditTrail_WrongIdReverts() public {
        vm.expectRevert(abi.encodeWithSelector(IRedemptionTypes.UnknownRedemption.selector, 99));
        registry.getRedemption(99);
    }

    // ==================================================================
    // 10. COMPLIANCE CONFIGURATION EDGE CASE
    // ==================================================================
    function test_Compliance_NoIdentityConfigured() public {
        // Deploy a fresh compliance module with NO default identity
        vm.prank(owner);
        ComplianceRecheck complianceNoId = new ComplianceRecheck(address(registry), address(0));
        // Point the registry at the new module (owner prank)
        vm.prank(owner);
        registry.setComplianceModule(address(complianceNoId));

        vm.prank(alice);
        token.approve(address(directBurn), REDEEM_AMOUNT);
        vm.prank(alice);
        uint256 id = directBurn.redeem(REDEEM_AMOUNT, alice);
        vm.roll(block.number + FINALITY_DEPTH);
        registry.confirmFinality(id);

        vm.expectRevert(ComplianceRecheck.IdentityNotConfigured.selector);
        complianceNoId.runCheck(id);
    }

    // ==================================================================
    // 11. CONFIG & ADMIN EDGE CASES (push coverage on branches)
    // ==================================================================

    function test_Registry_TransferOwnership() public {
        vm.prank(stranger);
        vm.expectRevert(IRedemptionTypes.NotAuthorized.selector);
        registry.transferOwnership(owner);
        vm.prank(owner);
        registry.transferOwnership(alice);
    }

    function test_Registry_ConfigSetters() public {
        vm.prank(owner);
        registry.setDefaultFinalityDepth(20);
        assertEq(registry.defaultFinalityDepth(), 20);

        vm.prank(owner);
        registry.setAssetFinalityDepth(address(token), 30);
        assertEq(registry.finalityDepthFor(address(token)), 30);

        vm.prank(owner);
        registry.setAssetFinalityDepth(address(token), 0);
        assertEq(registry.finalityDepthFor(address(token)), 20);

        vm.prank(owner);
        registry.setComplianceModule(address(compliance));
        assertEq(registry.complianceModule(), address(compliance));
    }

    function test_Registry_OnlyOwnerRejectsNonOwner() public {
        vm.prank(stranger);
        vm.expectRevert(IRedemptionTypes.NotAuthorized.selector);
        registry.setAdapter(address(directBurn), false);
    }

    function test_Registry_CancelByNonAdapterReverts() public {
        vm.expectRevert(IRedemptionTypes.NotAuthorized.selector);
        vm.prank(stranger);
        registry.cancelByAdapter(1);
    }

    function test_Registry_SettleWrongModuleReverts() public {
        _primeForSettlement();
        uint256 id = 1;
        vm.expectRevert(IRedemptionTypes.NotAuthorized.selector);
        vm.prank(stranger);
        registry.confirmSettlement(id, keccak256("x"));
    }

    // ==================================================================
    // 12. CIRCUIT BREAKER ADMIN & PIPELINE BRANCHES
    // ==================================================================
    function test_Breaker_ConfigAndPause() public {
        vm.prank(owner);
        breaker.setPaused(true);
        assertTrue(breaker.paused());
        vm.prank(owner);
        breaker.setPaused(false);
        assertFalse(breaker.paused());
        assertEq(breaker.boardSize(), 2);
        (uint256 ap, uint256 rj) = breaker.votesFor(0);
        assertEq(ap, 0);
        assertEq(rj, 0);
        vm.prank(stranger);
        vm.expectRevert(CircuitBreaker.NotAuthorized.selector);
        breaker.transferOwnership(alice);
        vm.prank(owner);
        breaker.transferOwnership(owner);
    }

    function test_breaker_setBoardValidation() public {
        vm.prank(owner);
        address[] memory bad0 = new address[](0);
        vm.expectRevert(CircuitBreaker.ZeroAddress.selector);
        breaker.setBoard(bad0, 0);

        vm.prank(owner);
        address[] memory dup = new address[](2);
        dup[0] = alice;
        dup[1] = alice;
        vm.expectRevert(CircuitBreaker.DuplicateMember.selector);
        breaker.setBoard(dup, 1);
    }

    function test_breaker_ResolveManualReview() public {
        vm.prank(owner);
        compliance.configureAsset(address(token), address(0), 50 ether);
        vm.prank(alice);
        token.approve(address(directBurn), 100 ether);
        vm.prank(alice);
        uint256 id = directBurn.redeem(100 ether, alice);
        vm.roll(block.number + FINALITY_DEPTH);
        registry.confirmFinality(id);
        compliance.runCheck(id);
        assertEq(uint8(registry.statusOf(id)), uint8(IRedemptionTypes.Status.InManualReview));

        vm.prank(boardMember1);
        breaker.voteApprove(id);
        vm.prank(boardMember2);
        breaker.voteApprove(id);
        assertEq(uint8(registry.statusOf(id)), uint8(IRedemptionTypes.Status.Approved));
    }

    // ==================================================================
    // 13. INSTRUCTION SIGNER ADMIN & EXPIRY
    // ==================================================================
    function test_Signer_ConfigValidation() public {
        vm.prank(owner);
        address[] memory sigs = new address[](0);
        vm.expectRevert(InstructionSigner.TooManySigners.selector);
        signer.setSigners(sigs, 0);

        vm.prank(owner);
        address[] memory sigs1 = new address[](1);
        sigs1[0] = alice;
        vm.expectRevert(InstructionSigner.InvalidThreshold.selector);
        signer.setSigners(sigs1, 2);

        assertEq(signer.signerCount(), 3);

        vm.prank(owner);
        vm.expectRevert(InstructionSigner.ZeroAmount.selector);
        signer.setSigningWindow(0);
    }

    function test_Signer_ExpiredDeadlineReverts() public {
        vm.prank(alice);
        token.approve(address(directBurn), REDEEM_AMOUNT);
        vm.prank(alice);
        uint256 id = directBurn.redeem(REDEEM_AMOUNT, alice);
        vm.roll(block.number + FINALITY_DEPTH);
        registry.confirmFinality(id);
        compliance.runCheck(id);

        vm.warp(block.timestamp + signer.signingWindow() + 1);
        (, bytes32 digest) = signer.getInstruction(id);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(PK_SIG1, digest);
        vm.expectRevert(InstructionSigner.InstructionExpired.selector);
        vm.prank(signer1);
        signer.submitSignature(id, abi.encodePacked(r, s, v));
    }

    function test_Signer_CollectedViews() public {
        vm.prank(alice);
        token.approve(address(directBurn), REDEEM_AMOUNT);
        vm.prank(alice);
        uint256 id = directBurn.redeem(REDEEM_AMOUNT, alice);
        vm.roll(block.number + FINALITY_DEPTH);
        registry.confirmFinality(id);
        compliance.runCheck(id);
        _sign(id, PK_SIG1);
        assertEq(signer.signatureCount(id), 1);
        address[] memory collected = signer.collectedSigners(id);
        assertEq(collected.length, 1);
        assertEq(collected[0], signer1);
    }

    function test_Signer_PausedByCircuitBreaker() public {
        vm.prank(owner);
        signer.setCircuitBreaker(address(breaker));
        vm.prank(owner);
        breaker.setPaused(true);

        vm.prank(alice);
        token.approve(address(directBurn), REDEEM_AMOUNT);
        vm.prank(alice);
        uint256 id = directBurn.redeem(REDEEM_AMOUNT, alice);
        vm.roll(block.number + FINALITY_DEPTH);
        registry.confirmFinality(id);
        compliance.runCheck(id);

        (, bytes32 digest) = signer.getInstruction(id);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(PK_SIG1, digest);
        vm.expectRevert(InstructionSigner.SigningPaused.selector);
        vm.prank(signer1);
        signer.submitSignature(id, abi.encodePacked(r, s, v));
        vm.prank(owner);
        breaker.setPaused(false);
    }

    // ==================================================================
    // 14. COMPLIANCE — SANCTIONS REFERENCE & ASSET OVERRIDE
    // ==================================================================
    function test_Compliance_SanctionsReferenceFlags() public {
        MockSanctions sanctions = new MockSanctions();
        vm.prank(owner);
        compliance.setSanctionsReference(address(sanctions));

        vm.prank(alice);
        token.approve(address(directBurn), REDEEM_AMOUNT);
        vm.prank(alice);
        uint256 id = directBurn.redeem(REDEEM_AMOUNT, bob);
        vm.roll(block.number + FINALITY_DEPTH);
        registry.confirmFinality(id);

        vm.prank(owner);
        sanctions.set(bob, true);
        compliance.runCheck(id);
        assertEq(uint8(registry.statusOf(id)), uint8(IRedemptionTypes.Status.Flagged));
    }

    function test_Compliance_PerAssetIdentityOverride() public {
        vm.prank(owner);
        compliance.configureAsset(address(token), address(idRegistry), 0);
        vm.prank(alice);
        token.approve(address(directBurn), REDEEM_AMOUNT);
        vm.prank(alice);
        uint256 id = directBurn.redeem(REDEEM_AMOUNT, alice);
        vm.roll(block.number + FINALITY_DEPTH);
        registry.confirmFinality(id);
        compliance.runCheck(id);
        assertEq(uint8(registry.statusOf(id)), uint8(IRedemptionTypes.Status.Approved));
    }

    // ==================================================================
    // 15. DIRECT-BURN ADAPTER BRANCHES
    // ==================================================================
    function test_TriggerTypeGetters() public {
        assertEq(uint8(directBurn.triggerType()), uint8(IRedemptionTypes.TriggerType.DirectBurn));
        assertEq(uint8(requestLock.triggerType()), uint8(IRedemptionTypes.TriggerType.RequestLock));
    }

    function test_DirectBurn_DestinationDefaultsToSelf() public {
        vm.prank(alice);
        token.approve(address(directBurn), REDEEM_AMOUNT);
        vm.prank(alice);
        uint256 id = directBurn.redeem(REDEEM_AMOUNT, address(0));
        IRedemptionRegistry.Redemption memory r = registry.getRedemption(id);
        assertEq(r.destination, alice, "destination defaults to sender");
    }

    function test_DirectBurn_InsufficientAllowanceReverts() public {
        // No approval
        vm.expectRevert();
        vm.prank(alice);
        directBurn.redeem(REDEEM_AMOUNT, alice);
    }

    function test_DirectBurn_ThrowsOnZeroAmount() public {
        vm.prank(alice);
        vm.expectRevert(DirectBurnAdapter.ZeroAmount.selector);
        directBurn.redeem(0, alice);
    }

    // ==================================================================
    // 16. INSTRUCTION SIGNER — ASSET ID & DUPLICATE SIGNER
    // ==================================================================
    function test_Signer_AssetIdAndDuplicate() public {
        // assetIdFor is a left-padded address
        assertEq(signer.assetIdFor(address(token)), bytes32(uint256(uint160(address(token)))));

        // Duplicate signer in setSigners
        vm.prank(owner);
        address[] memory dupSigs = new address[](2);
        dupSigs[0] = signer1;
        dupSigs[1] = signer1;
        vm.expectRevert(InstructionSigner.DuplicateSigner.selector);
        signer.setSigners(dupSigs, 1);
    }

    // ==================================================================
    // 17. COMPLIANCE — DEFAULT IDENTITY SETTER
    // ==================================================================
    function test_Compliance_SetDefaultIdentity() public {
        vm.prank(owner);
        compliance.setDefaultIdentity(address(idRegistry));
        vm.prank(alice);
        token.approve(address(directBurn), REDEEM_AMOUNT);
        vm.prank(alice);
        uint256 id = directBurn.redeem(REDEEM_AMOUNT, alice);
        vm.roll(block.number + FINALITY_DEPTH);
        registry.confirmFinality(id);
        compliance.runCheck(id);
        assertEq(uint8(registry.statusOf(id)), uint8(IRedemptionTypes.Status.Approved));
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------
    function _primeForSettlement() internal returns (uint256) {
        vm.prank(alice);
        token.approve(address(directBurn), REDEEM_AMOUNT);
        vm.prank(alice);
        uint256 id = directBurn.redeem(REDEEM_AMOUNT, alice);
        vm.roll(block.number + FINALITY_DEPTH);
        registry.confirmFinality(id);
        compliance.runCheck(id);
        _sign(id, PK_SIG1);
        _sign(id, PK_SIG2);
        return id;
    }

    /// @dev Sign as `_pkHolder` — finds the address, signs the digest, pranks the address.
    function _sign(uint256 redemptionId, uint256 pk) internal {
        address signerAddr = vm.addr(pk);
        (, bytes32 digest) = signer.getInstruction(redemptionId);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        bytes memory sig = abi.encodePacked(r, s, v);
        vm.prank(signerAddr);
        signer.submitSignature(redemptionId, sig);
    }

    function _settle(uint256 redemptionId, bytes32 ref) internal {
        bytes32 digest = settlement.settlementDigest(redemptionId, ref);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(PK_ATTEST, digest);
        vm.prank(attestor);
        settlement.confirmSettlement(redemptionId, ref, abi.encodePacked(r, s, v));
    }
    function test_AttestorEnableIsIdempotent() public {
        vm.prank(owner);
        settlement.setAttestor(attestor, true);
        assertEq(settlement.attestorCount(), 1, 'duplicate enable inflates count');
    }
    function test_DisablingUnknownAttestorPreservesCount() public {
        vm.prank(owner);
        settlement.setAttestor(stranger, false);
        assertEq(settlement.attestorCount(), 1, 'unknown disable reduces count');
    }
    function testFuzz_AttestorCountTracksMembership(uint256 actions) public {
        for (uint256 i = 0; i < 64; i++) {
            address target = (actions & 1) == 0 ? attestor : stranger;
            bool enabled = (actions & 2) != 0;
            vm.prank(owner);
            settlement.setAttestor(target, enabled);
            uint256 expected = (settlement.isAttestor(attestor) ? 1 : 0)
                + (settlement.isAttestor(stranger) ? 1 : 0);
            assertEq(settlement.attestorCount(), expected);
            actions >>= 2;
        }
    }

    function _approvedForRotation() internal returns (uint256 id) {
        vm.prank(alice);
        token.approve(address(directBurn), REDEEM_AMOUNT);
        vm.prank(alice);
        id = directBurn.redeem(REDEEM_AMOUNT, bob);
        vm.roll(block.number + FINALITY_DEPTH);
        registry.confirmFinality(id);
        compliance.runCheck(id);
    }

    function _rotateSignersForTest() internal {
        address[] memory members = new address[](2);
        members[0] = stranger;
        members[1] = bob;
        vm.prank(owner);
        signer.setSigners(members, 2);
    }

    function _rotateBoardForTest() internal {
        address[] memory members = new address[](2);
        members[0] = stranger;
        members[1] = bob;
        vm.prank(owner);
        breaker.setBoard(members, 2);
    }

    function test_Rotation_RemovesOldSigners() public {
        _rotateSignersForTest();
        assertFalse(signer.isSigner(signer1));
        assertFalse(signer.isSigner(signer2));
        assertFalse(signer.isSigner(signer3));
    }

    function test_Rotation_RemovesOldBoard() public {
        _rotateBoardForTest();
        assertFalse(breaker.isBoardMember(boardMember1));
        assertFalse(breaker.isBoardMember(boardMember2));
    }

    function test_Rotation_AllowsRetainedMembers() public {
        address[] memory members = new address[](2);
        members[0] = signer1;
        members[1] = stranger;
        vm.prank(owner);
        signer.setSigners(members, 2);
        members[0] = boardMember1;
        vm.prank(owner);
        breaker.setBoard(members, 2);
        assertTrue(signer.isSigner(signer1));
        assertTrue(breaker.isBoardMember(boardMember1));
    }

    function test_Rotation_ChangesInstructionDigest() public {
        uint256 id = _approvedForRotation();
        (, bytes32 beforeDigest) = signer.getInstruction(id);
        _rotateSignersForTest();
        (, bytes32 afterDigest) = signer.getInstruction(id);
        assertNotEq(beforeDigest, afterDigest);
    }

    function test_Rotation_ResetsPendingSignatures() public {
        uint256 id = _approvedForRotation();
        _sign(id, PK_SIG1);
        _rotateSignersForTest();
        assertEq(signer.signatureCount(id), 0);
        assertFalse(signer.hasSigned(id, signer1));
        _sign(id, PK_STR);
        assertEq(uint8(registry.statusOf(id)), uint8(IRedemptionTypes.Status.Approved));
        _sign(id, PK_BOB);
        assertEq(uint8(registry.statusOf(id)), uint8(IRedemptionTypes.Status.Signed));
    }

    function test_Rotation_RejectsRemovedSigner() public {
        uint256 id = _approvedForRotation();
        _rotateSignersForTest();
        (, bytes32 digest) = signer.getInstruction(id);
        (uint8 v, bytes32 r, bytes32 sigS) = vm.sign(PK_SIG1, digest);
        vm.expectRevert(abi.encodeWithSelector(InstructionSigner.UnauthorizedSigner.selector, signer1));
        signer.submitSignature(id, abi.encodePacked(r, sigS, v));
    }

    function test_Rotation_ResetsBothPendingVoteCounts() public {
        vm.prank(owner);
        idRegistry.setSanctioned(bob, true);
        uint256 id = _approvedForRotation();
        vm.prank(boardMember1);
        breaker.voteApprove(id);
        vm.prank(boardMember2);
        breaker.voteReject(id);
        _rotateBoardForTest();
        (uint256 approvals, uint256 rejections) = breaker.votesFor(id);
        assertEq(approvals, 0);
        assertEq(rejections, 0);
        assertFalse(breaker.hasVoted(id, boardMember1));
        vm.prank(stranger);
        breaker.voteApprove(id);
        assertEq(uint8(registry.statusOf(id)), uint8(IRedemptionTypes.Status.Flagged));
        vm.prank(bob);
        breaker.voteApprove(id);
        assertEq(uint8(registry.statusOf(id)), uint8(IRedemptionTypes.Status.Approved));
    }

    function test_Rotation_RetainedSignerCannotReplayOldPayload() public {
        uint256 id = _approvedForRotation();
        (, bytes32 oldDigest) = signer.getInstruction(id);
        (uint8 v, bytes32 r, bytes32 sigS) = vm.sign(PK_SIG1, oldDigest);
        address[] memory members = new address[](2);
        members[0] = signer1;
        members[1] = stranger;
        vm.prank(owner);
        signer.setSigners(members, 2);
        vm.expectRevert();
        signer.submitSignature(id, abi.encodePacked(r, sigS, v));
        _sign(id, PK_SIG1);
        _sign(id, PK_STR);
        assertEq(uint8(registry.statusOf(id)), uint8(IRedemptionTypes.Status.Signed));
    }

    function test_Rotation_WindowChangeResetsPendingPayload() public {
        uint256 id = _approvedForRotation();
        _sign(id, PK_SIG1);
        (, bytes32 oldDigest) = signer.getInstruction(id);
        vm.prank(owner);
        signer.setSigningWindow(4 days);
        assertEq(signer.signatureCount(id), 0);
        assertEq(signer.instructionDigestOf(id), bytes32(0));
        (, bytes32 newDigest) = signer.getInstruction(id);
        assertNotEq(oldDigest, newDigest);
        _sign(id, PK_SIG2);
        assertEq(uint8(registry.statusOf(id)), uint8(IRedemptionTypes.Status.Approved));
        _sign(id, PK_SIG1);
        assertEq(uint8(registry.statusOf(id)), uint8(IRedemptionTypes.Status.Signed));
    }

    function test_Rotation_PreservesCompletedSignatureAudit() public {
        uint256 id = _primeForSettlement();
        uint256 epoch = signer.signedEpochOf(id);
        bytes32 digest = signer.instructionDigestOf(id);
        _rotateSignersForTest();
        assertEq(signer.signedEpochOf(id), epoch);
        assertEq(signer.signatureCount(id), 2);
        assertTrue(signer.hasSigned(id, signer1));
        assertEq(signer.instructionDigestOf(id), digest);
        assertEq(signer.collectedSignersAtEpoch(id, epoch).length, 2);
        vm.prank(owner);
        signer.setSigningWindow(4 days);
        (, bytes32 historicalDigest) = signer.getInstruction(id);
        assertEq(historicalDigest, digest);
        _settle(id, keccak256("after rotation"));
        assertEq(uint8(registry.statusOf(id)), uint8(IRedemptionTypes.Status.Settled));
    }

    function test_Rotation_PreservesCompletedReviewAudit() public {
        vm.prank(owner);
        idRegistry.setSanctioned(bob, true);
        uint256 id = _approvedForRotation();
        vm.prank(boardMember1);
        breaker.voteReject(id);
        vm.prank(boardMember2);
        breaker.voteReject(id);
        uint256 epoch = breaker.resolvedEpochOf(id);
        _rotateBoardForTest();
        assertEq(breaker.rejectCountOf(id), 2);
        assertTrue(breaker.hasVoted(id, boardMember1));
        (, uint256 rejections) = breaker.votesAtEpoch(id, epoch);
        assertEq(rejections, 2);
        assertEq(uint8(registry.statusOf(id)), uint8(IRedemptionTypes.Status.Rejected));
    }

    function test_Rotation_InvalidUpdateRollsBackConfiguration() public {
        uint256 epoch = signer.signerEpoch();
        address[] memory members = new address[](2);
        members[0] = stranger;
        members[1] = stranger;
        vm.prank(owner);
        vm.expectRevert(InstructionSigner.DuplicateSigner.selector);
        signer.setSigners(members, 2);
        assertEq(signer.signerEpoch(), epoch);
        assertTrue(signer.isSigner(signer1));
        assertFalse(signer.isSigner(stranger));
        epoch = breaker.boardEpoch();
        vm.prank(owner);
        vm.expectRevert(CircuitBreaker.DuplicateMember.selector);
        breaker.setBoard(members, 2);
        assertEq(breaker.boardEpoch(), epoch);
        assertTrue(breaker.isBoardMember(boardMember1));
        assertFalse(breaker.isBoardMember(stranger));
    }

    function test_Rotation_RetainedBoardMemberCanVoteAgain() public {
        vm.prank(owner);
        idRegistry.setSanctioned(bob, true);
        uint256 id = _approvedForRotation();
        vm.prank(boardMember1);
        breaker.voteApprove(id);
        address[] memory members = new address[](2);
        members[0] = boardMember1;
        members[1] = stranger;
        vm.prank(owner);
        breaker.setBoard(members, 2);
        assertFalse(breaker.hasVoted(id, boardMember1));
        vm.prank(boardMember1);
        breaker.voteApprove(id);
        assertEq(breaker.approveCountOf(id), 1);
        vm.prank(stranger);
        breaker.voteApprove(id);
        assertEq(uint8(registry.statusOf(id)), uint8(IRedemptionTypes.Status.Approved));
    }

    function test_Rotation_ReaddedSignerCannotReuseOldSignature() public {
        uint256 id = _approvedForRotation();
        (, bytes32 oldDigest) = signer.getInstruction(id);
        (uint8 v, bytes32 r, bytes32 sigS) = vm.sign(PK_SIG1, oldDigest);
        _sign(id, PK_SIG1);
        _rotateSignersForTest();
        address[] memory members = new address[](2);
        members[0] = signer1;
        members[1] = signer2;
        vm.prank(owner);
        signer.setSigners(members, 2);
        assertEq(signer.signatureCount(id), 0);
        vm.expectRevert();
        signer.submitSignature(id, abi.encodePacked(r, sigS, v));
        _sign(id, PK_SIG1);
        _sign(id, PK_SIG2);
        assertEq(uint8(registry.statusOf(id)), uint8(IRedemptionTypes.Status.Signed));
    }

    function test_Rotation_SameConfigurationStartsFreshEpochs() public {
        uint256 id = _approvedForRotation();
        _sign(id, PK_SIG1);
        uint256 epoch = signer.signerEpoch();
        address[] memory members = new address[](3);
        members[0] = signer1;
        members[1] = signer2;
        members[2] = signer3;
        vm.prank(owner);
        signer.setSigners(members, 2);
        assertEq(signer.signerEpoch(), epoch + 1);
        assertEq(signer.signatureCount(id), 0);
        epoch = breaker.boardEpoch();
        members = new address[](2);
        members[0] = boardMember1;
        members[1] = boardMember2;
        vm.prank(owner);
        breaker.setBoard(members, 2);
        assertEq(breaker.boardEpoch(), epoch + 1);
    }
}