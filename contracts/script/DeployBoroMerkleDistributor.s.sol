// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BoroMerkleDistributor, IBoroDistributorToken} from "../src/BoroMerkleDistributor.sol";

interface Vm {
    function envAddress(string calldata name) external view returns (address);
    function envBytes32(string calldata name) external view returns (bytes32);
    function envUint(string calldata name) external view returns (uint256);
    function startBroadcast() external;
    function stopBroadcast() external;
}

contract DeployBoroMerkleDistributor {
    uint256 private constant BASE_MAINNET_CHAIN_ID = 8453;

    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    error WrongChain(uint256 expected, uint256 actual);
    error InvalidBoroAddress();

    function run() external returns (BoroMerkleDistributor distributor) {
        if (block.chainid != BASE_MAINNET_CHAIN_ID) {
            revert WrongChain(BASE_MAINNET_CHAIN_ID, block.chainid);
        }

        address token = vm.envAddress("BASE_MAINNET_BORO_ADDRESS");
        if (token == address(0)) revert InvalidBoroAddress();

        bytes32 merkleRoot = vm.envBytes32("BORO_MERKLE_ROOT");
        address owner = vm.envAddress("BORO_DISTRIBUTOR_OWNER");
        uint256 claimDeadline = vm.envUint("BORO_CLAIM_DEADLINE");

        vm.startBroadcast();
        distributor = new BoroMerkleDistributor(IBoroDistributorToken(token), merkleRoot, owner, claimDeadline);
        vm.stopBroadcast();
    }
}
