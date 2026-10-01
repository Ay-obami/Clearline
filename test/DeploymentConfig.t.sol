// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "forge-std/Test.sol";
import "../script/Deploy.s.sol";

contract DeploymentConfigHarness is ClearlineDeploy {
    function readRoles(string memory key, uint256 count) external view returns (address[] memory) {
        return _readList(key, address(0xD), count);
    }
}
contract DeploymentConfigTest is Test {
    DeploymentConfigHarness harness;
    function setUp() public { harness = new DeploymentConfigHarness(); vm.chainId(31337); }
    function test_PublicNetworkRequiresExplicitRoles() public {
        vm.chainId(133); vm.setEnv("ROLE_test_PublicNetworkRequiresExplicitRoles", "");
        vm.expectRevert("Deploy: explicit roles required"); harness.readRoles("ROLE_test_PublicNetworkRequiresExplicitRoles", 3);
    }
    function test_MalformedRoleRejectedInsteadOfFallback() public {
        vm.setEnv("ROLE_test_MalformedRoleRejectedInsteadOfFallback", "not-an-address");
        vm.expectRevert("Deploy: malformed role"); harness.readRoles("ROLE_test_MalformedRoleRejectedInsteadOfFallback", 1);
    }
    function test_BadPrefixRejected() public {
        vm.setEnv("ROLE_test_BadPrefixRejected", "zz1111111111111111111111111111111111111111");
        vm.expectRevert("Deploy: malformed role"); harness.readRoles("ROLE_test_BadPrefixRejected", 1);
    }
    function test_InvalidHexRejected() public {
        vm.setEnv("ROLE_test_InvalidHexRejected", "0x111111111111111111111111111111111111111z");
        vm.expectRevert("Deploy: invalid hex"); harness.readRoles("ROLE_test_InvalidHexRejected", 1);
    }
    function test_ZeroRoleRejected() public {
        vm.setEnv("ROLE_test_ZeroRoleRejected", "0x0000000000000000000000000000000000000000");
        vm.expectRevert("Deploy: zero role"); harness.readRoles("ROLE_test_ZeroRoleRejected", 1);
    }
    function test_DuplicateRolesRejected() public {
        vm.setEnv("ROLE_test_DuplicateRolesRejected", "0x1111111111111111111111111111111111111111,0x1111111111111111111111111111111111111111");
        vm.expectRevert("Deploy: duplicate role"); harness.readRoles("ROLE_test_DuplicateRolesRejected", 2);
    }
    function test_ExtraRolesNotSilentlyTruncated() public {
        vm.setEnv("ROLE_test_ExtraRolesNotSilentlyTruncated", "0x1111111111111111111111111111111111111111,0x2222222222222222222222222222222222222222");
        vm.expectRevert("Deploy: role count mismatch"); harness.readRoles("ROLE_test_ExtraRolesNotSilentlyTruncated", 1);
    }
    function test_MissingRolesNotPadded() public {
        vm.setEnv("ROLE_test_MissingRolesNotPadded", "0x1111111111111111111111111111111111111111");
        vm.expectRevert("Deploy: role count mismatch"); harness.readRoles("ROLE_test_MissingRolesNotPadded", 2);
    }
    function test_LocalDemoSupportsEveryCountWithoutDuplicates() public {
        vm.setEnv("ROLE_test_LocalDemoSupportsEveryCountWithoutDuplicates", "");
        for(uint256 count=1;count<=10;count++) {
            address[] memory roles=harness.readRoles("ROLE_test_LocalDemoSupportsEveryCountWithoutDuplicates", count);
            assertEq(roles.length,count);
            for(uint256 i;i<count;i++) {
                assertTrue(roles[i]!=address(0));
                for(uint256 j;j<i;j++) assertTrue(roles[i]!=roles[j],"duplicate demo roles");
            }
        }
    }
    function test_ExplicitRoleControl() public {
        vm.chainId(133);
        vm.setEnv("ROLE_test_ExplicitRoleControl", "0x1111111111111111111111111111111111111111,0x2222222222222222222222222222222222222222");
        address[] memory roles=harness.readRoles("ROLE_test_ExplicitRoleControl",2);
        assertEq(roles[0],address(0x1111111111111111111111111111111111111111));
        assertEq(roles[1],address(0x2222222222222222222222222222222222222222));
    }
}
