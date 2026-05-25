// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

library SafeERC20Lite {
    error ERC20CallFailed();
    error ERC20OperationFailed();

    function safeTransfer(IERC20 token, address to, uint256 amount) internal {
        _callOptionalReturn(address(token), abi.encodeCall(token.transfer, (to, amount)));
    }

    function safeTransferFrom(IERC20 token, address from, address to, uint256 amount) internal {
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

abstract contract ReentrancyGuardLite {
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _status = _NOT_ENTERED;

    error ReentrantCall();

    modifier nonReentrant() {
        if (_status == _ENTERED) revert ReentrantCall();
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }
}

contract TestcoinOneYearLock is ReentrancyGuardLite {
    using SafeERC20Lite for IERC20;

    uint256 public constant MIN_LOCK_DURATION = 365 days;

    IERC20 public immutable token;
    uint256 public nextPositionId = 1;
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

    event Locked(address indexed owner, uint256 indexed positionId, uint256 amount, uint256 lockedAt, uint256 unlockAt);
    event Withdrawn(address indexed owner, uint256 indexed positionId, uint256 amount);

    error InvalidToken();
    error UnsupportedAsset();
    error ZeroAmount();
    error UnknownPosition();
    error NotPositionOwner();
    error AlreadyWithdrawn();
    error LockNotMatured(uint256 unlockAt);

    constructor(IERC20 token_) {
        if (address(token_) == address(0)) revert InvalidToken();
        token = token_;
    }

    receive() external payable {
        revert UnsupportedAsset();
    }

    fallback() external payable {
        revert UnsupportedAsset();
    }

    function lock(uint256 amount) external payable nonReentrant returns (uint256 positionId) {
        if (msg.value != 0) revert UnsupportedAsset();
        if (amount == 0) revert ZeroAmount();

        uint256 lockedAt = block.timestamp;
        uint256 unlockAt = lockedAt + MIN_LOCK_DURATION;
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

    function positionIdsOf(address owner) external view returns (uint256[] memory) {
        return _ownerPositionIds[owner];
    }

    function getPositionIds(address owner, uint256 cursor, uint256 size)
        external
        view
        returns (uint256[] memory ids, uint256 nextCursor, bool done)
    {
        uint256[] storage source = _ownerPositionIds[owner];
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

    function maturedLockedAmountOf(address owner) external view returns (uint256 amount) {
        uint256[] storage ownerIds = _ownerPositionIds[owner];

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
}
