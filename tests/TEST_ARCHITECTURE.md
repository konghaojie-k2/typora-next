# 测试架构设计

## 测试金字塔

```
       /\
      /  \   E2E (CLI)        - 整链路验证
     /----\  tests/e2e/
    /      \
   /--------\ Integration     - Agent Bridge 实际调用
  /          \ tests/integration/
 /------------\
/--------------\ Unit          - 函数级逻辑
                 tests/unit/
```

## 三层测试

### 1. Unit Test (TDD)
- **Rust**: `src-tauri/src/ai_agent.rs` 中的 `#[cfg(test)]`
  - AgentProcess PID 管理
  - get_agent_bridge_path 路径解析
  - JSON 解析容错
- **JS**: `tests/unit/test_agent_bridge.js`
  - extractJSON 各种输入
  - collectAgentOutput mock
  - 文件名生成

### 2. Integration Test
- `tests/integration/test_agent_bridge.js`
  - Mock Agent SDK → agent-bridge.js → 验证输出
  - 不依赖真实 Claude API

### 3. E2E Test (CLI)
- `tests/e2e/cli-test.js`
  - 命令行直接调用 agent-bridge.js
  - 验证 JSON lines 输出格式
  - 验证文件写入

## CLI 端到端方案

所有前端操作都可以参数化：

```bash
# Plan 阶段
node agent-bridge.js plan '{"config": {...}, "args": {"goal": "...", "level": "...", "hours": 3}}'

# Generate 阶段
node agent-bridge.js generate '{"config": {...}, "args": {"project_path": "...", "outline": {...}}}'
```

## Mock Agent SDK

测试时使用 Mock SDK，不调用真实 API：

```javascript
// tests/mock-agent-sdk/index.js
async function* query({ prompt }) {
  if (prompt.includes('设计学习大纲')) {
    yield { type: 'assistant', content: '{"chapters": [...]}' };
  }
}
```

测试时通过环境变量注入：
```bash
MOCK_AGENT_SDK=1 node tests/run-all.js
```
