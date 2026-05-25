// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20, SafeERC20Lite, TestcoinOneYearLock} from "../src/TestcoinOneYearLock.sol";

interface Vm {
    function deal(address account, uint256 amount) external;
    function expectRevert(bytes4 selector) external;
    function expectRevert(bytes calldata revertData) external;
    function prank(address sender) external;
    function startPrank(address sender) external;
    function stopPrank() external;
    function warp(uint256 timestamp) external;
}

contract MockERC20 is IERC20 {
    string public constant name = "Base Sepolia Testcoin";
    string public constant symbol = "TEST";
    uint8 public constant decimals = 18;

    mapping(address account => uint256 amount) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (balanceOf[msg.sender] < amount) revert("balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (balanceOf[from] < amount) revert("balance");
        if (allowance[from][msg.sender] < amount) revert("allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract TestcoinOneYearLockTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    MockERC20 private token;
    TestcoinOneYearLock private lockContract;

    address private constant ALICE = address(0xA11CE);
    address private constant BOB = address(0xB0B);

    function setUp() external {
        token = new MockERC20();
        lockContract = new TestcoinOneYearLock(token);
        token.mint(ALICE, 1_000 ether);
        token.mint(BOB, 1_000 ether);
    }

    function testLockTransfersTokensAndUpdatesTotals() external {
        _approveAndLock(ALICE, 100 ether);

        assertEq(token.balanceOf(ALICE), 900 ether, "alice balance");
        assertEq(token.balanceOf(address(lockContract)), 100 ether, "contract balance");
        assertEq(lockContract.totalLocked(), 100 ether, "total locked");
        assertEq(lockContract.lockedAmountOf(ALICE), 100 ether, "alice locked");
        assertEq(lockContract.activePositionCount(), 1, "active count");

        (address owner, uint256 amount, uint64 lockedAt, uint64 unlockAt, bool withdrawn) = lockContract.positions(1);
        assertEq(owner, ALICE, "owner");
        assertEq(amount, 100 ether, "amount");
        assertEq(uint256(unlockAt), uint256(lockedAt) + lockContract.MIN_LOCK_DURATION(), "unlock");
        assertFalse(withdrawn, "withdrawn");
    }

    function testRejectsZeroAmountLock() external {
        vm.startPrank(ALICE);
        token.approve(address(lockContract), 1 ether);
        vm.expectRevert(TestcoinOneYearLock.ZeroAmount.selector);
        lockContract.lock(0);
        vm.stopPrank();
    }

    function testPlainEthTransferRevertsAndLeavesAccountingUnchanged() external {
        vm.deal(ALICE, 1 ether);

        vm.prank(ALICE);
        (bool success, bytes memory returndata) = payable(address(lockContract)).call{value: 1 wei}("");

        assertFalse(success, "eth transfer success");
        assertEq(bytes4(returndata), TestcoinOneYearLock.UnsupportedAsset.selector, "revert selector");
        assertEq(address(lockContract).balance, 0, "eth balance");
        assertEq(token.balanceOf(address(lockContract)), 0, "token balance");
        assertEq(lockContract.totalLocked(), 0, "total locked");
        assertEq(lockContract.lockedAmountOf(ALICE), 0, "alice locked");
        assertEq(lockContract.activePositionCount(), 0, "active count");
    }

    function testCalldataWithValueRevertsAndLeavesAccountingUnchanged() external {
        vm.deal(ALICE, 1 ether);

        vm.prank(ALICE);
        (bool success, bytes memory returndata) =
            payable(address(lockContract)).call{value: 1 wei}(abi.encodeCall(lockContract.lock, (1 ether)));

        assertFalse(success, "value call success");
        assertEq(bytes4(returndata), TestcoinOneYearLock.UnsupportedAsset.selector, "revert selector");
        assertEq(address(lockContract).balance, 0, "eth balance");
        assertEq(token.balanceOf(address(lockContract)), 0, "token balance");
        assertEq(lockContract.totalLocked(), 0, "total locked");
        assertEq(lockContract.lockedAmountOf(ALICE), 0, "alice locked");
        assertEq(lockContract.activePositionCount(), 0, "active count");
    }

    function testLockCannotUseUnsupportedTokenApproval() external {
        MockERC20 unsupportedToken = new MockERC20();
        unsupportedToken.mint(ALICE, 100 ether);

        vm.startPrank(ALICE);
        unsupportedToken.approve(address(lockContract), 100 ether);
        vm.expectRevert(SafeERC20Lite.ERC20CallFailed.selector);
        lockContract.lock(100 ether);
        vm.stopPrank();

        assertEq(unsupportedToken.balanceOf(ALICE), 100 ether, "unsupported token alice balance");
        assertEq(unsupportedToken.balanceOf(address(lockContract)), 0, "unsupported token contract balance");
        assertEq(token.balanceOf(address(lockContract)), 0, "configured token contract balance");
        assertEq(lockContract.totalLocked(), 0, "total locked");
        assertEq(lockContract.lockedAmountOf(ALICE), 0, "alice locked");
        assertEq(lockContract.activePositionCount(), 0, "active count");
    }

    function testCannotWithdrawBeforeOneYear() external {
        _approveAndLock(ALICE, 100 ether);
        (,,, uint64 unlockAt,) = lockContract.positions(1);

        vm.prank(ALICE);
        vm.expectRevert(abi.encodeWithSelector(TestcoinOneYearLock.LockNotMatured.selector, uint256(unlockAt)));
        lockContract.withdraw(1);
    }

    function testOnlyOwnerCanWithdraw() external {
        _approveAndLock(ALICE, 100 ether);
        (,,, uint64 unlockAt,) = lockContract.positions(1);
        vm.warp(unlockAt);

        vm.prank(BOB);
        vm.expectRevert(TestcoinOneYearLock.NotPositionOwner.selector);
        lockContract.withdraw(1);
    }

    function testCanWithdrawAfterOneYear() external {
        _approveAndLock(ALICE, 100 ether);
        (,,, uint64 unlockAt,) = lockContract.positions(1);
        vm.warp(unlockAt);

        vm.prank(ALICE);
        lockContract.withdraw(1);

        assertEq(token.balanceOf(ALICE), 1_000 ether, "alice balance");
        assertEq(token.balanceOf(address(lockContract)), 0, "contract balance");
        assertEq(lockContract.totalLocked(), 0, "total locked");
        assertEq(lockContract.lockedAmountOf(ALICE), 0, "alice locked");
        assertEq(lockContract.activePositionCount(), 0, "active count");
        (,,,, bool withdrawn) = lockContract.positions(1);
        assertTrue(withdrawn, "withdrawn");
    }

    function testCannotWithdrawTwice() external {
        _approveAndLock(ALICE, 100 ether);
        (,,, uint64 unlockAt,) = lockContract.positions(1);
        vm.warp(unlockAt);

        vm.startPrank(ALICE);
        lockContract.withdraw(1);
        vm.expectRevert(TestcoinOneYearLock.AlreadyWithdrawn.selector);
        lockContract.withdraw(1);
        vm.stopPrank();
    }

    function testWithdrawMaturedWithdrawsOnlyMaturedPositions() external {
        _approveAndLock(ALICE, 100 ether);
        vm.warp(100 days);
        _approveAndLock(ALICE, 40 ether);
        (,,, uint64 unlockAt,) = lockContract.positions(1);
        vm.warp(unlockAt);

        assertEq(lockContract.maturedLockedAmountOf(ALICE), 100 ether, "matured before");

        vm.prank(ALICE);
        (uint256 withdrawnAmount, uint256 withdrawnCount) = lockContract.withdrawMatured();

        assertEq(withdrawnAmount, 100 ether, "withdrawn amount");
        assertEq(withdrawnCount, 1, "withdrawn count");
        assertEq(lockContract.lockedAmountOf(ALICE), 40 ether, "remaining locked");
        assertEq(lockContract.maturedLockedAmountOf(ALICE), 0, "matured after");
    }

    function testPerAddressAndGlobalMaturedAccounting() external {
        _approveAndLock(ALICE, 100 ether);
        vm.warp(100 days);
        _approveAndLock(BOB, 25 ether);
        (,,, uint64 unlockAt,) = lockContract.positions(1);
        vm.warp(unlockAt);

        assertEq(lockContract.lockedAmountOf(ALICE), 100 ether, "alice locked");
        assertEq(lockContract.lockedAmountOf(BOB), 25 ether, "bob locked");
        assertEq(lockContract.maturedLockedAmountOf(ALICE), 100 ether, "alice matured");
        assertEq(lockContract.maturedLockedAmountOf(BOB), 0, "bob matured");

        (uint256 firstPage, uint256 nextCursor, bool done) = lockContract.maturedLockedTotal(0, 1);
        assertEq(firstPage, 100 ether, "first page");
        assertEq(nextCursor, 1, "next cursor");
        assertFalse(done, "first done");

        (uint256 secondPage,, bool secondDone) = lockContract.maturedLockedTotal(nextCursor, 10);
        assertEq(secondPage, 0, "second page");
        assertTrue(secondDone, "second done");
    }

    function testGetPositionIdsPaginatesOwnerPositions() external {
        _approveAndLock(ALICE, 10 ether);
        _approveAndLock(ALICE, 20 ether);

        (uint256[] memory ids, uint256 nextCursor, bool done) = lockContract.getPositionIds(ALICE, 0, 1);

        assertEq(ids.length, 1, "page length");
        assertEq(ids[0], 1, "first id");
        assertEq(nextCursor, 1, "next cursor");
        assertFalse(done, "done");
    }

    function _approveAndLock(address owner, uint256 amount) private {
        vm.startPrank(owner);
        token.approve(address(lockContract), amount);
        lockContract.lock(amount);
        vm.stopPrank();
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

    function assertEq(bytes4 actual, bytes4 expected, string memory message) private pure {
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
