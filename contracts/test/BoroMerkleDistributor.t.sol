// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BoroMerkleDistributor, IBoroDistributorToken} from "../src/BoroMerkleDistributor.sol";

interface Vm {
    function expectRevert() external;
    function expectRevert(bytes4 selector) external;
    function expectRevert(bytes calldata revertData) external;
    function prank(address sender) external;
    function startPrank(address sender) external;
    function stopPrank() external;
    function warp(uint256 timestamp) external;
}

contract MockBoroToken is IBoroDistributorToken {
    string public constant name = "BOROTOKEN";
    string public constant symbol = "BORO";
    uint8 public constant decimals = 18;

    mapping(address account => uint256 amount) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (balanceOf[msg.sender] < amount) revert("balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract BoroMerkleDistributorTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    MockBoroToken private token;
    BoroMerkleDistributor private distributor;

    address private constant OWNER = address(0xB0B0);
    address private constant ALICE = address(0xA11CE);
    address private constant BOB = address(0xB0B);
    uint256 private constant ALICE_AMOUNT = 100 ether;
    uint256 private constant BOB_AMOUNT = 25 ether;
    uint256 private constant DEADLINE = 30 days;

    bytes32 private aliceLeaf;
    bytes32 private bobLeaf;

    function setUp() external {
        token = new MockBoroToken();
        aliceLeaf = _leaf(ALICE, ALICE_AMOUNT);
        bobLeaf = _leaf(BOB, BOB_AMOUNT);
        distributor = new BoroMerkleDistributor(token, _hashPair(aliceLeaf, bobLeaf), OWNER, DEADLINE);
        token.mint(address(distributor), ALICE_AMOUNT + BOB_AMOUNT);
    }

    function testClaimTransfersAllocationAndRecordsClaim() external {
        bytes32[] memory proof = _singleProof(bobLeaf);

        vm.prank(ALICE);
        distributor.claim(ALICE_AMOUNT, proof);

        assertEq(token.balanceOf(ALICE), ALICE_AMOUNT, "alice balance");
        assertEq(token.balanceOf(address(distributor)), BOB_AMOUNT, "distributor balance");
        assertEq(distributor.totalClaimed(), ALICE_AMOUNT, "total claimed");
        assertTrue(distributor.hasClaimed(ALICE), "alice claimed");
    }

    function testRejectsInvalidProof() external {
        bytes32[] memory proof = _singleProof(bobLeaf);

        vm.prank(BOB);
        vm.expectRevert(BoroMerkleDistributor.InvalidProof.selector);
        distributor.claim(ALICE_AMOUNT, proof);
    }

    function testPreventsDoubleClaim() external {
        bytes32[] memory proof = _singleProof(bobLeaf);

        vm.startPrank(ALICE);
        distributor.claim(ALICE_AMOUNT, proof);
        vm.expectRevert(BoroMerkleDistributor.AlreadyClaimed.selector);
        distributor.claim(ALICE_AMOUNT, proof);
        vm.stopPrank();
    }

    function testClaimRevertsAfterDeadline() external {
        bytes32[] memory proof = _singleProof(bobLeaf);
        vm.warp(DEADLINE + 1);

        vm.prank(ALICE);
        vm.expectRevert(abi.encodeWithSelector(BoroMerkleDistributor.ClaimWindowClosed.selector, DEADLINE));
        distributor.claim(ALICE_AMOUNT, proof);
    }

    function testInsufficientFundingRevertsWithoutRecordingClaim() external {
        MockBoroToken unfundedToken = new MockBoroToken();
        BoroMerkleDistributor unfunded =
            new BoroMerkleDistributor(unfundedToken, _hashPair(aliceLeaf, bobLeaf), OWNER, DEADLINE);
        bytes32[] memory proof = _singleProof(bobLeaf);

        vm.prank(ALICE);
        vm.expectRevert();
        unfunded.claim(ALICE_AMOUNT, proof);

        assertFalse(unfunded.hasClaimed(ALICE), "claim flag reverted");
        assertEq(unfunded.totalClaimed(), 0, "total claimed reverted");
    }

    function testOnlyOwnerCanWithdrawExpiredTokensAfterDeadline() external {
        vm.warp(DEADLINE + 1);

        vm.prank(ALICE);
        vm.expectRevert(BoroMerkleDistributor.NotOwner.selector);
        distributor.withdrawExpired(OWNER, 1 ether);

        vm.prank(OWNER);
        distributor.withdrawExpired(OWNER, 1 ether);

        assertEq(token.balanceOf(OWNER), 1 ether, "owner received expired tokens");
    }

    function testCannotWithdrawExpiredTokensBeforeDeadline() external {
        vm.prank(OWNER);
        vm.expectRevert(abi.encodeWithSelector(BoroMerkleDistributor.ClaimWindowOpen.selector, DEADLINE));
        distributor.withdrawExpired(OWNER, 1 ether);
    }

    function testConstructorRejectsZeroRootAndPastDeadline() external {
        vm.expectRevert(BoroMerkleDistributor.InvalidMerkleRoot.selector);
        new BoroMerkleDistributor(token, bytes32(0), OWNER, DEADLINE);

        vm.warp(DEADLINE);
        vm.expectRevert(BoroMerkleDistributor.InvalidDeadline.selector);
        new BoroMerkleDistributor(token, _hashPair(aliceLeaf, bobLeaf), OWNER, DEADLINE);
    }

    function _singleProof(bytes32 sibling) private pure returns (bytes32[] memory proof) {
        proof = new bytes32[](1);
        proof[0] = sibling;
    }

    function _leaf(address account, uint256 amount) private pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(account, amount))));
    }

    function _hashPair(bytes32 left, bytes32 right) private pure returns (bytes32) {
        return left < right ? keccak256(abi.encode(left, right)) : keccak256(abi.encode(right, left));
    }

    function assertEq(uint256 actual, uint256 expected, string memory message) private pure {
        if (actual != expected) {
            revert(message);
        }
    }

    function assertTrue(bool value, string memory message) private pure {
        if (!value) {
            revert(message);
        }
    }

    function assertFalse(bool value, string memory message) private pure {
        if (value) {
            revert(message);
        }
    }
}
