# GFM (GitHub Flavored Markdown) Extensions

## Tables

### Simple Table

| Name | Age | City |
|------|-----|------|
| Alice | 28 | New York |
| Bob | 35 | London |
| Carol | 42 | Tokyo |

### Table with Alignment

| Left aligned | Center aligned | Right aligned |
|:-------------|:--------------:|--------------:|
| Left | Center | Right |
| Content | Content | Content |
| More data | More data | More data |

### Complex Table

| Feature | Status | Priority | Notes |
|:--------|:------:|---------:|:------|
| Dark mode | Done | High | Released in v2.0 |
| Export PDF | In Progress | Medium | Expected Q2 |
| API v3 | Planned | Low | Design phase |
| Mobile app | Review | High | Needs testing |

### Table with Inline Formatting

| Command | Description |
|---------|-------------|
| `git init` | Initialize a **new** repository |
| `git commit` | Save changes with a *message* |
| `git push` | Upload to [GitHub](https://github.com) |

## Task Lists

### Simple Task List

- [x] Complete the documentation
- [x] Write unit tests
- [ ] Deploy to production
- [ ] Monitor performance

### Nested Task List

- [x] Project setup
  - [x] Initialize repository
  - [x] Configure linting
  - [x] Set up CI/CD
- [ ] Development
  - [x] Create API endpoints
  - [ ] Implement frontend
  - [ ] Add authentication
- [ ] Testing
  - [ ] Unit tests
  - [ ] Integration tests

### Task List in Blockquote

> Project milestone checklist:
>
> - [x] Requirements gathered
> - [x] Design approved
> - [ ] Implementation complete
> - [ ] QA passed

## Strikethrough

This text has ~~strikethrough~~ applied.

~~This entire paragraph is crossed out.~~

You can combine ~~strikethrough~~ with **bold** and *italic*.

~~**Bold and strikethrough**~~ and ~~*italic and strikethrough*~~.

## Autolinks

### URL Autolinks

Visit https://www.example.com for more information.

Email us at contact@example.com for support.

### Extended Autolinks

www.example.com automatically becomes a link.

Email: user.name+tag@subdomain.example.co.uk

## Combination Examples

### Table with Task List

| Task | Status | Assignee |
|------|--------|----------|
| Design mockups | [x] Complete | Alice |
| Backend API | [ ] In Progress | Bob |
| ~~Legacy cleanup~~ | [x] ~~Cancelled~~ | - |

### Strikethrough in Lists

- Active item
- ~~Completed item~~
- **Another active item**
- ~~*Cancelled item*~~

## GFM Alerts (GitHub-specific)

> [!NOTE]
> Useful information that users should know, even when skimming.

> [!TIP]
> Helpful advice for doing things better or more easily.

> [!IMPORTANT]
> Key information users need to know to achieve their goal.

> [!WARNING]
> Urgent info that needs immediate user attention to avoid problems.

> [!CAUTION]
> Advises about risks or negative outcomes of certain actions.