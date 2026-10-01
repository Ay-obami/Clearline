// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/RedemptionRegistry.sol";
import "../src/ComplianceRecheck.sol";
import "../src/InstructionSigner.sol";
import "../src/CircuitBreaker.sol";
import "../src/SettlementRecorder.sol";
import "../src/adapters/DirectBurnAdapter.sol";
import "../src/adapters/RequestLockAdapter.sol";
import "../src/mocks/MockIdentityRegistry.sol";
import "../src/mocks/MockRWAToken.sol";

/**
 * @title ClearlineDeploy
 * @notice Full demo deployment (PRD 9.2 order) then wiring:
 * Identity Registry -> mock RWA token -> Redemption Registry -> trigger adapters
 * -> Compliance Re-check -> Circuit Breaker -> Instruction Signer -> Settlement
 * Recorder, followed by module wiring and demo-holder verification.
 *
 * Env: DEPLOYER_KEY (required); SIGNER_ADDRS, BOARD_ADDRS, ATTESTOR_ADDR, HOLDER,
 * MINT_AMOUNT (optional; missing lists fall back to the deployer address).
 */
contract ClearlineDeploy is Script {
    struct Roles {
        address[] signers;
        address[] board;
        uint256 signerThreshold;
        uint256 boardThreshold;
    }

    function _loadRoles(address deployer) internal view returns (Roles memory roles) {
        uint256 signerCount = vm.envOr("SIGNER_COUNT", uint256(3));
        uint256 boardCount = vm.envOr("BOARD_COUNT", uint256(2));
        roles.signerThreshold = vm.envOr("SIGNER_THRESHOLD", uint256(2));
        roles.boardThreshold = vm.envOr("BOARD_THRESHOLD", uint256(2));
        require(roles.signerThreshold > 0 && roles.signerThreshold <= signerCount, "bad signer cfg");
        require(roles.boardThreshold > 0 && roles.boardThreshold <= boardCount, "bad board cfg");
        roles.signers = _readList("SIGNER_ADDRS", deployer, signerCount);
        roles.board = _readList("BOARD_ADDRS", deployer, boardCount);
    }

    function run() external {
        uint256 key = vm.envUint("DEPLOYER_KEY");
        address deployer = vm.addr(key);

        // Production guardrail: mainnet broadcasts must be intentional.
        // HSK Chain mainnet chainId = 177 (ethereum-lists registry).
        if (block.chainid == 177 && !vm.envOr("CONFIRM_MAINNET", false)) {
            revert("MAINNET GUARD: re-run with CONFIRM_MAINNET=true to broadcast");
        }

        // Resolve every role before broadcasting. Public networks never use demo keys.
        Roles memory roles = _loadRoles(deployer);

        vm.startBroadcast(key);

        // 1. Identity registry
        MockIdentityRegistry identity = new MockIdentityRegistry(deployer);

        // 2. Mock RWA token
        MockRWAToken token = new MockRWAToken("Clearline RWA Token", "CLRWA", deployer);
        token.setIdentityRegistry(address(identity));
        token.addAgent(deployer);

        // 3. Redemption Registry
        RedemptionRegistry registry = new RedemptionRegistry(deployer);

        // 4. Core trigger adapters
        DirectBurnAdapter directBurn = new DirectBurnAdapter(address(token), address(registry));
        RequestLockAdapter requestLock = new RequestLockAdapter(address(token), address(registry));
        registry.setAdapter(address(directBurn), true);
        registry.setAdapter(address(requestLock), true);

        // 5. Compliance Re-Check module
        ComplianceRecheck compliance = new ComplianceRecheck(address(registry), address(identity));

        // 6. Circuit breaker
        CircuitBreaker breaker = new CircuitBreaker(address(registry), deployer);

        // 7. Instruction signer
        InstructionSigner signer = new InstructionSigner(address(registry), deployer);

        // 8. Settlement recorder
        SettlementRecorder settlement = new SettlementRecorder(address(registry), deployer);

        // Wire modules
        registry.setComplianceModule(address(compliance));
        registry.setCircuitBreaker(address(breaker));
        registry.setInstructionSigner(address(signer));
        registry.setSettlementRecorder(address(settlement));
        signer.setCircuitBreaker(address(breaker));

        // FR5: optional explicit finality depth (12–20 recommended; defaults
        // live inside RedemptionRegistry). Applies chain-wide unless per-asset
        // overrides are set afterwards via setAssetFinalityDepth().
        {
            uint256 finalityDepth = vm.envOr("FINALITY_DEPTH", uint256(0));
            if (finalityDepth > 0) {
                registry.setDefaultFinalityDepth(finalityDepth);
                registry.setAssetFinalityDepth(address(token), finalityDepth);
            }
        }

        signer.setSigners(roles.signers, roles.signerThreshold);
        console2.log("SIGNERS_%d_THRESHOLD_%d", roles.signers.length, roles.signerThreshold);
        breaker.setBoard(roles.board, roles.boardThreshold);
        console2.log("BOARD_%d_THRESHOLD_%d", roles.board.length, roles.boardThreshold);

        address attestor = vm.envOr("ATTESTOR_ADDR", deployer);
        settlement.setAttestor(attestor, true);

        // Demo holder + adapter verification
        address holder = vm.envOr("HOLDER", deployer);
        identity.setVerified(holder, true);
        identity.setVerified(address(directBurn), true);
        identity.setVerified(address(requestLock), true);

        uint256 mintAmount = vm.envOr("MINT_AMOUNT", uint256(0));
        if (mintAmount > 0) token.mint(holder, mintAmount);

        vm.stopBroadcast();

        console2.log("=== Clearline deployment complete (chainId=%d) ===", block.chainid);
        console2.log("TOKEN_ADDRESS=%s", address(token));
        console2.log("REGISTRY_ADDRESS=%s", address(registry));
        console2.log("IDENTITY_ADDRESS=%s", address(identity));
        console2.log("DIRECT_BURN_ADAPTER=%s", address(directBurn));
        console2.log("REQUEST_LOCK_ADAPTER=%s", address(requestLock));
        console2.log("COMPLIANCE_ADDRESS=%s", address(compliance));
        console2.log("SIGNER_ADDRESS=%s", address(signer));
        console2.log("BREAKER_ADDRESS=%s", address(breaker));
        console2.log("SETTLEMENT_ADDRESS=%s", address(settlement));
        console2.log("ATTESTOR_ADDR=%s", attestor);
        console2.log("HOLDER_ADDR=%s", holder);
    }

    /// @dev Exact comma list. Deterministic test identities exist only on local chain 31337.
    function _readList(string memory envKey, address fallback_, uint256 count)
        internal view returns (address[] memory arr)
    {
        require(count > 0 && count <= 10, "Deploy: invalid role count");
        arr = new address[](count);
        bytes memory input = _envExists(envKey) ? bytes(vm.envString(envKey)) : bytes("");
        if (input.length == 0) {
            require(block.chainid == 31337, "Deploy: explicit roles required");
            uint256 first = _deriveFrom(fallback_) + uint256(keccak256(bytes(envKey))) % (2 ** 128);
            for (uint256 i; i < count; ++i) arr[i] = vm.addr(first + i + 1);
            return arr;
        }
        uint256 idx;
        bytes memory current;
        for (uint256 i; i <= input.length; ++i) {
            if (i == input.length || input[i] == ",") {
                require(idx < count, "Deploy: role count mismatch");
                address role = _toAddr(string(current), fallback_);
                for (uint256 j; j < idx; ++j) require(arr[j] != role, "Deploy: duplicate role");
                arr[idx++] = role;
                current = "";
            } else current = bytes.concat(current, input[i]);
        }
        require(idx == count, "Deploy: role count mismatch");
    }

    function _envExists(string memory envKey) internal view returns (bool) {
        try vm.envString(envKey) returns (string memory) {
            return true;
        } catch {
            return false;
        }
    }

    /// @dev Deterministic distinct-seed offset derived from an address, so the
    /// deployed demo's derived signers/board never collide with the deployer.
    function _deriveFrom(address a) internal pure returns (uint256) {
        return uint256(keccak256(abi.encodePacked("Clearline.derive", a))) % (2 ** 128);
    }

    function _toAddr(string memory s, address) internal pure returns (address) {
        require(bytes(s).length == 42, "Deploy: malformed role");
        require(bytes(s)[0] == "0" && bytes(s)[1] == "x", "Deploy: malformed role");
        bytes memory b = bytes(s);
        uint160 v;
        for (uint256 i = 2; i < 42; i++) v = v * 16 + _hex(b[i]);
        require(v != 0, "Deploy: zero role");
        return address(v);
    }

    function _hex(bytes1 c) internal pure returns (uint160) {
        uint8 v = uint8(c);
        if (v >= 48 && v <= 57) return v - 48;
        if (v >= 97 && v <= 102) return v - 87;
        if (v >= 65 && v <= 70) return v - 55;
        revert("Deploy: invalid hex");
    }
}
