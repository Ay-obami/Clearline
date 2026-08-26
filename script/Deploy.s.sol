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
    function run() external {
        uint256 key = vm.envUint("DEPLOYER_KEY");
        address deployer = vm.addr(key);

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

        address[] memory sigs = _readList("SIGNER_ADDRS", deployer, 3);
        if (!_envExists("SIGNER_ADDRS")) {
            uint256 first = _deriveFrom(deployer);
            sigs[0] = vm.addr(first);
            sigs[1] = vm.addr(first + 1);
            sigs[2] = vm.addr(first + 2);
        }
        signer.setSigners(sigs, 2);

        address[] memory board = _readList("BOARD_ADDRS", deployer, 2);
        if (!_envExists("BOARD_ADDRS")) {
            uint256 b0 = _deriveFrom(deployer) + 100;
            board[0] = vm.addr(b0);
            board[1] = vm.addr(b0 + 1);
        }
        breaker.setBoard(board, 2);

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

        console2.log("=== Clearline deployment complete ===");
        console2.log("TOKEN_ADDRESS=%s", address(token));
        console2.log("REGISTRY_ADDRESS=%s", address(registry));
        console2.log("IDENTITY_ADDRESS=%s", address(identity));
        console2.log("DIRECT_BURN_ADAPTER=%s", address(directBurn));
        console2.log("REQUEST_LOCK_ADAPTER=%s", address(requestLock));
        console2.log("COMPLIANCE_ADDRESS=%s", address(compliance));
        console2.log("SIGNER_ADDRESS=%s", address(signer));
        console2.log("BREAKER_ADDRESS=%s", address(breaker));
        console2.log("SETTLEMENT_ADDRESS=%s", address(settlement));
    }

    /// @dev env comma-list -> address[]; unset/garbage entries padded with `fallback_`.
    function _readList(string memory envKey, address fallback_, uint256 max)
        internal
        view
        returns (address[] memory arr)
    {
        arr = new address[](max);
        if (!_envExists(envKey)) {
            for (uint256 i = 0; i < max; i++) arr[i] = fallback_;
            return arr;
        }
        bytes memory b = bytes(vm.envString(envKey));
        uint256 idx;
        bytes memory cur;
        for (uint256 i = 0; i <= b.length; i++) {
            if (i == b.length || b[i] == ",") {
                if (idx < max) arr[idx] = _toAddr(string(cur), fallback_);
                idx++;
                cur = "";
            } else {
                cur = bytes.concat(cur, b[i]);
            }
        }
        for (uint256 i = idx; i < max; i++) arr[i] = fallback_;
        return arr;
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

    function _toAddr(string memory s, address fallback_) internal pure returns (address) {
        if (bytes(s).length != 42) return fallback_;
        bytes memory b = bytes(s);
        uint160 v;
        for (uint256 i = 2; i < 42; i++) v = v * 16 + _hex(b[i]);
        return address(v);
    }

    function _hex(bytes1 c) internal pure returns (uint160) {
        uint8 v = uint8(c);
        if (v >= 48 && v <= 57) return v - 48;
        if (v >= 97 && v <= 102) return v - 87;
        if (v >= 65 && v <= 70) return v - 55;
        return 0;
    }
}