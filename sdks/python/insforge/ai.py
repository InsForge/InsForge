"""
AI module for the InsForge Python SDK.

Provides OpenAI-compatible chat completions, image generation, and embeddings.

Usage:
    response = client.ai.chat.completions.create(
        model="anthropic/claude-3.5-haiku",
        messages=[{"role": "user", "content": "Hello!"}],
    )
    print(response["choices"][0]["message"]["content"])

    images = client.ai.images.generate(
        model="google/gemini-3-pro-image-preview",
        prompt="A sunset over the ocean",
    )

    embeddings = client.ai.embeddings.create(
        model="openai/text-embedding-3-small",
        input="Hello world",
    )
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Any


class _ChatCompletions:
    def __init__(self, http: Any) -> None:
        self._http = http

    def create(
        self,
        *,
        model: str,
        messages: list[dict[str, Any]],
        temperature: float | None = None,
        max_tokens: int | None = None,
        top_p: float | None = None,
        stream: bool = False,
        web_search: dict[str, Any] | None = None,
        file_parser: dict[str, Any] | None = None,
        tools: list[dict[str, Any]] | None = None,
        tool_choice: Any | None = None,
        parallel_tool_calls: bool | None = None,
    ) -> dict[str, Any] | Iterator[dict[str, Any]]:
        """
        Create a chat completion.

        Args:
            model: Model identifier (e.g., 'anthropic/claude-3.5-haiku').
            messages: List of message dicts with 'role' and 'content'.
            temperature: Sampling temperature 0-2.
            max_tokens: Max tokens to generate.
            top_p: Top-p sampling 0-1.
            stream: If True, returns a generator of chunks.
            web_search: Dict with 'enabled' bool and optional 'max_results'.
            file_parser: Dict with 'enabled' bool and optional 'pdf' options.
            tools: List of tool definitions for function calling.
            tool_choice: Controls tool usage ('auto', 'none', 'required', or dict).
            parallel_tool_calls: Allow parallel tool calls.

        Returns:
            Non-streaming: dict with 'choices', 'usage', etc.
            Streaming: iterator of chunk dicts.

        Raises:
            InsForgeError: On API error.
        """
        payload: dict[str, Any] = {"model": model, "messages": messages, "stream": stream}
        if temperature is not None:
            payload["temperature"] = temperature
        if max_tokens is not None:
            payload["maxTokens"] = max_tokens
        if top_p is not None:
            payload["topP"] = top_p
        if web_search is not None:
            payload["webSearch"] = web_search
        if file_parser is not None:
            payload["fileParser"] = file_parser
        if tools is not None:
            payload["tools"] = tools
        if tool_choice is not None:
            payload["toolChoice"] = tool_choice
        if parallel_tool_calls is not None:
            payload["parallelToolCalls"] = parallel_tool_calls

        if stream:
            return self._stream(payload)

        return self._http.post("/api/ai/chat/completions", data=payload)

    def _stream(self, payload: dict[str, Any]) -> Iterator[dict[str, Any]]:
        """Internal SSE streaming generator."""
        import requests as _requests

        url = self._http._url("/api/ai/chat/completions")
        headers = self._http._build_headers()
        with _requests.post(
            url,
            json=payload,
            headers=headers,
            stream=True,
            timeout=self._http.timeout,
        ) as r:
            r.raise_for_status()
            for line in r.iter_lines():
                if not line:
                    continue
                text = line.decode("utf-8") if isinstance(line, bytes) else line
                if text.startswith("data:"):
                    text = text[len("data:"):].strip()
                if text == "[DONE]":
                    break
                if text:
                    try:
                        yield json.loads(text)
                    except json.JSONDecodeError:
                        pass


class _Chat:
    def __init__(self, http: Any) -> None:
        self.completions = _ChatCompletions(http)


class _Embeddings:
    def __init__(self, http: Any) -> None:
        self._http = http

    def create(
        self,
        *,
        model: str,
        input: str | list[str],
        encoding_format: str = "float",
        dimensions: int | None = None,
    ) -> dict[str, Any]:
        """
        Generate vector embeddings for text input.

        Args:
            model: Embedding model (e.g., 'openai/text-embedding-3-small').
            input: Text string or list of strings to embed.
            encoding_format: 'float' (default) or 'base64'.
            dimensions: Number of output dimensions.

        Returns:
            Dict with keys: object ('list'), data (list of embedding objects),
            metadata (model, usage).
        """
        payload: dict[str, Any] = {
            "model": model,
            "input": input,
            "encoding_format": encoding_format,
        }
        if dimensions is not None:
            payload["dimensions"] = dimensions
        return self._http.post("/api/ai/embeddings", data=payload)


class _Images:
    def __init__(self, http: Any) -> None:
        self._http = http

    def generate(
        self,
        *,
        model: str,
        prompt: str,
        images: list[str | dict[str, Any]] | None = None,
        width: int | None = None,
        height: int | None = None,
        size: str | None = None,
        num_images: int | None = None,
        quality: str | None = None,
        style: str | None = None,
    ) -> dict[str, Any]:
        """
        Generate images using an AI model.

        Args:
            model: Image model (e.g., 'google/gemini-3-pro-image-preview').
            prompt: Text description of the desired image.
            images: Optional input images for image-to-image (URL or base64).
            width: Image width in pixels.
            height: Image height in pixels.
            size: Predefined size string (e.g., '1024x1024').
            num_images: Number of images to generate.
            quality: 'standard' or 'hd'.
            style: 'vivid' or 'natural'.

        Returns:
            Dict with keys: created (timestamp), data (list of ImageData).
        """
        payload: dict[str, Any] = {"model": model, "prompt": prompt}
        if images is not None:
            payload["images"] = images
        if width is not None:
            payload["width"] = width
        if height is not None:
            payload["height"] = height
        if size is not None:
            payload["size"] = size
        if num_images is not None:
            payload["numImages"] = num_images
        if quality is not None:
            payload["quality"] = quality
        if style is not None:
            payload["style"] = style
        return self._http.post("/api/ai/images/generate", data=payload)


class AIClient:
    """Provides AI chat completions, embeddings, and image generation."""

    def __init__(self, http: Any) -> None:
        self.chat = _Chat(http)
        self.embeddings = _Embeddings(http)
        self.images = _Images(http)
