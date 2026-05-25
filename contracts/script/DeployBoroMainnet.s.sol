// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BoroToken} from "../src/BoroToken.sol";
import {ERC1967Proxy} from "../src/ERC1967Proxy.sol";

interface VmBoroMainnet {
    function envAddress(string calldata name) external view returns (address);
    function startBroadcast() external;
    function stopBroadcast() external;
}

contract DeployBoroMainnet {
    VmBoroMainnet private constant vm = VmBoroMainnet(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 public constant BASE_MAINNET_CHAIN_ID = 8453;

    error WrongChain(uint256 chainId);

    function run() external returns (BoroToken implementation, ERC1967Proxy proxy, BoroToken token) {
        if (block.chainid != BASE_MAINNET_CHAIN_ID) revert WrongChain(block.chainid);

        address initialRecipient = vm.envAddress("BORO_INITIAL_RECIPIENT");
        address ownerOrUpgradeAdmin = vm.envAddress("BORO_OWNER_OR_UPGRADE_ADMIN");

        vm.startBroadcast();
        implementation = new BoroToken();
        proxy = new ERC1967Proxy(
            address(implementation), abi.encodeCall(BoroToken.initialize, (initialRecipient, ownerOrUpgradeAdmin))
        );
        token = BoroToken(address(proxy));
        vm.stopBroadcast();
    }
}
