// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC1822Proxiable {
    function proxiableUUID() external view returns (bytes32);
}

contract BoroToken is IERC1822Proxiable {
    bytes32 public constant IMPLEMENTATION_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
    uint256 public constant INITIAL_SUPPLY = 1_000_000_000 ether;

    bool private _initialized;

    uint256 public totalSupply;
    address public owner;

    mapping(address account => uint256 amount) public balanceOf;
    mapping(address account => mapping(address spender => uint256 amount)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event Upgraded(address indexed implementation);

    error AlreadyInitialized();
    error InvalidImplementation();
    error InsufficientAllowance();
    error InsufficientBalance();
    error Unauthorized();
    error ZeroAddress();

    constructor() {
        _initialized = true;
    }

    function initialize(address initialRecipient, address initialOwner) external {
        if (_initialized) revert AlreadyInitialized();
        if (initialRecipient == address(0) || initialOwner == address(0)) revert ZeroAddress();

        _initialized = true;
        owner = initialOwner;
        totalSupply = INITIAL_SUPPLY;
        balanceOf[initialRecipient] = INITIAL_SUPPLY;

        emit OwnershipTransferred(address(0), initialOwner);
        emit Transfer(address(0), initialRecipient, INITIAL_SUPPLY);
    }

    function name() external pure returns (string memory) {
        return "BOROTOKEN";
    }

    function symbol() external pure returns (string memory) {
        return "BORO";
    }

    function decimals() external pure returns (uint8) {
        return 18;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        if (spender == address(0)) revert ZeroAddress();

        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 currentAllowance = allowance[from][msg.sender];
        if (currentAllowance < amount) revert InsufficientAllowance();

        if (currentAllowance != type(uint256).max) {
            allowance[from][msg.sender] = currentAllowance - amount;
            emit Approval(from, msg.sender, currentAllowance - amount);
        }

        _transfer(from, to, amount);
        return true;
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

    function _transfer(address from, address to, uint256 amount) private {
        if (to == address(0)) revert ZeroAddress();

        uint256 fromBalance = balanceOf[from];
        if (fromBalance < amount) revert InsufficientBalance();

        balanceOf[from] = fromBalance - amount;
        balanceOf[to] += amount;

        emit Transfer(from, to, amount);
    }

    function _validateImplementation(address newImplementation) private view {
        if (newImplementation == address(this)) revert InvalidImplementation();
        if (newImplementation.code.length == 0) revert InvalidImplementation();

        (bool success, bytes memory returndata) =
            newImplementation.staticcall(abi.encodeCall(IERC1822Proxiable.proxiableUUID, ()));

        if (!success || returndata.length != 32 || abi.decode(returndata, (bytes32)) != IMPLEMENTATION_SLOT) {
            revert InvalidImplementation();
        }
    }
}
