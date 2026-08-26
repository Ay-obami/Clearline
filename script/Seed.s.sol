// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/mocks/MockIdentityRegistry.sol";
import "../src/mocks/MockRWAToken.sol";

/**
 * @title ClearlineSeed
 * @notice Demo-day reset helper (PRD 9.9): re-verify the holder and re-mint a
 * fresh batch of mock RWA tokens so the demo flow can be re-run quickly.
 *
 * Env:
 *   DEPLOYER_KEY   required — must own/agent the token & identity registry
 *   IDENTITY       the MockIdentityRegistry address
 *   TOKEN          the MockRWAToken address
 *   HOLDER         account to KYC-verify and mint to (default = deployer)
 *   MINT_AMOUNT    amount of tokens to mint (default 10,000)
 */
contract ClearlineSeed is Script {
    function run() external {
        uint256 key = vm.envUint("DEPLOYER_KEY");
        address identity = vm.envAddress("IDENTITY");
        address token = vm.envAddress("TOKEN");

        vm.startBroadcast(key);

        MockIdentityRegistry id = MockIdentityRegistry(identity);
        MockRWAToken t = MockRWAToken(token);

        address holder = vm.envOr("HOLDER", vm.addr(key));
        id.setVerified(holder, true);

        uint256 amount = vm.envOr("MINT_AMOUNT", uint256(10000 ether));
        t.mint(holder, amount);

        vm.stopBroadcast();

        console2.log("Seeded holder=%s with %s CLRWA", holder, amount);
    }
}