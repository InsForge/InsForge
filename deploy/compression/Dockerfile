# syntax=docker/dockerfile:1.7
#
# leanctx prompt-compression sidecar for the InsForge Model Gateway (CPU image).
#
# Runs the leanctx HTTP service (leanctx-serve) with the ~1.2 GB LLMLingua-2
# model baked in. When the backend's AI_COMPRESSION_URL points at this service,
# the Model Gateway sends each request's prose to POST /compress before calling
# OpenRouter, cutting prompt tokens (and cost). Source code, tool results, and
# multimodal content are forwarded verbatim.
#
# It is opt-in: started only via the "compression" Compose profile, so default
# deployments are unaffected. See ./README.md.
#
# leanctx's HTTP server (the [server] extra + the leanctx-serve console script)
# is not yet part of the PyPI release, so we install from the pinned GitHub
# commit below for a reproducible build.

FROM python:3.12-slim

ARG LINGUA_MODEL=microsoft/llmlingua-2-xlm-roberta-large-meetingbank
# Pinned leanctx commit — has the [server] extra and leanctx-serve.
ARG LEANCTX_REF=50e917fa2db91eaf25115f79a3324fec1451deed

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/models

# git is required for the VCS install below.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

# CPU-only torch in its own layer (the default PyPI wheel bundles CUDA and is
# ~2 GB larger; a separate layer also stays cached across edits).
RUN pip install --index-url https://download.pytorch.org/whl/cpu torch

# leanctx with [server] (FastAPI/uvicorn + leanctx-serve), [lingua] (LLMLingua-2),
# and [tokens] (real tiktoken counts, not chars/4). Pinned for reproducibility.
RUN pip install "leanctx[server,lingua,tokens] @ git+https://github.com/jia-gao/leanctx@${LEANCTX_REF}"

# Bake the LLMLingua-2 weights into the image (offline, deterministic first boot).
RUN python -c "from llmlingua import PromptCompressor; \
PromptCompressor(model_name='${LINGUA_MODEL}', use_llmlingua2=True, device_map='cpu')"
ENV HF_HUB_OFFLINE=1

# --- Model Gateway compression defaults (override via compose / -e) ---
#   threshold 1500  -> never compress short system/instruction turns
#   dedup off       -> the gateway sends raw OpenAI messages; no upstream dedup
ENV LEANCTX_SERVER_MODE=on \
    LEANCTX_SERVER_THRESHOLD=1500 \
    LEANCTX_SERVER_LINGUA_RATIO=0.5 \
    LEANCTX_SERVER_LINGUA_DEVICE=cpu \
    LEANCTX_SERVER_DEDUP=off

EXPOSE 8459

# Generous start-period: the startup warmup loads the model before serving.
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD python -c "import urllib.request,sys; \
sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8459/health').getcode()==200 else 1)"

# 0.0.0.0 so the container is reachable on the compose network; a single worker
# keeps exactly one warm model in memory.
CMD ["leanctx-serve", "--host", "0.0.0.0", "--port", "8459", "--workers", "1"]
