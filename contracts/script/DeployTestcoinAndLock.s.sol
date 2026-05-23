// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseSepoliaTestcoin} from "../src/BaseSepoliaTestcoin.sol";
import {IERC20, TestcoinOneYearLock} from "../src/TestcoinOneYearLock.sol";

interface Vm {
    function envUint(string calldata name) external view returns (uint256);
    function startBroadcast() external;
    function stopBroadcast() external;
}

contract DeployTestcoinAndLock {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (BaseSepoliaTestcoin token, TestcoinOneYearLock lockContract) {
        uint256 initialSupply = vm.envUint("TESTCOIN_INITIAL_SUPPLY_RAW");

        vm.startBroadcast();
        token = new BaseSepoliaTestcoin("Base Sepolia Testcoin", "TEST", initialSupply, msg.sender);
        lockContract = new TestcoinOneYearLock(IERC20(address(token)));
        vm.stopBroadcast();
    }
}
