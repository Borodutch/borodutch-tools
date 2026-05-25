// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BoroOneYearLock} from "../src/BoroOneYearLock.sol";
import {ERC1967Proxy} from "../src/ERC1967Proxy.sol";

interface VmBoroLockMainnet {
    function envAddress(string calldata name) external view returns (address);
    function envUint(string calldata name) external view returns (uint256);
    function envOr(string calldata name, address defaultValue) external view returns (address);
    function envOr(string calldata name, uint256 defaultValue) external view returns (uint256);
    function addr(uint256 privateKey) external returns (address);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

contract DeployBoroOneYearLock {
    VmBoroLockMainnet private constant vm = VmBoroLockMainnet(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 public constant BASE_MAINNET_CHAIN_ID = 8453;
    uint256 public constant DEFAULT_LOCK_DURATION = 365 days;

    error WrongChain(uint256 chainId);

    function run() external returns (BoroOneYearLock implementation, ERC1967Proxy proxy, BoroOneYearLock lockContract) {
        if (block.chainid != BASE_MAINNET_CHAIN_ID) revert WrongChain(block.chainid);

        address token = vm.envAddress("BORO_TOKEN_ADDRESS");
        uint256 deployerPrivateKey = vm.envUint("BASE_MAINNET_DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address owner = vm.envOr("BORO_LOCK_OWNER", deployer);
        uint256 lockDuration = vm.envOr("BORO_LOCK_DURATION_SECONDS", DEFAULT_LOCK_DURATION);

        vm.startBroadcast(deployerPrivateKey);
        implementation = new BoroOneYearLock();
        proxy = new ERC1967Proxy(
            address(implementation), abi.encodeCall(BoroOneYearLock.initialize, (token, owner, lockDuration))
        );
        lockContract = BoroOneYearLock(payable(address(proxy)));
        vm.stopBroadcast();
    }
}
