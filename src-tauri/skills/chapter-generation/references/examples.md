# Chapter Generation — Worked Example

A complete example of a generated chapter + supporting files. Use as a template to mirror style, structure, and field shapes.

## Setup

- `chapter_index`: 2
- `chapter_title`: "反向过程：去噪原理"
- `duration_minutes`: 25
- `concepts`: ["前向过程", "噪声调度", "反向去噪"]
- `project_path`: `/Users/x/projects/diffusion-model`
- `previous_chapters`: ["为什么学这个", "前向过程：逐步加噪"]

Expected output files:
- `02-反向过程-去噪原理.md`
- `02-反向过程-去噪原理.quiz.json`
- `02-反向过程-去噪原理.concepts.json`

## 1. Markdown: `02-反向过程-去噪原理.md`

```markdown
# 反向过程：去噪原理

> [!concept] 反向过程
> 把一张随机噪声图片逐步"擦亮"回真实图片的过程，可以类比为"修复一张被水泡模糊的老照片"，每一轮都猜出最可能的细节再修一点点。

上一章我们看到了前向过程如何加噪。这一章反过来：能不能从纯噪声开始，"倒着"还原出一张有意义的图片？

## 为什么反向过程是核心

直觉上，去噪听起来比加噪难。给定一张清晰的猫和噪声 → 把它变噪声很容易。但给定噪声 → 还原出猫，这本质上是个**欠定问题**（一张噪声图可能对应无数张原图）。

> [!concept] 条件分布 p(x_{t-1} | x_t)
> 反向过程建模的是"在看到第 t 步的带噪图后，第 t-1 步大概长什么样"。这是一个**条件概率**，由训练数据中学到。

突破口是**只预测噪声**（不直接预测上一时刻的图）。

## 算法骨架

```python
# 训练时（很简化）
for x0 in dataloader:
    t = sample_timestep()
    noise = torch.randn_like(x0)
    xt = add_noise(x0, noise, t)
    pred_noise = model(xt, t)
    loss = mse(pred_noise, noise)

# 采样时
xt = torch.randn_like(shape)
for t in [T, T-1, ..., 1]:
    pred_noise = model(xt, t)
    xt = denoise_step(xt, pred_noise, t)
return xt
```

> [!question] 为什么"只预测噪声"比"直接预测 x_{t-1}"效果更好？
>
> > [!answer] 噪声的分布更简单（接近高斯），神经网络擅长拟合简单分布。直接预测图片的方差太大，每一步的不确定性都会累积。

## 噪声调度 β_t

不是所有时间步的加噪量都均匀。常用 **cosine schedule**：

```mermaid
graph LR
  A[t=0 清晰] -->|β₁=小| B[t=中]
  B -->|β_中=中| C[t=T 纯噪声]
```

| 调度方式 | 特点 |
|----------|------|
| 线性 | 简单，但尾部过吵，破坏信息太快 |
| cosine | 端点附近变化慢，中段变化快，主流选择 |
| sigmoid | 介于两者之间 |

> [!quiz]
> 1. 反向过程预测的目标是？
>    - A. x_{t-1} 完整图片 ✓
>    - B. 加入的噪声 ε
>    - C. 时间步 t 本身

## 总结

反向过程 = 迭代去噪，每一步只预测噪声；调度函数 β_t 决定加噪/去噪的节奏。下一章我们把前向+反向拼起来，看完整的 DDPM 训练循环。

> [!concept] DDPM
> Denoising Diffusion Probabilistic Model，把前向加噪和反向去噪组合成完整的生成模型。训练 = 学噪声预测器；推理 = 迭代去噪。
```

## 2. Quiz: `02-反向过程-去噪原理.quiz.json`

```json
{
  "$schema": "quiz.json.v1",
  "chapter_file": "02-反向过程-去噪原理.md",
  "chapter_title": "反向过程：去噪原理",
  "generated_at": "2026-06-15T10:30:00Z",
  "questions": [
    {
      "id": "q1",
      "qtype": "single",
      "question": "DDPM 训练时，神经网络的预测目标是？",
      "options": [
        {"label": "A", "text": "上一时刻的图片 x_{t-1}"},
        {"label": "B", "text": "加入的噪声 ε"},
        {"label": "C", "text": "时间步 t 的值"}
      ],
      "correct": "B",
      "weak_concepts": ["反向过程", "训练目标"],
      "related_section": "算法骨架",
      "suggestion": "回顾'为什么只预测噪声'那一节"
    },
    {
      "id": "q2",
      "qtype": "multiple",
      "question": "以下哪些是常用的噪声调度 β_t 方案？",
      "options": [
        {"label": "A", "text": "线性调度"},
        {"label": "B", "text": "cosine 调度"},
        {"label": "C", "text": "指数调度（不常见）"},
        {"label": "D", "text": "随机调度"}
      ],
      "correct": ["A", "B"],
      "weak_concepts": ["噪声调度", "前向过程"],
      "related_section": "噪声调度 β_t",
      "suggestion": "主流是 cosine，端点附近变化慢"
    },
    {
      "id": "q3",
      "qtype": "short",
      "question": "用自己的话解释：为什么'只预测噪声'比'直接预测上一时刻图片'更好？",
      "options": [],
      "correct": null,
      "weak_concepts": ["反向过程", "训练目标"],
      "related_section": "为什么反向过程是核心",
      "suggestion": "想一下分布复杂度和误差累积"
    },
    {
      "id": "q4",
      "qtype": "single",
      "question": "DDPM 推理时，从纯噪声还原图片的过程是？",
      "options": [
        {"label": "A", "text": "一次前向计算直接出图"},
        {"label": "B", "text": "迭代去噪，每步预测噪声并更新"},
        {"label": "C", "text": "查训练集找最相似的"}
      ],
      "correct": "B",
      "weak_concepts": ["采样过程", "反向过程"],
      "related_section": "算法骨架",
      "suggestion": "采样循环就是反向过程的迭代"
    }
  ],
  "adaptive_rules": {
    "mastered_threshold": 0.8,
    "learning_threshold": 0.5,
    "max_questions": 5
  }
}
```

## 3. Concepts: `02-反向过程-去噪原理.concepts.json`

```json
{
  "chapter": "02-反向过程-去噪原理.md",
  "concepts": [
    {
      "id": "reverse-process",
      "name": "反向过程",
      "depends_on": ["forward-process", "noise-schedule"]
    },
    {
      "id": "noise-prediction",
      "name": "噪声预测",
      "depends_on": ["forward-process"]
    },
    {
      "id": "ddpm",
      "name": "DDPM",
      "depends_on": ["reverse-process", "noise-prediction"]
    }
  ]
}
```

## 4. What the agent returns to the host

After writing all three files, return a single short text line as the assistant message:

```
第 2 章已生成: 反向过程：去噪原理, 4 个测验题, 3 个概念
```

The host uses this to emit a `chapter_complete` event with `{index, file, title}` to update the UI.
