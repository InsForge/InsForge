🎃 Hacktoberfest Welcome! 🎃
Welcome to InsForge, and thank you for your interest in contributing during Hacktoberfest! We're building the Agent-Native Supabase Alternative, and we're thrilled to have you join our community.

About InsForge:

InsForge is revolutionizing how AI agents interact with backend services. We're building Supabase-like features in an AI-native way, enabling AI agents to build and manage full-stack applications autonomously. Our goal is to make backend development as simple as talking to an AI assistant.

Getting Started:

Before jumping into contributions, please:
Read our CONTRIBUTING.md guide thoroughly
Join our Discord community to introduce yourself
Browse existing issues and pull requests to understand what's being worked on
Set up your local development environment following the quickstart guide
Familiarize yourself with our architecture and project structure

What Makes a Quality Contribution:

We value meaningful contributions that enhance the project and help our community. Here's what we're looking for:
Good Contributions Include:

Bug fixes with clear reproduction steps and test cases
Documentation improvements that help users understand features better
New features that align with our AI-native vision (discuss in an issue first)
Performance optimizations with measurable improvements
Test coverage improvements for existing features
UI/UX enhancements that improve the developer experience
Integration examples and tutorials

Please Avoid:

Trivial changes like single-line formatting without context
Automated bulk changes without careful review
Adding dependencies without discussion and justification
Breaking changes without prior team approval
Duplicate work (check existing PRs first)
Changes that don't add value to the project

Contribution Guidelines:
Before You Start:

Check our issue tracker for tasks marked "good first issue" or "help wanted"
Comment on the issue to claim it and share your approach
For new features, open an issue to discuss before coding
Fork the repository and create a feature branch from main
Ensure Docker and Node.js are properly installed

While Working:

Follow our branch naming convention: type/description
Write clear, descriptive commit messages using Conventional Commits format
Keep commits focused and atomic
Add or update tests for your changes
Update documentation to reflect your changes
Run linters and tests before pushing
Test your changes with the Docker environment

When Submitting:

Create a detailed pull request with clear description
Include screenshots or videos for UI changes
Reference related issues using keywords like "Closes" or "Fixes"
Ensure all CI checks pass
Be responsive to review feedback
Keep your branch up to date with main

Areas Where We Need Help:
Here are some areas where contributions would be especially valuable:

Documentation: Improve setup guides, add usage examples, create tutorials
Testing: Expand test coverage for backend API, frontend components, and edge functions
Bug Fixes: Check our issue tracker for bugs that need attention
Feature Development: Help build site deployment, enhance authentication, or improve storage
Developer Experience: Improve error messages, logging, and debugging tools
Integration Examples: Create sample projects showing InsForge capabilities
Performance: Identify and optimize bottlenecks in API responses or database queries
AI Agent Integration: Enhance MCP tools and improve agent interactions

Development Environment Setup:

Ensure you have Docker installed and running
Install Node.js LTS version
Clone your fork of the repository
Copy .env.example to .env
Run docker compose up to start all services
Access the dashboard at http://localhost:7131
Review the monorepo structure in CONTRIBUTING.md

Project Structure Overview:

Backend: Express.js API with PostgreSQL and Better Auth
Frontend: React dashboard for managing resources
Shared Schemas: TypeScript types shared across services
Functions: Serverless edge functions
Docs: MCP and API documentation

Communication:
We encourage you to:

Ask questions in our Discord server for real-time help
Open issues for bugs, feature requests, or clarifications
Share your progress and get feedback early
Be patient while waiting for reviews (we're a small team)
Engage respectfully with other contributors and maintainers

Code Quality Standards:

Follow TypeScript best practices and use proper typing
Write unit tests for new features
Run npm run lint before committing
Run npm test:e2e to verify everything works
Keep functions small and focused
Use meaningful variable and function names
Add comments for complex logic

Hacktoberfest-Specific Guidelines:
Remember that Hacktoberfest is about learning and making meaningful contributions. Here's what we value:

Quality over quantity: One well-tested feature is better than multiple rushed changes
Learning opportunity: Use this as a chance to learn about AI-native development
Community engagement: Join discussions, help others, and share knowledge
Long-term value: Contribute changes that will benefit users for months to come

Recognition:
All contributors are automatically added to our contributors list and acknowledged in our repository. We deeply appreciate every meaningful contribution, regardless of size.

Need Help?
If you have questions or need assistance:

Join our Discord server for real-time support
Open an issue with your question
Email us at info@insforge.dev
Check our comprehensive documentation

Testing Your Changes:

Test locally with Docker environment
Verify all existing tests pass
Test the MCP connection with an AI agent (Claude, GPT, etc.)
Ensure the dashboard works correctly
Check that your changes don't break existing functionality

Pull Request Checklist:
Before submitting your PR, ensure:

 Code follows project style guidelines
 All tests pass locally
 Documentation is updated
 Commit messages follow Conventional Commits format
 PR description clearly explains the changes
 Related issues are referenced
 Screenshots/videos included for UI changes
 No merge conflicts with main branch

What Happens After Submission:

A maintainer will review your PR within a few days
You may receive feedback or change requests
Address feedback promptly and push updates
Once approved, your PR will be merged
Your contribution will be part of the next release

Code of Conduct:
We expect all contributors to treat each other with respect and professionalism. InsForge aims to provide a welcoming environment for everyone, regardless of experience level, background, or identity.
Final Notes
Thank you for contributing to InsForge! Your efforts help us build the future of AI-native backend development. We're excited to see what you'll create and how you'll help shape this project.
Remember: The best contributions come from understanding the project's vision, engaging with the community, and taking the time to do things right.
Happy coding, and welcome to the InsForge community! 🚀
