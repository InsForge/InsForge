# Contributing to InsForge

Thank you for your interest in contributing to InsForge. This guide will help you get started with the contribution process.

## Table of Contents
- [Code of Conduct](#code-of-conduct)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
- [Claiming an Issue](#claiming-an-issue)
- [Development Workflow](#development-workflow)
- [Testing](#testing)
- [Pull Request Process](#pull-request-process)
- [Code Style](#code-style)

## Code of Conduct

This project and everyone participating in it is governed by our Code of Conduct. By participating, you are expected to uphold this code.

## Project Structure

The InsForge monorepo is organized as follows:

- `/backend` - Core backend service with Express.js, PostgreSQL, and Better Auth integration
- `/frontend` - React-based admin dashboard for managing databases, users, and storage
- `/packages/shared-schemas` - Zod schemas and TypeScript types shared between frontend and backend
- `/docs` - MCP documentation
- `/functions` - Serverless edge functions for custom business logic
- `docker-compose.yml` - Docker config file to start the project

## Prerequisites

Before you start development, ensure you have the following:
- [Docker](https://www.docker.com/get-started)
- [Node.js](https://nodejs.org/) (LTS version recommended)

## Getting Started

1. Fork the repository to your GitHub account
2. Clone your fork locally:
   ```bash
   git clone https://github.com/InsForge/InsForge.git
   cd insforge
   ```
3. Install Docker
4. Open Docker App
5. Install Node.js (LTS version recommended)
6. Create a .env file from the example:
   
   On Unix-based systems:
   ```bash
   cp .env.example .env
   ```
   
   On Windows:
   ```bash
   copy .env.example .env
   ```
7. Run the project
   ```bash
   docker compose up
   ```

## Claiming an Issue

We follow an **issue-first workflow**: open or find an issue, get it assigned to you, and only then start working on a PR. This keeps work tracked, avoids two people building the same thing, and makes review smoother.

1. **Find or open an issue** for the work. If one doesn't exist, open a new issue describing the bug or feature first.
2. **Claim it.** Comment on the issue asking for it to be assigned to you (for example, "I'd like to work on this" or "please assign this to me"). Our repo maintainer agent, **章北海 (Zhang Beihai)**, will assign you automatically if it can.
   - Each contributor may hold **at most 3 open assigned issues at a time, across all InsForge repositories** (not per repo). Finish or release one before claiming another. To release an issue, comment "unassign me" on it.
   - If the agent can't assign you (some accounts lack the required access), a maintainer will assign you manually.
3. **Wait until the issue is assigned to you** before opening your PR, and **link the issue from the PR** (for example, "Closes #123").

> Drive-by fixes are welcome — a PR without an assigned issue will still be reviewed. But the agent will add a `needs-issue` or `needs-assignment` label and leave a friendly reminder, and unlinked work is easier to lose track of. Claiming an issue first is the smoothest path.

## Development Workflow

1. Create a new branch for your changes:
   ```bash
   git checkout -b type/description
   # Example: git checkout -b feat/site-deployment
   ```

   Branch type prefixes:
   - `feat/` - New features
   - `fix/` - Bug fixes
   - `docs/` - Documentation changes
   - `refactor/` - Code refactoring
   - `test/` - Test-related changes
   - `chore/` - Build process or tooling changes

2. Make your changes following the code style guidelines
3. Add tests for your changes (see test README for guidelines)
4. Run the test suite:
   ```bash
   npm run test:e2e
   ```
5. Run linter:
   ```bash
   npm run lint
   ```
6. Ensure all tests pass and the code is properly formatted
7. Commit your changes with a descriptive message following the Conventional Commits format:
   ```
   type(scope): description
   
   [optional body]
   [optional screenshots / videos]
   [optional footer(s)]
   ```
8. Push your branch to your fork
9. Open a pull request against the main branch

## Testing

All contributions must include appropriate tests. Follow these guidelines:
- Write unit tests for new features
- Ensure all tests pass before submitting a pull request
- Update existing tests if your changes affect their behavior
- Follow the existing test patterns and structure
- Test across different environments when applicable

## Pull Request Process

1. Make sure the issue you're resolving is [assigned to you](#claiming-an-issue) before opening the PR
2. Create a draft pull request early to facilitate discussion
3. Link the issue your PR resolves in the description (e.g., 'Closes #123')
4. Ensure all tests pass and the build is successful
5. Update documentation as needed
6. Keep your PR focused on a single feature or bug fix
7. Be responsive to code review feedback
8. **After you address review comments, re-request a review from your assigned reviewer** (use the 🔁 button next to their name in the Reviewers section). This is how the reviewer is notified that your changes are ready for another look — without it, your PR may sit unnoticed.

## Code Style

- Follow the existing code style
- Use TypeScript types and interfaces effectively
- Keep functions small and focused
- Use meaningful variable and function names
- Add comments for complex logic
- Update relevant documentation when making API changes

## Documentation Assets

Please review the documentation asset guidelines before adding images, videos, SVGs, or other media files to the repository:

- [Documentation Asset Guidelines](docs/asset-guidelines.md)


