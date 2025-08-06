# Contributing to InsForge

Thank you for your interest in contributing to InsForge. This guide will help you get started with the contribution process.

## Table of Contents
- [Code of Conduct](#code-of-conduct)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
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
- `/shared-schemas` - Zod schemas and TypeScript types shared between frontend and backend
- `/docs` - MCP documemtation
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
   git clone https://github.com/insforge/insforge.git
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
   npm test:e2e
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

1. Create a draft pull request early to facilitate discussion
2. Reference any related issues in your PR description (e.g., 'Closes #123')
3. Ensure all tests pass and the build is successful
4. Update documentation as needed
5. Keep your PR focused on a single feature or bug fix
6. Be responsive to code review feedback

## Code Style

- Follow the existing code style
- Use TypeScript types and interfaces effectively
- Keep functions small and focused
- Use meaningful variable and function names
- Add comments for complex logic
- Update relevant documentation when making API changes