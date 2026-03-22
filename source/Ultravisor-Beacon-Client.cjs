/**
 * Ultravisor Beacon Client
 *
 * A lightweight worker node that connects to an Ultravisor server,
 * registers its capabilities, polls for work, executes tasks locally,
 * and reports results back to the orchestrator.
 *
 * Capabilities are provided by pluggable CapabilityProviders loaded
 * via the ProviderRegistry. The beacon advertises the aggregate set
 * of capabilities from all loaded providers.
 *
 * Communication is HTTP-based (transport-agnostic design means this
 * can be swapped for WebSocket, MQTT, etc. in the future).
 */

const libHTTP = require('http');

let libWebSocket;
try
{
	libWebSocket = require('ws');
}
catch (pError)
{
	// ws is optional — only required for WebSocket transport
	libWebSocket = null;
}

const libBeaconExecutor = require('./Ultravisor-Beacon-Executor.cjs');

class UltravisorBeaconClient
{
	constructor(pConfig)
	{
		this._Config = Object.assign({
			ServerURL: 'http://localhost:54321',
			Name: 'beacon-worker',
			Password: '',
			Capabilities: ['Shell'],
			MaxConcurrent: 1,
			PollIntervalMs: 5000,
			HeartbeatIntervalMs: 30000,
			ReconnectIntervalMs: 10000,
			StagingPath: process.cwd(),
			Tags: {}
		}, pConfig || {});

		this._BeaconID = null;
		this._PollInterval = null;
		this._HeartbeatInterval = null;
		this._Running = false;
		this._ActiveWorkItems = 0;
		this._SessionCookie = null;
		this._Authenticating = false;

		// WebSocket transport state — determined at runtime, not config
		this._WebSocket = null;
		this._UseWebSocket = false;

		this._Executor = new libBeaconExecutor({
			StagingPath: this._Config.StagingPath
		});

		// Load capability providers
		this._loadProviders();
	}

	// ================================================================
	// Provider Loading
	// ================================================================

	_loadProviders()
	{
		let tmpProviders = this._Config.Providers;

		if (!tmpProviders)
		{
			// Backward compatibility: convert Capabilities array to Provider descriptors
			let tmpCapabilities = this._Config.Capabilities || ['Shell'];
			tmpProviders = tmpCapabilities.map(function (pCap)
			{
				return { Source: pCap, Config: {} };
			});
		}

		let tmpCount = this._Executor.providerRegistry.loadProviders(tmpProviders);
		console.log(`[Beacon] Loaded ${tmpCount} capability provider(s).`);
	}

	// ================================================================
	// Lifecycle
	// ================================================================

	/**
	 * Start the Beacon client: initialize providers, register, then begin polling.
	 */
	start(fCallback)
	{
		console.log(`[Beacon] Starting "${this._Config.Name}"...`);
		console.log(`[Beacon] Server: ${this._Config.ServerURL}`);

		// Initialize all providers before registering
		this._Executor.providerRegistry.initializeAll((pInitError) =>
		{
			if (pInitError)
			{
				console.error(`[Beacon] Provider initialization failed: ${pInitError.message}`);
				return fCallback(pInitError);
			}

			let tmpCapabilities = this._Executor.providerRegistry.getCapabilities();
			console.log(`[Beacon] Capabilities: ${tmpCapabilities.join(', ')}`);

			// Authenticate before registering (both transports need a session)
			this._authenticate((pAuthError) =>
			{
				if (pAuthError)
				{
					console.error(`[Beacon] Authentication failed: ${pAuthError.message}`);
					return fCallback(pAuthError);
				}

				console.log(`[Beacon] Authenticated successfully.`);

				// Try WebSocket first — if ws library is available and the
				// server supports it, we get push-based work dispatch.
				// Falls back to HTTP polling automatically.
				if (libWebSocket)
				{
					this._startWebSocket((pWSError, pBeacon) =>
					{
						if (pWSError)
						{
							console.log(`[Beacon] WebSocket unavailable (${pWSError.message}), using HTTP polling.`);
							this._UseWebSocket = false;
							this._startHTTP(fCallback);
							return;
						}
						this._UseWebSocket = true;
						return fCallback(null, pBeacon);
					});
				}
				else
				{
					this._startHTTP(fCallback);
				}
			});
		});
	}

	/**
	 * Start with HTTP transport: register via REST, then poll for work.
	 */
	_startHTTP(fCallback)
	{
		this._register((pError, pBeacon) =>
		{
			if (pError)
			{
				console.error(`[Beacon] Registration failed: ${pError.message}`);
				return fCallback(pError);
			}

			this._BeaconID = pBeacon.BeaconID;
			this._Running = true;

			console.log(`[Beacon] Registered as ${this._BeaconID}`);

			// Start polling for work
			this._PollInterval = setInterval(() =>
			{
				this._poll();
			}, this._Config.PollIntervalMs);

			// Start heartbeat
			this._HeartbeatInterval = setInterval(() =>
			{
				this._heartbeat();
			}, this._Config.HeartbeatIntervalMs);

			// Do an immediate poll
			this._poll();

			return fCallback(null, pBeacon);
		});
	}

	/**
	 * Stop the Beacon client: stop polling/WebSocket, shutdown providers, deregister.
	 */
	stop(fCallback)
	{
		console.log(`[Beacon] Stopping...`);
		this._Running = false;

		if (this._PollInterval)
		{
			clearInterval(this._PollInterval);
			this._PollInterval = null;
		}

		if (this._HeartbeatInterval)
		{
			clearInterval(this._HeartbeatInterval);
			this._HeartbeatInterval = null;
		}

		// Close WebSocket if open
		if (this._WebSocket)
		{
			if (this._BeaconID)
			{
				// Send deregister message before closing
				this._wsSend({ Action: 'Deregister', BeaconID: this._BeaconID });
			}
			this._WebSocket.onclose = null;
			this._WebSocket.close();
			this._WebSocket = null;
		}

		// Clean up affinity staging directories
		this._Executor.cleanupAffinityDirs();

		// Shutdown providers
		this._Executor.providerRegistry.shutdownAll((pShutdownError) =>
		{
			if (pShutdownError)
			{
				console.warn(`[Beacon] Provider shutdown warning: ${pShutdownError.message}`);
			}

			if (this._BeaconID)
			{
				this._deregister((pError) =>
				{
					if (pError)
					{
						console.warn(`[Beacon] Deregistration warning: ${pError.message}`);
					}
					console.log(`[Beacon] Stopped.`);
					if (fCallback) return fCallback(null);
				});
			}
			else
			{
				console.log(`[Beacon] Stopped.`);
				if (fCallback) return fCallback(null);
			}
		});
	}

	// ================================================================
	// Authentication
	// ================================================================

	_authenticate(fCallback)
	{
		let tmpBody = {
			UserName: this._Config.Name,
			Password: this._Config.Password || ''
		};

		let tmpBodyString = JSON.stringify(tmpBody);
		let tmpParsedURL = new URL(this._Config.ServerURL);
		let tmpOptions = {
			hostname: tmpParsedURL.hostname,
			port: tmpParsedURL.port || 80,
			path: '/1.0/Authenticate',
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Content-Length': Buffer.byteLength(tmpBodyString)
			}
		};

		let tmpReq = libHTTP.request(tmpOptions, (pResponse) =>
		{
			let tmpData = '';
			pResponse.on('data', (pChunk) => { tmpData += pChunk; });
			pResponse.on('end', () =>
			{
				if (pResponse.statusCode >= 400)
				{
					return fCallback(new Error(`Authentication failed with HTTP ${pResponse.statusCode}`));
				}

				// Extract session cookie from Set-Cookie headers
				let tmpSetCookieHeaders = pResponse.headers['set-cookie'];
				if (tmpSetCookieHeaders && tmpSetCookieHeaders.length > 0)
				{
					// Take the name=value portion (before the first semicolon)
					let tmpCookieParts = tmpSetCookieHeaders[0].split(';');
					this._SessionCookie = tmpCookieParts[0].trim();
					console.log(`[Beacon] Session cookie acquired.`);
				}

				try
				{
					let tmpParsed = JSON.parse(tmpData);
					return fCallback(null, tmpParsed);
				}
				catch (pParseError)
				{
					return fCallback(new Error(`Invalid JSON in auth response: ${tmpData.substring(0, 200)}`));
				}
			});
		});

		tmpReq.on('error', (pError) =>
		{
			return fCallback(pError);
		});

		tmpReq.write(tmpBodyString);
		tmpReq.end();
	}

	// ================================================================
	// Reconnection
	// ================================================================

	_reconnect()
	{
		if (this._Authenticating)
		{
			return;
		}
		this._Authenticating = true;

		// Clear existing intervals
		if (this._PollInterval)
		{
			clearInterval(this._PollInterval);
			this._PollInterval = null;
		}
		if (this._HeartbeatInterval)
		{
			clearInterval(this._HeartbeatInterval);
			this._HeartbeatInterval = null;
		}

		this._SessionCookie = null;

		console.log(`[Beacon] Reconnecting — re-authenticating...`);

		this._authenticate((pAuthError) =>
		{
			if (pAuthError)
			{
				console.error(`[Beacon] Re-authentication failed: ${pAuthError.message}`);
				this._Authenticating = false;
				setTimeout(() => { this._reconnect(); }, 10000);
				return;
			}

			console.log(`[Beacon] Re-authenticated, re-registering...`);

			this._register((pRegError, pBeacon) =>
			{
				if (pRegError)
				{
					console.error(`[Beacon] Re-registration failed: ${pRegError.message}`);
					this._Authenticating = false;
					setTimeout(() => { this._reconnect(); }, 10000);
					return;
				}

				this._BeaconID = pBeacon.BeaconID;
				this._Authenticating = false;

				console.log(`[Beacon] Reconnected as ${this._BeaconID}`);

				// Restart polling
				this._PollInterval = setInterval(() =>
				{
					this._poll();
				}, this._Config.PollIntervalMs);

				// Restart heartbeat
				this._HeartbeatInterval = setInterval(() =>
				{
					this._heartbeat();
				}, this._Config.HeartbeatIntervalMs);

				// Immediate poll
				this._poll();
			});
		});
	}

	// ================================================================
	// Registration
	// ================================================================

	_register(fCallback)
	{
		let tmpBody = {
			Name: this._Config.Name,
			Capabilities: this._Executor.providerRegistry.getCapabilities(),
			ActionSchemas: this._Executor.providerRegistry.getActionSchemas(),
			MaxConcurrent: this._Config.MaxConcurrent,
			Tags: this._Config.Tags
		};

		// Include contexts if any are defined
		if (this._Config.Contexts && Object.keys(this._Config.Contexts).length > 0)
		{
			tmpBody.Contexts = this._Config.Contexts;
		}

		// Include operations if any are defined
		if (Array.isArray(this._Config.Operations) && this._Config.Operations.length > 0)
		{
			tmpBody.Operations = this._Config.Operations;
		}

		// Include bind addresses so the coordinator knows how to reach us
		if (Array.isArray(this._Config.BindAddresses) && this._Config.BindAddresses.length > 0)
		{
			tmpBody.BindAddresses = this._Config.BindAddresses;
		}

		this._httpRequest('POST', '/Beacon/Register', tmpBody, fCallback);
	}

	_deregister(fCallback)
	{
		this._httpRequest('DELETE', `/Beacon/${this._BeaconID}`, null, fCallback);
	}

	// ================================================================
	// Polling
	// ================================================================

	_poll()
	{
		if (!this._Running || !this._BeaconID)
		{
			return;
		}

		if (this._ActiveWorkItems >= this._Config.MaxConcurrent)
		{
			return;
		}

		this._httpRequest('POST', '/Beacon/Work/Poll', { BeaconID: this._BeaconID },
			(pError, pResponse) =>
			{
				if (pError)
				{
					// Silent on poll errors — just retry next interval
					return;
				}

				if (!pResponse || !pResponse.WorkItem)
				{
					// No work available
					return;
				}

				// Execute the work item
				this._executeWorkItem(pResponse.WorkItem);
			});
	}

	// ================================================================
	// Work Execution
	// ================================================================

	_executeWorkItem(pWorkItem)
	{
		this._ActiveWorkItems++;
		console.log(`[Beacon] Executing work item [${pWorkItem.WorkItemHash}] (${pWorkItem.Capability}/${pWorkItem.Action})`);

		// Create a progress callback that sends updates to the server
		let tmpWorkItemHash = pWorkItem.WorkItemHash;
		let fReportProgress = (pProgressData) =>
		{
			if (this._UseWebSocket)
			{
				this._wsReportProgress(tmpWorkItemHash, pProgressData);
			}
			else
			{
				this._reportProgress(tmpWorkItemHash, pProgressData);
			}
		};

		this._Executor.execute(pWorkItem, (pError, pResult) =>
		{
			this._ActiveWorkItems--;

			if (pError)
			{
				console.error(`[Beacon] Execution error for [${pWorkItem.WorkItemHash}]: ${pError.message}`);
				if (this._UseWebSocket)
				{
					this._wsReportError(pWorkItem.WorkItemHash, pError.message, []);
				}
				else
				{
					this._reportError(pWorkItem.WorkItemHash, pError.message, []);
				}
				return;
			}

			// Check if the result indicates an error (non-zero exit code)
			let tmpOutputs = pResult.Outputs || {};
			if (tmpOutputs.ExitCode && tmpOutputs.ExitCode !== 0)
			{
				console.warn(`[Beacon] Work item [${pWorkItem.WorkItemHash}] completed with exit code ${tmpOutputs.ExitCode}`);
			}
			else
			{
				console.log(`[Beacon] Work item [${pWorkItem.WorkItemHash}] completed successfully.`);
			}

			if (this._UseWebSocket)
			{
				this._wsReportComplete(pWorkItem.WorkItemHash, tmpOutputs, pResult.Log || []);
			}
			else
			{
				this._reportComplete(pWorkItem.WorkItemHash, tmpOutputs, pResult.Log || []);
			}
		}, fReportProgress);
	}

	// ================================================================
	// Reporting
	// ================================================================

	_reportComplete(pWorkItemHash, pOutputs, pLog)
	{
		this._httpRequest('POST', `/Beacon/Work/${pWorkItemHash}/Complete`,
			{ Outputs: pOutputs, Log: pLog },
			(pError) =>
			{
				if (pError)
				{
					console.error(`[Beacon] Failed to report completion for [${pWorkItemHash}]: ${pError.message}`);
				}
			});
	}

	_reportError(pWorkItemHash, pErrorMessage, pLog)
	{
		this._httpRequest('POST', `/Beacon/Work/${pWorkItemHash}/Error`,
			{ ErrorMessage: pErrorMessage, Log: pLog },
			(pError) =>
			{
				if (pError)
				{
					console.error(`[Beacon] Failed to report error for [${pWorkItemHash}]: ${pError.message}`);
				}
			});
	}

	_reportProgress(pWorkItemHash, pProgressData)
	{
		if (!pProgressData || !this._Running)
		{
			return;
		}

		this._httpRequest('POST', `/Beacon/Work/${pWorkItemHash}/Progress`,
			pProgressData,
			(pError) =>
			{
				if (pError)
				{
					// Fire-and-forget — log but don't affect execution
					console.warn(`[Beacon] Failed to report progress for [${pWorkItemHash}]: ${pError.message}`);
				}
			});
	}

	// ================================================================
	// Heartbeat
	// ================================================================

	_heartbeat()
	{
		if (!this._Running || !this._BeaconID)
		{
			return;
		}

		this._httpRequest('POST', `/Beacon/${this._BeaconID}/Heartbeat`, {},
			(pError) =>
			{
				if (pError)
				{
					console.warn(`[Beacon] Heartbeat failed: ${pError.message}`);
				}
			});
	}

	// ================================================================
	// HTTP Transport
	// ================================================================

	_httpRequest(pMethod, pPath, pBody, fCallback)
	{
		let tmpParsedURL = new URL(this._Config.ServerURL);
		let tmpOptions = {
			hostname: tmpParsedURL.hostname,
			port: tmpParsedURL.port || 80,
			path: pPath,
			method: pMethod,
			headers: {
				'Content-Type': 'application/json'
			}
		};

		// Attach session cookie if available
		if (this._SessionCookie)
		{
			tmpOptions.headers['Cookie'] = this._SessionCookie;
		}

		let tmpReq = libHTTP.request(tmpOptions, (pResponse) =>
		{
			let tmpData = '';
			pResponse.on('data', (pChunk) => { tmpData += pChunk; });
			pResponse.on('end', () =>
			{
				// Detect 401 and trigger reconnection
				if (pResponse.statusCode === 401)
				{
					this._reconnect();
					return fCallback(new Error('Unauthorized — reconnecting'));
				}

				try
				{
					let tmpParsed = JSON.parse(tmpData);
					if (pResponse.statusCode >= 400)
					{
						return fCallback(new Error(tmpParsed.Error || `HTTP ${pResponse.statusCode}`));
					}
					return fCallback(null, tmpParsed);
				}
				catch (pParseError)
				{
					return fCallback(new Error(`Invalid JSON response: ${tmpData.substring(0, 200)}`));
				}
			});
		});

		tmpReq.on('error', (pError) =>
		{
			return fCallback(pError);
		});

		if (pBody && (pMethod === 'POST' || pMethod === 'PUT'))
		{
			tmpReq.write(JSON.stringify(pBody));
		}

		tmpReq.end();
	}

	// ================================================================
	// WebSocket Transport
	// ================================================================

	/**
	 * Start with WebSocket transport: open a persistent connection,
	 * register over the socket, and receive work items via push.
	 */
	_startWebSocket(fCallback)
	{
		if (!libWebSocket)
		{
			return fCallback(new Error('WebSocket transport requires the "ws" package. Install it with: npm install ws'));
		}

		// Build WebSocket URL from the server URL
		let tmpParsedURL = new URL(this._Config.ServerURL);
		let tmpWSProtocol = (tmpParsedURL.protocol === 'https:') ? 'wss:' : 'ws:';
		let tmpWSURL = tmpWSProtocol + '//' + tmpParsedURL.host;

		let tmpHeaders = {};
		if (this._SessionCookie)
		{
			tmpHeaders['Cookie'] = this._SessionCookie;
		}

		try
		{
			this._WebSocket = new libWebSocket(tmpWSURL, { headers: tmpHeaders });
		}
		catch (pError)
		{
			return fCallback(new Error('Failed to create WebSocket connection: ' + pError.message));
		}

		let tmpCallbackFired = false;

		this._WebSocket.on('open', () =>
		{
			console.log(`[Beacon] WebSocket connected to ${tmpWSURL}`);

			// Register over WebSocket
			let tmpWSRegPayload = {
				Action: 'BeaconRegister',
				Name: this._Config.Name,
				Capabilities: this._Executor.providerRegistry.getCapabilities(),
				ActionSchemas: this._Executor.providerRegistry.getActionSchemas(),
				MaxConcurrent: this._Config.MaxConcurrent,
				Tags: this._Config.Tags
			};
			if (this._Config.Contexts && Object.keys(this._Config.Contexts).length > 0)
			{
				tmpWSRegPayload.Contexts = this._Config.Contexts;
			}
			if (Array.isArray(this._Config.Operations) && this._Config.Operations.length > 0)
			{
				tmpWSRegPayload.Operations = this._Config.Operations;
			}
			if (Array.isArray(this._Config.BindAddresses) && this._Config.BindAddresses.length > 0)
			{
				tmpWSRegPayload.BindAddresses = this._Config.BindAddresses;
			}
			this._wsSend(tmpWSRegPayload);
		});

		this._WebSocket.on('message', (pMessage) =>
		{
			this._handleWSMessage(pMessage, (pBeaconData) =>
			{
				// Registration response — fire the start callback once
				if (!tmpCallbackFired && pBeaconData)
				{
					tmpCallbackFired = true;
					this._Running = true;

					// Start heartbeat over WebSocket
					this._HeartbeatInterval = setInterval(() =>
					{
						this._wsHeartbeat();
					}, this._Config.HeartbeatIntervalMs);

					return fCallback(null, pBeaconData);
				}
			});
		});

		this._WebSocket.on('error', (pError) =>
		{
			console.error(`[Beacon] WebSocket error: ${pError.message}`);
			if (!tmpCallbackFired)
			{
				tmpCallbackFired = true;
				return fCallback(pError);
			}
		});

		this._WebSocket.on('close', () =>
		{
			console.log(`[Beacon] WebSocket connection closed.`);
			this._WebSocket = null;

			if (this._Running && !this._Authenticating)
			{
				// Connection lost while running — attempt reconnect
				this._wsReconnect();
			}
		});
	}

	/**
	 * Handle an incoming WebSocket message from the Ultravisor server.
	 *
	 * @param {Buffer|string} pMessage - The raw message data.
	 * @param {function} fRegistrationCallback - Called with beacon data on registration.
	 */
	_handleWSMessage(pMessage, fRegistrationCallback)
	{
		let tmpData;
		try
		{
			tmpData = JSON.parse(pMessage.toString());
		}
		catch (pError)
		{
			return;
		}

		if (tmpData.EventType === 'BeaconRegistered')
		{
			this._BeaconID = tmpData.BeaconID;
			console.log(`[Beacon] Registered via WebSocket as ${this._BeaconID}`);
			if (typeof fRegistrationCallback === 'function')
			{
				fRegistrationCallback({ BeaconID: this._BeaconID });
			}
		}
		else if (tmpData.EventType === 'WorkItem' && tmpData.WorkItem)
		{
			if (this._ActiveWorkItems >= this._Config.MaxConcurrent)
			{
				console.log(`[Beacon] At max concurrent capacity, ignoring pushed work item.`);
				return;
			}
			this._executeWorkItem(tmpData.WorkItem);
		}
		else if (tmpData.EventType === 'Deregistered')
		{
			console.log(`[Beacon] Deregistered by server.`);
			this._BeaconID = null;
		}
	}

	/**
	 * Send a JSON message over the WebSocket.
	 *
	 * @param {object} pData - The data to send.
	 */
	_wsSend(pData)
	{
		if (this._WebSocket && this._WebSocket.readyState === libWebSocket.OPEN)
		{
			this._WebSocket.send(JSON.stringify(pData));
		}
	}

	/**
	 * Send a heartbeat over WebSocket.
	 */
	_wsHeartbeat()
	{
		if (!this._Running || !this._BeaconID)
		{
			return;
		}
		this._wsSend({ Action: 'BeaconHeartbeat', BeaconID: this._BeaconID });
	}

	/**
	 * Report work completion over WebSocket (falls back to HTTP if WS is closed).
	 */
	_wsReportComplete(pWorkItemHash, pOutputs, pLog)
	{
		if (this._WebSocket && this._WebSocket.readyState === libWebSocket.OPEN)
		{
			this._wsSend({
				Action: 'WorkComplete',
				WorkItemHash: pWorkItemHash,
				Outputs: pOutputs,
				Log: pLog
			});
		}
		else
		{
			// Fall back to HTTP
			this._reportComplete(pWorkItemHash, pOutputs, pLog);
		}
	}

	/**
	 * Report work error over WebSocket (falls back to HTTP if WS is closed).
	 */
	_wsReportError(pWorkItemHash, pErrorMessage, pLog)
	{
		if (this._WebSocket && this._WebSocket.readyState === libWebSocket.OPEN)
		{
			this._wsSend({
				Action: 'WorkError',
				WorkItemHash: pWorkItemHash,
				ErrorMessage: pErrorMessage,
				Log: pLog
			});
		}
		else
		{
			this._reportError(pWorkItemHash, pErrorMessage, pLog);
		}
	}

	/**
	 * Report work progress over WebSocket.
	 */
	_wsReportProgress(pWorkItemHash, pProgressData)
	{
		if (!pProgressData || !this._Running)
		{
			return;
		}
		if (this._WebSocket && this._WebSocket.readyState === libWebSocket.OPEN)
		{
			this._wsSend({
				Action: 'WorkProgress',
				WorkItemHash: pWorkItemHash,
				ProgressData: pProgressData
			});
		}
		else
		{
			this._reportProgress(pWorkItemHash, pProgressData);
		}
	}

	/**
	 * Reconnect the WebSocket after unexpected disconnection.
	 * Falls back to HTTP polling if WebSocket can't be re-established.
	 */
	_wsReconnect()
	{
		if (this._Authenticating)
		{
			return;
		}
		this._Authenticating = true;

		if (this._HeartbeatInterval)
		{
			clearInterval(this._HeartbeatInterval);
			this._HeartbeatInterval = null;
		}

		this._SessionCookie = null;
		console.log(`[Beacon] WebSocket disconnected — re-authenticating...`);

		this._authenticate((pAuthError) =>
		{
			if (pAuthError)
			{
				console.error(`[Beacon] Re-authentication failed: ${pAuthError.message}`);
				this._Authenticating = false;
				setTimeout(() => { this._wsReconnect(); }, this._Config.ReconnectIntervalMs);
				return;
			}

			this._Authenticating = false;

			// Try WebSocket again
			this._startWebSocket((pError, pBeacon) =>
			{
				if (pError)
				{
					// WebSocket failed — fall back to HTTP polling
					console.log(`[Beacon] WebSocket reconnection failed, falling back to HTTP polling.`);
					this._UseWebSocket = false;
					this._startHTTP((pHTTPError, pHTTPBeacon) =>
					{
						if (pHTTPError)
						{
							console.error(`[Beacon] HTTP fallback failed: ${pHTTPError.message}`);
							setTimeout(() => { this._wsReconnect(); }, this._Config.ReconnectIntervalMs);
							return;
						}
						console.log(`[Beacon] Reconnected via HTTP polling as ${pHTTPBeacon.BeaconID}`);
					});
					return;
				}
				console.log(`[Beacon] WebSocket reconnected as ${pBeacon.BeaconID}`);
			});
		});
	}
}

module.exports = UltravisorBeaconClient;
