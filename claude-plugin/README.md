# InsForge Claude Plugin

Official Claude Code plugin for building with InsForge.

## What's Included

**Skill: `insforge-schema-patterns`**
- Social graph patterns (follows, likes)
- Nested comments (self-referential)
- Multi-tenant patterns
- Best practices for foreign keys, indexes, and RLS

This skill automatically activates when you're designing database schemas with Claude.

## Installation

### Method 1: From Marketplace (Recommended)

The easiest way to install:

```bash
# In Claude Code, run:
/plugin marketplace add InsForge/InsForge

# Then browse available plugins:
/plugin

# Select "insforge" to install
```

### Method 2: Direct Install

```bash
# Create user plugins directory if needed
mkdir -p ~/.claude/plugins/user

# Clone the repository
git clone https://github.com/InsForge/InsForge.git

# Create symlink
ln -s "$(pwd)/InsForge/claude-plugin" ~/.claude/plugins/user/insforge

# Verify installation
ls -la ~/.claude/plugins/user/insforge/
```

### Method 3: Local Development

For contributing or testing local changes:

```bash
# Navigate to your local InsForge repo
cd /path/to/your/InsForge

# Create user plugins directory
mkdir -p ~/.claude/plugins/user

# Symlink your local development version
ln -s "$(pwd)/claude-plugin" ~/.claude/plugins/user/insforge

# Verify
ls -la ~/.claude/plugins/user/insforge/
```

## Usage

Once installed, the skill automatically activates when you ask Claude about database design:

```
You: "I need to build a social media app with follows and likes"

Claude: [Automatically loads insforge-schema-patterns skill]
"I'll use the Social Graph pattern from InsForge best practices..."
```

No special commands needed - Claude knows when to use it!

## What's a Skill?

Skills are folders with instructions that Claude automatically loads when relevant. They're like giving Claude domain expertise.

## Verification

Check if the plugin is installed correctly:

```bash
# Check plugin installation
ls -la ~/.claude/plugins/user/insforge/

# Should show:
# .claude-plugin/
# skills/
# README.md

# Check the skill is present
cat ~/.claude/plugins/user/insforge/skills/insforge-schema-patterns/SKILL.md

# Should display database schema patterns
```

## Test the Plugin

In Claude Code, ask a database design question:

```
"Help me design a database for a social media app with follows and likes"
```

Claude should automatically load the `insforge-schema-patterns` skill and provide expert schema patterns with RLS policies, indexes, and SDK examples.

## Troubleshooting

**Plugin not found:**
```bash
# Remove old symlink if exists
rm ~/.claude/plugins/user/insforge

# Recreate with absolute path
ln -s /absolute/path/to/InsForge/claude-plugin ~/.claude/plugins/user/insforge
```

**Skill not loading:**
1. Verify SKILL.md has proper frontmatter (name and description)
2. Restart Claude Code
3. Ask a database design question explicitly

## Contributing

Want to add more skills? Check the [main InsForge repository](https://github.com/InsForge/InsForge).

## License

MIT
