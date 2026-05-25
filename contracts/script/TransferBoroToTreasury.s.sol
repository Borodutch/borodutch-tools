// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface VmBoroTreasuryTransfer {
    function envAddress(string calldata name) external view returns (address);
    function envUint(string calldata name) external view returns (uint256);
    function startBroadcast() external;
    function stopBroadcast() external;
}

interface IBoroTransfer {
    function transfer(address to, uint256 amount) external returns (bool);
}

contract TransferBoroToTreasury {
    VmBoroTreasuryTransfer private constant vm =
        VmBoroTreasuryTransfer(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 public constant BASE_MAINNET_CHAIN_ID = 8453;

    error WrongChain(uint256 chainId);
    error TransferFailed();

    function run() external {
        if (block.chainid != BASE_MAINNET_CHAIN_ID) revert WrongChain(block.chainid);

        IBoroTransfer token = IBoroTransfer(vm.envAddress("BORO_PROXY_ADDRESS"));
        address treasury = vm.envAddress("BORO_TREASURY_ADDRESS");
        uint256 amount = vm.envUint("BORO_TREASURY_TRANSFER_AMOUNT_RAW");

        vm.startBroadcast();
        if (!token.transfer(treasury, amount)) revert TransferFailed();
        vm.stopBroadcast();
    }
}
