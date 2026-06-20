// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract PaymentReceipt {
    event ReceiptIssued(
        address indexed payer,
        address indexed payee,
        uint256 amount,
        string memo,
        uint256 timestamp
    );

    // Agent 每完成一次决策/支付，调一次这个函数，把"凭证"写上链
    function issueReceipt(address payee, uint256 amount, string calldata memo) external {
        emit ReceiptIssued(msg.sender, payee, amount, memo, block.timestamp);
    }
}
