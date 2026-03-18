/**
 * Ultravisor Beacon Service
 *
 * A Fable service that turns any Fable/Pict application into an
 * Ultravisor beacon.  Host applications register capabilities
 * (with action handlers), then call enable() to connect to an
 * Ultravisor server and begin accepting remote work items.
 *
 * Beacon mode is opt-in and disabled by default.
 *
 * This service composes three internal components:
 *   - CapabilityManager: stores registered capabilities
 *   - ConnectivityHTTP: HTTP transport configuration
 *   - BeaconClient (thin client): handles polling, auth, heartbeat
 *
 * Usage:
 *   let libBeaconService = require('ultravisor-beacon');
 *   pFable.addAndInstantiateServiceType('UltravisorBeacon', libBeaconService, {
 *     ServerURL: 'http://localhost:54321',
 *     Name: 'my-app-beacon'
 *   });
 *   let tmpBeacon = pFable.services.UltravisorBeacon;
 *   tmpBeacon.registerCapability({ Capability: 'MyApp', actions: { ... } });
 *   tmpBeacon.enable(function(pError) { ... });
 */

const libFableServiceBase = require('fable-serviceproviderbase');

const libBeaconClient = require('./Ultravisor-Beacon-Client.cjs');
const libCapabilityManager = require('./Ultravisor-Beacon-CapabilityManager.cjs');
const libConnectivityHTTP = require('./Ultravisor-Beacon-ConnectivityHTTP.cjs');
const libConnectivityWebSocket = require('./Ultravisor-Beacon-ConnectivityWebSocket.cjs');

class UltravisorBeaconService extends libFableServiceBase
{
	constructor(pFable, pOptions, pServiceHash)
	{
		super(pFable, pOptions, pServiceHash);

		this.serviceType = 'UltravisorBeacon';

		// Merge defaults
		this.options = Object.assign({
			Enabled: false,
			ServerURL: 'http://localhost:54321',
			Name: '',
			Password: '',
			MaxConcurrent: 1,
			PollIntervalMs: 5000,
			HeartbeatIntervalMs: 30000,
			StagingPath: '',
			Tags: {}
		}, this.options || {});

		// Internal components
		this._CapabilityManager = new libCapabilityManager();
		this._ConnectivityService = new libConnectivityHTTP(this.options);
		this._ThinClient = null;
		this._Enabled = false;
	}

	// ================================================================
	// Public API
	// ================================================================

	/**
	 * Register a capability from the host application.
	 *
	 * @param {object} pDescriptor - Capability descriptor:
	 *   {
	 *     Capability: 'ContentSystem',
	 *     Name: 'ContentSystemProvider',
	 *     actions: {
	 *       'ReadFile': {
	 *         Description: 'Read a content file',
	 *         SettingsSchema: [{ Name: 'FilePath', DataType: 'String', Required: true }],
	 *         Handler: function(pWorkItem, pContext, fCallback, fReportProgress) { ... }
	 *       }
	 *     },
	 *     initialize: function(fCallback) { ... },   // optional
	 *     shutdown: function(fCallback) { ... }       // optional
	 *   }
	 * @returns {object} this (for chaining)
	 */
	registerCapability(pDescriptor)
	{
		this._CapabilityManager.registerCapability(pDescriptor);

		if (this.log)
		{
			this.log.info(`UltravisorBeacon: registered capability [${pDescriptor.Capability}]`);
		}

		return this;
	}

	/**
	 * Remove a previously registered capability.
	 *
	 * @param {string} pCapabilityName
	 * @returns {object} this (for chaining)
	 */
	removeCapability(pCapabilityName)
	{
		this._CapabilityManager.removeCapability(pCapabilityName);
		return this;
	}

	/**
	 * Get the list of registered capability names.
	 *
	 * @returns {string[]}
	 */
	getCapabilityNames()
	{
		return this._CapabilityManager.getCapabilityNames();
	}

	/**
	 * Enable beacon mode: build providers, create thin client, connect.
	 *
	 * @param {function} fCallback - function(pError, pBeacon)
	 */
	enable(fCallback)
	{
		if (this._Enabled)
		{
			if (this.log)
			{
				this.log.warn('UltravisorBeacon: already enabled.');
			}
			return fCallback(null);
		}

		// Determine beacon name
		let tmpName = this.options.Name;
		if (!tmpName && this.fable && this.fable.settings && this.fable.settings.Product)
		{
			tmpName = this.fable.settings.Product;
		}
		if (!tmpName)
		{
			tmpName = 'beacon-worker';
		}

		// Build adapter instances from registered capabilities
		let tmpAdapters = this._CapabilityManager.buildProviderDescriptors();

		if (tmpAdapters.length === 0)
		{
			if (this.log)
			{
				this.log.warn('UltravisorBeacon: no capabilities registered. Beacon will have no providers.');
			}
		}

		// Get transport config
		let tmpTransportConfig = this._ConnectivityService.getTransportConfig();

		// Build thin client config
		let tmpClientConfig = Object.assign({}, tmpTransportConfig, {
			Name: tmpName,
			MaxConcurrent: this.options.MaxConcurrent || 1,
			StagingPath: this.options.StagingPath || process.cwd(),
			Tags: this.options.Tags || {},
			// Pass empty Providers array — we'll register adapters directly
			Providers: []
		});

		// Create thin client
		this._ThinClient = new libBeaconClient(tmpClientConfig);

		// Register each adapter directly with the thin client's provider registry
		for (let i = 0; i < tmpAdapters.length; i++)
		{
			this._ThinClient._Executor.providerRegistry.registerProvider(tmpAdapters[i]);
		}

		if (this.log)
		{
			this.log.info(`UltravisorBeacon: enabling beacon "${tmpName}" → ${tmpTransportConfig.ServerURL}`);
			this.log.info(`UltravisorBeacon: capabilities: [${this._CapabilityManager.getCapabilityNames().join(', ')}]`);
		}

		// Start the thin client (authenticate, register, begin polling)
		this._ThinClient.start((pError, pBeacon) =>
		{
			if (pError)
			{
				this._ThinClient = null;
				if (this.log)
				{
					this.log.error(`UltravisorBeacon: enable failed: ${pError.message}`);
				}
				return fCallback(pError);
			}

			this._Enabled = true;

			if (this.log)
			{
				this.log.info(`UltravisorBeacon: enabled as ${pBeacon.BeaconID}`);
			}

			return fCallback(null, pBeacon);
		});
	}

	/**
	 * Disable beacon mode: stop polling, deregister, disconnect.
	 *
	 * @param {function} fCallback - function(pError)
	 */
	disable(fCallback)
	{
		if (!this._Enabled || !this._ThinClient)
		{
			if (this.log)
			{
				this.log.warn('UltravisorBeacon: not enabled.');
			}
			return fCallback(null);
		}

		if (this.log)
		{
			this.log.info('UltravisorBeacon: disabling...');
		}

		this._ThinClient.stop((pError) =>
		{
			this._Enabled = false;
			this._ThinClient = null;

			if (pError && this.log)
			{
				this.log.warn(`UltravisorBeacon: disable warning: ${pError.message}`);
			}
			else if (this.log)
			{
				this.log.info('UltravisorBeacon: disabled.');
			}

			return fCallback(pError || null);
		});
	}

	/**
	 * Check if beacon mode is currently enabled.
	 *
	 * @returns {boolean}
	 */
	isEnabled()
	{
		return this._Enabled;
	}

	/**
	 * Get the underlying thin client instance (for advanced usage).
	 * Returns null if beacon is not enabled.
	 *
	 * @returns {object|null}
	 */
	getThinClient()
	{
		return this._ThinClient;
	}

	/**
	 * Get the capability manager instance.
	 *
	 * @returns {object}
	 */
	getCapabilityManager()
	{
		return this._CapabilityManager;
	}
}

module.exports = UltravisorBeaconService;

// Also export sub-components for direct usage
module.exports.BeaconClient = libBeaconClient;
module.exports.CapabilityManager = libCapabilityManager;
module.exports.CapabilityAdapter = require('./Ultravisor-Beacon-CapabilityAdapter.cjs');
module.exports.CapabilityProvider = require('./Ultravisor-Beacon-CapabilityProvider.cjs');
module.exports.ProviderRegistry = require('./Ultravisor-Beacon-ProviderRegistry.cjs');
module.exports.ConnectivityHTTP = libConnectivityHTTP;
module.exports.ConnectivityWebSocket = libConnectivityWebSocket;
