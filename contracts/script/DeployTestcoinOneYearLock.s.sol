// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20, TestcoinOneYearLock} from "../src/TestcoinOneYearLock.sol";

interface Vm {
    function envAddress(string calldata name) external view returns (address);
    function startBroadcast() external;
    function stopBroadcast() external;
}

contract DeployTestcoinOneYearLock {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (TestcoinOneYearLock lockContract) {
        address token = vm.envAddress("BASE_SEPOLIA_TESTCOIN_ADDRESS");
        vm.startBroadcast();
        lockContract = new TestcoinOneYearLock(IERC20(token));
        vm.stopBroadcast();
    }
}
