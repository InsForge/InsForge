# InsForge Claude Code Plugin

Official plugin for building with InsForge in Claude Code.

## Installation

### Option 1: Install from InsForge Marketplace (Recommended)

In Claude Code, run:

```
/plugin marketplace add InsForge/InsForge
```

Then install the plugin:

```
/plugin install insforge
```

### Option 2: Install Directly from Repository

```
/plugin install https://github.com/InsForge/InsForge/claude-plugin
```

### Option 3: Local Installation (Development)

```bash
cd ~/.claude-plugins
git clone https://github.com/InsForge/InsForge.git
ln -s InsForge/claude-plugin insforge
```

## What's Included

### Skill: `insforge-schema-patterns`

Automatically activates when designing database schemas. Includes:

- **Social Graph Patterns** - Follows, likes, and social relationships
- **Junction Tables** - Many-to-many relationships with proper indexes
- **Nested Comments** - Self-referential hierarchical data
- **Multi-Tenant Patterns** - Organization-scoped data with RLS
- **Best Practices** - Foreign keys, indexes, Row Level Security

## Usage

Once installed, the skill automatically loads when relevant:

**Example:**
```
You: "I need to build a social media app with follows and likes"

Claude: [Automatically loads insforge-schema-patterns]
"I'll use the Social Graph pattern from InsForge best practices:

CREATE TABLE follows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_id UUID REFERENCES users(id) ON DELETE CASCADE,
  following_id UUID REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(follower_id, following_id)
);
..."
```

No special commands needed - Claude knows when to use it based on your conversation!

## What Are Skills?

Skills are folders containing instructions and examples that Claude automatically loads when they're relevant to the task. Think of them as giving Claude domain expertise in specific areas.

The `insforge-schema-patterns` skill teaches Claude:
- Proven database design patterns for common use cases
- How to write efficient PostgREST queries with the InsForge SDK
- Best practices for security (RLS policies)
- Performance optimization (indexes, query patterns)

## Future Skills (Coming Soon)

We're planning to add:
- `insforge-fullstack-templates` - Complete app templates (Instagram, Todo, Blog)
- `insforge-edge-functions` - Serverless function recipes
- `insforge-realtime` - WebSocket and live collaboration patterns

## Contributing

Want to improve the skills or add new ones?

1. Fork the repository
2. Edit or add skills in `claude-plugin/skills/`
3. Test locally by installing from your fork
4. Submit a PR

Skills are just Markdown files with YAML frontmatter - easy to contribute!

## Feedback

Found an issue or have a suggestion? [Open an issue](https://github.com/InsForge/InsForge/issues) or join our [Discord](https://discord.com/invite/MPxwj5xVvW).

## License

MIT - Same as InsForge
