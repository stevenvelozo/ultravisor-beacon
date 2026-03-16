/**
 * Ultravisor Beacon Executor
 *
 * Routes work items to the appropriate capability provider via the
 * ProviderRegistry. Replaces the former hard-coded switch statement
 * with a pluggable, composable provider architecture.
 *
 * Supports file transfer for remote dispatch scenarios:
 *   - Pre-execute: downloads source files from a SourceURL
 *   - Post-execute: base64-encodes output files into Outputs
 *   - Affinity-scoped download caching for repeated operations on the same file
 */

const libFS = require('fs');
const libPath = require('path');
const libHTTP = require('http');
const libHTTPS = require('https');

const libBeaconProviderRegistry = require('./Ultravisor-Beacon-ProviderRegistry.cjs');

class UltravisorBeaconExecutor
{
	constructor(pConfig)
	{
		this._Config = pConfig || {};
		this._StagingPath = this._Config.StagingPath || process.cwd();
		this._ProviderRegistry = new libBeaconProviderRegistry();
	}

	/**
	 * Get the provider registry.
	 * Used by BeaconClient for capability list and provider lifecycle.
	 */
	get providerRegistry()
	{
		return this._ProviderRegistry;
	}

	/**
	 * Execute a work item by routing to the appropriate provider.
	 *
	 * If the work item's Settings include file transfer directives
	 * (SourceURL, OutputFilename), the executor handles downloading
	 * the source file before execution and collecting the output file
	 * after execution. This is transparent to providers.
	 *
	 * @param {object} pWorkItem - { WorkItemHash, Capability, Action, Settings, TimeoutMs }
	 * @param {function} fCallback - function(pError, pResult) where pResult = { Outputs, Log }
	 * @param {function} [fReportProgress] - Optional progress callback passed through to provider
	 */
	execute(pWorkItem, fCallback, fReportProgress)
	{
		let tmpCapability = pWorkItem.Capability || 'Shell';
		let tmpAction = pWorkItem.Action || '';

		let tmpResolved = this._ProviderRegistry.resolve(tmpCapability, tmpAction);

		if (!tmpResolved)
		{
			return fCallback(null, {
				Outputs: {
					StdOut: `Unknown capability: ${tmpCapability}` +
						(tmpAction ? `/${tmpAction}` : ''),
					ExitCode: -1,
					Result: ''
				},
				Log: [`Beacon Executor: no provider for [${tmpCapability}` +
					(tmpAction ? `/${tmpAction}` : '') + `].`]
			});
		}

		let tmpContext = {
			StagingPath: this._StagingPath
		};

		let tmpSettings = pWorkItem.Settings || {};

		// Check if file transfer is needed
		if (tmpSettings.SourceURL || tmpSettings.OutputFilename)
		{
			return this._executeWithFileTransfer(
				pWorkItem, tmpResolved, tmpContext, fCallback, fReportProgress);
		}

		// Standard execution — no file transfer
		tmpResolved.provider.execute(
			tmpResolved.action, pWorkItem, tmpContext, fCallback, fReportProgress);
	}

	// ================================================================
	// File Transfer Execution
	// ================================================================

	/**
	 * Execute a work item with file transfer support.
	 *
	 * 1. Download source file (if SourceURL specified)
	 * 2. Substitute {SourcePath} and {OutputPath} in Command
	 * 3. Execute the provider
	 * 4. Collect output file (if OutputFilename specified)
	 * 5. Clean up work directory
	 */
	_executeWithFileTransfer(pWorkItem, pResolved, pContext, fCallback, fReportProgress)
	{
		let tmpSelf = this;
		let tmpSettings = pWorkItem.Settings || {};
		let tmpLog = [];

		// Phase 1: Prepare — download source file and set up paths
		this._prepareFileTransfer(pWorkItem, tmpLog,
			(pPrepareError) =>
			{
				if (pPrepareError)
				{
					return fCallback(null, {
						Outputs: {
							StdOut: `File transfer preparation failed: ${pPrepareError.message}`,
							ExitCode: -1,
							Result: ''
						},
						Log: tmpLog.concat([`File transfer error: ${pPrepareError.message}`])
					});
				}

				// Phase 2: Execute the provider
				pResolved.provider.execute(
					pResolved.action, pWorkItem, pContext,
					(pExecError, pResult) =>
					{
						if (pExecError)
						{
							tmpSelf._cleanupWorkDir(pWorkItem.WorkItemHash);
							return fCallback(pExecError);
						}

						// Phase 3: Collect output files
						tmpSelf._collectOutputFiles(pWorkItem, pResult, tmpLog,
							(pCollectError, pFinalResult) =>
							{
								// Clean up work directory (keep affinity staging)
								tmpSelf._cleanupWorkDir(pWorkItem.WorkItemHash);

								if (pCollectError)
								{
									return fCallback(null, {
										Outputs: Object.assign(pResult.Outputs || {},
										{
											StdOut: (pResult.Outputs ? pResult.Outputs.StdOut || '' : '') +
												'\nOutput collection failed: ' + pCollectError.message,
											ExitCode: -1
										}),
										Log: (pResult.Log || []).concat(tmpLog)
									});
								}

								// Merge file transfer log into result
								pFinalResult.Log = (pFinalResult.Log || []).concat(tmpLog);
								return fCallback(null, pFinalResult);
							});
					}, fReportProgress);
			});
	}

	/**
	 * Prepare for file transfer: download source file, substitute paths.
	 *
	 * @param {object} pWorkItem - The work item (Settings will be modified in-place)
	 * @param {Array} pLog - Log array to append messages to
	 * @param {function} fCallback - function(pError)
	 */
	_prepareFileTransfer(pWorkItem, pLog, fCallback)
	{
		let tmpSettings = pWorkItem.Settings || {};
		let tmpCommand = tmpSettings.Command || '';

		// Set up output path (always, even if no source download)
		if (tmpSettings.OutputFilename)
		{
			let tmpWorkDir = this._getWorkDir(pWorkItem);
			let tmpOutputPath = libPath.join(tmpWorkDir, tmpSettings.OutputFilename);
			tmpCommand = tmpCommand.replace(/\{OutputPath\}/g, tmpOutputPath);
			// Store resolved path for later collection
			tmpSettings._ResolvedOutputPath = tmpOutputPath;
		}

		// Download source file if URL specified
		if (tmpSettings.SourceURL)
		{
			let tmpSourceFilename = tmpSettings.SourceFilename || 'source_file';
			let tmpDownloadDir;
			let tmpSourcePath;

			// Use affinity-scoped directory if AffinityKey is present
			if (pWorkItem.Settings.AffinityKey)
			{
				tmpDownloadDir = this._getAffinityDir(pWorkItem);
			}
			else
			{
				tmpDownloadDir = this._getWorkDir(pWorkItem);
			}

			tmpSourcePath = libPath.join(tmpDownloadDir, tmpSourceFilename);

			// Check if file already exists (affinity cache hit)
			if (libFS.existsSync(tmpSourcePath))
			{
				pLog.push(`Source file cached (affinity): ${tmpSourceFilename}`);
				tmpCommand = tmpCommand.replace(/\{SourcePath\}/g, tmpSourcePath);
				tmpSettings.Command = tmpCommand;
				tmpSettings._ResolvedSourcePath = tmpSourcePath;
				return fCallback(null);
			}

			// Download the file
			pLog.push(`Downloading source: ${tmpSettings.SourceURL}`);

			this._downloadFile(tmpSettings.SourceURL, tmpSourcePath,
				(pDownloadError) =>
				{
					if (pDownloadError)
					{
						return fCallback(pDownloadError);
					}

					pLog.push(`Downloaded: ${tmpSourceFilename} (${this._formatFileSize(tmpSourcePath)})`);
					tmpCommand = tmpCommand.replace(/\{SourcePath\}/g, tmpSourcePath);
					tmpSettings.Command = tmpCommand;
					tmpSettings._ResolvedSourcePath = tmpSourcePath;
					return fCallback(null);
				});
		}
		else
		{
			// No download needed — just update the command
			tmpSettings.Command = tmpCommand;
			return fCallback(null);
		}
	}

	/**
	 * Collect output files after execution, base64-encoding if requested.
	 *
	 * @param {object} pWorkItem - The work item
	 * @param {object} pResult - The execution result { Outputs, Log }
	 * @param {Array} pLog - Log array to append messages to
	 * @param {function} fCallback - function(pError, pFinalResult)
	 */
	_collectOutputFiles(pWorkItem, pResult, pLog, fCallback)
	{
		let tmpSettings = pWorkItem.Settings || {};

		if (!tmpSettings.OutputFilename || !tmpSettings.ReturnOutputAsBase64)
		{
			return fCallback(null, pResult);
		}

		let tmpOutputPath = tmpSettings._ResolvedOutputPath;

		if (!tmpOutputPath || !libFS.existsSync(tmpOutputPath))
		{
			pLog.push(`Output file not found: ${tmpSettings.OutputFilename}`);
			return fCallback(new Error(`Output file not found: ${tmpSettings.OutputFilename}`));
		}

		try
		{
			let tmpBuffer = libFS.readFileSync(tmpOutputPath);
			let tmpBase64 = tmpBuffer.toString('base64');

			pLog.push(`Output collected: ${tmpSettings.OutputFilename} (${this._formatFileSize(tmpOutputPath)})`);

			// Merge into result
			let tmpOutputs = pResult.Outputs || {};
			tmpOutputs.OutputData = tmpBase64;
			tmpOutputs.OutputFilename = tmpSettings.OutputFilename;
			tmpOutputs.OutputSize = tmpBuffer.length;

			return fCallback(null, {
				Outputs: tmpOutputs,
				Log: pResult.Log || []
			});
		}
		catch (pReadError)
		{
			return fCallback(pReadError);
		}
	}

	// ================================================================
	// File Download
	// ================================================================

	/**
	 * Download a file from a URL to a local path.
	 * Streams to disk to handle large files.
	 *
	 * @param {string} pURL - The URL to download from
	 * @param {string} pOutputPath - Local file path to write to
	 * @param {function} fCallback - function(pError)
	 */
	_downloadFile(pURL, pOutputPath, fCallback)
	{
		let tmpLib = pURL.startsWith('https') ? libHTTPS : libHTTP;

		// Ensure the directory exists
		let tmpDir = libPath.dirname(pOutputPath);
		if (!libFS.existsSync(tmpDir))
		{
			libFS.mkdirSync(tmpDir, { recursive: true });
		}

		let tmpFileStream = libFS.createWriteStream(pOutputPath);
		let tmpCallbackFired = false;

		let tmpComplete = (pError) =>
		{
			if (tmpCallbackFired)
			{
				return;
			}
			tmpCallbackFired = true;

			if (pError)
			{
				tmpFileStream.close();
				// Clean up partial download
				try { libFS.unlinkSync(pOutputPath); }
				catch (pErr) { /* ignore */ }
				return fCallback(pError);
			}

			return fCallback(null);
		};

		tmpLib.get(pURL, (pResponse) =>
		{
			// Handle redirects
			if (pResponse.statusCode >= 300 && pResponse.statusCode < 400 && pResponse.headers.location)
			{
				tmpFileStream.close();
				try { libFS.unlinkSync(pOutputPath); }
				catch (pErr) { /* ignore */ }
				return this._downloadFile(pResponse.headers.location, pOutputPath, fCallback);
			}

			if (pResponse.statusCode !== 200)
			{
				return tmpComplete(new Error(`Download failed: HTTP ${pResponse.statusCode} for ${pURL}`));
			}

			pResponse.pipe(tmpFileStream);

			tmpFileStream.on('finish', () =>
			{
				tmpFileStream.close(() =>
				{
					tmpComplete(null);
				});
			});

			pResponse.on('error', tmpComplete);
			tmpFileStream.on('error', tmpComplete);

		}).on('error', tmpComplete);
	}

	// ================================================================
	// Staging Directory Management
	// ================================================================

	/**
	 * Get or create the affinity-scoped staging directory.
	 * Files here persist across work items with the same affinity key.
	 *
	 * @param {object} pWorkItem - Work item with Settings.AffinityKey
	 * @returns {string} Absolute path to the affinity directory
	 */
	_getAffinityDir(pWorkItem)
	{
		let tmpAffinityKey = (pWorkItem.Settings && pWorkItem.Settings.AffinityKey) || 'default';
		// Sanitize the affinity key for use as a directory name
		let tmpSafeKey = tmpAffinityKey.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 64);
		let tmpDir = libPath.join(this._StagingPath, `affinity-${tmpSafeKey}`);

		if (!libFS.existsSync(tmpDir))
		{
			libFS.mkdirSync(tmpDir, { recursive: true });
		}

		return tmpDir;
	}

	/**
	 * Get or create the work-item-scoped staging directory.
	 * Files here are cleaned up after the work item completes.
	 *
	 * @param {object} pWorkItem - Work item with WorkItemHash
	 * @returns {string} Absolute path to the work directory
	 */
	_getWorkDir(pWorkItem)
	{
		let tmpHash = pWorkItem.WorkItemHash || 'unknown';
		let tmpDir = libPath.join(this._StagingPath, `work-${tmpHash}`);

		if (!libFS.existsSync(tmpDir))
		{
			libFS.mkdirSync(tmpDir, { recursive: true });
		}

		return tmpDir;
	}

	/**
	 * Clean up a work item's staging directory.
	 *
	 * @param {string} pWorkItemHash - The work item hash
	 */
	_cleanupWorkDir(pWorkItemHash)
	{
		let tmpDir = libPath.join(this._StagingPath, `work-${pWorkItemHash}`);

		if (!libFS.existsSync(tmpDir))
		{
			return;
		}

		try
		{
			libFS.rmSync(tmpDir, { recursive: true, force: true });
		}
		catch (pError)
		{
			// Best-effort cleanup
			console.warn(`[Beacon Executor] Could not clean up work directory: ${pError.message}`);
		}
	}

	/**
	 * Clean up all affinity staging directories.
	 * Called during beacon shutdown.
	 */
	cleanupAffinityDirs()
	{
		try
		{
			let tmpEntries = libFS.readdirSync(this._StagingPath);

			for (let i = 0; i < tmpEntries.length; i++)
			{
				if (tmpEntries[i].startsWith('affinity-'))
				{
					let tmpDir = libPath.join(this._StagingPath, tmpEntries[i]);
					try
					{
						libFS.rmSync(tmpDir, { recursive: true, force: true });
					}
					catch (pError)
					{
						console.warn(`[Beacon Executor] Could not clean up affinity dir [${tmpEntries[i]}]: ${pError.message}`);
					}
				}
			}
		}
		catch (pError)
		{
			// Staging path doesn't exist or can't be read — fine
		}
	}

	// ================================================================
	// Utilities
	// ================================================================

	/**
	 * Format a file size for logging.
	 *
	 * @param {string} pFilePath - Path to the file
	 * @returns {string} Human-readable file size
	 */
	_formatFileSize(pFilePath)
	{
		try
		{
			let tmpStat = libFS.statSync(pFilePath);
			let tmpSize = tmpStat.size;

			if (tmpSize < 1024) return `${tmpSize} B`;
			if (tmpSize < 1024 * 1024) return `${(tmpSize / 1024).toFixed(1)} KB`;
			if (tmpSize < 1024 * 1024 * 1024) return `${(tmpSize / (1024 * 1024)).toFixed(1)} MB`;
			return `${(tmpSize / (1024 * 1024 * 1024)).toFixed(2)} GB`;
		}
		catch (pError)
		{
			return 'unknown size';
		}
	}
}

module.exports = UltravisorBeaconExecutor;
