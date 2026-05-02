from __future__ import annotations

import datetime
import http.server
import pathlib
import sys
import threading
import urllib.parse
import webbrowser

import click
import httpx

from tracker.config import clear_tokens, load_config, update_tokens

_STATIC_DIR = pathlib.Path(__file__).parent / "static"


def make_proxy_handler(server_url: str, token_lock: threading.Lock) -> type:
    """Build and return a BaseHTTPRequestHandler subclass bound to *server_url* and *token_lock*."""
    class ProxyHandler(http.server.BaseHTTPRequestHandler):
        """HTTP handler that serves the dashboard UI and proxies /api/* calls to InsForge."""

        _server_url = server_url
        _lock = token_lock

        def do_GET(self) -> None:
            """Route GET requests to the static dashboard or the upstream API proxy."""
            parsed = urllib.parse.urlparse(self.path)
            if parsed.path in ("/", ""):
                self._serve_static()
            elif parsed.path.startswith("/api/"):
                self._proxy_api()
            else:
                self.send_error(404)

        def _serve_static(self) -> None:
            """Respond with the dashboard index.html."""
            html_path = _STATIC_DIR / "index.html"
            try:
                data = html_path.read_bytes()
            except FileNotFoundError:
                self._send_json_error(500, "STATIC_MISSING", "index.html not found")
                return
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def _proxy_api(self) -> None:
            """Forward an /api/* request to InsForge, handling auth and transparent token refresh."""
            cfg = load_config()
            if not cfg.access_token:
                self._send_json_error(
                    401, "NOT_LOGGED_IN", "No credentials found. Run `tracker login` first."
                )
                return

            parsed = urllib.parse.urlparse(self.path)
            upstream = self._server_url + parsed.path
            if parsed.query:
                upstream += "?" + parsed.query

            try:
                resp = self._attempt_upstream(upstream, cfg.access_token)
            except httpx.ConnectError:
                self._send_json_error(
                    502, "UPSTREAM_UNAVAILABLE",
                    f"Cannot connect to InsForge at {self._server_url}"
                )
                return
            except httpx.TimeoutException:
                self._send_json_error(504, "UPSTREAM_TIMEOUT", "InsForge request timed out.")
                return

            if resp.status_code == 401:
                new_token = self._do_refresh()
                if new_token is None:
                    self._send_json_error(
                        401, "SESSION_EXPIRED", "Session expired. Run `tracker login` again."
                    )
                    return
                try:
                    resp = self._attempt_upstream(upstream, new_token)
                except (httpx.ConnectError, httpx.TimeoutException):
                    self._send_json_error(502, "UPSTREAM_UNAVAILABLE", "InsForge unreachable.")
                    return

            body = resp.content
            self.send_response(resp.status_code)
            self.send_header(
                "Content-Type", resp.headers.get("content-type", "application/json")
            )
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _attempt_upstream(self, url: str, access_token: str) -> httpx.Response:
            """Make a single authenticated GET request to the InsForge upstream URL."""
            with httpx.Client(timeout=15.0) as client:
                return client.get(url, headers={"Authorization": f"Bearer {access_token}"})

        def _do_refresh(self) -> str | None:
            """Attempt to refresh the access token; return the new token or None on failure."""
            with self._lock:
                cfg = load_config()
                if not cfg.refresh_token:
                    return None
                try:
                    with httpx.Client(timeout=10.0) as client:
                        resp = client.post(
                            cfg.server_url + "/api/auth/sessions",
                            json={"refreshToken": cfg.refresh_token},
                        )
                    if not resp.is_success:
                        clear_tokens()
                        return None
                    data = resp.json()
                    new_access = data.get("accessToken") or data.get("access_token", "")
                    if not new_access:
                        clear_tokens()
                        return None
                    new_refresh = data.get("refreshToken") or data.get(
                        "refresh_token", cfg.refresh_token
                    )
                    update_tokens(new_access, new_refresh)
                    return new_access
                except Exception:
                    return None

        def _send_json_error(self, status: int, code: str, message: str) -> None:
            """Send a JSON error response with the given HTTP status, error code, and message."""
            import json
            body = json.dumps({"error": code, "message": message}).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, fmt: str, *args: object) -> None:
            """Write a timestamped access-log line to stderr."""
            ts = datetime.datetime.now().strftime("%H:%M:%S")
            sys.stderr.write(f"  [{ts}] {fmt % args}\n")

    return ProxyHandler


@click.command("serve")
@click.option("--port", default=8765, show_default=True, help="Port to listen on.")
@click.option("--no-browser", is_flag=True, default=False, help="Do not open the browser automatically.")
def cmd_serve(port: int, no_browser: bool) -> None:
    """Start the local web dashboard (proxies API calls to InsForge)."""
    from rich.console import Console
    from rich.panel import Panel

    console = Console()
    err_console = Console(stderr=True)

    cfg = load_config()
    if not cfg.access_token:
        err_console.print(Panel(
            "[yellow]Warning:[/] No credentials found. "
            "Run [bold]tracker login[/] first, or the dashboard will show an auth error.",
            border_style="yellow",
        ))

    token_lock = threading.Lock()
    HandlerClass = make_proxy_handler(cfg.server_url, token_lock)

    url = f"http://127.0.0.1:{port}"
    try:
        httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), HandlerClass)
    except OSError as e:
        err_console.print(f"[bold red]Cannot start server:[/] {e}")
        raise SystemExit(1)

    console.print(Panel(
        f"Dashboard:  [bold]{url}[/]\n"
        f"Proxying to: {cfg.server_url}\n"
        "Press [bold]Ctrl+C[/] to stop.",
        title="tracker serve",
        border_style="cyan",
    ))

    if not no_browser:
        webbrowser.open(url)

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        console.print("\n[dim]Server stopped.[/]")
    finally:
        httpd.server_close()
