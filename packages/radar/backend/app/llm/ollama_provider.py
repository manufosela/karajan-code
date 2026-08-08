"""Ollama LLM provider, for running a radar against a local model.

Ollama needs no API key and costs nothing per token, which matters when
reprocessing a corpus during development: the same pipeline that would spend
real money against a hosted model can be exercised locally for free.

Small local models are chattier than hosted ones and routinely wrap their
JSON in prose or code fences despite instructions to the contrary. Reading
that reply is not an Ollama problem, though -- every provider that asks for
structured output without an output schema hits it -- so it lives in
``app.llm.json_parsing``.
"""

from __future__ import annotations

import json
import os
import time
from typing import Any

import httpx

from app.core.logging import get_logger
from app.llm import default_registry
from app.llm.base import BaseLLMProvider, LLMResponse, Usage
from app.llm.json_parsing import extract_json

logger = get_logger(__name__)

_DEFAULT_BASE_URL = "http://localhost:11434"
_DEFAULT_MODEL = "llama3.1"
_DEFAULT_TIMEOUT = 120.0  # local generation is slower than a hosted API


class OllamaProvider(BaseLLMProvider):
    """Chat provider backed by a local Ollama server."""

    def __init__(
        self,
        *,
        base_url: str | None = None,
        model: str | None = None,
        timeout: float = _DEFAULT_TIMEOUT,
    ) -> None:
        resolved: str = base_url or os.getenv("OLLAMA_BASE_URL") or _DEFAULT_BASE_URL
        self.base_url = resolved.rstrip("/")
        self.model: str = model or os.getenv("OLLAMA_MODEL") or _DEFAULT_MODEL
        self._timeout = timeout

    async def complete(
        self,
        prompt: str,
        *,
        system_prompt: str | None = None,
        temperature: float = 0.2,
        max_tokens: int = 4096,
    ) -> LLMResponse:
        """Send a prompt and return a free-text response."""
        return await self._chat(
            prompt,
            system_prompt=system_prompt,
            options={"temperature": temperature, "num_predict": max_tokens},
        )

    async def complete_json(
        self,
        prompt: str,
        *,
        system_prompt: str | None = None,
        schema: dict | None = None,
    ) -> dict:
        """Send a prompt and return structured JSON.

        Raises:
            ValueError: If the model's reply contains no usable JSON object.
        """
        user_content = prompt
        if schema:
            user_content = (
                f"{prompt}\n\nRespond with JSON matching this schema:\n{json.dumps(schema, indent=2)}"
            )

        response = await self._chat(
            user_content,
            system_prompt=system_prompt,
            response_format="json",
        )
        return extract_json(response.content)

    async def _chat(
        self,
        prompt: str,
        *,
        system_prompt: str | None = None,
        response_format: str | None = None,
        options: dict[str, Any] | None = None,
    ) -> LLMResponse:
        """Perform one non-streamed /api/chat call."""
        messages: list[dict[str, str]] = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            # A streamed reply arrives as newline-delimited fragments, which
            # would not decode as a single JSON body.
            "stream": False,
        }
        if response_format:
            payload["format"] = response_format
        if options:
            payload["options"] = options

        start = time.perf_counter()
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                http_response = await client.post(f"{self.base_url}/api/chat", json=payload)
                http_response.raise_for_status()
                data = http_response.json()
        except httpx.ConnectError as exc:
            raise ConnectionError(f"cannot reach Ollama at {self.base_url}: {exc}") from exc

        latency_ms = (time.perf_counter() - start) * 1000

        usage = Usage(
            prompt_tokens=data.get("prompt_eval_count", 0),
            completion_tokens=data.get("eval_count", 0),
        )

        logger.info(
            "ollama_call_complete",
            model=data.get("model", self.model),
            latency_ms=round(latency_ms, 1),
            total_tokens=usage.total_tokens,
        )

        return LLMResponse(
            content=data.get("message", {}).get("content", ""),
            model=data.get("model", self.model),
            usage=usage,
            latency_ms=latency_ms,
        )


default_registry.register("ollama", OllamaProvider)
