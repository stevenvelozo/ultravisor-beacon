/**
 * Ultravisor Beacon Capability Manager
 *
 * Manages capabilities registered by a host application.  Each
 * capability descriptor declares a Capability name, actions with
 * Handler functions, and optional lifecycle hooks.
 *
 * When the Beacon Service calls enable(), the CapabilityManager
 * converts all registered descriptors into provider descriptors
 * that the thin client's ProviderRegistry can load.
 *
 * Capability Descriptor shape:
 * {
 *   Capability: 'ContentSystem',
 *   Name: 'ContentSystemProvider',
 *   actions: {
 *     'ReadFile': {
 *       Description: 'Read a content file',
 *       SettingsSchema: [{ Name: 'FilePath', DataType: 'String', Required: true }],
 *       Handler: function(pWorkItem, pContext, fCallback, fReportProgress) { ... }
 *     }
 *   },
 *   initialize: function(fCallback) { ... },   // optional
 *   shutdown: function(fCallback) { ... }       // optional
 * }
 */

const libCapabilityAdapter = require('./Ultravisor-Beacon-CapabilityAdapter.cjs');

class UltravisorBeaconCapabilityManager
{
	constructor()
	{
		// Map of Capability name -> descriptor
		this._Capabilities = {};
	}

	/**
	 * Register a capability from the host application.
	 *
	 * @param {object} pDescriptor - Capability descriptor
	 * @returns {boolean} true if registered successfully
	 */
	registerCapability(pDescriptor)
	{
		if (!pDescriptor || !pDescriptor.Capability)
		{
			console.error('[CapabilityManager] Descriptor must have a Capability name.');
			return false;
		}

		if (!pDescriptor.actions || Object.keys(pDescriptor.actions).length === 0)
		{
			console.warn(`[CapabilityManager] Capability "${pDescriptor.Capability}" has no actions.`);
		}

		this._Capabilities[pDescriptor.Capability] = pDescriptor;
		return true;
	}

	/**
	 * Remove a previously registered capability.
	 *
	 * @param {string} pCapabilityName - The capability to remove
	 * @returns {boolean} true if removed
	 */
	removeCapability(pCapabilityName)
	{
		if (this._Capabilities[pCapabilityName])
		{
			delete this._Capabilities[pCapabilityName];
			return true;
		}

		return false;
	}

	/**
	 * Get the list of registered capability names.
	 *
	 * @returns {string[]}
	 */
	getCapabilityNames()
	{
		return Object.keys(this._Capabilities);
	}

	/**
	 * Get all registered capability descriptors.
	 *
	 * @returns {object} Map of capability name -> descriptor
	 */
	getCapabilities()
	{
		return this._Capabilities;
	}

	/**
	 * Build provider descriptors for the thin client.
	 *
	 * Creates a CapabilityAdapter instance per registered capability
	 * and returns them as provider descriptors compatible with
	 * ProviderRegistry.loadProvider().
	 *
	 * The descriptors use a pre-instantiated object format (the adapter
	 * instances already have execute() on them), which ProviderRegistry
	 * supports as a direct registration path.
	 *
	 * @returns {Array<object>} Provider descriptors for the thin client
	 */
	buildProviderDescriptors()
	{
		let tmpDescriptors = [];
		let tmpCapabilityNames = Object.keys(this._Capabilities);

		for (let i = 0; i < tmpCapabilityNames.length; i++)
		{
			let tmpCapName = tmpCapabilityNames[i];
			let tmpCapDescriptor = this._Capabilities[tmpCapName];

			// Create an adapter instance that bridges this descriptor
			// to the CapabilityProvider interface
			let tmpAdapter = new libCapabilityAdapter(tmpCapDescriptor);

			tmpDescriptors.push(tmpAdapter);
		}

		return tmpDescriptors;
	}
}

module.exports = UltravisorBeaconCapabilityManager;
