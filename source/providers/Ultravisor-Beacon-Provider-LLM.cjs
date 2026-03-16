/**
 * Ultravisor Beacon Provider — LLM
 *
 * Built-in provider that wraps LLM API calls for multiple backends:
 *   - openai           — OpenAI API (GPT-4, etc.)
 *   - anthropic        — Anthropic API (Claude)
 *   - ollama           — Local Ollama instance
 *   - openai-compatible — Any OpenAI-compatible API
 *
 * Capability: 'LLM'
 * Actions:    'ChatCompletion' — Send messages, get completion
 *             'Embedding'      — Generate text embeddings
 *             'ToolUse'        — Chat completion with tool definitions
 *
 * Provider config:
 *   Backend {string}          — 'openai' | 'anthropic' | 'ollama' | 'openai-compatible'
 *   BaseURL {string}          — API endpoint base URL
 *   APIKey {string}           — API key or $ENV_VAR_NAME for env resolution
 *   Model {string}            — Default model name
 *   DefaultParameters {object} — { Temperature, MaxTokens, TopP }
 *   TimeoutMs {number}        — Per-request timeout (default: 120000)
 */

const libHttp = require('http');
const libHttps = require('https');
const libUrl = require('url');

const libBeaconCapabilityProvider = require('../Ultravisor-Beacon-CapabilityProvider.cjs');

class UltravisorBeaconProviderLLM extends libBeaconCapabilityProvider
{
	constructor(pProviderConfig)
	{
		super(pProviderConfig);

		this.Name = 'LLM';
		this.Capability = 'LLM';

		this._Backend = this._ProviderConfig.Backend || 'openai';
		this._BaseURL = this._ProviderConfig.BaseURL || '';
		this._APIKeyConfig = this._ProviderConfig.APIKey || '';
		this._Model = this._ProviderConfig.Model || '';
		this._DefaultParameters = this._ProviderConfig.DefaultParameters || {};
		this._TimeoutMs = this._ProviderConfig.TimeoutMs || 120000;

		// Resolved at initialize time
		this._ResolvedAPIKey = '';
	}

	get actions()
	{
		return {
			'ChatCompletion':
			{
				Description: 'Send messages to an LLM and receive a completion.',
				SettingsSchema:
				[
					{ Name: 'Messages', DataType: 'String', Required: false, Description: 'JSON array of message objects [{role, content}]' },
					{ Name: 'SystemPrompt', DataType: 'String', Required: false, Description: 'System prompt text (prepended as system message)' },
					{ Name: 'Model', DataType: 'String', Required: false, Description: 'Override model name' },
					{ Name: 'Temperature', DataType: 'Number', Required: false, Description: 'Sampling temperature (0-2)' },
					{ Name: 'MaxTokens', DataType: 'Number', Required: false, Description: 'Maximum tokens to generate' },
					{ Name: 'TopP', DataType: 'Number', Required: false, Description: 'Nucleus sampling parameter' },
					{ Name: 'StopSequences', DataType: 'String', Required: false, Description: 'JSON array of stop sequences' },
					{ Name: 'ResponseFormat', DataType: 'String', Required: false, Description: '"text" or "json_object"' }
				]
			},
			'Embedding':
			{
				Description: 'Generate embeddings for text input.',
				SettingsSchema:
				[
					{ Name: 'Text', DataType: 'String', Required: true, Description: 'Text to embed (string or JSON array for batch)' },
					{ Name: 'Model', DataType: 'String', Required: false, Description: 'Override embedding model' }
				]
			},
			'ToolUse':
			{
				Description: 'Chat completion with tool/function definitions.',
				SettingsSchema:
				[
					{ Name: 'Messages', DataType: 'String', Required: true, Description: 'JSON array of message objects' },
					{ Name: 'Tools', DataType: 'String', Required: true, Description: 'JSON array of tool definitions' },
					{ Name: 'Model', DataType: 'String', Required: false, Description: 'Override model name' },
					{ Name: 'ToolChoice', DataType: 'String', Required: false, Description: '"auto", "none", or specific tool name' },
					{ Name: 'Temperature', DataType: 'Number', Required: false, Description: 'Sampling temperature' },
					{ Name: 'MaxTokens', DataType: 'Number', Required: false, Description: 'Maximum tokens to generate' }
				]
			}
		};
	}

	/**
	 * Resolve the API key from config. Supports $ENV_VAR_NAME syntax.
	 */
	_resolveAPIKey(pKeyConfig)
	{
		if (!pKeyConfig)
		{
			return '';
		}

		if (pKeyConfig.startsWith('$'))
		{
			let tmpEnvVar = pKeyConfig.substring(1);
			return process.env[tmpEnvVar] || '';
		}

		return pKeyConfig;
	}

	/**
	 * Validate connectivity during initialization.
	 */
	initialize(fCallback)
	{
		this._ResolvedAPIKey = this._resolveAPIKey(this._APIKeyConfig);

		if (!this._BaseURL)
		{
			console.warn(`[LLM] No BaseURL configured for provider "${this.Name}".`);
		}

		if (!this._Model)
		{
			console.warn(`[LLM] No default Model configured for provider "${this.Name}".`);
		}

		// For Ollama, check that the server is reachable
		if (this._Backend === 'ollama' && this._BaseURL)
		{
			let tmpParsed = new URL(this._BaseURL);
			let tmpLib = tmpParsed.protocol === 'https:' ? libHttps : libHttp;
			let tmpRequest = tmpLib.request(
				{
					hostname: tmpParsed.hostname,
					port: tmpParsed.port,
					path: '/api/tags',
					method: 'GET',
					timeout: 5000
				},
				function (pResponse)
				{
					// Consume response body to free the socket
					pResponse.resume();
					console.log(`[LLM] Ollama server reachable at ${tmpParsed.hostname}:${tmpParsed.port}`);
					return fCallback(null);
				});

			tmpRequest.on('error', function (pError)
			{
				console.warn(`[LLM] Ollama server not reachable at ${tmpParsed.hostname}:${tmpParsed.port}: ${pError.message}`);
				// Non-fatal — the server may come online later
				return fCallback(null);
			});

			tmpRequest.on('timeout', function ()
			{
				tmpRequest.destroy();
				console.warn(`[LLM] Ollama server connection timed out.`);
				return fCallback(null);
			});

			tmpRequest.end();
			return;
		}

		console.log(`[LLM] Provider initialized: backend=${this._Backend}, model=${this._Model}`);
		return fCallback(null);
	}

	/**
	 * Route execution to the appropriate action handler.
	 */
	execute(pAction, pWorkItem, pContext, fCallback, fReportProgress)
	{
		switch (pAction)
		{
			case 'ChatCompletion':
				return this._executeChatCompletion(pWorkItem, pContext, fCallback, fReportProgress);
			case 'Embedding':
				return this._executeEmbedding(pWorkItem, pContext, fCallback, fReportProgress);
			case 'ToolUse':
				return this._executeToolUse(pWorkItem, pContext, fCallback, fReportProgress);
			default:
				return fCallback(new Error(`LLM Provider: unknown action "${pAction}".`));
		}
	}

	// ── ChatCompletion ──────────────────────────────────────────

	_executeChatCompletion(pWorkItem, pContext, fCallback, fReportProgress)
	{
		let tmpSettings = pWorkItem.Settings || {};
		let tmpMessages = this._parseMessages(tmpSettings);

		if (!tmpMessages || tmpMessages.length === 0)
		{
			return fCallback(null, {
				Outputs: { Content: '', Model: '', FinishReason: 'error', PromptTokens: 0, CompletionTokens: 0, TotalTokens: 0, Result: '' },
				Log: ['LLM ChatCompletion: no messages provided.']
			});
		}

		let tmpModel = tmpSettings.Model || this._Model;
		let tmpRequestBody = this._buildChatRequestBody(tmpMessages, tmpModel, tmpSettings, false);
		let tmpRequestOptions = this._buildRequestOptions('chat', tmpRequestBody);

		console.log(`  [LLM] ChatCompletion: model=${tmpModel}, messages=${tmpMessages.length}`);

		this._makeRequest(tmpRequestOptions, tmpRequestBody, fReportProgress,
			(pError, pResponseBody) =>
			{
				if (pError)
				{
					return fCallback(null, {
						Outputs: { Content: '', Model: tmpModel, FinishReason: 'error', PromptTokens: 0, CompletionTokens: 0, TotalTokens: 0, Result: '' },
						Log: [`LLM ChatCompletion failed: ${pError.message}`]
					});
				}

				let tmpParsed = this._parseChatResponse(pResponseBody);

				return fCallback(null, {
					Outputs:
					{
						Content: tmpParsed.Content,
						Model: tmpParsed.Model || tmpModel,
						FinishReason: tmpParsed.FinishReason,
						PromptTokens: tmpParsed.PromptTokens,
						CompletionTokens: tmpParsed.CompletionTokens,
						TotalTokens: tmpParsed.TotalTokens,
						Result: tmpParsed.Content
					},
					Log: [`LLM ChatCompletion: model=${tmpParsed.Model || tmpModel}, tokens=${tmpParsed.TotalTokens}, finish=${tmpParsed.FinishReason}`]
				});
			});
	}

	// ── Embedding ───────────────────────────────────────────────

	_executeEmbedding(pWorkItem, pContext, fCallback, fReportProgress)
	{
		let tmpSettings = pWorkItem.Settings || {};
		let tmpText = tmpSettings.Text || '';

		if (!tmpText)
		{
			return fCallback(null, {
				Outputs: { Embedding: '[]', Dimensions: 0, Model: '', Result: '' },
				Log: ['LLM Embedding: no text provided.']
			});
		}

		let tmpModel = tmpSettings.Model || this._Model;
		let tmpRequestBody = this._buildEmbeddingRequestBody(tmpText, tmpModel);
		let tmpRequestOptions = this._buildRequestOptions('embedding', tmpRequestBody);

		console.log(`  [LLM] Embedding: model=${tmpModel}`);

		this._makeRequest(tmpRequestOptions, tmpRequestBody, fReportProgress,
			(pError, pResponseBody) =>
			{
				if (pError)
				{
					return fCallback(null, {
						Outputs: { Embedding: '[]', Dimensions: 0, Model: tmpModel, Result: '' },
						Log: [`LLM Embedding failed: ${pError.message}`]
					});
				}

				let tmpParsed = this._parseEmbeddingResponse(pResponseBody);

				return fCallback(null, {
					Outputs:
					{
						Embedding: tmpParsed.Embedding,
						Dimensions: tmpParsed.Dimensions,
						Model: tmpParsed.Model || tmpModel,
						Result: tmpParsed.Embedding
					},
					Log: [`LLM Embedding: model=${tmpParsed.Model || tmpModel}, dimensions=${tmpParsed.Dimensions}`]
				});
			});
	}

	// ── ToolUse ─────────────────────────────────────────────────

	_executeToolUse(pWorkItem, pContext, fCallback, fReportProgress)
	{
		let tmpSettings = pWorkItem.Settings || {};
		let tmpMessages = this._parseMessages(tmpSettings);
		let tmpTools = this._safeParseJSON(tmpSettings.Tools, []);

		if (!tmpMessages || tmpMessages.length === 0)
		{
			return fCallback(null, {
				Outputs: { Content: '', ToolCalls: '[]', Model: '', FinishReason: 'error', PromptTokens: 0, CompletionTokens: 0, TotalTokens: 0, Result: '' },
				Log: ['LLM ToolUse: no messages provided.']
			});
		}

		if (!tmpTools || tmpTools.length === 0)
		{
			return fCallback(null, {
				Outputs: { Content: '', ToolCalls: '[]', Model: '', FinishReason: 'error', PromptTokens: 0, CompletionTokens: 0, TotalTokens: 0, Result: '' },
				Log: ['LLM ToolUse: no tools provided.']
			});
		}

		let tmpModel = tmpSettings.Model || this._Model;
		let tmpRequestBody = this._buildChatRequestBody(tmpMessages, tmpModel, tmpSettings, true);

		// Add tools to the request body
		this._addToolsToRequestBody(tmpRequestBody, tmpTools, tmpSettings.ToolChoice);

		let tmpRequestOptions = this._buildRequestOptions('chat', tmpRequestBody);

		console.log(`  [LLM] ToolUse: model=${tmpModel}, messages=${tmpMessages.length}, tools=${tmpTools.length}`);

		this._makeRequest(tmpRequestOptions, tmpRequestBody, fReportProgress,
			(pError, pResponseBody) =>
			{
				if (pError)
				{
					return fCallback(null, {
						Outputs: { Content: '', ToolCalls: '[]', Model: tmpModel, FinishReason: 'error', PromptTokens: 0, CompletionTokens: 0, TotalTokens: 0, Result: '' },
						Log: [`LLM ToolUse failed: ${pError.message}`]
					});
				}

				let tmpParsed = this._parseToolUseResponse(pResponseBody);

				return fCallback(null, {
					Outputs:
					{
						Content: tmpParsed.Content,
						ToolCalls: tmpParsed.ToolCalls,
						Model: tmpParsed.Model || tmpModel,
						FinishReason: tmpParsed.FinishReason,
						PromptTokens: tmpParsed.PromptTokens,
						CompletionTokens: tmpParsed.CompletionTokens,
						TotalTokens: tmpParsed.TotalTokens,
						Result: tmpParsed.Content
					},
					Log: [`LLM ToolUse: model=${tmpParsed.Model || tmpModel}, tokens=${tmpParsed.TotalTokens}, finish=${tmpParsed.FinishReason}, tool_calls=${tmpParsed.ToolCallCount}`]
				});
			});
	}

	// ── Message Parsing ─────────────────────────────────────────

	/**
	 * Parse messages from settings. Supports Messages JSON array
	 * and SystemPrompt convenience field.
	 */
	_parseMessages(pSettings)
	{
		let tmpMessages = [];

		// Parse Messages JSON if provided
		if (pSettings.Messages)
		{
			let tmpParsed = this._safeParseJSON(pSettings.Messages, null);

			if (Array.isArray(tmpParsed))
			{
				tmpMessages = tmpParsed;
			}
			else if (typeof pSettings.Messages === 'string' && pSettings.Messages.length > 0)
			{
				// Treat plain string as a single user message
				tmpMessages.push({ role: 'user', content: pSettings.Messages });
			}
		}

		// Prepend SystemPrompt if provided and not already in messages
		if (pSettings.SystemPrompt)
		{
			let tmpHasSystem = tmpMessages.some(function (pMsg) { return pMsg.role === 'system'; });

			if (!tmpHasSystem)
			{
				tmpMessages.unshift({ role: 'system', content: pSettings.SystemPrompt });
			}
		}

		return tmpMessages;
	}

	// ── Request Building ────────────────────────────────────────

	/**
	 * Build the chat completion request body for the configured backend.
	 */
	_buildChatRequestBody(pMessages, pModel, pSettings, pIsToolUse)
	{
		let tmpTemperature = (pSettings.Temperature !== undefined && pSettings.Temperature !== '')
			? parseFloat(pSettings.Temperature)
			: (this._DefaultParameters.Temperature !== undefined ? this._DefaultParameters.Temperature : undefined);

		let tmpMaxTokens = (pSettings.MaxTokens !== undefined && pSettings.MaxTokens !== '')
			? parseInt(pSettings.MaxTokens, 10)
			: (this._DefaultParameters.MaxTokens !== undefined ? this._DefaultParameters.MaxTokens : undefined);

		let tmpTopP = (pSettings.TopP !== undefined && pSettings.TopP !== '')
			? parseFloat(pSettings.TopP)
			: (this._DefaultParameters.TopP !== undefined ? this._DefaultParameters.TopP : undefined);

		let tmpStopSequences = this._safeParseJSON(pSettings.StopSequences, null);

		if (this._Backend === 'anthropic')
		{
			return this._buildAnthropicChatBody(pMessages, pModel, tmpTemperature, tmpMaxTokens, tmpTopP, tmpStopSequences);
		}

		if (this._Backend === 'ollama')
		{
			return this._buildOllamaChatBody(pMessages, pModel, tmpTemperature, tmpMaxTokens, tmpTopP, tmpStopSequences);
		}

		// OpenAI and openai-compatible
		return this._buildOpenAIChatBody(pMessages, pModel, tmpTemperature, tmpMaxTokens, tmpTopP, tmpStopSequences, pSettings.ResponseFormat);
	}

	_buildOpenAIChatBody(pMessages, pModel, pTemperature, pMaxTokens, pTopP, pStopSequences, pResponseFormat)
	{
		let tmpBody = {
			model: pModel,
			messages: pMessages
		};

		if (pTemperature !== undefined)
		{
			tmpBody.temperature = pTemperature;
		}
		if (pMaxTokens !== undefined)
		{
			tmpBody.max_tokens = pMaxTokens;
		}
		if (pTopP !== undefined)
		{
			tmpBody.top_p = pTopP;
		}
		if (pStopSequences)
		{
			tmpBody.stop = pStopSequences;
		}
		if (pResponseFormat === 'json_object')
		{
			tmpBody.response_format = { type: 'json_object' };
		}

		return tmpBody;
	}

	_buildAnthropicChatBody(pMessages, pModel, pTemperature, pMaxTokens, pTopP, pStopSequences)
	{
		// Anthropic separates system from messages
		let tmpSystem = '';
		let tmpMessages = [];

		for (let i = 0; i < pMessages.length; i++)
		{
			if (pMessages[i].role === 'system')
			{
				tmpSystem = (tmpSystem ? tmpSystem + '\n' : '') + pMessages[i].content;
			}
			else
			{
				tmpMessages.push(pMessages[i]);
			}
		}

		let tmpBody = {
			model: pModel,
			messages: tmpMessages,
			max_tokens: pMaxTokens || 4096
		};

		if (tmpSystem)
		{
			tmpBody.system = tmpSystem;
		}
		if (pTemperature !== undefined)
		{
			tmpBody.temperature = pTemperature;
		}
		if (pTopP !== undefined)
		{
			tmpBody.top_p = pTopP;
		}
		if (pStopSequences)
		{
			tmpBody.stop_sequences = pStopSequences;
		}

		return tmpBody;
	}

	_buildOllamaChatBody(pMessages, pModel, pTemperature, pMaxTokens, pTopP, pStopSequences)
	{
		let tmpBody = {
			model: pModel,
			messages: pMessages,
			stream: false
		};

		let tmpOptions = {};

		if (pTemperature !== undefined)
		{
			tmpOptions.temperature = pTemperature;
		}
		if (pMaxTokens !== undefined)
		{
			tmpOptions.num_predict = pMaxTokens;
		}
		if (pTopP !== undefined)
		{
			tmpOptions.top_p = pTopP;
		}
		if (pStopSequences)
		{
			tmpOptions.stop = pStopSequences;
		}

		if (Object.keys(tmpOptions).length > 0)
		{
			tmpBody.options = tmpOptions;
		}

		return tmpBody;
	}

	/**
	 * Build embedding request body.
	 */
	_buildEmbeddingRequestBody(pText, pModel)
	{
		if (this._Backend === 'ollama')
		{
			return {
				model: pModel,
				prompt: pText
			};
		}

		// OpenAI / openai-compatible / Anthropic (uses voyage via OpenAI-compat)
		return {
			model: pModel,
			input: pText
		};
	}

	/**
	 * Add tool definitions to an existing request body.
	 */
	_addToolsToRequestBody(pRequestBody, pTools, pToolChoice)
	{
		if (this._Backend === 'anthropic')
		{
			// Anthropic uses a different tool format
			pRequestBody.tools = pTools.map(function (pTool)
			{
				if (pTool.type === 'function')
				{
					// Convert from OpenAI format to Anthropic format
					return {
						name: pTool.function.name,
						description: pTool.function.description || '',
						input_schema: pTool.function.parameters || {}
					};
				}
				// Already in Anthropic format
				return pTool;
			});

			if (pToolChoice && pToolChoice !== 'auto' && pToolChoice !== 'none')
			{
				pRequestBody.tool_choice = { type: 'tool', name: pToolChoice };
			}
			else if (pToolChoice === 'none')
			{
				// Anthropic doesn't have a direct 'none' — omit tools instead
				delete pRequestBody.tools;
			}
			else if (pToolChoice === 'auto')
			{
				pRequestBody.tool_choice = { type: 'auto' };
			}
		}
		else
		{
			// OpenAI / openai-compatible / Ollama
			pRequestBody.tools = pTools;

			if (pToolChoice)
			{
				if (pToolChoice === 'auto' || pToolChoice === 'none')
				{
					pRequestBody.tool_choice = pToolChoice;
				}
				else
				{
					pRequestBody.tool_choice = { type: 'function', function: { name: pToolChoice } };
				}
			}
		}
	}

	// ── HTTP Request Options ────────────────────────────────────

	/**
	 * Build HTTP request options based on backend and action type.
	 *
	 * @param {string} pActionType - 'chat' or 'embedding'
	 * @param {object} pBody - The request body (used for Content-Length)
	 * @returns {{ url: string, options: object, bodyString: string }}
	 */
	_buildRequestOptions(pActionType, pBody)
	{
		let tmpBodyString = JSON.stringify(pBody);
		let tmpPath = '';

		switch (this._Backend)
		{
			case 'anthropic':
				tmpPath = (pActionType === 'embedding') ? '/v1/embeddings' : '/v1/messages';
				break;

			case 'ollama':
				tmpPath = (pActionType === 'embedding') ? '/api/embeddings' : '/api/chat';
				break;

			case 'openai':
			case 'openai-compatible':
			default:
				tmpPath = (pActionType === 'embedding') ? '/v1/embeddings' : '/v1/chat/completions';
				break;
		}

		let tmpParsed = new URL(this._BaseURL);

		let tmpHeaders = {
			'Content-Type': 'application/json',
			'Content-Length': Buffer.byteLength(tmpBodyString)
		};

		// Set auth headers per backend
		if (this._Backend === 'anthropic')
		{
			if (this._ResolvedAPIKey)
			{
				tmpHeaders['x-api-key'] = this._ResolvedAPIKey;
			}
			tmpHeaders['anthropic-version'] = '2023-06-01';
		}
		else if (this._Backend !== 'ollama')
		{
			// OpenAI / openai-compatible use Bearer token
			if (this._ResolvedAPIKey)
			{
				tmpHeaders['Authorization'] = 'Bearer ' + this._ResolvedAPIKey;
			}
		}

		return {
			options:
			{
				hostname: tmpParsed.hostname,
				port: tmpParsed.port || (tmpParsed.protocol === 'https:' ? 443 : 80),
				path: tmpPath,
				method: 'POST',
				headers: tmpHeaders,
				timeout: this._TimeoutMs
			},
			bodyString: tmpBodyString,
			protocol: tmpParsed.protocol
		};
	}

	// ── HTTP Transport ──────────────────────────────────────────

	/**
	 * Execute an HTTP/HTTPS request and return the parsed JSON response.
	 *
	 * @param {object} pRequestInfo - From _buildRequestOptions
	 * @param {object} pBody - Original request body (unused, kept for clarity)
	 * @param {function} fReportProgress - Optional progress callback
	 * @param {function} fCallback - function(pError, pResponseBody)
	 */
	_makeRequest(pRequestInfo, pBody, fReportProgress, fCallback)
	{
		let tmpLib = pRequestInfo.protocol === 'https:' ? libHttps : libHttp;

		let tmpRequest = tmpLib.request(pRequestInfo.options, function (pResponse)
		{
			let tmpChunks = [];
			let tmpTotalBytes = 0;

			pResponse.on('data', function (pChunk)
			{
				tmpChunks.push(pChunk);
				tmpTotalBytes += pChunk.length;

				// Report progress during large responses
				if (fReportProgress && tmpTotalBytes > 0)
				{
					fReportProgress({
						Message: `Receiving response: ${Math.round(tmpTotalBytes / 1024)}KB`,
						Log: []
					});
				}
			});

			pResponse.on('end', function ()
			{
				let tmpRawBody = Buffer.concat(tmpChunks).toString('utf8');
				let tmpParsedBody = null;

				try
				{
					tmpParsedBody = JSON.parse(tmpRawBody);
				}
				catch (pParseError)
				{
					return fCallback(new Error(`Failed to parse LLM response as JSON: ${pParseError.message}. Raw: ${tmpRawBody.substring(0, 500)}`));
				}

				// Check for API error responses
				if (pResponse.statusCode >= 400)
				{
					let tmpErrorMsg = tmpParsedBody.error
						? (tmpParsedBody.error.message || JSON.stringify(tmpParsedBody.error))
						: `HTTP ${pResponse.statusCode}`;
					return fCallback(new Error(`LLM API error (${pResponse.statusCode}): ${tmpErrorMsg}`));
				}

				return fCallback(null, tmpParsedBody);
			});
		});

		tmpRequest.on('error', function (pError)
		{
			return fCallback(new Error(`LLM request failed: ${pError.message}`));
		});

		tmpRequest.on('timeout', function ()
		{
			tmpRequest.destroy();
			return fCallback(new Error(`LLM request timed out after ${pRequestInfo.options.timeout}ms.`));
		});

		tmpRequest.write(pRequestInfo.bodyString);
		tmpRequest.end();
	}

	// ── Response Parsing ────────────────────────────────────────

	/**
	 * Parse a chat completion response into normalized outputs.
	 */
	_parseChatResponse(pResponseBody)
	{
		if (this._Backend === 'anthropic')
		{
			return this._parseAnthropicChatResponse(pResponseBody);
		}

		if (this._Backend === 'ollama')
		{
			return this._parseOllamaChatResponse(pResponseBody);
		}

		return this._parseOpenAIChatResponse(pResponseBody);
	}

	_parseOpenAIChatResponse(pBody)
	{
		let tmpChoice = (pBody.choices && pBody.choices.length > 0) ? pBody.choices[0] : {};
		let tmpMessage = tmpChoice.message || {};
		let tmpUsage = pBody.usage || {};

		return {
			Content: tmpMessage.content || '',
			Model: pBody.model || '',
			FinishReason: tmpChoice.finish_reason || 'unknown',
			PromptTokens: tmpUsage.prompt_tokens || 0,
			CompletionTokens: tmpUsage.completion_tokens || 0,
			TotalTokens: tmpUsage.total_tokens || 0
		};
	}

	_parseAnthropicChatResponse(pBody)
	{
		let tmpContent = '';

		if (pBody.content && Array.isArray(pBody.content))
		{
			for (let i = 0; i < pBody.content.length; i++)
			{
				if (pBody.content[i].type === 'text')
				{
					tmpContent += pBody.content[i].text;
				}
			}
		}

		let tmpUsage = pBody.usage || {};

		return {
			Content: tmpContent,
			Model: pBody.model || '',
			FinishReason: pBody.stop_reason || 'unknown',
			PromptTokens: tmpUsage.input_tokens || 0,
			CompletionTokens: tmpUsage.output_tokens || 0,
			TotalTokens: (tmpUsage.input_tokens || 0) + (tmpUsage.output_tokens || 0)
		};
	}

	_parseOllamaChatResponse(pBody)
	{
		let tmpMessage = pBody.message || {};

		return {
			Content: tmpMessage.content || '',
			Model: pBody.model || '',
			FinishReason: pBody.done ? 'stop' : 'unknown',
			PromptTokens: pBody.prompt_eval_count || 0,
			CompletionTokens: pBody.eval_count || 0,
			TotalTokens: (pBody.prompt_eval_count || 0) + (pBody.eval_count || 0)
		};
	}

	/**
	 * Parse an embedding response.
	 */
	_parseEmbeddingResponse(pResponseBody)
	{
		if (this._Backend === 'ollama')
		{
			let tmpEmbedding = pResponseBody.embedding || [];
			return {
				Embedding: JSON.stringify(tmpEmbedding),
				Dimensions: tmpEmbedding.length,
				Model: pResponseBody.model || ''
			};
		}

		// OpenAI / openai-compatible
		let tmpData = (pResponseBody.data && pResponseBody.data.length > 0) ? pResponseBody.data[0] : {};
		let tmpEmbedding = tmpData.embedding || [];

		return {
			Embedding: JSON.stringify(tmpEmbedding),
			Dimensions: tmpEmbedding.length,
			Model: pResponseBody.model || ''
		};
	}

	/**
	 * Parse a tool use response into normalized outputs.
	 */
	_parseToolUseResponse(pResponseBody)
	{
		if (this._Backend === 'anthropic')
		{
			return this._parseAnthropicToolUseResponse(pResponseBody);
		}

		// OpenAI / openai-compatible / Ollama
		return this._parseOpenAIToolUseResponse(pResponseBody);
	}

	_parseOpenAIToolUseResponse(pBody)
	{
		let tmpChoice = (pBody.choices && pBody.choices.length > 0) ? pBody.choices[0] : {};
		let tmpMessage = tmpChoice.message || {};
		let tmpUsage = pBody.usage || {};
		let tmpToolCalls = tmpMessage.tool_calls || [];

		return {
			Content: tmpMessage.content || '',
			ToolCalls: JSON.stringify(tmpToolCalls),
			ToolCallCount: tmpToolCalls.length,
			Model: pBody.model || '',
			FinishReason: tmpChoice.finish_reason || 'unknown',
			PromptTokens: tmpUsage.prompt_tokens || 0,
			CompletionTokens: tmpUsage.completion_tokens || 0,
			TotalTokens: tmpUsage.total_tokens || 0
		};
	}

	_parseAnthropicToolUseResponse(pBody)
	{
		let tmpContent = '';
		let tmpToolCalls = [];

		if (pBody.content && Array.isArray(pBody.content))
		{
			for (let i = 0; i < pBody.content.length; i++)
			{
				if (pBody.content[i].type === 'text')
				{
					tmpContent += pBody.content[i].text;
				}
				else if (pBody.content[i].type === 'tool_use')
				{
					// Normalize to OpenAI-style tool_calls format for consistency
					tmpToolCalls.push({
						id: pBody.content[i].id,
						type: 'function',
						function: {
							name: pBody.content[i].name,
							arguments: JSON.stringify(pBody.content[i].input)
						}
					});
				}
			}
		}

		let tmpUsage = pBody.usage || {};

		return {
			Content: tmpContent,
			ToolCalls: JSON.stringify(tmpToolCalls),
			ToolCallCount: tmpToolCalls.length,
			Model: pBody.model || '',
			FinishReason: pBody.stop_reason || 'unknown',
			PromptTokens: tmpUsage.input_tokens || 0,
			CompletionTokens: tmpUsage.output_tokens || 0,
			TotalTokens: (tmpUsage.input_tokens || 0) + (tmpUsage.output_tokens || 0)
		};
	}

	// ── Utilities ───────────────────────────────────────────────

	/**
	 * Safely parse a JSON string, returning a fallback on failure.
	 */
	_safeParseJSON(pString, pFallback)
	{
		if (!pString || typeof pString !== 'string')
		{
			return pFallback;
		}

		try
		{
			return JSON.parse(pString);
		}
		catch (pError)
		{
			return pFallback;
		}
	}

	shutdown(fCallback)
	{
		console.log(`[LLM] Provider "${this.Name}" shutting down (backend=${this._Backend}).`);
		return fCallback(null);
	}
}

module.exports = UltravisorBeaconProviderLLM;
