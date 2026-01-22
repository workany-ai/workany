# Contributing Guide

Thank you for your interest in the WorkAny project! We welcome all forms of contributions, including but not limited to:

- Bug reports
- Feature requests
- Code fixes or new features
- Documentation improvements
- Translations

## Code of Conduct

Please be kind and respectful when participating in this project. We are committed to providing an open and inclusive environment for everyone.

## How to Contribute

### Reporting Bugs

1. Search [Issues](https://github.com/workany-ai/workany/issues) to check if a similar issue already exists
2. If not, create a new Issue
3. Use a clear title to describe the problem
4. Provide the following information:
   - Operating system and version
   - WorkAny version
   - Steps to reproduce
   - Expected behavior vs actual behavior
   - Relevant error logs or screenshots

### Submitting Feature Requests

1. Search Issues to check if a similar request already exists
2. Create a new Issue with a title starting with `[Feature]`
3. Describe the feature requirements and use cases in detail
4. If possible, provide implementation ideas

### Submitting Code

#### Prerequisites

1. Fork this repository
2. Clone your fork:
   ```bash
   git clone https://github.com/YOUR-USERNAME/workany.git
   cd workany
   ```
3. Add the upstream repository:
   ```bash
   git remote add upstream https://github.com/workany-ai/workany.git
   ```
4. Install dependencies:
   ```bash
   pnpm install
   ```

#### Development Workflow

1. Sync with upstream:
   ```bash
   git fetch upstream
   git checkout main
   git merge upstream/main
   ```

2. Create a feature branch:
   ```bash
   git checkout -b feature/your-feature-name
   # or for fixes
   git checkout -b fix/issue-description
   ```

3. Make your changes, ensuring:
   - Consistent code style
   - Necessary tests are added
   - Related documentation is updated

4. Commit your changes:
   ```bash
   git add .
   git commit -m "feat: add your feature description"
   ```

5. Push to your fork:
   ```bash
   git push origin feature/your-feature-name
   ```

6. Create a Pull Request

#### Commit Convention

Use semantic commit messages:

- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation update
- `style:` Code formatting (no functional changes)
- `refactor:` Code refactoring
- `perf:` Performance improvement
- `test:` Test related
- `chore:` Build/tooling related

Examples:
```
feat: add dark mode support
fix: resolve task list rendering issue
docs: update installation guide
```

### Pull Request Guidelines

1. PR title should clearly describe the changes
2. Reference related Issues in the description (if any)
3. Ensure all CI checks pass
4. Wait for code review
5. Make changes based on feedback

### Code Review

All submissions require code review. Reviewers will focus on:

- Code quality and readability
- Test coverage
- Documentation completeness
- Consistency with existing code

## Development Guide

### Project Structure

```
workany/
├── src/                    # Frontend source code
│   ├── components/         # React components
│   ├── pages/              # Page components
│   ├── db/                 # Database layer
│   ├── hooks/              # Custom hooks
│   └── providers/          # Context providers
├── src-api/                # Backend API service
├── src-tauri/              # Tauri native layer
└── scripts/                # Build scripts
```

### Tech Stack

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS
- **Backend**: Hono, Claude Agent SDK
- **Desktop**: Tauri 2, SQLite

### Development Commands

```bash
# Start frontend development server
pnpm dev

# Start frontend + API service
pnpm dev:all

# Start Tauri development mode
pnpm tauri dev

# Build
pnpm build

# Type check
pnpm tsc --noEmit
```

### Code Style

- Use TypeScript for type-safe development
- Use ESLint and Prettier for code consistency
- Use functional components and hooks
- Use meaningful variable and function names

## License

By contributing to this project, you agree that:

1. Your contributions will be licensed under the [WorkAny Community License](LICENSE)
2. ThinkAny, LLC may use your contributed code for commercial purposes, including cloud services and enterprise editions
3. ThinkAny, LLC may adjust the open-source agreement as deemed necessary

## Contact

If you have any questions, feel free to reach out:

- GitHub Issues: [github.com/workany-ai/workany/issues](https://github.com/workany-ai/workany/issues)
- Email: support@workany.ai

Thank you for your contributions!
