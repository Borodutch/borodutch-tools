// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BoroOneYearLock, BoroLockSafeERC20, IBoroLockToken} from "../src/BoroOneYearLock.sol";
import {ERC1967Proxy} from "../src/ERC1967Proxy.sol";
import {DeployBoroOneYearLock} from "../script/DeployBoroOneYearLock.s.sol";

interface VmBoroLockTest {
    function chainId(uint256 newChainId) external;
    function deal(address account, uint256 amount) external;
    function expectRevert(bytes4 selector) external;
    function expectRevert(bytes calldata revertData) external;
    function prank(address sender) external;
    function startPrank(address sender) external;
    function stopPrank() external;
    function warp(uint256 timestamp) external;
}

contract MockBoroLockToken is IBoroLockToken {
    string public constant name = "BOROTOKEN";
    string public constant symbol = "BORO";
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

contract ReenteringBoroLockToken is IBoroLockToken {
    mapping(address account => uint256 amount) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;

    BoroOneYearLock private _lockContract;
    uint256 private _reenterPositionId;
    bool private _reenter;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function seedLock(BoroOneYearLock lockContract, uint256 amount) external {
        _lockContract = lockContract;
        this.approve(address(lockContract), amount);
        lockContract.lock(amount);
    }

    function enableWithdrawReentry(uint256 positionId) external {
        _reenterPositionId = positionId;
        _reenter = true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (balanceOf[msg.sender] < amount) revert("balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (_reenter) {
            _reenter = false;
            _lockContract.withdraw(_reenterPositionId);
        }

        if (balanceOf[from] < amount) revert("balance");
        if (allowance[from][msg.sender] < amount) revert("allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract BoroOneYearLockV2 is BoroOneYearLock {
    function version() external pure returns (uint256) {
        return 2;
    }
}

contract NotBoroLockUUPS {}

contract BoroOneYearLockTest {
    VmBoroLockTest private constant vm = VmBoroLockTest(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 private constant MIN_LOCK_DURATION = 365 days;

    address private constant DEPLOYER = address(0xD3D10);
    address private constant ALICE = address(0xA11CE);
    address private constant BOB = address(0xB0B);

    MockBoroLockToken private token;
    BoroOneYearLock private implementation;
    ERC1967Proxy private proxy;
    BoroOneYearLock private lockContract;

    function setUp() external {
        token = new MockBoroLockToken();
        implementation = new BoroOneYearLock();
        proxy = new ERC1967Proxy(
            address(implementation),
            abi.encodeCall(BoroOneYearLock.initialize, (address(token), DEPLOYER, MIN_LOCK_DURATION))
        );
        lockContract = BoroOneYearLock(payable(address(proxy)));
        token.mint(ALICE, 1_000 ether);
        token.mint(BOB, 1_000 ether);
    }

    function testInitializesTokenOwnerAndDuration() external view {
        assertEq(address(lockContract.token()), address(token), "token");
        assertEq(lockContract.owner(), DEPLOYER, "owner");
        assertEq(lockContract.lockDuration(), 365 days, "duration");
        assertEq(lockContract.nextPositionId(), 1, "next id");
    }

    function testRejectsReinitialization() external {
        vm.expectRevert(BoroOneYearLock.AlreadyInitialized.selector);
        lockContract.initialize(address(token), DEPLOYER, 365 days);
    }

    function testImplementationCannotBeInitializedDirectly() external {
        vm.expectRevert(BoroOneYearLock.AlreadyInitialized.selector);
        implementation.initialize(address(token), DEPLOYER, 365 days);
    }

    function testRejectsInvalidInitializationArgs() external {
        BoroOneYearLock freshImplementation = new BoroOneYearLock();

        vm.expectRevert(BoroOneYearLock.InvalidToken.selector);
        new ERC1967Proxy(
            address(freshImplementation), abi.encodeCall(BoroOneYearLock.initialize, (address(0), DEPLOYER, 365 days))
        );

        vm.expectRevert(BoroOneYearLock.ZeroAddress.selector);
        new ERC1967Proxy(
            address(freshImplementation),
            abi.encodeCall(BoroOneYearLock.initialize, (address(token), address(0), 365 days))
        );

        vm.expectRevert(BoroOneYearLock.InvalidLockDuration.selector);
        new ERC1967Proxy(
            address(freshImplementation),
            abi.encodeCall(BoroOneYearLock.initialize, (address(token), DEPLOYER, 364 days))
        );
    }

    function testLockTransfersBoroAndUpdatesTotals() external {
        _approveAndLock(ALICE, 100 ether);

        assertEq(token.balanceOf(ALICE), 900 ether, "alice balance");
        assertEq(token.balanceOf(address(lockContract)), 100 ether, "contract balance");
        assertEq(lockContract.totalLocked(), 100 ether, "total locked");
        assertEq(lockContract.lockedAmountOf(ALICE), 100 ether, "alice locked");
        assertEq(lockContract.activePositionCount(), 1, "active count");

        (address owner, uint256 amount, uint64 lockedAt, uint64 unlockAt, bool withdrawn) = lockContract.positions(1);
        assertEq(owner, ALICE, "position owner");
        assertEq(amount, 100 ether, "position amount");
        assertEq(uint256(unlockAt), uint256(lockedAt) + lockContract.lockDuration(), "unlock");
        assertFalse(withdrawn, "withdrawn");
    }

    function testRejectsZeroAmountLock() external {
        vm.startPrank(ALICE);
        token.approve(address(lockContract), 1 ether);
        vm.expectRevert(BoroOneYearLock.ZeroAmount.selector);
        lockContract.lock(0);
        vm.stopPrank();
    }

    function testCannotWithdrawBeforeUnlock() external {
        _approveAndLock(ALICE, 100 ether);
        (,,, uint64 unlockAt,) = lockContract.positions(1);

        vm.prank(ALICE);
        vm.expectRevert(abi.encodeWithSelector(BoroOneYearLock.LockNotMatured.selector, uint256(unlockAt)));
        lockContract.withdraw(1);
    }

    function testOnlyOwnerCanWithdrawPosition() external {
        _approveAndLock(ALICE, 100 ether);
        (,,, uint64 unlockAt,) = lockContract.positions(1);
        vm.warp(unlockAt);

        vm.prank(BOB);
        vm.expectRevert(BoroOneYearLock.NotPositionOwner.selector);
        lockContract.withdraw(1);
    }

    function testCanWithdrawAfterUnlockAndCannotWithdrawTwice() external {
        _approveAndLock(ALICE, 100 ether);
        (,,, uint64 unlockAt,) = lockContract.positions(1);
        vm.warp(unlockAt);

        vm.startPrank(ALICE);
        lockContract.withdraw(1);
        vm.expectRevert(BoroOneYearLock.AlreadyWithdrawn.selector);
        lockContract.withdraw(1);
        vm.stopPrank();

        assertEq(token.balanceOf(ALICE), 1_000 ether, "alice balance");
        assertEq(token.balanceOf(address(lockContract)), 0, "contract balance");
        assertEq(lockContract.totalLocked(), 0, "total locked");
        assertEq(lockContract.lockedAmountOf(ALICE), 0, "alice locked");
        assertEq(lockContract.activePositionCount(), 0, "active count");
        (,,,, bool withdrawn) = lockContract.positions(1);
        assertTrue(withdrawn, "withdrawn");
    }

    function testWithdrawMaturedAndMaturedViews() external {
        _approveAndLock(ALICE, 100 ether);
        vm.warp(100 days);
        _approveAndLock(ALICE, 40 ether);
        _approveAndLock(BOB, 25 ether);
        (,,, uint64 unlockAt,) = lockContract.positions(1);
        vm.warp(unlockAt);

        assertEq(lockContract.maturedLockedAmountOf(ALICE), 100 ether, "alice matured");
        assertEq(lockContract.maturedLockedAmountOf(BOB), 0, "bob matured");

        (uint256 firstPage, uint256 nextCursor, bool done) = lockContract.maturedLockedTotal(0, 1);
        assertEq(firstPage, 100 ether, "first page");
        assertEq(nextCursor, 1, "next cursor");
        assertFalse(done, "first done");

        vm.prank(ALICE);
        (uint256 withdrawnAmount, uint256 withdrawnCount) = lockContract.withdrawMatured();

        assertEq(withdrawnAmount, 100 ether, "withdrawn amount");
        assertEq(withdrawnCount, 1, "withdrawn count");
        assertEq(lockContract.lockedAmountOf(ALICE), 40 ether, "remaining locked");
        assertEq(lockContract.maturedLockedAmountOf(ALICE), 0, "matured after");
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

    function testRejectsDirectEthSends() external {
        vm.deal(ALICE, 1 ether);

        vm.prank(ALICE);
        (bool success,) = address(lockContract).call{value: 1 wei}("");

        assertFalse(success, "eth send success");
        assertEq(address(lockContract).balance, 0, "eth balance");
        assertEq(lockContract.totalLocked(), 0, "total locked");
    }

    function testCalldataWithValueRevertsAndLeavesAccountingUnchanged() external {
        vm.deal(ALICE, 1 ether);

        vm.prank(ALICE);
        (bool success,) =
            payable(address(lockContract)).call{value: 1 wei}(abi.encodeCall(lockContract.lock, (1 ether)));

        assertFalse(success, "value call success");
        assertEq(address(lockContract).balance, 0, "eth balance");
        assertEq(token.balanceOf(address(lockContract)), 0, "token balance");
        assertEq(lockContract.totalLocked(), 0, "total locked");
        assertEq(lockContract.lockedAmountOf(ALICE), 0, "alice locked");
        assertEq(lockContract.activePositionCount(), 0, "active count");
    }

    function testLockCannotUseUnsupportedTokenApproval() external {
        MockBoroLockToken unsupportedToken = new MockBoroLockToken();
        unsupportedToken.mint(ALICE, 100 ether);

        vm.startPrank(ALICE);
        unsupportedToken.approve(address(lockContract), 100 ether);
        vm.expectRevert(BoroLockSafeERC20.ERC20CallFailed.selector);
        lockContract.lock(100 ether);
        vm.stopPrank();

        assertEq(unsupportedToken.balanceOf(ALICE), 100 ether, "unsupported token alice balance");
        assertEq(unsupportedToken.balanceOf(address(lockContract)), 0, "unsupported token contract balance");
        assertEq(token.balanceOf(address(lockContract)), 0, "configured token contract balance");
        assertEq(lockContract.totalLocked(), 0, "total locked");
        assertEq(lockContract.lockedAmountOf(ALICE), 0, "alice locked");
        assertEq(lockContract.activePositionCount(), 0, "active count");
    }

    function testOwnerCanTransferOwnershipAndAuthorizeUpgrade() external {
        BoroOneYearLockV2 upgradedImplementation = new BoroOneYearLockV2();

        vm.prank(BOB);
        vm.expectRevert(BoroOneYearLock.Unauthorized.selector);
        lockContract.transferOwnership(BOB);

        vm.prank(DEPLOYER);
        lockContract.transferOwnership(BOB);

        vm.prank(DEPLOYER);
        vm.expectRevert(BoroOneYearLock.Unauthorized.selector);
        lockContract.upgradeToAndCall(address(upgradedImplementation), "");

        vm.prank(BOB);
        lockContract.upgradeToAndCall(address(upgradedImplementation), "");

        assertEq(proxy.implementation(), address(upgradedImplementation), "implementation");
        assertEq(BoroOneYearLockV2(payable(address(lockContract))).version(), 2, "version");
        assertEq(lockContract.owner(), BOB, "new owner");
    }

    function testUpgradePreservesLockedBalancesAndStorage() external {
        _approveAndLock(ALICE, 100 ether);
        BoroOneYearLockV2 upgradedImplementation = new BoroOneYearLockV2();

        vm.prank(DEPLOYER);
        lockContract.upgradeToAndCall(address(upgradedImplementation), "");

        assertEq(address(lockContract.token()), address(token), "token");
        assertEq(lockContract.lockedAmountOf(ALICE), 100 ether, "alice locked");
        assertEq(lockContract.totalLocked(), 100 ether, "total locked");
        assertEq(lockContract.nextPositionId(), 2, "next id");
        assertEq(BoroOneYearLockV2(payable(address(lockContract))).version(), 2, "version");
    }

    function testRejectsInvalidUpgradeImplementation() external {
        NotBoroLockUUPS invalidImplementation = new NotBoroLockUUPS();

        vm.prank(DEPLOYER);
        vm.expectRevert(BoroOneYearLock.InvalidImplementation.selector);
        lockContract.upgradeToAndCall(address(invalidImplementation), "");
    }

    function testReentrancyCannotWithdrawDuringLockTransfer() external {
        ReenteringBoroLockToken reenteringToken = new ReenteringBoroLockToken();
        BoroOneYearLock reenterImplementation = new BoroOneYearLock();
        ERC1967Proxy reenterProxy = new ERC1967Proxy(
            address(reenterImplementation),
            abi.encodeCall(BoroOneYearLock.initialize, (address(reenteringToken), DEPLOYER, MIN_LOCK_DURATION))
        );
        BoroOneYearLock reenterLock = BoroOneYearLock(payable(address(reenterProxy)));

        reenteringToken.mint(address(reenteringToken), 10 ether);
        reenteringToken.seedLock(reenterLock, 10 ether);
        (,,, uint64 unlockAt,) = reenterLock.positions(1);
        vm.warp(unlockAt);

        reenteringToken.mint(ALICE, 100 ether);
        vm.startPrank(ALICE);
        reenteringToken.approve(address(reenterLock), 100 ether);
        reenteringToken.enableWithdrawReentry(1);
        vm.expectRevert(BoroLockSafeERC20.ERC20CallFailed.selector);
        reenterLock.lock(100 ether);
        vm.stopPrank();

        assertEq(reenterLock.totalLocked(), 10 ether, "total locked");
        assertEq(reenterLock.lockedAmountOf(address(reenteringToken)), 10 ether, "seed locked");
        (,,,, bool withdrawn) = reenterLock.positions(1);
        assertFalse(withdrawn, "seed withdrawn");
    }

    function testDeploymentScriptRefusesWrongChain() external {
        vm.chainId(84532);
        DeployBoroOneYearLock script = new DeployBoroOneYearLock();

        vm.expectRevert(abi.encodeWithSelector(DeployBoroOneYearLock.WrongChain.selector, 84532));
        script.run();
    }

    function _approveAndLock(address account, uint256 amount) private {
        vm.startPrank(account);
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
