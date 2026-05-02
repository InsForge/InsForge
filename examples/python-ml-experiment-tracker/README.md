# ML Experiment Tracker

A command-line tool for logging and browsing ML experiments. Each run records hyperparameters, metrics, and notes in a PostgreSQL database managed by InsForge. A local web dashboard lets you visualize runs and compare results without leaving your machine.

> **Note:** This project was built as an example application to demonstrate using [InsForge](https://insforge.com) as a backend-as-a-service. InsForge handles auth, the database, and the REST API — this tool is a thin CLI and dashboard on top of it.

---

## Prerequisites

- **Python 3.10+**
- **Docker** (to run InsForge locally)
- **InsForge** running on `http://localhost:7130` — see the [InsForge docs](https://insforge.com/docs) for the quickstart Docker command

---

## Installation

```bash
# From the project root
pip install -e .
```

This installs the `tracker` command on your PATH.

---

## Setup

### 1. Start InsForge

InsForge must be running before any `tracker` command will work. A typical local start looks like:

```bash
docker run -p 7130:7130 insforge/insforge
```

Refer to the InsForge documentation for your exact Docker command and any environment variables (database URL, secret key, etc.).

### 2. Register an account

```bash
tracker register
# prompts for email and password
```

### 3. Log in

```bash
tracker login
# prompts for email and password
# credentials are saved to ~/.config/ml-tracker/config.json
```

### 4. Create the database tables

Table creation requires admin access in InsForge. Run `tracker init` to check whether the tables already exist:

```bash
tracker init
```

If the `experiments` and `runs` tables are missing, the command prints the SQL you need to run. Execute it via the InsForge dashboard or admin API:

```sql
CREATE TABLE IF NOT EXISTS experiments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS runs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    experiment_id UUID REFERENCES experiments(id) ON DELETE SET NULL,
    experiment_name TEXT NOT NULL,
    run_name TEXT,
    status TEXT DEFAULT 'completed',
    params JSONB DEFAULT '{}',
    metrics JSONB DEFAULT '{}',
    started_at TIMESTAMPTZ DEFAULT now(),
    finished_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);
```

Run `tracker init` again to confirm the tables are accessible before logging any runs.

---

## CLI Commands

### Authentication

```bash
# Register a new account
tracker register

# Log in (saves tokens to ~/.config/ml-tracker/config.json)
tracker login

# Point at a non-default InsForge instance
tracker login --server http://my-insforge-host:7130
```

### Logging runs

```bash
# Minimal — just experiment name and metrics
tracker log -e my-model -m accuracy=0.91 -m loss=0.32

# With hyperparameters, a run label, and notes
tracker log \
  -e bert-finetune \
  -r "run-lr1e-4" \
  -p learning_rate=1e-4 \
  -p batch_size=32 \
  -p epochs=5 \
  -m accuracy=0.94 \
  -m f1=0.93 \
  -m val_loss=0.21 \
  -n "Warmup schedule, no dropout"

# Provide explicit timestamps (ISO-8601)
tracker log \
  -e nightly-sweep \
  --started-at 2024-06-01T01:00:00Z \
  --finished-at 2024-06-01T03:42:00Z \
  -m rmse=0.045
```

`--params` / `-p` and `--metrics` / `-m` each accept `KEY=VALUE` and can be repeated. Numeric values are stored as floats; everything else is stored as a string.

### Viewing runs

```bash
# List the 20 most recent runs across all experiments
tracker runs list

# Filter to one experiment
tracker runs list -e bert-finetune

# Show more results or paginate
tracker runs list --limit 50 --offset 50

# Full details for a specific run (use the ID from the list)
tracker runs get a1b2c3d4
```

### Viewing experiments

```bash
# List all experiments
tracker experiments list

# Limit results
tracker experiments list --limit 10
```

### Checking the setup

```bash
# Verify that required tables exist and are accessible
tracker init
```

---

## Web Dashboard

The dashboard shows a summary of all experiments and lets you browse runs with their params and metrics.

```bash
# Start the dashboard (opens your browser automatically)
tracker serve

# Custom port
tracker serve --port 9000

# Skip opening the browser
tracker serve --no-browser
```

The dashboard runs at `http://127.0.0.1:8765` by default and proxies all API requests to InsForge using your saved credentials. It handles token refresh automatically. Stop it with `Ctrl+C`.

> You must be logged in (`tracker login`) before starting the dashboard, otherwise API requests will return an auth error.

---

## Configuration

The CLI stores its config at `~/.config/ml-tracker/config.json` (mode `0600`). You can override the InsForge server URL at login time with `--server`; the value is persisted for subsequent commands.

Default server URL: `http://localhost:7130`
