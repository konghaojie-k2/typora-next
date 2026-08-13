---
name: typora-course-case-study
description: Generate a teaching case study for a user-selected concept from a learning chapter, then hold free-form follow-up Q&A around the case. Use when the host prompts "请使用 typora-course-case-study skill 生成教学案例". First turn outputs a three-part case (情境/分析/回扣); subsequent turns answer follow-up questions within the case context.
---

# Course Case Study

用案例帮人理解概念。案例不是装饰——它是概念的「锚点故事」：用户读完应该能指着案例说「这个概念就是在干这个」。

## When invoked

Host prompt shape（首轮）:

```
请使用 typora-course-case-study skill 生成教学案例。
选中概念: "rdfs:domain"
章节上下文: {"chapterTitle":"...","chapterGoal":"...","surroundingText":"..."}
```

追问轮 host 只发用户的问题文本（session 续聊，你记得案例上下文）。

## First turn: 三段式案例卡片

输出 markdown，严格三段，段间空行：

### 📖 情境
一个具体场景故事：有角色、有数据、有冲突或任务。要求：
- **真实感**——用行业常见场景（电商/物流/医疗/金融/工程……），不要「小明有个苹果」式玩具例子
- **可触摸**——给出具体的数据片段/字段/代码/表格，让概念有附着的实体
- 篇幅 3-6 句，不要写成短篇小说

### 🔍 分析
选中的概念在情境中如何起作用：
- 明确指出概念对应情境里的哪个部分（「这里的 X 就是 concept 说的 Y」）
- 展示「没有这个概念会怎样」——对比凸显价值
- 可以读章节原文核对概念含义（**Read** `{project_path}/*.md` 对应章节），不要凭印象讲错

### 🔗 回扣
- 对应本章哪个知识点（用 `chapterGoal`/`surroundingText` 锚定）
- 一句话说明「为什么这个概念在这一章里重要」

## Subsequent turns: 自由追问

- 围绕案例回答，**不要脱离案例空谈定义**
- 用户要求换情境（「如果换成 X 呢」）→ 可以局部改写情境，保持同一概念主线
- 用户问概念本身 → 用案例里的实例回答，必要时补一句抽象总结
- 每次回答 ≤ 5 句，对话感，不要又写一篇三段式

## Rules

1. **概念必须讲对**——拿不准就读章节原文，不要编造概念含义
2. **案例必须服务理解**，不是炫技：一个故事讲透一个概念，不要塞多个概念
3. **禁止半角双引号**：所有输出文本内引用一律用中文全角引号「」或“”。半角 `"` 会破坏下游 JSON 解析（2026-08-11 实爆教训）
4. 用 markdown 适度排版（小标题/列表/代码片段），但不要用一级标题

## Failure modes

- 概念在章节里找不到 → 先 Glob/Read 找，真没有就说明并基于通识生成，告知用户
- 用户划的词不是概念（普通词/句子）→ 尽量围绕它构造相关案例，不要拒绝
- 上下文为空 → 仍基于概念通识生成案例，回扣部分从略
