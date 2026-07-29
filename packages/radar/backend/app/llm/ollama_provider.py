"""Ollama LLM provider, for running a radar against a local model.

Ollama needs no API key and costs nothing per token, which matters when
reprocessing a corpus during development: the same pipeline that would spend
real money against a hosted model can be exercised locally for free.

Small local models are chattier than hosted ones and routinely wrap their
JSON in prose or code fences despite instructions to the contrary, so the
JSON path here is deliberately forgiving about the envelope while staying
strict about the payload.
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

logger = get_logger(__name__)

_DEFAULT_BASE_URL = "http://localhost:11434"
_DEFAULT_MODEL = "llama3.1"
_DEFAULT_TIMEOUT = 120.0  # local generation is slower than a hosted API


def extract_json(text: str) -> dict[str, Any]:
    """Pull a JSON object out of a model response.

    Accepts a bare object, one wrapped in a Markdown code fence, or one
    embedded in prose. Braces inside string literals are not mistaken for
    structure.

    Args:
        text: The raw model output.

    Returns:
        The decoded object.

    Raises:
        ValueError: If no JSON object is present, or it is malformed.
    """
    candidate = _strip_code_fence(text.strip())

    try:
        return _as_object(json.loads(candidate))
    except json.JSONDecodeError:
        pass

    span = _find_object_span(candidate)
    if span is None:
        raise ValueError(f"no JSON object found in model response: {text[:200]!r}")

    start, end = span
    try:
        return _as_object(json.loads(candidate[start:end]))
    except json.JSONDecodeError as exc:
        raise ValueError(f"malformed JSON in model response: {exc}") from exc


def _as_object(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"expected a JSON object, got {type(value).__name__}")
    return value


def _strip_code_fence(text: str) -> str:
    """Remove a surrounding ``` fence, with or without a language tag."""
    if not text.startswith("```"):
        return text

    without_open = text[3:]
    newline = without_open.find("\n")
    if newline == -1:
        return text

    body = without_open[newline + 1 :]
    closing = body.rfind("```")
    return body[:closing].strip() if closing != -1 else body.strip()


def _find_object_span(text: str) -> tuple[int, int] | None:
    """Locate the first balanced ``{...}`` span, ignoring braces in strings."""
    start = text.find("{")
    if start == -1:
        return None

    depth = 0
    in_string = False
    escaped = False

    for index in range(start, len(text)):
        char = text[index]

        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue

        if char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return start, index + 1

    return None


class OllamaProvider(BaseLLMProvider):
    """Chat provider backed by a local Ollama server."""

    def __init__(
        self,
        *,
        base_url: str | None = None,
        model: str | None = None,
        timeout: float = _DEFAULT_TIMEOUT,
    ) -> None:
        resolved = base_url or os.getenv("OLLAMA_BASE_URL", _DEFAULT_BASE_URL)
        self.base_url = resolved.rstrip("/")
        self.model = model or os.getenv("OLLAMA_MODEL", _DEFAULT_MODEL)
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
