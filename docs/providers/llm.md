# LLM Provider

Multi-backend LLM API calls with unified request/response normalization across OpenAI, Anthropic, Ollama, and OpenAI-compatible APIs.

**Capability:** `LLM`

## Configuration

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `Backend` | `string` | `'openai'` | `'openai'`, `'anthropic'`, `'ollama'`, `'openai-compatible'` |
| `BaseURL` | `string` | `''` | API endpoint base URL |
| `APIKey` | `string` | `''` | API key or `$ENV_VAR_NAME` for environment variable resolution |
| `Model` | `string` | `''` | Default model name |
| `DefaultParameters` | `object` | `{}` | `{ Temperature, MaxTokens, TopP }` |
| `TimeoutMs` | `number` | `120000` | Per-request timeout (ms) |

### Example Configurations

```javascript
// OpenAI
{ Source: 'LLM', Config: {
	Backend: 'openai',
	BaseURL: 'https://api.openai.com',
	APIKey: '$OPENAI_API_KEY',
	Model: 'gpt-4',
	DefaultParameters: { Temperature: 0.7, MaxTokens: 4096 }
}}

// Anthropic
{ Source: 'LLM', Config: {
	Backend: 'anthropic',
	BaseURL: 'https://api.anthropic.com',
	APIKey: '$ANTHROPIC_API_KEY',
	Model: 'claude-sonnet-4-20250514'
}}

// Ollama (local)
{ Source: 'LLM', Config: {
	Backend: 'ollama',
	BaseURL: 'http://localhost:11434',
	Model: 'llama3'
}}

// OpenAI-compatible (e.g. vLLM, LiteLLM)
{ Source: 'LLM', Config: {
	Backend: 'openai-compatible',
	BaseURL: 'http://localhost:8000',
	Model: 'mistral-7b'
}}
```

### API Key Resolution

The `APIKey` config supports environment variable syntax:

- `'sk-abc123...'` -- Used as-is
- `'$OPENAI_API_KEY'` -- Resolved from `process.env.OPENAI_API_KEY` at initialization

---

## Actions

### ChatCompletion

Send messages to an LLM and receive a completion.

#### Settings

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `Messages` | `string` | No | JSON array of `[{role, content}]` or plain string (treated as user message) |
| `SystemPrompt` | `string` | No | System prompt (prepended if no system message exists in Messages) |
| `Model` | `string` | No | Override model name |
| `Temperature` | `number` | No | Sampling temperature (0-2) |
| `MaxTokens` | `number` | No | Maximum tokens to generate |
| `TopP` | `number` | No | Nucleus sampling parameter |
| `StopSequences` | `string` | No | JSON array of stop sequences |
| `ResponseFormat` | `string` | No | `'text'` or `'json_object'` (OpenAI only) |

#### Outputs

| Name | Type | Description |
|------|------|-------------|
| `Content` | `string` | Generated text |
| `Model` | `string` | Model used |
| `FinishReason` | `string` | `'stop'`, `'length'`, `'error'`, etc. |
| `PromptTokens` | `number` | Input token count |
| `CompletionTokens` | `number` | Output token count |
| `TotalTokens` | `number` | Combined token count |
| `Result` | `string` | Same as `Content` |

#### Example

```javascript
// Work item settings
{
	Messages: '[{"role": "user", "content": "Summarize this text: ..."}]',
	SystemPrompt: 'You are a helpful assistant.',
	Temperature: 0.5,
	MaxTokens: 1000
}

// Or with a plain string message
{
	Messages: 'What is the capital of France?',
	Model: 'gpt-4'
}
```

---

### Embedding

Generate text embeddings.

#### Settings

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `Text` | `string` | Yes | Text to embed (string or JSON array for batch) |
| `Model` | `string` | No | Override embedding model |

#### Outputs

| Name | Type | Description |
|------|------|-------------|
| `Embedding` | `string` | JSON string of the embedding vector |
| `Dimensions` | `number` | Vector dimensions |
| `Model` | `string` | Model used |
| `Result` | `string` | Same as `Embedding` |

#### Example

```javascript
// Work item settings
{ Text: 'The quick brown fox jumps over the lazy dog.' }

// Result
{
	Outputs: {
		Embedding: '[0.123, -0.456, 0.789, ...]',
		Dimensions: 1536,
		Model: 'text-embedding-ada-002',
		Result: '[0.123, -0.456, 0.789, ...]'
	},
	Log: ['LLM Embedding: model=text-embedding-ada-002, dimensions=1536']
}
```

---

### ToolUse

Chat completion with tool/function definitions. Tool call results are normalized to a consistent format across backends.

#### Settings

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `Messages` | `string` | Yes | JSON array of message objects |
| `Tools` | `string` | Yes | JSON array of tool definitions |
| `Model` | `string` | No | Override model name |
| `ToolChoice` | `string` | No | `'auto'`, `'none'`, or specific tool name |
| `Temperature` | `number` | No | Sampling temperature |
| `MaxTokens` | `number` | No | Maximum tokens |

#### Tool Definition Format

Use the OpenAI tool definition format; the provider converts automatically for Anthropic:

```javascript
[
	{
		"type": "function",
		"function":
		{
			"name": "get_weather",
			"description": "Get the current weather",
			"parameters":
			{
				"type": "object",
				"properties":
				{
					"location": { "type": "string", "description": "City name" }
				},
				"required": ["location"]
			}
		}
	}
]
```

#### Outputs

| Name | Type | Description |
|------|------|-------------|
| `Content` | `string` | Text content (may be empty if tools were called) |
| `ToolCalls` | `string` | JSON string of tool call array |
| `Model` | `string` | Model used |
| `FinishReason` | `string` | `'stop'`, `'tool_calls'`, etc. |
| `PromptTokens` | `number` | Input token count |
| `CompletionTokens` | `number` | Output token count |
| `TotalTokens` | `number` | Combined token count |
| `Result` | `string` | Same as `Content` |

#### Tool Call Format (Normalized)

Anthropic tool calls are normalized to OpenAI format:

```javascript
[
	{
		"id": "call_abc123",
		"type": "function",
		"function":
		{
			"name": "get_weather",
			"arguments": "{\"location\": \"San Francisco\"}"
		}
	}
]
```

---

## Backend Differences

| Feature | OpenAI | Anthropic | Ollama | OpenAI-compatible |
|---------|--------|-----------|--------|-------------------|
| Auth header | `Authorization: Bearer` | `x-api-key` | None | `Authorization: Bearer` |
| Chat endpoint | `/v1/chat/completions` | `/v1/messages` | `/api/chat` | `/v1/chat/completions` |
| Embedding endpoint | `/v1/embeddings` | `/v1/embeddings` | `/api/embeddings` | `/v1/embeddings` |
| System message | In messages array | Separate `system` field | In messages array | In messages array |
| Max tokens | `max_tokens` | `max_tokens` (required) | `options.num_predict` | `max_tokens` |
| Stop sequences | `stop` | `stop_sequences` | `options.stop` | `stop` |
| Response format | `response_format` | Not supported | Not supported | `response_format` |

---

## Initialization

During `initialize()`, the LLM provider:

1. Resolves the API key from config (including `$ENV_VAR` syntax)
2. For Ollama, pings the server to verify reachability (non-fatal if unreachable)
3. Logs warnings for missing `BaseURL` or `Model`

---

## Notes

- All settings values are strings (they come from work item serialization). Numeric values like `Temperature` are parsed automatically.
- The Anthropic backend requires `MaxTokens` (defaults to 4096 if not specified).
- Embedding with Anthropic typically uses Voyage models via an OpenAI-compatible endpoint.
- API errors (4xx/5xx) return a result with `FinishReason: 'error'` rather than calling back with an error.
