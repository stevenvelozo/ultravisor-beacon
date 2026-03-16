/**
 * Ultravisor Beacon Provider Registry
 *
 * Manages loaded capability providers, routes work items to the
 * correct provider based on Capability:Action, and aggregates the
 * capabilities list for beacon registration.
 *
 * Provider loading supports three sources:
 *   - Built-in name ('Shell', 'FileSystem') → resolves to ./providers/
 *   - Local file path ('./my-provider.cjs' or absolute) → require(resolved)
 *   - npm package name ('ultravisor-provider-ml') → require(name)
 */

const libPath = require('path');

class UltravisorBeaconProviderRegistry
{
	constructor()
	{
		// Map of 'Capability:Action' → { provider, actionDef }
		this._ActionHandlers = {};

		// Map of 'Capability' → { provider, defaultAction }
		this._DefaultHandlers = {};

		// All loaded providers by Name
		this._Providers = {};

		// Aggregate capabilities list (string[])
		this._Capabilities = [];
	}

	/**
	 * Register a provider instance.
	 *
	 * @param {object} pProvider - Provider instance (extends CapabilityProvider or duck-types it)
	 * @returns {boolean} true if registered successfully
	 */
	registerProvider(pProvider)
	{
		if (!pProvider || !pProvider.Capability)
		{
			console.error('[ProviderRegistry] Provider must have a Capability.');
			return false;
		}

		let tmpActions = pProvider.actions || {};
		let tmpActionNames = Object.keys(tmpActions);

		if (tmpActionNames.length === 0)
		{
			console.warn(`[ProviderRegistry] Provider "${pProvider.Name}" declares no actions.`);
		}

		// Index each action by composite key
		for (let i = 0; i < tmpActionNames.length; i++)
		{
			let tmpKey = pProvider.Capability + ':' + tmpActionNames[i];
			this._ActionHandlers[tmpKey] = {
				provider: pProvider,
				actionDef: tmpActions[tmpActionNames[i]]
			};
		}

		// First declared action is the default for capability-only routing
		if (tmpActionNames.length > 0)
		{
			this._DefaultHandlers[pProvider.Capability] = {
				provider: pProvider,
				defaultAction: tmpActionNames[0]
			};
		}

		// Update aggregate capabilities list
		let tmpCapabilities = pProvider.getCapabilities();
		for (let i = 0; i < tmpCapabilities.length; i++)
		{
			if (this._Capabilities.indexOf(tmpCapabilities[i]) === -1)
			{
				this._Capabilities.push(tmpCapabilities[i]);
			}
		}

		this._Providers[pProvider.Name] = pProvider;

		console.log(`[ProviderRegistry] Registered "${pProvider.Name}" → ` +
			`${pProvider.Capability} [${tmpActionNames.join(', ')}]`);

		return true;
	}

	/**
	 * Resolve a Capability+Action to a provider and action name.
	 *
	 * @param {string} pCapability - The capability to match
	 * @param {string} [pAction] - Optional action within the capability
	 * @returns {{ provider: object, action: string }|null}
	 */
	resolve(pCapability, pAction)
	{
		// Try exact Capability:Action match first
		if (pAction)
		{
			let tmpKey = pCapability + ':' + pAction;
			let tmpHandler = this._ActionHandlers[tmpKey];
			if (tmpHandler)
			{
				return { provider: tmpHandler.provider, action: pAction };
			}
		}

		// Fall back to default action for the capability
		let tmpDefault = this._DefaultHandlers[pCapability];
		if (tmpDefault)
		{
			return { provider: tmpDefault.provider, action: tmpDefault.defaultAction };
		}

		return null;
	}

	/**
	 * Get the aggregate capabilities list for beacon registration.
	 *
	 * @returns {string[]}
	 */
	getCapabilities()
	{
		return this._Capabilities.slice();
	}

	/**
	 * Get all loaded providers.
	 *
	 * @returns {object} Map of provider Name → instance
	 */
	getProviders()
	{
		return this._Providers;
	}

	/**
	 * Load a provider from a source descriptor.
	 *
	 * @param {object} pDescriptor - { Source, Config }
	 *   Source: 'Shell' (built-in), './my-provider.cjs' (local), 'npm-pkg' (npm)
	 *   Config: per-provider config object (passed to constructor)
	 * @returns {boolean} true if loaded and registered successfully
	 */
	loadProvider(pDescriptor)
	{
		let tmpSource = (pDescriptor && pDescriptor.Source) ? pDescriptor.Source : '';
		let tmpConfig = (pDescriptor && pDescriptor.Config) ? pDescriptor.Config : {};

		if (!tmpSource)
		{
			console.error('[ProviderRegistry] Provider descriptor must have a Source.');
			return false;
		}

		let tmpProviderModule = null;

		// Built-in providers
		let tmpBuiltIns = {
			'Shell': libPath.join(__dirname, 'providers', 'Ultravisor-Beacon-Provider-Shell.cjs'),
			'FileSystem': libPath.join(__dirname, 'providers', 'Ultravisor-Beacon-Provider-FileSystem.cjs'),
			'LLM': libPath.join(__dirname, 'providers', 'Ultravisor-Beacon-Provider-LLM.cjs')
		};

		try
		{
			if (tmpBuiltIns[tmpSource])
			{
				tmpProviderModule = require(tmpBuiltIns[tmpSource]);
			}
			else if (tmpSource.startsWith('.') || tmpSource.startsWith('/'))
			{
				// Local file path — resolve relative to cwd
				tmpProviderModule = require(libPath.resolve(tmpSource));
			}
			else
			{
				// npm package
				tmpProviderModule = require(tmpSource);
			}
		}
		catch (pError)
		{
			console.error(`[ProviderRegistry] Failed to load provider from "${tmpSource}": ${pError.message}`);
			return false;
		}

		if (!tmpProviderModule)
		{
			console.error(`[ProviderRegistry] Could not load provider from: ${tmpSource}`);
			return false;
		}

		// Support class exports, factory functions, and pre-instantiated singletons
		let tmpProvider;

		if (typeof tmpProviderModule === 'function' &&
			tmpProviderModule.prototype &&
			typeof tmpProviderModule.prototype.execute === 'function')
		{
			// Class with execute on prototype — instantiate it
			tmpProvider = new tmpProviderModule(tmpConfig);
		}
		else if (typeof tmpProviderModule === 'function')
		{
			// Factory function
			tmpProvider = tmpProviderModule(tmpConfig);
		}
		else if (typeof tmpProviderModule === 'object' &&
			typeof tmpProviderModule.execute === 'function')
		{
			// Pre-instantiated singleton
			tmpProvider = tmpProviderModule;
		}
		else
		{
			console.error(`[ProviderRegistry] Invalid provider export from "${tmpSource}": ` +
				`must be a class, factory function, or object with execute().`);
			return false;
		}

		return this.registerProvider(tmpProvider);
	}

	/**
	 * Load all providers from a config array.
	 *
	 * @param {Array<{ Source: string, Config?: object }>} pDescriptors
	 * @returns {number} count of successfully loaded providers
	 */
	loadProviders(pDescriptors)
	{
		if (!Array.isArray(pDescriptors))
		{
			return 0;
		}

		let tmpCount = 0;

		for (let i = 0; i < pDescriptors.length; i++)
		{
			if (this.loadProvider(pDescriptors[i]))
			{
				tmpCount++;
			}
		}

		return tmpCount;
	}

	/**
	 * Initialize all loaded providers sequentially.
	 * Called before the beacon starts polling.
	 *
	 * @param {function} fCallback - function(pError)
	 */
	initializeAll(fCallback)
	{
		let tmpProviderNames = Object.keys(this._Providers);
		let tmpIndex = 0;

		let fNext = (pError) =>
		{
			if (pError)
			{
				return fCallback(pError);
			}

			if (tmpIndex >= tmpProviderNames.length)
			{
				return fCallback(null);
			}

			let tmpProviderName = tmpProviderNames[tmpIndex++];
			let tmpProvider = this._Providers[tmpProviderName];

			if (typeof tmpProvider.initialize === 'function')
			{
				tmpProvider.initialize(fNext);
			}
			else
			{
				fNext(null);
			}
		};

		fNext(null);
	}

	/**
	 * Shut down all loaded providers sequentially.
	 * Called when the beacon is stopping.
	 *
	 * @param {function} fCallback - function(pError)
	 */
	shutdownAll(fCallback)
	{
		let tmpProviderNames = Object.keys(this._Providers);
		let tmpIndex = 0;

		let fNext = (pError) =>
		{
			if (tmpIndex >= tmpProviderNames.length)
			{
				return fCallback(pError || null);
			}

			let tmpProviderName = tmpProviderNames[tmpIndex++];
			let tmpProvider = this._Providers[tmpProviderName];

			if (typeof tmpProvider.shutdown === 'function')
			{
				tmpProvider.shutdown(fNext);
			}
			else
			{
				fNext(null);
			}
		};

		fNext(null);
	}
}

module.exports = UltravisorBeaconProviderRegistry;
