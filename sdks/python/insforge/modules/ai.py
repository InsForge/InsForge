"""AI module - chat completions, embeddings, image generation."""
from __future__ import annotations

import json
from typing import Any, AsyncIterator

import httpx

from insforge.errors import InsForgeError
from insforge.lib.http_client import HttpClient


class ChatCompletions:
    def __init__(self, http: HttpClient) -> None:
        self._http = http

    async def create(
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
        thinking: bool = False,
        tools: list[dict[str, Any]] | None = None,
        tool_choice: Any | None = None,
    ) -> Any:
        """
        Create a chat completion.

        When stream=True, returns an async generator of response chunks.
        When stream=False, returns the full completion response.
        """
        body: dict[str, Any] = {"model": model, "messages": messages}
        if temperature is not None:
            body["temperature"] = temperature
        if max_tokens is not None:
            body["maxTokens"] = max_tokens
        if top_p is not None:
            body["topP"] = top_p
        if web_search:
            body["webSearch"] = web_search
        if file_parser:
            body["fileParser"] = file_parser
        if thinking:
            body["thinking"] = True
        if tools:
            body["tools"] = tools
        if tool_choice is not None:
            body["toolChoice"] = tool_choice
        if stream:
            body["stream"] = True
            return self._stream(body)

        try:
            data = await self._http.post("/api/ai/chat/completion", body)
            return data
        except InsForgeError:
            raise

    async def _stream(self, body: dict[str, Any]) -> AsyncIterator[dict[str, Any]]:
        url = f"{self._http._base_url}/api/ai/chat/completion"
        headers = self._http._build_headers()
        async with httpx.AsyncClient(timeout=None) as client:
            async with client.stream("POST", url, json=body, headers=headers) as response:
                if response.status_code >= 400:
                    text = await response.aread()
                    try:
                        err_body = json.loads(text)
                    except Exception:
                        err_body = {"error": {"message": text.decode()}}
                    raise InsForgeError.from_response(err_body, response.status_code)
                async for line in response.aiter_lines():
                    line = line.strip()
                    if not line:
                        continue
                    if line.startswith("data: "):
                        payload = line[6:]
                        if payload == "[DONE]":
                            return
                        try:
                            yield json.loads(payload)
                        except json.JSONDecodeError:
                            continue


class _Chat:
    def __init__(self, http: HttpClient) -> None:
        self.completions = ChatCompletions(http)


class Embeddings:
    def __init__(self, http: HttpClient) -> None:
        self._http = http

    async def create(
        self,
        *,
        model: str,
        input: str | list[str],
        dimensions: int | None = None,
        encoding_format: str | None = None,
    ) -> Any:
        """Generate embeddings for the given input."""
        body: dict[str, Any] = {"model": model, "input": input}
        if dimensions is not None:
            body["dimensions"] = dimensions
        if encoding_format:
            body["encoding_format"] = encoding_format
        return await self._http.post("/api/ai/embeddings", body)


class Images:
    def __init__(self, http: HttpClient) -> None:
        self._http = http

    async def generate(
        self,
        *,
        model: str,
        prompt: str,
        n: int | None = None,
        size: str | None = None,
        images: list[dict[str, str]] | None = None,
    ) -> Any:
        """Generate images from a text prompt."""
        body: dict[str, Any] = {"model": model, "prompt": prompt}
        if n is not None:
            body["n"] = n
        if size:
            body["size"] = size
        if images:
            body["images"] = images
        return await self._http.post("/api/ai/image/generation", body)


class AI:
    def __init__(self, http: HttpClient) -> None:
        self.chat = _Chat(http)
        self.embeddings = Embeddings(http)
        self.images = Images(http)
        self._http = http

    async def list_models(self) -> Any:
        """List available AI models."""
        return await self._http.get("/api/ai/models")
