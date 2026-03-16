/**
 * Ultravisor Beacon Provider — FileSystem
 *
 * Built-in provider for local file operations on the Beacon worker.
 *
 * Capability: 'FileSystem'
 * Actions:    'Read', 'Write', 'List', 'Copy'
 *
 * Provider config:
 *   AllowedPaths     {string[]} — path prefixes the provider may access (empty = allow all)
 *   MaxFileSizeBytes {number}   — max file size for read/write (default: 100MB)
 */

const libFS = require('fs');
const libPath = require('path');

const libBeaconCapabilityProvider = require('../Ultravisor-Beacon-CapabilityProvider.cjs');

class UltravisorBeaconProviderFileSystem extends libBeaconCapabilityProvider
{
	constructor(pProviderConfig)
	{
		super(pProviderConfig);

		this.Name = 'FileSystem';
		this.Capability = 'FileSystem';

		this._AllowedPaths = this._ProviderConfig.AllowedPaths || [];
		this._MaxFileSizeBytes = this._ProviderConfig.MaxFileSizeBytes || 104857600;
	}

	get actions()
	{
		return {
			'Read':
			{
				Description: 'Read a file from disk.',
				SettingsSchema:
				[
					{ Name: 'FilePath', DataType: 'String', Required: true, Description: 'Path to the file to read' },
					{ Name: 'Encoding', DataType: 'String', Required: false, Description: 'File encoding (default: utf8)' }
				]
			},
			'Write':
			{
				Description: 'Write content to a file on disk.',
				SettingsSchema:
				[
					{ Name: 'FilePath', DataType: 'String', Required: true, Description: 'Path to the output file' },
					{ Name: 'Content', DataType: 'String', Required: true, Description: 'Content to write' },
					{ Name: 'Encoding', DataType: 'String', Required: false, Description: 'File encoding (default: utf8)' }
				]
			},
			'List':
			{
				Description: 'List files in a directory.',
				SettingsSchema:
				[
					{ Name: 'Folder', DataType: 'String', Required: true, Description: 'Directory path to list' },
					{ Name: 'Pattern', DataType: 'String', Required: false, Description: 'Glob-style pattern filter (e.g. *.txt)' }
				]
			},
			'Copy':
			{
				Description: 'Copy a file from source to target.',
				SettingsSchema:
				[
					{ Name: 'Source', DataType: 'String', Required: true, Description: 'Source file path' },
					{ Name: 'TargetFile', DataType: 'String', Required: true, Description: 'Target file path' }
				]
			}
		};
	}

	execute(pAction, pWorkItem, pContext, fCallback, fReportProgress)
	{
		switch (pAction)
		{
			case 'Read':
				return this._executeRead(pWorkItem, pContext, fCallback);
			case 'Write':
				return this._executeWrite(pWorkItem, pContext, fCallback);
			case 'List':
				return this._executeList(pWorkItem, pContext, fCallback);
			case 'Copy':
				return this._executeCopy(pWorkItem, pContext, fCallback);
			default:
				return fCallback(null, {
					Outputs: { StdOut: `Unknown FileSystem action: ${pAction}`, ExitCode: -1, Result: '' },
					Log: [`FileSystem Provider: unsupported action [${pAction}].`]
				});
		}
	}

	// ================================================================
	// Path helpers
	// ================================================================

	_resolvePath(pFilePath, pStagingPath)
	{
		if (!pFilePath) return '';
		if (libPath.isAbsolute(pFilePath)) return pFilePath;
		return libPath.resolve(pStagingPath || process.cwd(), pFilePath);
	}

	_isPathAllowed(pResolvedPath)
	{
		if (this._AllowedPaths.length === 0) return true;
		for (let i = 0; i < this._AllowedPaths.length; i++)
		{
			if (pResolvedPath.startsWith(this._AllowedPaths[i])) return true;
		}
		return false;
	}

	// ================================================================
	// Actions
	// ================================================================

	_executeRead(pWorkItem, pContext, fCallback)
	{
		let tmpSettings = pWorkItem.Settings || {};
		let tmpFilePath = tmpSettings.FilePath || '';
		let tmpEncoding = tmpSettings.Encoding || 'utf8';

		if (!tmpFilePath)
		{
			return fCallback(null, {
				Outputs: { StdOut: 'No FilePath specified.', ExitCode: -1, Result: '' },
				Log: ['FileSystem Read: no FilePath specified.']
			});
		}

		tmpFilePath = this._resolvePath(tmpFilePath, pContext.StagingPath);

		if (!this._isPathAllowed(tmpFilePath))
		{
			return fCallback(null, {
				Outputs: { StdOut: `Path not allowed: ${tmpFilePath}`, ExitCode: -1, Result: '' },
				Log: [`FileSystem Read: path not in AllowedPaths: ${tmpFilePath}`]
			});
		}

		try
		{
			let tmpContent = libFS.readFileSync(tmpFilePath, tmpEncoding);
			let tmpBytesRead = Buffer.byteLength(tmpContent, tmpEncoding);

			return fCallback(null, {
				Outputs: {
					StdOut: `Read ${tmpBytesRead} bytes from ${tmpFilePath}`,
					ExitCode: 0,
					Result: tmpContent
				},
				Log: [`FileSystem Read: read ${tmpBytesRead} bytes from ${tmpFilePath}`]
			});
		}
		catch (pError)
		{
			return fCallback(null, {
				Outputs: { StdOut: `Read failed: ${pError.message}`, ExitCode: 1, Result: '' },
				Log: [`FileSystem Read: failed to read ${tmpFilePath}: ${pError.message}`]
			});
		}
	}

	_executeWrite(pWorkItem, pContext, fCallback)
	{
		let tmpSettings = pWorkItem.Settings || {};
		let tmpFilePath = tmpSettings.FilePath || '';
		let tmpContent = tmpSettings.Content;
		let tmpEncoding = tmpSettings.Encoding || 'utf8';

		if (!tmpFilePath)
		{
			return fCallback(null, {
				Outputs: { StdOut: 'No FilePath specified.', ExitCode: -1, Result: '' },
				Log: ['FileSystem Write: no FilePath specified.']
			});
		}

		if (tmpContent === undefined || tmpContent === null) { tmpContent = ''; }
		if (typeof tmpContent !== 'string') { tmpContent = JSON.stringify(tmpContent, null, '\t'); }

		tmpFilePath = this._resolvePath(tmpFilePath, pContext.StagingPath);

		if (!this._isPathAllowed(tmpFilePath))
		{
			return fCallback(null, {
				Outputs: { StdOut: `Path not allowed: ${tmpFilePath}`, ExitCode: -1, Result: '' },
				Log: [`FileSystem Write: path not in AllowedPaths: ${tmpFilePath}`]
			});
		}

		try
		{
			let tmpDir = libPath.dirname(tmpFilePath);
			if (!libFS.existsSync(tmpDir)) { libFS.mkdirSync(tmpDir, { recursive: true }); }
			libFS.writeFileSync(tmpFilePath, tmpContent, tmpEncoding);
			let tmpBytesWritten = Buffer.byteLength(tmpContent, tmpEncoding);

			return fCallback(null, {
				Outputs: {
					StdOut: `Wrote ${tmpBytesWritten} bytes to ${tmpFilePath}`,
					ExitCode: 0,
					Result: tmpFilePath
				},
				Log: [`FileSystem Write: wrote ${tmpBytesWritten} bytes to ${tmpFilePath}`]
			});
		}
		catch (pError)
		{
			return fCallback(null, {
				Outputs: { StdOut: `Write failed: ${pError.message}`, ExitCode: 1, Result: '' },
				Log: [`FileSystem Write: failed to write ${tmpFilePath}: ${pError.message}`]
			});
		}
	}

	_executeList(pWorkItem, pContext, fCallback)
	{
		let tmpSettings = pWorkItem.Settings || {};
		let tmpFolder = tmpSettings.Folder || '';
		let tmpPattern = tmpSettings.Pattern || '*';

		if (!tmpFolder)
		{
			return fCallback(null, {
				Outputs: { StdOut: 'No Folder specified.', ExitCode: -1, Result: '' },
				Log: ['FileSystem List: no Folder specified.']
			});
		}

		tmpFolder = this._resolvePath(tmpFolder, pContext.StagingPath);

		if (!this._isPathAllowed(tmpFolder))
		{
			return fCallback(null, {
				Outputs: { StdOut: `Path not allowed: ${tmpFolder}`, ExitCode: -1, Result: '' },
				Log: [`FileSystem List: path not in AllowedPaths: ${tmpFolder}`]
			});
		}

		try
		{
			let tmpFiles = libFS.readdirSync(tmpFolder);

			// Simple glob: convert * and ? to regex
			if (tmpPattern && tmpPattern !== '*')
			{
				let tmpRegex = new RegExp('^' + tmpPattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
				tmpFiles = tmpFiles.filter(function (pFile) { return tmpRegex.test(pFile); });
			}

			return fCallback(null, {
				Outputs: {
					StdOut: `Found ${tmpFiles.length} files in ${tmpFolder}`,
					ExitCode: 0,
					Result: JSON.stringify(tmpFiles)
				},
				Log: [`FileSystem List: found ${tmpFiles.length} files in ${tmpFolder}`]
			});
		}
		catch (pError)
		{
			return fCallback(null, {
				Outputs: { StdOut: `List failed: ${pError.message}`, ExitCode: 1, Result: '' },
				Log: [`FileSystem List: failed: ${pError.message}`]
			});
		}
	}

	_executeCopy(pWorkItem, pContext, fCallback)
	{
		let tmpSettings = pWorkItem.Settings || {};
		let tmpSource = tmpSettings.Source || '';
		let tmpTarget = tmpSettings.TargetFile || '';

		if (!tmpSource || !tmpTarget)
		{
			return fCallback(null, {
				Outputs: { StdOut: 'Source and TargetFile are required.', ExitCode: -1, Result: '' },
				Log: ['FileSystem Copy: Source and TargetFile are required.']
			});
		}

		tmpSource = this._resolvePath(tmpSource, pContext.StagingPath);
		tmpTarget = this._resolvePath(tmpTarget, pContext.StagingPath);

		if (!this._isPathAllowed(tmpSource))
		{
			return fCallback(null, {
				Outputs: { StdOut: `Source path not allowed: ${tmpSource}`, ExitCode: -1, Result: '' },
				Log: [`FileSystem Copy: source not in AllowedPaths: ${tmpSource}`]
			});
		}

		if (!this._isPathAllowed(tmpTarget))
		{
			return fCallback(null, {
				Outputs: { StdOut: `Target path not allowed: ${tmpTarget}`, ExitCode: -1, Result: '' },
				Log: [`FileSystem Copy: target not in AllowedPaths: ${tmpTarget}`]
			});
		}

		try
		{
			let tmpDir = libPath.dirname(tmpTarget);
			if (!libFS.existsSync(tmpDir)) { libFS.mkdirSync(tmpDir, { recursive: true }); }
			libFS.copyFileSync(tmpSource, tmpTarget);

			return fCallback(null, {
				Outputs: {
					StdOut: `Copied ${tmpSource} → ${tmpTarget}`,
					ExitCode: 0,
					Result: tmpTarget
				},
				Log: [`FileSystem Copy: copied ${tmpSource} → ${tmpTarget}`]
			});
		}
		catch (pError)
		{
			return fCallback(null, {
				Outputs: { StdOut: `Copy failed: ${pError.message}`, ExitCode: 1, Result: '' },
				Log: [`FileSystem Copy: failed: ${pError.message}`]
			});
		}
	}
}

module.exports = UltravisorBeaconProviderFileSystem;
