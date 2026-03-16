/**
 * Ultravisor Beacon Capability Provider — Base Class
 *
 * Providers extend this class to implement a specific capability
 * (Shell, FileSystem, MediaProcessing, etc.) that the Beacon can
 * advertise and execute work items for.
 *
 * This is a plain JavaScript class — no Fable dependency — keeping
 * the Beacon lightweight and deployable with minimal dependencies.
 *
 * Lifecycle:
 *   1. constructor(pProviderConfig) — receive per-provider config
 *   2. initialize(fCallback)        — async init (validate prereqs)
 *   3. execute(...)                  — called per work item
 *   4. shutdown(fCallback)           — cleanup on beacon stop
 */

class UltravisorBeaconCapabilityProvider
{
	constructor(pProviderConfig)
	{
		this._ProviderConfig = pProviderConfig || {};

		// Subclasses MUST set these
		this.Name = 'BaseProvider';
		this.Capability = 'Unknown';
	}

	/**
	 * Return the actions this provider supports.
	 *
	 * Override in subclasses. Each key is an action name, value is
	 * an object with Description and optional SettingsSchema.
	 *
	 * @returns {object} Map of ActionName → { Description, SettingsSchema? }
	 *
	 * Example:
	 * {
	 *   'Execute': { Description: 'Run a shell command.' },
	 *   'Script':  { Description: 'Run a script file.',
	 *                SettingsSchema: [{ Name: 'ScriptPath', DataType: 'String', Required: true }] }
	 * }
	 */
	get actions()
	{
		return {};
	}

	/**
	 * Return the list of capability strings this provider advertises.
	 *
	 * Usually just [this.Capability]. Override for multi-capability
	 * providers.
	 *
	 * @returns {string[]}
	 */
	getCapabilities()
	{
		return [this.Capability];
	}

	/**
	 * Return a structured description of all supported actions.
	 * Used for logging and introspection.
	 *
	 * @returns {Array<{ Capability: string, Action: string, Description: string }>}
	 */
	describeActions()
	{
		let tmpResult = [];
		let tmpActions = this.actions;
		let tmpActionNames = Object.keys(tmpActions);

		for (let i = 0; i < tmpActionNames.length; i++)
		{
			tmpResult.push({
				Capability: this.Capability,
				Action: tmpActionNames[i],
				Description: tmpActions[tmpActionNames[i]].Description || ''
			});
		}

		return tmpResult;
	}

	/**
	 * Execute a work item for the given action.
	 *
	 * @param {string} pAction - The action to perform (e.g. 'Execute', 'Read')
	 * @param {object} pWorkItem - The full work item from the server:
	 *   { WorkItemHash, Capability, Action, Settings, TimeoutMs, OperationHash }
	 * @param {object} pContext - Execution context: { StagingPath }
	 * @param {function} fCallback - function(pError, pResult)
	 *   pResult = { Outputs: { ... }, Log: [...] }
	 * @param {function} [fReportProgress] - Optional progress callback:
	 *   function({ Percent, Message, Step, TotalSteps, Log })
	 *   All fields optional. Call during long-running operations.
	 */
	execute(pAction, pWorkItem, pContext, fCallback, fReportProgress)
	{
		return fCallback(new Error(
			`Provider "${this.Name}" has not implemented execute() for action "${pAction}".`));
	}

	/**
	 * Optional lifecycle hook: called after provider is loaded,
	 * before the beacon starts polling. Use for async initialization
	 * (e.g. verifying that ffmpeg exists, connecting to a local API).
	 *
	 * @param {function} fCallback - function(pError)
	 */
	initialize(fCallback)
	{
		return fCallback(null);
	}

	/**
	 * Optional lifecycle hook: called when the beacon is shutting down.
	 * Use for cleanup (e.g. closing connections, flushing buffers).
	 *
	 * @param {function} fCallback - function(pError)
	 */
	shutdown(fCallback)
	{
		return fCallback(null);
	}
}

module.exports = UltravisorBeaconCapabilityProvider;
