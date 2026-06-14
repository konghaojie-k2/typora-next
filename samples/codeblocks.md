# Code Blocks Test

## Python Example

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
A simple Python module demonstrating various syntax features.
"""

from typing import List, Optional
from dataclasses import dataclass


@dataclass
class User:
    """User data class with type hints."""
    name: str
    age: int
    email: Optional[str] = None


def calculate_average(numbers: List[float]) -> float:
    """Calculate the average of a list of numbers."""
    if not numbers:
        return 0.0
    return sum(numbers) / len(numbers)


async def fetch_user(user_id: int) -> Optional[User]:
    """Fetch a user by ID (simulated async operation)."""
    # Simulate database lookup
    users = {
        1: User("Alice", 28, "alice@example.com"),
        2: User("Bob", 35),
    }
    return users.get(user_id)


if __name__ == "__main__":
    nums = [1.5, 2.5, 3.5, 4.5]
    print(f"Average: {calculate_average(nums):.2f}")
```

## JavaScript Example

```javascript
/**
 * Modern JavaScript module with ES6+ features
 * @module UserService
 */

const API_BASE = 'https://api.example.com/v1';

class UserService {
    constructor(baseUrl = API_BASE) {
        this.baseUrl = baseUrl;
        this.cache = new Map();
    }

    async getUser(id) {
        if (this.cache.has(id)) {
            return this.cache.get(id);
        }

        const response = await fetch(`${this.baseUrl}/users/${id}`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const user = await response.json();
        this.cache.set(id, user);
        return user;
    }

    static formatDate(date) {
        return new Intl.DateTimeFormat('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        }).format(date);
    }
}

export default UserService;
```

## Rust Example

```rust
//! A simple Rust module demonstrating ownership and borrowing.

use std::collections::HashMap;

/// Represents a user in the system.
#[derive(Debug, Clone)]
pub struct User {
    pub name: String,
    pub age: u32,
    pub email: Option<String>,
}

impl User {
    /// Creates a new user with the given name and age.
    pub fn new(name: impl Into<String>, age: u32) -> Self {
        Self {
            name: name.into(),
            age,
            email: None,
        }
    }

    /// Sets the email address and returns ownership.
    pub fn with_email(mut self, email: impl Into<String>) -> Self {
        self.email = Some(email.into());
        self
    }
}

/// A collection of users indexed by ID.
pub struct UserStore {
    users: HashMap<u32, User>,
}

impl UserStore {
    pub fn new() -> Self {
        Self {
            users: HashMap::new(),
        }
    }

    pub fn insert(&mut self, id: u32, user: User) -> Option<User> {
        self.users.insert(id, user)
    }
}
```

## Go Example

```go
// Package user provides user management functionality.
package user

import (
	"encoding/json"
	"fmt"
	"net/http"
)

// User represents a user in the system.
type User struct {
	ID    int    `json:"id"`
	Name  string `json:"name"`
	Email string `json:"email,omitempty"`
	Age   int    `json:"age"`
}

// Service handles user-related operations.
type Service struct {
	client *http.Client
	baseURL string
}

// NewService creates a new user service.
func NewService(baseURL string) *Service {
	return &Service{
		client:  &http.Client{},
		baseURL: baseURL,
	}
}

// GetUser fetches a user by ID from the API.
func (s *Service) GetUser(id int) (*User, error) {
	url := fmt.Sprintf("%s/users/%d", s.baseURL, id)
	
	resp, err := s.client.Get(url)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch user: %w", err)
	}
	defer resp.Body.Close()

	var user User
	if err := json.NewDecoder(resp.Body).Decode(&user); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &user, nil
}
```

## Java Example

```java
package com.example.users;

import java.util.List;
import java.util.Optional;
import java.util.ArrayList;
import java.util.concurrent.CompletableFuture;

/**
 * Service class for managing users.
 * Provides async operations for user CRUD.
 */
public class UserService {
    private final UserRepository repository;
    private final List<UserChangeListener> listeners = new ArrayList<>();

    public UserService(UserRepository repository) {
        this.repository = repository;
    }

    public CompletableFuture<Optional<User>> findByIdAsync(Long id) {
        return CompletableFuture.supplyAsync(() -> {
            return repository.findById(id);
        });
    }

    public User create(UserCreateRequest request) {
        validateRequest(request);
        
        User user = new User();
        user.setName(request.getName());
        user.setEmail(request.getEmail());
        user.setAge(request.getAge());
        
        User saved = repository.save(user);
        notifyListeners(saved, ChangeType.CREATED);
        
        return saved;
    }

    private void validateRequest(UserCreateRequest request) {
        if (request.getName() == null || request.getName().isBlank()) {
            throw new ValidationException("Name is required");
        }
    }

    private void notifyListeners(User user, ChangeType type) {
        listeners.forEach(listener -> listener.onUserChanged(user, type));
    }
}
```

## TypeScript Example

```typescript
/**
 * TypeScript module with advanced type features
 */

interface BaseEntity {
  id: number;
  createdAt: Date;
  updatedAt: Date;
}

interface User extends BaseEntity {
  name: string;
  email: string;
  role: 'admin' | 'user' | 'guest';
  preferences?: UserPreferences;
}

interface UserPreferences {
  theme: 'light' | 'dark' | 'auto';
  notifications: boolean;
  language: string;
}

type UserCreateInput = Omit<User, 'id' | 'createdAt' | 'updatedAt'>;

class UserService {
  private users: Map<number, User> = new Map();

  async create(input: UserCreateInput): Promise<User> {
    const id = Math.max(0, ...Array.from(this.users.keys())) + 1;
    
    const user: User = {
      ...input,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.users.set(id, user);
    return user;
  }

  async findById(id: number): Promise<User | undefined> {
    return this.users.get(id);
  }
}

export { UserService, type User, type UserCreateInput };
```

## Inline Code Examples

Use `console.log()` for debugging in JavaScript.

The `std::vector` is a dynamic array in C++.

Python's `if __name__ == "__main__":` idiom prevents code execution on import.

Use `docker-compose up -d` to start services in detached mode.

Run `cargo build --release` for optimized Rust builds.