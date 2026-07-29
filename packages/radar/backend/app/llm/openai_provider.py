"""OpenAI LLM provider implementation."""

from __future__ import annotations

import asyncio
import json
import os
import time

from openai import AsyncOpenAI, RateLimitError

from app.core.logging import get_logger
from app.llm import default_registry
from app.llm.base import BaseLLMProvider, LLMResponse, Usage

logger = get_logger(__name__)

_DEFAULT_MODEL = "gpt-4o"
_MAX_RETRIES = 3
_RETRY_BASE_DELAY = 1.0  # seconds


class OpenAIProvider(BaseLLMProvider):
    """OpenAI chat-completions provider with retry/backoff."""

    def __init__(
        self,
        *,
        api_key: str | None = None,
        model: str | None = None,
        max_retries: int = _MAX_RETRIES,
    ) -> None:
        resolved_key = api_key or os.getenv("OPENAI_API_KEY", "")
        self.model = model or os.getenv("OPENAI_MODEL", _DEFAULT_MODEL)
        self._max_retries = max_retries
        self._client = AsyncOpenAI(api_key=resolved_key)

    # ------------------------------------------------------------------
    # Public interface
    # ------------------------------------------------------------------

    async def complete(
        self,
        prompt: str,
        *,
        system_prompt: str | None = None,
        temperature: float = 0.2,
        max_tokens: int = 4096,
    ) -> LLMResponse:
        """Send a prompt and return a free-text response."""
        messages = self._build_messages(prompt, system_prompt=system_prompt)
        response = await self._call_with_retry(
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        return response

    async def complete_json(
        self,
        prompt: str,
        *,
        system_prompt: str | None = None,
        schema: dict | None = None,
    ) -> dict:
        """Send a prompt and return structured JSON."""
        user_content = prompt
        if schema:
            user_content = (
                f"{prompt}\n\nRespond with JSON matching this schema:\n"
                f"{json.dumps(schema, indent=2)}"
            )

        messages = self._build_messages(user_content, system_prompt=system_prompt)
        response = await self._call_with_retry(
            messages=messages,
            response_format={"type": "json_object"},
        )
        return json.loads(response.content)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _build_messages(
        prompt: str,
        *,
        system_prompt: str | None = None,
    ) -> list[dict[str, str]]:
        messages: list[dict[str, str]] = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})
        return messages

    async def _call_with_retry(self, **kwargs) -> LLMResponse:
        """Call the OpenAI API with exponential backoff on rate limits."""
        last_error: Exception | None = None

        for attempt in range(self._max_retries):
            try:
                return await self._do_call(**kwargs)
            except RateLimitError as exc:
                last_error = exc
                if attempt < self._max_retries - 1:
                    delay = _RETRY_BASE_DELAY * (2**attempt)
                    logger.warning(
                        "Rate limited, retrying",
                        attempt=attempt + 1,
                        delay=delay,
                    )
                    await asyncio.sleep(delay)

        raise last_error  # type: ignore[misc]

    async def _do_call(self, **kwargs) -> LLMResponse:
        """Execute a single API call and wrap the result."""
        kwargs.setdefault("model", self.model)
        start = time.perf_counter()
        response = await self._client.chat.completions.create(**kwargs)
        latency_ms = (time.perf_counter() - start) * 1000

        choice = response.choices[0]
        usage = Usage(
            prompt_tokens=response.usage.prompt_tokens,
            completion_tokens=response.usage.completion_tokens,
        )
        return LLMResponse(
            content=choice.message.content,
            model=response.model,
            usage=usage,
            latency_ms=latency_ms,
        )


# ---------------------------------------------------------------------------
# Auto-register in the default registry
# ---------------------------------------------------------------------------
default_registry.register("openai", OpenAIProvider)
