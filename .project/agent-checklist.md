# Agent 自检清单

> 每次进入本项目时，请按以下顺序执行自检，然后主动向用户汇报状态。

---

## 步骤 0：检查初始化开关（必读）

- [ ] 读取 `CLAUDE.md`
- [ ] **检查 `.project/bootstrap.md` 是否存在**
- [ ] 若存在，执行 Bootstrap Protocol（按 `bootstrap.md` 引导新用户完成初始化，创建个人上下文，更新 `index.json`，最后**删除 `bootstrap.md`**）
- [ ] 初始化完成后，继续执行步骤 1

---

## 步骤 1：加载上下文（必读）

- [ ] 读取 `.project/project-state.json`
- [ ] 读取 `.project/user-contexts/index.json`（用户注册表）
- [ ] 识别当前用户身份；读取对应的 `.project/user-contexts/{username}.json`
- [ ] 若用户无个人上下文文件，基于 `_template.json` 主动为其创建并告知
- [ ] 读取 `.project/memory/*.md`（按修改时间降序）
- [ ] 确定 `current_phase` 和 `active_threads`

---

## 步骤 2：扫描 inbox（关键）

- [ ] 列出 `90-inbox/` 中的文件
- [ ] 若 `inbox_items > 0`，向用户汇报：文件名、内容摘要、建议归档位置
- [ ] 对反馈/需求类文件，提供初步分类（bug / feature / question / idea）
- [ ] 若 `inbox_items == 0`，无需汇报

---

## 步骤 3：检查项目变更

- [ ] 运行 `git diff --name-only HEAD~3..HEAD`（或最近 3 个 commit）
- [ ] 识别新增的 `.md` 文件或重大修改
- [ ] 判断是否有新的技术决策、方案变更、限制条件调整
- [ ] 若有，提议创建或更新 ADR（`00-meta/decisions/`）

---

## 步骤 4：检查活跃线程状态

- [ ] 遍历 `active_threads`
- [ ] 对 `last_update` 超过 7 天的线程，标记为 `stale` 并提醒用户
- [ ] 对 `next_action` 为空的线程，提议补充后续计划
- [ ] 汇报本周最值得关注的 1-2 个线程

---

## 步骤 5：主动汇报（标准模板）

用以下格式向用户汇报：

```text
【项目状态速览】
- 当前阶段：[phase]
- 活跃线程数：[N] 个，其中 [M] 个需要关注
- 最近更新：[日期]
- inbox 状态：[N] 个待处理 / 空
- 本周建议优先处理：[线程名称]
```

---

## 步骤 6：会话结束前的整理（可选）

- [ ] 回顾本次会话是否有新决策
- [ ] 若有，向用户确认是否需要：
  - 创建 ADR
  - 更新 `project-state.json` 的线程状态
  - 写入 `memory/decision-log.md`
  - 更新个人上下文文件 `user-contexts/{username}.json`
- [ ] 更新 `project-state.json` 的 `last_update` 字段

---

## 重要约束

- **模式 A**：对 `project-state.json`、ADR、memory 的写入，**必须先提议，经用户确认后再执行**。
- 个人上下文文件 `user-contexts/{username}.json` 可由对应用户直接更新，Agent 协助整理。
- 不要猜测用户的意图。不确定时，直接问。
- 所有中文文件使用 UTF-8 编码。
