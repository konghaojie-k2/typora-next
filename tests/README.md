# 测试规范

> 本规范适用于 typora-next 项目的 AI 学习设计师功能。
> 所有 Sprint 必须严格遵循：BDD feature -> TDD test -> 实现 -> 验收。

---

## 1. 目录结构（强制）

```
tests/
├── README.md                      # 本规范
├── run-all.js                     # 统一测试入口（自动发现各 Sprint 测试）
├── sprint1/ ~ sprint8/            # 按 Sprint 组织的测试
│   ├── features/                  # BDD Gherkin 场景文件
│   │   └── sprint{N}_{pb_title}.feature
│   ├── steps/                     # BDD Step Definitions（JS）
│   │   ├── steps.js               # Sprint 专属步骤
│   │   └── common.js              # 跨 Sprint 共享步骤（可选）
│   ├── unit/                      # JS 单元测试
│   │   └── test_{module}.js
│   └── integration/               # JS Integration Tests（可选）
│       └── test_{module}.js
├── bdd-acceptance/                # BDD 验收测试（真实文件系统层）
│   ├── runner.js
│   └── sprint{N}_{pb_title}.steps.js
├── e2e/                           # CLI 端到端测试
│   └── cli-test.js
├── samples/                       # 测试用 Markdown 样本
├── mock-agent-sdk/                # Mock Agent SDK
│   └── index.js
└── shared/                        # 跨 Sprint 共享工具
    ├── runner.js                  # Gherkin 解析器 + StepRegistry
    ├── test-runner.js             # 轻量测试框架（零外部依赖）
    ├── mock-dom.js                # Mock DOM 辅助
    └── steps/
        └── common.js              # 跨 Sprint 共享步骤

src-tauri/tests/                    # Rust Integration Tests
└── *_test.rs
```

**规则**：
- 每 Sprint 一个 feature 文件 + 一个 step definitions 文件
- JS 测试统一用 `tests/unit/test-runner.js`（不引入 jest/mocha 等外部依赖）
- Rust 测试统一用 `tests/*_test.rs`（integration test，不依赖 lib 内部模块）

---

## 2. BDD 规范

### 2.1 Feature 文件格式

```gherkin
Feature: {一句话描述用户价值}

  {用户故事格式：作为...我想要...以便...}

  Scenario: {具体场景描述}
    Given {前置条件}
    When  {用户动作}
    Then  {预期结果}
    And   {额外断言}
```

### 2.2 Step Pattern 风格（强制）

**禁止**在 pattern 中写引号：

```javascript
// ✅ 正确
steps.when('用户输入{string}', async function(text) { ... });
steps.when('点击第{int}章', async function(index) { ... });
steps.when('选择难度{string}', async function(level) { ... });

// ❌ 错误
steps.when('用户输入"{string}"', async function(text) { ... });
steps.when('点击第 {int} 章', async function(index) { ... });
```

**原因**：`{string}` 替换为 `[""""]([^""""]+)[""""]`，自动匹配中英文引号。pattern 中写引号会导致双重引号匹配。

### 2.3 验收标准

一个 Sprint 的 BDD **全部通过** = 该 Sprint 完成。

---

## 3. TDD 规范

### 3.1 JS 单元测试

```javascript
const TestRunner = require('./test-runner');
const { functionToTest } = require('../../path/to/module');

TestRunner.test('描述测试场景', () => {
  // Arrange
  const input = ...;
  
  // Act
  const result = functionToTest(input);
  
  // Assert
  TestRunner.assertEquals(result, expected, '失败消息');
});

// 运行
TestRunner.run();
```

### 3.2 Rust Integration Test

```rust
// tests/some_module_test.rs

#[test]
fn test_feature_scenario() {
    // Arrange
    let input = ...;
    
    // Act
    let result = function_to_test(input);
    
    // Assert
    assert_eq!(result, expected);
}
```

**运行方式**：
```bash
# 运行全部测试
node tests/run-all.js

# 只运行某个 Sprint
node tests/run-all.js --sprint=1

# 只运行单元测试
node tests/run-all.js --unit

# 只运行 BDD 测试
node tests/run-all.js --bdd

# 只运行验收测试（真实文件系统）
node tests/run-all.js --acceptance

# 运行单个单元测试文件
node tests/sprint1/unit/test_project_manager.js

# Rust 测试（主仓库）
cd src-tauri && cargo test --test some_module_test
```

### 3.3 Mock 规范

Agent SDK 调用**必须**通过注入 mock：

```javascript
// 生产代码：queryFn 作为参数
async function planCourse(queryFn, config, args) { ... }

// 测试时注入 mock
const mockSDK = require('../mock-agent-sdk');
await planCourse(mockSDK.query, {}, args);
```

禁止在生产代码中直接 `require('@anthropic-ai/claude-agent-sdk')` 而不提供注入点。

---

## 4. 测试执行流程（强制）

每个模块按此顺序执行：

```
Step 1: 写 BDD feature 文件（确定验收标准）
        ↓
Step 2: 写 Step Definitions（确定可执行步骤）
        ↓
Step 3: 写 TDD 测试（确定内部 API 行为）
        ↓
Step 4: 运行测试 → 预期失败（红）
        ↓
Step 5: 写实现代码
        ↓
Step 6: 运行测试 → 通过（绿）
        ↓
Step 7: 重构（可选）
        ↓
Step 8: BDD 场景验证 → 全部通过
```

**禁止跳过步骤**：
- ❌ 先写实现再补测试
- ❌ 不写 BDD feature 直接编码
- ❌ 测试不跑直接提交

---

## 5. "测试通过"的定义

一个 Sprint **完成**当且仅当：

- [ ] BDD: `node tests/run-all.js --bdd --sprint=N` 该 Sprint 的 feature 全绿
- [ ] TDD JS: `node tests/run-all.js --unit --sprint=N` 全绿
- [ ] TDD Rust: `cargo test --test *_test` 全绿（主仓库执行）
- [ ] Integration: `node tests/run-all.js --integration --sprint=N` 全绿
- [ ] Acceptance: `node tests/run-all.js --acceptance` 全绿
- [ ] 无编译错误：`cargo check` 通过

---

## 6. CLI 调试工具

每个模块必须提供**不依赖 UI** 的调试方式：

```bash
# 示例：直接测试 agent-bridge.js
node agent-bridge.js plan '{"config": {...}, "args": {"goal": "..."}}'
```

输出到 `agent-bridge.log`（JSON lines），方便排查。

---

## 7. 当前 Sprint 状态

| Sprint | BDD | TDD JS | TDD Rust | Integration | 状态 |
|--------|-----|--------|----------|-------------|------|
| Sprint 1 | 8/8 ✅ | 27/27 ✅ | 8/8 ✅ | 3/3 ✅ | **完成** |
| Sprint 2 | - | - | - | - | 未开始 |
| Sprint 3 | - | - | - | - | 未开始 |
| Sprint 4 | - | - | - | - | 未开始 |
