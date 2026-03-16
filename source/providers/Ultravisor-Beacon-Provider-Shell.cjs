/**
 * Ultravisor Beacon Provider — Shell
 *
 * Built-in provider that executes shell commands via child_process.exec().
 *
 * Capability: 'Shell'
 * Actions:    'Execute' — run a shell command with optional parameters.
 *
 * Provider config:
 *   MaxBufferBytes {number} — max stdout/stderr buffer (default: 10MB)
 */

const libChildProcess = require('child_process');

const libBeaconCapabilityProvider = require('../Ultravisor-Beacon-CapabilityProvider.cjs');

class UltravisorBeaconProviderShell extends libBeaconCapabilityProvider
{
	constructor(pProviderConfig)
	{
		super(pProviderConfig);

		this.Name = 'Shell';
		this.Capability = 'Shell';

		this._MaxBufferBytes = this._ProviderConfig.MaxBufferBytes || 10485760;
	}

	get actions()
	{
		return {
			'Execute':
			{
				Description: 'Execute a shell command.',
				SettingsSchema:
				[
					{ Name: 'Command', DataType: 'String', Required: true, Description: 'The command to run' },
					{ Name: 'Parameters', DataType: 'String', Required: false, Description: 'Command-line arguments' }
				]
			}
		};
	}

	execute(pAction, pWorkItem, pContext, fCallback, fReportProgress)
	{
		let tmpSettings = pWorkItem.Settings || {};
		let tmpCommand = tmpSettings.Command || '';
		let tmpParameters = tmpSettings.Parameters || '';

		if (!tmpCommand)
		{
			return fCallback(null, {
				Outputs: { StdOut: 'No command specified.', ExitCode: -1, Result: '' },
				Log: ['Shell Provider: no command specified.']
			});
		}

		let tmpFullCommand = tmpParameters ? (tmpCommand + ' ' + tmpParameters) : tmpCommand;
		let tmpTimeout = pWorkItem.TimeoutMs || 300000;

		console.log(`  [Shell] Running: ${tmpFullCommand}`);

		libChildProcess.exec(tmpFullCommand,
			{
				cwd: pContext.StagingPath || process.cwd(),
				timeout: tmpTimeout,
				maxBuffer: this._MaxBufferBytes
			},
			function (pError, pStdOut, pStdErr)
			{
				if (pError)
				{
					return fCallback(null, {
						Outputs: {
							StdOut: (pStdOut || '') + (pStdErr || ''),
							ExitCode: pError.code || 1,
							Result: ''
						},
						Log: [`Command failed: ${pError.message}`, pStdErr || ''].filter(Boolean)
					});
				}

				return fCallback(null, {
					Outputs: {
						StdOut: pStdOut || '',
						ExitCode: 0,
						Result: pStdOut || ''
					},
					Log: [`Command executed: ${tmpFullCommand}`]
				});
			});
	}
}

module.exports = UltravisorBeaconProviderShell;
