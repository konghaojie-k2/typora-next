# Mermaid Error Test

## 语法错误的流程图

```mermaid
flowchart TD
    A[Start] --> B{Is it working?}
    B -->|Yes| C[Great!]
    B -->|No| D[Debug]
    D --> B
    C --> E[End
```

上面的图表故意少了一个右括号 `]`，Mermaid 会报语法错误。

## 另一个错误：非法字符

```mermaid
sequenceDiagram
    participant A as Alice
    participant B as Bob
    A->>B: Hello Bob!
    B->>A: Hi Alice!
    A-->>B: How are you?
    note over A,B: 这条 note 语法有问题
    B-->>A: I'm good!
```

## 正确的图表（对比用）

```mermaid
flowchart LR
    A[Input] --> B[Process]
    B --> C[Output]
```
