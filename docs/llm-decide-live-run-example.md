# ClipCordon LLM `decide()` 真实跑通示例

## 1. 使用场景、工具集与路径（一句话）

**场景**：LiveClip Rights Agent 每轮轮询 clip 价格与授权状态，由 LLM 在「告警 / 留痕 / 查声誉 / x402 采购 / 拒绝」之间选一条动作，并把决策 memo 上链留证。

**工具集**：`trigger_alert` · `record_only` · `check_erc8004_reputation` · `purchase_replacement_license` · `pay_for_service` · `decline`

**路径**：

```text
worker/src/index.ts（10 轮模拟轮询）
  → worker/src/alertOnAnomaly.ts（decide 入参 + tool handlers）
    → agent/src/llm.ts decide()（OpenAI tool_call）
      → 动作分发：notify / registry / reputation / x402 / console
      → agent/src/receipt.ts issueReceipt()（Base Sepolia 上链）
```

**外部依赖**：

| 组件 | 配置 |
|------|------|
| LLM | `agent/.env` → `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` |
| x402 | `X402_ENDPOINT=https://provable-grandpa-quintet.ngrok-free.dev/api/x402/license` → `web/x402-license-server.mjs`（localhost:3000） |
| 链上 | `PAYMENT_RECEIPT_ADDRESS=0xc7A09816Ce3D3e01A2Ae0483E76957d31FcDdf20` |

**本地启动**：

```bash
# 终端 1：x402 license server
cd web && npm run dev:x402-license

# 终端 2：worker 10 轮决策
cd worker && npm run dev
```

---

## 2. 真实 LLM 决策 + 链上决策日志

### 代表性决策（3 类必现动作）

| 轮次 | LLM 选择 | 决策摘要 | Receipt TX | memo（链上可读） |
|------|----------|----------|------------|------------------|
| 3 | `pay_for_service` | 缺跨平台 BGM 授权，走 x402 采购 | [0xde2523…debff](https://sepolia.basescan.org/tx/0xde2523f93e8e96e642ddc89c0b38a53570a0aad586aa9d7a15ab94d6ad0debff) | `pay_for_service\|Cross-platform BGM license missing for running-shoe-clip-002: current scope is T` |
| 4 | `decline` | 供应商拒绝跨平台授权 | [0x72871f…0abd](https://sepolia.basescan.org/tx/0x72871fdc4e964ae70cd05f7c4b1fe7f6eaa043e032013cee221075ea1f390abd) | `decline\|Supplier agent-bgm-cross-platform-01 restricts BGM license to TikTok only and ex` |
| 6 | `trigger_alert` | 价格 100.9→132（+30.82%）突变告警 | [0x51393b…0ec4](https://sepolia.basescan.org/tx/0x51393b8391aafd60a055e477ac9c8c855a0cf6ac4e2a5270c0dbd296d5130ec4) | `trigger_alert\|Sharp price spike on BGM license for running-shoe-clip-002: jumped from $100.90` |

### 第 3 轮 x402 真实结算

```text
[x402] service payment result: {
  status: 'settled',
  endpoint: 'https://provable-grandpa-quintet.ngrok-free.dev/api/x402/license',
  transactionHash: '0xff1d4969851de05a86373add719d8492483fff3d00b78636aab3fdf6d50e8d57',
  responseBody: {
    ok: true,
    licenseReceiptHash: 'license-1782065109408',
    licenseScope: ['TikTok', 'Reels', 'Shorts', 'commercial-use']
  }
}
```

### Basescan 验证路径

- 合约 Events：[0xc7A09816…Ddf20#events](https://sepolia.basescan.org/address/0xc7A09816Ce3D3e01A2Ae0483E76957d31FcDdf20#events)
- 点开任意 TX → **Status = Success**，Event Logs 可见 `ReceiptIssued`，memo 格式为 `action|理由`

---

## 3. 最新 10 事件 ↔ 10 轮决策对账

**结论**：链上 `ReceiptIssued` 最新 10 条 = 终端 10 轮 `[decision]`，一一对应；10 条 TX 全部 **Success**。

| 轮次 | 终端 action | Receipt TX | memo（链上） | Status |
|------|-------------|------------|--------------|--------|
| 1 | `record_only` | `0xb280…48da` | `record_only\|Selected tool record_only.` | Success |
| 2 | `record_only` | `0xba8d…4e46` | `record_only\|Selected tool record_only.` | Success |
| 3 | `pay_for_service` | `0xde25…debff` | `pay_for_service\|Cross-platform BGM license missing…` | Success |
| 4 | `decline` | `0x7287…0abd` | `decline\|Supplier agent-bgm-cross-platform-01 restricts…` | Success |
| 5 | `record_only` | `0x73f4…0377` | `record_only\|Selected tool record_only.` | Success |
| 6 | `trigger_alert` | `0x5139…0ec4` | `trigger_alert\|Sharp price spike on BGM license…` | Success |
| 7 | `record_only` | `0xf2f6…aca3` | `record_only\|Selected tool record_only.` | Success |
| 8 | `record_only` | `0x11f6…fd42` | `record_only\|Selected tool record_only.` | Success |
| 9 | `record_only` | `0x7f9e…6c71` | `record_only\|Selected tool record_only.` | Success |
| 10 | `record_only` | `0x0bff…b7a6` | `record_only\|Selected tool record_only.` | Success |

**分布**：`record_only` ×7 · `pay_for_service` ×1 · `decline` ×1 · `trigger_alert` ×1

### 终端结构化日志样例

```text
[decision] {
  scenario: 'alertOnAnomaly',
  action: 'pay_for_service',
  elapsedMs: 17174,
  argsSummary: '{"endpoint":"https://provable-grandpa-quintet.ngrok-free.dev/api/x402/license",...}',
  txHash: '0xff1d4969851de05a86373add719d8492483fff3d00b78636aab3fdf6d50e8d57'
}
[receipt] tx: https://sepolia.basescan.org/tx/0xde2523f93e8e96e642ddc89c0b38a53570a0aad586aa9d7a15ab94d6ad0debff
```

> 说明：`[decision].txHash` 在 `pay_for_service` 轮优先展示 x402 支付 TX；其余轮次为 receipt TX。每轮决策都会额外写一条 `issueReceipt` 上链留痕。
