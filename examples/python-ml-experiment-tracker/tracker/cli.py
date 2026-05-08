from __future__ import annotations

import functools
from datetime import datetime, timezone
from typing import Any

import click
import httpx
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from tracker.client import APIError, AuthError, InsForgeClient
from tracker.config import load_config, save_config, update_tokens

console = Console()
err_console = Console(stderr=True)

REQUIRED_TABLES = ["experiments", "runs"]

# SQL for admins to run once via the InsForge dashboard or migration API
ADMIN_SETUP_SQL = """\
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
);\
"""


def handle_errors(fn):
    """Decorator that converts tracker exceptions into stderr messages and SystemExit(1)."""
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        """Invoke the wrapped command, translating known exceptions to user-facing output."""
        try:
            return fn(*args, **kwargs)
        except AuthError as e:
            err_console.print(f"[bold red]Auth error:[/] {e}")
            raise SystemExit(1)
        except APIError as e:
            err_console.print(f"[bold red]API error {e.status_code}:[/] {e.message}")
            raise SystemExit(1)
        except httpx.ConnectError:
            cfg = load_config()
            err_console.print(
                f"[bold red]Connection refused.[/] Is InsForge running at {cfg.server_url}?"
            )
            raise SystemExit(1)
        except httpx.TimeoutException:
            err_console.print("[bold red]Request timed out.[/]")
            raise SystemExit(1)
        except httpx.RequestError as e:
            err_console.print(f"[bold red]Network error:[/] {e}")
            raise SystemExit(1)
    return wrapper


def parse_kv_pairs(pairs: tuple[str, ...]) -> dict[str, Any]:
    """Parse KEY=VALUE strings into a typed dict, coercing bool/int/float where applicable."""
    result: dict[str, Any] = {}
    for pair in pairs:
        if "=" not in pair:
            raise click.BadParameter(
                f"Expected KEY=VALUE, got: {pair!r}",
                param_hint="--params/--metrics",
            )
        key, _, raw = pair.partition("=")
        key = key.strip()
        raw = raw.strip()
        if raw.lower() == "true":
            result[key] = True
        elif raw.lower() == "false":
            result[key] = False
        else:
            try:
                result[key] = int(raw)
            except ValueError:
                try:
                    result[key] = float(raw)
                except ValueError:
                    result[key] = raw
    return result


def now_iso() -> str:
    """Return the current UTC time as an ISO-8601 string."""
    return datetime.now(timezone.utc).isoformat()


# ── Root group ───────────────────────────────────────────────────────────

@click.group()
@click.version_option(version="0.1.0", prog_name="tracker")
def cli() -> None:
    """ML Experiment Tracker — powered by InsForge BaaS."""


from tracker.serve import cmd_serve  # noqa: E402
cli.add_command(cmd_serve)


# ── tracker register ──────────────────────────────────────────────────────

@cli.command("register")
@click.option("--email", prompt="Email", help="User email address")
@click.option(
    "--password",
    prompt="Password",
    hide_input=True,
    confirmation_prompt=True,
    help="Account password",
)
@click.option("--server", default=None, help="InsForge server URL")
@handle_errors
def cmd_register(email: str, password: str, server: str | None) -> None:
    """Register a new InsForge user account."""
    cfg = load_config()
    if server:
        cfg.server_url = server
        save_config(cfg)
    with InsForgeClient(cfg) as client:
        client.register(email, password)
    console.print(Panel(f"[green]Registered[/] {email}\nRun [bold]tracker login[/] to authenticate."))


# ── tracker login ─────────────────────────────────────────────────────────

@cli.command("login")
@click.option("--email", prompt="Email", help="User email address")
@click.option("--password", prompt="Password", hide_input=True, help="Account password")
@click.option("--server", default=None, help="InsForge server URL")
@handle_errors
def cmd_login(email: str, password: str, server: str | None) -> None:
    """Authenticate and save credentials to ~/.config/ml-tracker/config.json."""
    cfg = load_config()
    if server:
        cfg.server_url = server
        save_config(cfg)
    with InsForgeClient(cfg) as client:
        access_token, refresh_token = client.login(email, password)
    cfg.access_token = access_token
    cfg.refresh_token = refresh_token
    cfg.user_email = email
    save_config(cfg)
    console.print(Panel(f"[green]Logged in[/] as [bold]{email}[/]"))


# ── tracker init ──────────────────────────────────────────────────────────

@cli.command("init")
@handle_errors
def cmd_init() -> None:
    """Verify that the required InsForge tables exist and are accessible."""
    with InsForgeClient() as client:
        missing = [t for t in REQUIRED_TABLES if not client.table_exists(t)]

    if not missing:
        console.print(Panel(
            "[green]Database ready.[/] Tables [bold]experiments[/] and [bold]runs[/] are accessible.",
        ))
        return

    missing_list = ", ".join(f"[bold]{t}[/]" for t in missing)
    err_console.print(Panel(
        f"[yellow]Missing tables:[/] {missing_list}\n\n"
        "InsForge table creation requires admin access. Ask your project admin to run "
        "the following migration via the InsForge dashboard or admin API:\n\n"
        f"[dim]{ADMIN_SETUP_SQL}[/]",
        title="Setup required",
        border_style="yellow",
    ))
    raise SystemExit(1)


# ── tracker log ───────────────────────────────────────────────────────────

@cli.command("log")
@click.option("--experiment", "-e", required=True, help="Experiment name (created if not found)")
@click.option("--run-name", "-r", default=None, help="Optional run label")
@click.option("--params", "-p", multiple=True, metavar="KEY=VALUE", help="Hyperparameter (repeatable)")
@click.option("--metrics", "-m", multiple=True, metavar="KEY=VALUE", help="Metric (repeatable)")
@click.option("--notes", "-n", default=None, help="Free-text notes")
@click.option("--started-at", default=None, help="ISO-8601 start time (default: now)")
@click.option("--finished-at", default=None, help="ISO-8601 finish time (default: now)")
@handle_errors
def cmd_log(
    experiment: str,
    run_name: str | None,
    params: tuple[str, ...],
    metrics: tuple[str, ...],
    notes: str | None,
    started_at: str | None,
    finished_at: str | None,
) -> None:
    """Log a new experiment run with hyperparameters and metrics."""
    parsed_params = parse_kv_pairs(params)
    parsed_metrics = parse_kv_pairs(metrics)
    ts = now_iso()
    started_at = started_at or ts
    finished_at = finished_at or ts

    with InsForgeClient() as client:
        exp = client.get_or_create_experiment(experiment)
        run = client.create_run(
            experiment_id=exp.id,
            experiment_name=exp.name,
            run_name=run_name,
            params=parsed_params,
            metrics=parsed_metrics,
            notes=notes,
            started_at=started_at,
            finished_at=finished_at,
        )

    _print_run_panel(run)


# ── tracker runs ──────────────────────────────────────────────────────────

@cli.group("runs")
def runs_group() -> None:
    """Commands for managing experiment runs."""


@runs_group.command("list")
@click.option("--experiment", "-e", default=None, help="Filter by experiment name")
@click.option("--limit", "-l", default=20, show_default=True, help="Max runs to return")
@click.option("--offset", default=0, show_default=True, help="Pagination offset")
@handle_errors
def cmd_runs_list(experiment: str | None, limit: int, offset: int) -> None:
    """List recent runs, optionally filtered by experiment."""
    with InsForgeClient() as client:
        runs = client.list_runs(experiment_name=experiment, limit=limit, offset=offset)

    if not runs:
        console.print("[dim]No runs found.[/]")
        return

    table = Table(title="Experiment Runs", show_header=True, header_style="bold cyan")
    table.add_column("ID", style="dim")
    table.add_column("Experiment")
    table.add_column("Run Name")
    table.add_column("Status")
    table.add_column("Params", justify="right")
    table.add_column("Metrics", justify="right")
    table.add_column("Started At")

    for r in runs:
        table.add_row(
            r.id,
            r.experiment_name,
            r.run_name or "—",
            r.status,
            str(len(r.params)),
            str(len(r.metrics)),
            r.started_at[:19].replace("T", " ") if r.started_at else "—",
        )

    console.print(table)


@runs_group.command("get")
@click.argument("run_id")
@handle_errors
def cmd_runs_get(run_id: str) -> None:
    """Show full details for a specific run."""
    with InsForgeClient() as client:
        run = client.get_run(run_id)
    _print_run_panel(run)


# ── tracker experiments ───────────────────────────────────────────────────

@cli.group("experiments")
def experiments_group() -> None:
    """Commands for managing experiments."""


@experiments_group.command("list")
@click.option("--limit", "-l", default=50, show_default=True, help="Max experiments to return")
@handle_errors
def cmd_experiments_list(limit: int) -> None:
    """List all experiments."""
    with InsForgeClient() as client:
        exps = client.list_experiments(limit=limit)

    if not exps:
        console.print("[dim]No experiments found.[/]")
        return

    table = Table(title="Experiments", show_header=True, header_style="bold cyan")
    table.add_column("ID", style="dim", width=10)
    table.add_column("Name")
    table.add_column("Description")
    table.add_column("Created At")

    for e in exps:
        table.add_row(
            e.id[:8],
            e.name,
            e.description or "—",
            e.created_at[:19].replace("T", " ") if e.created_at else "—",
        )

    console.print(table)


# ── Helpers ───────────────────────────────────────────────────────────────

def _print_run_panel(run) -> None:
    """Print a Rich-formatted panel showing run details, hyperparameters, and metrics."""
    params_table = Table(show_header=True, header_style="bold", box=None, padding=(0, 1))
    params_table.add_column("Key")
    params_table.add_column("Value")
    for k, v in run.params.items():
        params_table.add_row(str(k), str(v))

    metrics_table = Table(show_header=True, header_style="bold", box=None, padding=(0, 1))
    metrics_table.add_column("Key")
    metrics_table.add_column("Value")
    for k, v in run.metrics.items():
        metrics_table.add_row(str(k), str(v))

    lines = [
        f"[bold]Run ID:[/]        {run.id}",
        f"[bold]Experiment:[/]    {run.experiment_name}",
        f"[bold]Run Name:[/]      {run.run_name or '—'}",
        f"[bold]Status:[/]        {run.status}",
        f"[bold]Started:[/]       {run.started_at[:19].replace('T', ' ') if run.started_at else '—'}",
        f"[bold]Finished:[/]      {run.finished_at[:19].replace('T', ' ') if run.finished_at else '—'}",
    ]
    if run.notes:
        lines.append(f"[bold]Notes:[/]         {run.notes}")

    console.print(Panel("\n".join(lines), title="Run Details", border_style="cyan"))

    if run.params:
        console.print(Panel(params_table, title="Hyperparameters", border_style="blue"))
    if run.metrics:
        console.print(Panel(metrics_table, title="Metrics", border_style="green"))
