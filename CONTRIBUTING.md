# Contributing to ChainTap

Thank you for your interest in contributing to ChainTap! This document provides guidelines for contributing to the project.

## Getting Started

### Prerequisites

- Node.js >= 18.0.0
- npm or yarn
- Git

### Setup

1. Fork the repository on GitHub
2. Clone your fork locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/chaintap.git
   cd chaintap
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Build the project:
   ```bash
   npm run build
   ```
5. Run tests to ensure everything works:
   ```bash
   npm test
   ```

## Development Workflow

### Making Changes

1. Create a new branch for your feature or bugfix:
   ```bash
   git checkout -b feature/your-feature-name
   ```
   or
   ```bash
   git checkout -b fix/your-bugfix-name
   ```

2. Make your changes in the `src/` directory

3. Run tests frequently:
   ```bash
   npm run test:watch
   ```

4. Run linting and formatting:
   ```bash
   npm run lint:fix
   npm run format
   ```

5. Ensure all checks pass:
   ```bash
   npm run typecheck
   npm test
   npm run lint
   ```

### Code Style

- We use TypeScript with strict mode enabled
- ESLint and Prettier for code formatting
- Use ES modules with .js extensions in imports
- Write unit tests for all new features
- Aim for 80%+ test coverage

### Testing

- Unit tests go in `tests/unit/`
- Integration tests go in `tests/integration/`
- Use Vitest for all tests
- Mock external dependencies (RPC providers, file system)
- Test both success and error paths

Example test structure:
```typescript
import { describe, it, expect } from 'vitest';

describe('YourModule', () => {
  it('should handle success case', () => {
    // Arrange
    const input = '...';

    // Act
    const result = yourFunction(input);

    // Assert
    expect(result).toBe(expected);
  });

  it('should handle error case', () => {
    expect(() => yourFunction(invalid)).toThrow(ExpectedError);
  });
});
```

### Commit Messages

Follow conventional commit format:

- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `test:` - Test additions or fixes
- `refactor:` - Code refactoring
- `perf:` - Performance improvements
- `chore:` - Maintenance tasks

Examples:
```
feat: add support for Polygon zkEVM chain
fix: handle rate limit errors correctly
docs: update configuration examples
test: add tests for event decoder
```

## Pull Request Process

1. Update the README.md or documentation if needed
2. Ensure all tests pass and coverage is maintained
3. Update CHANGELOG.md with your changes
4. Push your branch to GitHub:
   ```bash
   git push origin feature/your-feature-name
   ```
5. Open a Pull Request on GitHub
6. Fill out the PR template completely
7. Wait for code review and address feedback

### PR Checklist

- [ ] Tests added/updated and passing
- [ ] Code follows project style guidelines
- [ ] Documentation updated (if applicable)
- [ ] No console.log or debug statements
- [ ] TypeScript types are correct
- [ ] All CI checks pass

## Project Structure

```
chaintap/
├── src/
│   ├── abi/           # ABI fetching and decoding
│   ├── cli/           # CLI commands and config
│   ├── core/          # Core indexer logic
│   ├── providers/     # RPC provider management
│   ├── storage/       # Database adapters
│   └── utils/         # Shared utilities
├── tests/
│   ├── unit/          # Unit tests
│   └── integration/   # Integration tests
├── dist/              # Compiled output (gitignored)
└── docs/              # Documentation
```

## Areas for Contribution

### High Priority

- [ ] Add support for more EVM chains (zkSync, Avalanche, etc.)
- [ ] Postgres/MySQL storage adapters
- [ ] Webhook notifications for new events
- [ ] Performance optimizations for large-scale indexing
- [ ] Better error recovery and retry logic

### Documentation

- [ ] More configuration examples
- [ ] Video tutorials
- [ ] API documentation improvements
- [ ] Troubleshooting guides

### Testing

- [ ] Integration tests with real RPC providers
- [ ] Load testing and benchmarks
- [ ] Edge case coverage

### Features

- [ ] Event filtering by parameters
- [ ] Custom event transformations
- [ ] Dashboard/UI for monitoring
- [ ] Export to CSV/JSON
- [ ] GraphQL API layer (optional plugin)

## Code Review Guidelines

When reviewing PRs:

- Be respectful and constructive
- Focus on code quality, not personal preferences
- Test the changes locally
- Check for security issues
- Verify test coverage

## Reporting Bugs

When filing a bug report, include:

1. ChainTap version (`chaintap --version`)
2. Node.js version (`node --version`)
3. Operating system
4. Configuration file (remove sensitive data!)
5. Error messages and logs
6. Steps to reproduce

## Security Issues

**DO NOT** open public issues for security vulnerabilities.

Instead, email security@chaintap.dev (or create a private security advisory on GitHub).

## Questions?

- Open a GitHub Discussion for general questions
- Join our Discord community (link in README)
- Check existing issues and documentation first

## License

By contributing to ChainTap, you agree that your contributions will be licensed under the MIT License.

---

Thank you for making ChainTap better! 🚀
