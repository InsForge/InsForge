# leanctx prompt-compression sidecar (optional)

An opt-in [leanctx](https://pypi.org/project/leanctx/) sidecar that adds ML
"prose" compression in front of the InsForge **Model Gateway**. When enabled,
the gateway sends each chat request's natural-language content to this service's
`POST /compress` before calling OpenRouter, cutting prompt tokens — and
therefore OpenRouter cost. Source code, tool results, and multimodal content are
forwarded verbatim.

It is **off by default** and lives behind the `compression` Compose profile, so
standard deployments are completely unaffected.

## Enable it

1. Start the sidecar (builds the image; first boot downloads the ~1.2 GB
   LLMLingua-2 model and bakes it in, so give it a minute):

   ```bash
   docker compose --profile compression up -d --build compression
   ```

2. Point the backend at it — set in your `.env`, then restart `insforge`:

   ```bash
   AI_COMPRESSION_URL=http://compression:8459
   ```

   That is the only switch. Leaving `AI_COMPRESSION_URL` empty disables
   compression entirely.

## Behaviour & safety

- **Fail-open:** if the sidecar is slow, erroring, or down, the gateway falls
  back to the original (uncompressed) request — compression never breaks a call.
- **Verbatim:** only `system`/`user`/`assistant` string prose is compressed;
  tool results and multimodal (image) content pass through untouched.
- **Thresholds:** short turns (< ~1500 tokens) and small requests are skipped,
  so the round-trip is only paid where there is real prose to shrink.

## Tuning (optional env on the `insforge` service)

| Var | Default | Meaning |
|-----|---------|---------|
| `AI_COMPRESSION_URL` | _(empty / off)_ | Sidecar base URL, e.g. `http://compression:8459` |
| `AI_COMPRESSION_TIMEOUT_MS` | `2000` | Per-request timeout for the sidecar call |
| `AI_COMPRESSION_MIN_CHARS` | `6000` | Skip the sidecar below this much string content |

## GPU

The bundled image is CPU-only (portable; the model runs in seconds on first
token under load). For lower latency, run it on a GPU / Apple-Silicon host and
set `LEANCTX_SERVER_LINGUA_DEVICE=cuda` (or `mps`) on this service.
