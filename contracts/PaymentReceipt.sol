// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract PaymentReceipt {
    event ReceiptIssued(
        bytes32 indexed decisionId,
        address indexed payer,
        string action,
        string reason,
        uint256 amountUsd,
        string metadataURI
    );

    function issueReceipt(
        bytes32 decisionId,
        string calldata action,
        string calldata reason,
        uint256 amountUsd,
        string calldata metadataURI
    ) external returns (bytes32) {
        emit ReceiptIssued(decisionId, msg.sender, action, reason, amountUsd, metadataURI);
        return decisionId;
    }
}
