// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BoroToken} from "../src/BoroToken.sol";
import {ERC1967Proxy} from "../src/ERC1967Proxy.sol";
import {DeployBoroMainnet} from "../script/DeployBoroMainnet.s.sol";
import {TransferBoroToTreasury} from "../script/TransferBoroToTreasury.s.sol";

interface VmBoroTest {
    function chainId(uint256 newChainId) external;
    function expectRevert(bytes4 selector) external;
    function expectRevert(bytes calldata revertData) external;
    function prank(address sender) external;
}

contract BoroTokenV2 is BoroToken {
    function version() external pure returns (uint256) {
        return 2;
    }
}

contract NotUUPS {}

contract BoroTokenTest {
    VmBoroTest private constant vm = VmBoroTest(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant DEPLOYER = address(0xD3D10);
    address private constant OWNER = address(0xA11CE);
    address private constant BOB = address(0xB0B);

    BoroToken private implementation;
    ERC1967Proxy private proxy;
    BoroToken private token;

    function setUp() external {
        implementation = new BoroToken();
        proxy = new ERC1967Proxy(address(implementation), abi.encodeCall(BoroToken.initialize, (DEPLOYER, OWNER)));
        token = BoroToken(address(proxy));
    }

    function testInitializesBoroMetadataAndSupply() external view {
        assertEq(token.name(), "BOROTOKEN", "name");
        assertEq(token.symbol(), "BORO", "symbol");
        assertEq(uint256(token.decimals()), 18, "decimals");
        assertEq(token.totalSupply(), 1_000_000_000 ether, "total supply");
        assertEq(token.balanceOf(DEPLOYER), 1_000_000_000 ether, "initial recipient balance");
        assertEq(token.owner(), OWNER, "owner");
    }

    function testRejectsReinitialization() external {
        vm.expectRevert(BoroToken.AlreadyInitialized.selector);
        token.initialize(BOB, BOB);
    }

    function testImplementationCannotBeInitializedDirectly() external {
        vm.expectRevert(BoroToken.AlreadyInitialized.selector);
        implementation.initialize(BOB, BOB);
    }

    function testTransfersAndApprovalsUseFixedSupply() external {
        vm.prank(DEPLOYER);
        token.transfer(BOB, 10 ether);

        assertEq(token.balanceOf(BOB), 10 ether, "bob balance");
        assertEq(token.balanceOf(DEPLOYER), 999_999_990 ether, "deployer balance");
        assertEq(token.totalSupply(), 1_000_000_000 ether, "supply unchanged");

        vm.prank(BOB);
        token.approve(DEPLOYER, 4 ether);

        vm.prank(DEPLOYER);
        token.transferFrom(BOB, DEPLOYER, 4 ether);

        assertEq(token.balanceOf(BOB), 6 ether, "bob balance after transferFrom");
        assertEq(token.allowance(BOB, DEPLOYER), 0, "allowance spent");
        assertEq(token.totalSupply(), 1_000_000_000 ether, "supply still unchanged");
    }

    function testOnlyOwnerCanTransferOwnership() external {
        vm.prank(BOB);
        vm.expectRevert(BoroToken.Unauthorized.selector);
        token.transferOwnership(BOB);

        vm.prank(OWNER);
        token.transferOwnership(BOB);

        assertEq(token.owner(), BOB, "new owner");
    }

    function testOnlyOwnerCanUpgrade() external {
        BoroTokenV2 upgradedImplementation = new BoroTokenV2();

        vm.prank(BOB);
        vm.expectRevert(BoroToken.Unauthorized.selector);
        token.upgradeToAndCall(address(upgradedImplementation), "");

        vm.prank(OWNER);
        token.upgradeToAndCall(address(upgradedImplementation), "");

        assertEq(proxy.implementation(), address(upgradedImplementation), "implementation");
        assertEq(BoroTokenV2(address(token)).version(), 2, "upgraded version");
        assertEq(token.balanceOf(DEPLOYER), 1_000_000_000 ether, "balance preserved");
        assertEq(token.owner(), OWNER, "owner preserved");
    }

    function testRejectsInvalidUpgradeImplementation() external {
        NotUUPS invalidImplementation = new NotUUPS();

        vm.prank(OWNER);
        vm.expectRevert(BoroToken.InvalidImplementation.selector);
        token.upgradeToAndCall(address(invalidImplementation), "");
    }

    function testRejectsProxyAsUpgradeImplementation() external {
        vm.prank(OWNER);
        vm.expectRevert(BoroToken.InvalidImplementation.selector);
        token.upgradeToAndCall(address(token), "");
    }

    function testDeploymentScriptRefusesWrongChain() external {
        vm.chainId(84532);
        DeployBoroMainnet script = new DeployBoroMainnet();

        vm.expectRevert(abi.encodeWithSelector(DeployBoroMainnet.WrongChain.selector, 84532));
        script.run();
    }

    function testTreasuryTransferScriptRefusesWrongChain() external {
        vm.chainId(84532);
        TransferBoroToTreasury script = new TransferBoroToTreasury();

        vm.expectRevert(abi.encodeWithSelector(TransferBoroToTreasury.WrongChain.selector, 84532));
        script.run();
    }

    function assertEq(uint256 actual, uint256 expected, string memory message) private pure {
        if (actual != expected) {
            revert(message);
        }
    }

    function assertEq(address actual, address expected, string memory message) private pure {
        if (actual != expected) {
            revert(message);
        }
    }

    function assertEq(string memory actual, string memory expected, string memory message) private pure {
        if (keccak256(bytes(actual)) != keccak256(bytes(expected))) {
            revert(message);
        }
    }
}
