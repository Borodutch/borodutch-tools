// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IBoroLockToken {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IBoroLockProxiable {
    function proxiableUUID() external view returns (bytes32);
}

library BoroLockSafeERC20 {
    error ERC20CallFailed();
    error ERC20OperationFailed();

    function safeTransfer(IBoroLockToken token, address to, uint256 amount) internal {
        _callOptionalReturn(address(token), abi.encodeCall(token.transfer, (to, amount)));
    }

    function safeTransferFrom(IBoroLockToken token, address from, address to, uint256 amount) internal {
        _callOptionalReturn(address(token), abi.encodeCall(token.transferFrom, (from, to, amount)));
    }

    function _callOptionalReturn(address token, bytes memory data) private {
        (bool success, bytes memory returndata) = token.call(data);
        if (!success) revert ERC20CallFailed();
        if (returndata.length != 0 && !abi.decode(returndata, (bool))) {
            revert ERC20OperationFailed();
        }
    }
}

contract BoroOneYearLock is IBoroLockProxiable {
    using BoroLockSafeERC20 for IBoroLockToken;

    bytes32 public constant IMPLEMENTATION_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
    uint256 public constant MIN_LOCK_DURATION = 365 days;

    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    bool private _initialized;
    uint256 private _status;

    IBoroLockToken public token;
    address public owner;
    uint256 public lockDuration;
    uint256 public nextPositionId;
    uint256 public totalLocked;

    struct Position {
        address owner;
        uint256 amount;
        uint64 lockedAt;
        uint64 unlockAt;
        bool withdrawn;
    }

    mapping(uint256 positionId => Position) public positions;
    mapping(address owner => uint256 activeAmount) public lockedAmountOf;

    mapping(address owner => uint256[]) private _ownerPositionIds;
    uint256[] private _activePositionIds;
    mapping(uint256 positionId => uint256 indexPlusOne) private _activePositionIndex;

    event Initialized(address indexed token, address indexed owner, uint256 lockDuration);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event Upgraded(address indexed implementation);
    event Locked(address indexed owner, uint256 indexed positionId, uint256 amount, uint256 lockedAt, uint256 unlockAt);
    event Withdrawn(address indexed owner, uint256 indexed positionId, uint256 amount);

    error AlreadyInitialized();
    error AlreadyWithdrawn();
    error EthNotAccepted();
    error InvalidImplementation();
    error InvalidLockDuration();
    error InvalidToken();
    error LockNotMatured(uint256 unlockAt);
    error NotPositionOwner();
    error ReentrantCall();
    error Unauthorized();
    error UnknownPosition();
    error ZeroAddress();
    error ZeroAmount();

    constructor() {
        _initialized = true;
    }

    function initialize(address token_, address initialOwner, uint256 lockDuration_) external {
        if (_initialized) revert AlreadyInitialized();
        if (token_ == address(0)) revert InvalidToken();
        if (initialOwner == address(0)) revert ZeroAddress();
        if (lockDuration_ < MIN_LOCK_DURATION) revert InvalidLockDuration();

        _initialized = true;
        _status = _NOT_ENTERED;
        token = IBoroLockToken(token_);
        owner = initialOwner;
        lockDuration = lockDuration_;
        nextPositionId = 1;

        emit OwnershipTransferred(address(0), initialOwner);
        emit Initialized(token_, initialOwner, lockDuration_);
    }

    receive() external payable {
        revert EthNotAccepted();
    }

    fallback() external payable {
        revert EthNotAccepted();
    }

    function lock(uint256 amount) external nonReentrant returns (uint256 positionId) {
        if (amount == 0) revert ZeroAmount();

        uint256 lockedAt = block.timestamp;
        uint256 unlockAt = lockedAt + lockDuration;
        positionId = nextPositionId++;

        positions[positionId] = Position({
            owner: msg.sender, amount: amount, lockedAt: uint64(lockedAt), unlockAt: uint64(unlockAt), withdrawn: false
        });
        _ownerPositionIds[msg.sender].push(positionId);
        _activePositionIndex[positionId] = _activePositionIds.length + 1;
        _activePositionIds.push(positionId);

        lockedAmountOf[msg.sender] += amount;
        totalLocked += amount;

        token.safeTransferFrom(msg.sender, address(this), amount);

        emit Locked(msg.sender, positionId, amount, lockedAt, unlockAt);
    }

    function withdraw(uint256 positionId) external nonReentrant {
        Position storage position = positions[positionId];
        if (position.owner == address(0)) revert UnknownPosition();
        if (position.owner != msg.sender) revert NotPositionOwner();
        if (position.withdrawn) revert AlreadyWithdrawn();
        if (block.timestamp < position.unlockAt) revert LockNotMatured(position.unlockAt);

        uint256 amount = position.amount;
        position.withdrawn = true;
        lockedAmountOf[msg.sender] -= amount;
        totalLocked -= amount;
        _removeActivePosition(positionId);

        token.safeTransfer(msg.sender, amount);

        emit Withdrawn(msg.sender, positionId, amount);
    }

    function withdrawMatured() external nonReentrant returns (uint256 withdrawnAmount, uint256 withdrawnCount) {
        uint256[] storage ownerIds = _ownerPositionIds[msg.sender];

        for (uint256 index = 0; index < ownerIds.length; index++) {
            uint256 positionId = ownerIds[index];
            Position storage position = positions[positionId];

            if (!position.withdrawn && block.timestamp >= position.unlockAt) {
                uint256 amount = position.amount;
                position.withdrawn = true;
                withdrawnAmount += amount;
                withdrawnCount++;
                lockedAmountOf[msg.sender] -= amount;
                totalLocked -= amount;
                _removeActivePosition(positionId);
                emit Withdrawn(msg.sender, positionId, amount);
            }
        }

        if (withdrawnAmount > 0) {
            token.safeTransfer(msg.sender, withdrawnAmount);
        }
    }

    function positionIdsOf(address account) external view returns (uint256[] memory) {
        return _ownerPositionIds[account];
    }

    function getPositionIds(address account, uint256 cursor, uint256 size)
        external
        view
        returns (uint256[] memory ids, uint256 nextCursor, bool done)
    {
        uint256[] storage source = _ownerPositionIds[account];
        if (cursor >= source.length || size == 0) {
            return (new uint256[](0), cursor, true);
        }

        uint256 end = cursor + size;
        if (end > source.length) {
            end = source.length;
        }

        ids = new uint256[](end - cursor);
        for (uint256 index = cursor; index < end; index++) {
            ids[index - cursor] = source[index];
        }

        nextCursor = end;
        done = end == source.length;
    }

    function activePositionCount() external view returns (uint256) {
        return _activePositionIds.length;
    }

    function activePositionIdAt(uint256 index) external view returns (uint256) {
        return _activePositionIds[index];
    }

    function maturedLockedAmountOf(address account) external view returns (uint256 amount) {
        uint256[] storage ownerIds = _ownerPositionIds[account];

        for (uint256 index = 0; index < ownerIds.length; index++) {
            Position storage position = positions[ownerIds[index]];
            if (!position.withdrawn && block.timestamp >= position.unlockAt) {
                amount += position.amount;
            }
        }
    }

    function maturedLockedTotal(uint256 cursor, uint256 size)
        external
        view
        returns (uint256 amount, uint256 nextCursor, bool done)
    {
        if (cursor >= _activePositionIds.length || size == 0) {
            return (0, cursor, true);
        }

        uint256 end = cursor + size;
        if (end > _activePositionIds.length) {
            end = _activePositionIds.length;
        }

        for (uint256 index = cursor; index < end; index++) {
            Position storage position = positions[_activePositionIds[index]];
            if (block.timestamp >= position.unlockAt) {
                amount += position.amount;
            }
        }

        nextCursor = end;
        done = end == _activePositionIds.length;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function proxiableUUID() external pure returns (bytes32) {
        return IMPLEMENTATION_SLOT;
    }

    function upgradeToAndCall(address newImplementation, bytes calldata data) external payable onlyOwner {
        _validateImplementation(newImplementation);

        bytes32 implementationSlot = IMPLEMENTATION_SLOT;
        assembly {
            sstore(implementationSlot, newImplementation)
        }

        emit Upgraded(newImplementation);

        if (data.length > 0) {
            (bool success, bytes memory returndata) = newImplementation.delegatecall(data);
            if (!success) {
                if (returndata.length > 0) {
                    assembly {
                        revert(add(returndata, 32), mload(returndata))
                    }
                }
                revert InvalidImplementation();
            }
        }
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier nonReentrant() {
        if (_status == _ENTERED) revert ReentrantCall();
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }

    function _removeActivePosition(uint256 positionId) private {
        uint256 indexPlusOne = _activePositionIndex[positionId];
        if (indexPlusOne == 0) return;

        uint256 index = indexPlusOne - 1;
        uint256 lastIndex = _activePositionIds.length - 1;

        if (index != lastIndex) {
            uint256 movedPositionId = _activePositionIds[lastIndex];
            _activePositionIds[index] = movedPositionId;
            _activePositionIndex[movedPositionId] = indexPlusOne;
        }

        _activePositionIds.pop();
        delete _activePositionIndex[positionId];
    }

    function _validateImplementation(address newImplementation) private view {
        if (newImplementation == address(this)) revert InvalidImplementation();
        if (newImplementation.code.length == 0) revert InvalidImplementation();

        (bool success, bytes memory returndata) =
            newImplementation.staticcall(abi.encodeCall(IBoroLockProxiable.proxiableUUID, ()));

        if (!success || returndata.length != 32 || abi.decode(returndata, (bytes32)) != IMPLEMENTATION_SLOT) {
            revert InvalidImplementation();
        }
    }
}
