# Mermaid Diagrams Test

## Flowchart Examples

### Simple Flowchart

```mermaid
flowchart TD
    A[Start] --> B{Is it working?}
    B -->|Yes| C[Great!]
    B -->|No| D[Debug]
    D --> B
    C --> E[End]
```

### Horizontal Flowchart

```mermaid
flowchart LR
    A[Input] --> B[Process]
    B --> C{Decision}
    C -->|Yes| D[Output A]
    C -->|No| E[Output B]
    D --> F[End]
    E --> F
```

### Complex Flowchart with Subgraphs

```mermaid
flowchart TB
    subgraph Input
        A[User Request]
        B[Parse Input]
    end

    subgraph Processing
        C{Validate}
        D[Transform]
        E[Execute]
    end

    subgraph Output
        F[Format Response]
        G[Send Response]
    end

    A --> B
    B --> C
    C -->|Valid| D
    C -->|Invalid| H[Error Handler]
    D --> E
    E --> F
    F --> G
    H --> F
```

### Flowchart with Different Shapes

```mermaid
flowchart TD
    A[Rectangle]
    B(Rounded Rectangle)
    C([Stadium])
    D[[Subroutine]]
    E[(Database)]
    F((Circle))
    G>Flag]
    H{{Hexagon}}
    I[/Parallelogram/]
    J[\Parallelogram Alt\]
    K[/Trapezoid\]

    A --> B
    B --> C
    C --> D
    D --> E
    E --> F
    F --> G
    G --> H
    H --> I
    I --> J
    J --> K
```

## Sequence Diagram Examples

### Simple Sequence Diagram

```mermaid
sequenceDiagram
    participant A as Alice
    participant B as Bob
    A->>B: Hello Bob!
    B->>A: Hi Alice!
    A-->>B: How are you?
    B-->>A: I'm good, thanks!
```

### Sequence Diagram with Loops

```mermaid
sequenceDiagram
    participant Client
    participant Server
    participant Database

    Client->>Server: Login Request
    Server->>Database: Query User
    Database-->>Server: User Data
    
    alt Valid User
        Server->>Client: Login Success
        loop Every Request
            Client->>Server: API Request
            Server->>Database: Query Data
            Database-->>Server: Results
            Server-->>Client: Response
        end
    else Invalid User
        Server->>Client: Login Failed
    end
```

### Sequence Diagram with Notes

```mermaid
sequenceDiagram
    participant U as User
    participant F as Frontend
    participant B as Backend
    participant D as Database

    Note over U,D: Complete Authentication Flow

    U->>F: Enter credentials
    F->>B: POST /api/login
    Note right of F: HTTPS encrypted
    
    B->>D: Find user
    D-->>B: User record
    
    Note over B: Hash comparison
    
    alt Credentials match
        B->>B: Generate JWT
        B-->>F: 200 OK + Token
        F-->>U: Dashboard page
    else Invalid credentials
        B-->>F: 401 Unauthorized
        F-->>U: Show error
    end
```

### Complex Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    participant C as Client
    participant LB as Load Balancer
    participant S1 as Server 1
    participant S2 as Server 2
    participant Cache as Redis Cache
    participant DB as PostgreSQL

    C->>LB: HTTP Request
    LB->>S1: Route to Server 1
    
    S1->>Cache: Check Cache
    alt Cache Hit
        Cache-->>S1: Cached Data
    else Cache Miss
        S1->>DB: Query Database
        DB-->>S1: Fresh Data
        S1->>Cache: Update Cache
    end
    
    S1-->>LB: Response
    LB-->>C: HTTP Response
    
    Note over S1,S2: Health Check
    S1--)S2: Heartbeat
    S2--)S1: Ack
```

## Class Diagram

```mermaid
classDiagram
    class Animal {
        +String name
        +int age
        +makeSound() void
    }
    
    class Dog {
        +String breed
        +bark() void
        +fetch() void
    }
    
    class Cat {
        +String color
        +meow() void
        +scratch() void
    }
    
    Animal <|-- Dog
    Animal <|-- Cat
    
    class Owner {
        +String name
        +adopt(Animal pet)
        +feed()
    }
    
    Owner "1" --> "*" Animal : owns
```

## State Diagram

```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> Processing : Start
    Processing --> Success : Complete
    Processing --> Error : Fail
    Error --> Idle : Retry
    Success --> [*]
    
    state Processing {
        [*] --> Validating
        Validating --> Transforming
        Transforming --> Saving
        Saving --> [*]
    }
```

## Entity Relationship Diagram

```mermaid
erDiagram
    CUSTOMER ||--o{ ORDER : places
    CUSTOMER {
        int id PK
        string name
        string email
    }
    ORDER ||--|{ LINE_ITEM : contains
    ORDER {
        int id PK
        date created
        string status
    }
    PRODUCT ||--o{ LINE_ITEM : "is in"
    PRODUCT {
        int id PK
        string name
        float price
    }
    LINE_ITEM {
        int quantity
        float subtotal
    }
```

## Pie Chart

```mermaid
pie showData
    title Project Time Distribution
    "Development" : 45
    "Testing" : 20
    "Documentation" : 15
    "Meetings" : 12
    "Code Review" : 8
```

## Gantt Chart

```mermaid
gantt
    title Project Schedule
    dateFormat  YYYY-MM-DD
    
    section Planning
    Requirements    :a1, 2024-01-01, 7d
    Design          :a2, after a1, 5d
    
    section Development
    Backend         :b1, after a2, 14d
    Frontend        :b2, after a2, 10d
    Integration     :b3, after b1, 5d
    
    section Testing
    Unit Tests      :c1, after b1, 7d
    E2E Tests       :c2, after b3, 5d
    
    section Deployment
    Staging         :d1, after c2, 3d
    Production      :d2, after d1, 2d
```