/**
 * Ultravisor Beacon Capability Adapter
 *
 * Bridges Fable-world capability descriptors to the thin client's
 * CapabilityProvider interface.  One adapter instance is created per
 * capability registered with the Beacon Service.
 *
 * The adapter extends the thin-client base class so it can be loaded
 * by the ProviderRegistry exactly like a built-in provider (Shell,
 * FileSystem, etc.).
 *
 * Lifecycle:
 *   1. Constructed by CapabilityManager with a capability descriptor
 *   2. Registered with the thin client's ProviderRegistry
 *   3. execute() delegates to the descriptor's Handler functions
 *   4. initialize()/shutdown() delegate to descriptor hooks if present
 */

const libCapabilityProvider = require('./Ultravisor-Beacon-CapabilityProvider.cjs');

class UltravisorBeaconCapabilityAdapter extends libCapabilityProvider
{
	constructor(pDescriptor)
	{
		super(pDescriptor.Config || {});

		this._Descriptor = pDescriptor;

		// Set identity from the descriptor
		this.Name = pDescriptor.Name || pDescriptor.Capability || 'AdaptedProvider';
		this.Capability = pDescriptor.Capability || 'Unknown';
	}

	/**
	 * Return the actions map from the descriptor, stripping Handler
	 * functions (which are internal) and keeping only Description
	 * and SettingsSchema for introspection.
	 */
	get actions()
	{
		let tmpDescriptorActions = (this._Descriptor && this._Descriptor.actions) ? this._Descriptor.actions : {};
		let tmpActionNames = Object.keys(tmpDescriptorActions);
		let tmpActions = {};

		for (let i = 0; i < tmpActionNames.length; i++)
		{
			let tmpName = tmpActionNames[i];
			let tmpSrc = tmpDescriptorActions[tmpName];

			tmpActions[tmpName] = {
				Description: tmpSrc.Description || '',
				SettingsSchema: tmpSrc.SettingsSchema || []
			};
		}

		return tmpActions;
	}

	/**
	 * Execute a work item by delegating to the descriptor's Handler.
	 *
	 * @param {string} pAction - Action name (e.g. 'ReadFile')
	 * @param {object} pWorkItem - Full work item from the server
	 * @param {object} pContext - Execution context: { StagingPath }
	 * @param {function} fCallback - function(pError, pResult)
	 * @param {function} [fReportProgress] - Optional progress callback
	 */
	execute(pAction, pWorkItem, pContext, fCallback, fReportProgress)
	{
		let tmpDescriptorActions = (this._Descriptor && this._Descriptor.actions) ? this._Descriptor.actions : {};
		let tmpActionDef = tmpDescriptorActions[pAction];

		// Per-action Handler takes priority
		if (tmpActionDef && typeof tmpActionDef.Handler === 'function')
		{
			try
			{
				return tmpActionDef.Handler(pWorkItem, pContext, fCallback, fReportProgress);
			}
			catch (pError)
			{
				return fCallback(pError);
			}
		}

		// Fall back to descriptor-level execute method (Provider pattern —
		// a single execute() that routes actions internally)
		if (typeof this._Descriptor.execute === 'function')
		{
			try
			{
				return this._Descriptor.execute(pAction, pWorkItem, pContext, fCallback, fReportProgress);
			}
			catch (pError)
			{
				return fCallback(pError);
			}
		}

		return fCallback(new Error(
			`CapabilityAdapter "${this.Name}" has no Handler for action "${pAction}".`));
	}

	/**
	 * Delegate initialization to the descriptor if present.
	 */
	initialize(fCallback)
	{
		if (this._Descriptor && typeof this._Descriptor.initialize === 'function')
		{
			return this._Descriptor.initialize(fCallback);
		}

		return fCallback(null);
	}

	/**
	 * Delegate shutdown to the descriptor if present.
	 */
	shutdown(fCallback)
	{
		if (this._Descriptor && typeof this._Descriptor.shutdown === 'function')
		{
			return this._Descriptor.shutdown(fCallback);
		}

		return fCallback(null);
	}
}

module.exports = UltravisorBeaconCapabilityAdapter;
