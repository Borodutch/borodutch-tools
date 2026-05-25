// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IBoroDistributorToken {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

library BoroSafeERC20 {
    error ERC20CallFailed();
    error ERC20OperationFailed();

    function safeTransfer(IBoroDistributorToken token, address to, uint256 amount) internal {
        (bool success, bytes memory returndata) = address(token).call(abi.encodeCall(token.transfer, (to, amount)));
        if (!success) revert ERC20CallFailed();
        if (returndata.length != 0 && !abi.decode(returndata, (bool))) {
            revert ERC20OperationFailed();
        }
    }
}

abstract contract BoroReentrancyGuard {
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

contract BoroMerkleDistributor is BoroReentrancyGuard {
    using BoroSafeERC20 for IBoroDistributorToken;

    IBoroDistributorToken public immutable token;
    bytes32 public immutable merkleRoot;
    address public immutable owner;
    uint256 public immutable claimDeadline;
    uint256 public totalClaimed;

    mapping(address account => bool claimed) public hasClaimed;

    event Claimed(address indexed account, uint256 amount);
    event ExpiredTokensWithdrawn(address indexed to, uint256 amount);

    error InvalidToken();
    error InvalidMerkleRoot();
    error InvalidOwner();
    error InvalidDeadline();
    error ZeroAddress();
    error ZeroAmount();
    error AlreadyClaimed();
    error InvalidProof();
    error ClaimWindowClosed(uint256 deadline);
    error ClaimWindowOpen(uint256 deadline);
    error NotOwner();

    constructor(IBoroDistributorToken token_, bytes32 merkleRoot_, address owner_, uint256 claimDeadline_) {
        if (address(token_) == address(0)) revert InvalidToken();
        if (merkleRoot_ == bytes32(0)) revert InvalidMerkleRoot();
        if (owner_ == address(0)) revert InvalidOwner();
        if (claimDeadline_ <= block.timestamp) revert InvalidDeadline();

        token = token_;
        merkleRoot = merkleRoot_;
        owner = owner_;
        claimDeadline = claimDeadline_;
    }

    function claim(uint256 amount, bytes32[] calldata proof) external nonReentrant {
        if (block.timestamp > claimDeadline) revert ClaimWindowClosed(claimDeadline);
        if (amount == 0) revert ZeroAmount();
        if (hasClaimed[msg.sender]) revert AlreadyClaimed();
        if (!verify(proof, msg.sender, amount)) revert InvalidProof();

        hasClaimed[msg.sender] = true;
        totalClaimed += amount;

        token.safeTransfer(msg.sender, amount);

        emit Claimed(msg.sender, amount);
    }

    function withdrawExpired(address to, uint256 amount) external nonReentrant {
        if (msg.sender != owner) revert NotOwner();
        if (block.timestamp <= claimDeadline) revert ClaimWindowOpen(claimDeadline);
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        token.safeTransfer(to, amount);

        emit ExpiredTokensWithdrawn(to, amount);
    }

    function distributorBalance() external view returns (uint256) {
        return token.balanceOf(address(this));
    }

    function verify(bytes32[] calldata proof, address account, uint256 amount) public view returns (bool) {
        return processProof(proof, claimLeaf(account, amount)) == merkleRoot;
    }

    function claimLeaf(address account, uint256 amount) public pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(account, amount))));
    }

    function processProof(bytes32[] calldata proof, bytes32 leaf) public pure returns (bytes32 computedHash) {
        computedHash = leaf;

        for (uint256 index = 0; index < proof.length; index++) {
            computedHash = _hashPair(computedHash, proof[index]);
        }
    }

    function _hashPair(bytes32 left, bytes32 right) private pure returns (bytes32) {
        return left < right ? _efficientHash(left, right) : _efficientHash(right, left);
    }

    function _efficientHash(bytes32 left, bytes32 right) private pure returns (bytes32 value) {
        assembly {
            mstore(0x00, left)
            mstore(0x20, right)
            value := keccak256(0x00, 0x40)
        }
    }
}
