/**
 * Ultravisor Beacon Address Resolver
 *
 * Parses and resolves Universal Data Addresses — a URI scheme for
 * referencing resources across a federated beacon mesh.
 *
 * Address format:
 *   >BeaconID/Context/Path...
 *
 * Components:
 *   >           — Prefix indicating a beacon-scoped resource
 *   BeaconID    — The registered beacon's name or ID
 *                  Special values: '*' (any beacon with required capability),
 *                                  'ULTRAVISOR' (the orchestrator itself)
 *   Context     — The namespace within the beacon:
 *                  'File'       — Filesystem access (content root)
 *                  'Staging'    — Work item staging area
 *                  'Cache'      — Cache storage (thumbnails, previews, etc.)
 *                  'Projection' — Data query endpoint (e.g. retold-facto)
 *                  'Operation'  — Operation state/artifacts on the orchestrator
 *   Path        — The resource path within that context
 *
 * Examples:
 *   >RR-BCN-001/File/volume3/Sort/SomeSong.mp3
 *   >ULTRAVISOR/Operation/0x732490df0/Stage/Transcoded.avi
 *   >RF-BCN-001/Projection/Countries/*
 *   >RF-BCN-001/Projection/Countries/FilteredTo/FBV~Name~LK~Col%25
 *   >WILDCARD/MediaConversion/Staging/input.jpg  (use * for any beacon)
 *
 * This module is Fable-free — usable from both beacon clients and
 * the Ultravisor server.
 */

class UltravisorBeaconAddressResolver
{
	constructor(pOptions)
	{
		let tmpOptions = pOptions || {};

		// Registry of known beacons and their contexts
		// Map of BeaconID → { Contexts: { ContextName: { BasePath, BaseURL, Writable } } }
		this._BeaconRegistry = {};

		// Local beacon ID (set when running on a beacon)
		this._LocalBeaconID = tmpOptions.LocalBeaconID || null;

		// Local context mappings (set when running on a beacon)
		// Map of ContextName → absolute filesystem path
		this._LocalContextPaths = {};
	}

	// ================================================================
	// Address Parsing
	// ================================================================

	/**
	 * Parse a universal data address string into its components.
	 *
	 * @param {string} pAddress - The address string (e.g. '>RR-BCN-001/File/photos/img.jpg')
	 * @returns {object|null} Parsed address: { BeaconID, Context, Path, Raw }
	 *                        Returns null if the address is not a valid universal address.
	 */
	parse(pAddress)
	{
		if (!pAddress || typeof pAddress !== 'string')
		{
			return null;
		}

		// Must start with >
		if (pAddress.charAt(0) !== '>')
		{
			return null;
		}

		// Strip the prefix
		let tmpBody = pAddress.substring(1);

		// Split into segments: BeaconID / Context / Path...
		let tmpFirstSlash = tmpBody.indexOf('/');
		if (tmpFirstSlash < 0)
		{
			// Just a beacon ID with no context or path
			return {
				BeaconID: tmpBody,
				Context: '',
				Path: '',
				Raw: pAddress
			};
		}

		let tmpBeaconID = tmpBody.substring(0, tmpFirstSlash);
		let tmpRemainder = tmpBody.substring(tmpFirstSlash + 1);

		let tmpSecondSlash = tmpRemainder.indexOf('/');
		if (tmpSecondSlash < 0)
		{
			// BeaconID and Context, no path
			return {
				BeaconID: tmpBeaconID,
				Context: tmpRemainder,
				Path: '',
				Raw: pAddress
			};
		}

		let tmpContext = tmpRemainder.substring(0, tmpSecondSlash);
		let tmpPath = tmpRemainder.substring(tmpSecondSlash + 1);

		return {
			BeaconID: tmpBeaconID,
			Context: tmpContext,
			Path: tmpPath,
			Raw: pAddress
		};
	}

	/**
	 * Check if a string is a universal data address.
	 *
	 * @param {string} pAddress - The string to check.
	 * @returns {boolean} True if the string starts with '>'.
	 */
	isUniversalAddress(pAddress)
	{
		return (typeof pAddress === 'string' && pAddress.length > 1 && pAddress.charAt(0) === '>');
	}

	/**
	 * Compose a universal data address from components.
	 *
	 * @param {string} pBeaconID - The beacon identifier.
	 * @param {string} pContext - The context namespace.
	 * @param {string} pPath - The resource path.
	 * @returns {string} The composed address.
	 */
	compose(pBeaconID, pContext, pPath)
	{
		let tmpParts = ['>', pBeaconID];
		if (pContext)
		{
			tmpParts.push('/', pContext);
			if (pPath)
			{
				tmpParts.push('/', pPath);
			}
		}
		return tmpParts.join('');
	}

	// ================================================================
	// Beacon Registry
	// ================================================================

	/**
	 * Register a beacon and its available contexts.
	 *
	 * @param {string} pBeaconID - The beacon identifier.
	 * @param {object} pContexts - Map of ContextName → { BasePath, BaseURL, Writable, Description }
	 */
	registerBeacon(pBeaconID, pContexts)
	{
		this._BeaconRegistry[pBeaconID] = {
			Contexts: pContexts || {}
		};
	}

	/**
	 * Deregister a beacon.
	 *
	 * @param {string} pBeaconID - The beacon identifier to remove.
	 */
	deregisterBeacon(pBeaconID)
	{
		delete this._BeaconRegistry[pBeaconID];
	}

	/**
	 * Get the context definition for a beacon.
	 *
	 * @param {string} pBeaconID - The beacon identifier.
	 * @param {string} pContext - The context name.
	 * @returns {object|null} The context definition, or null if not found.
	 */
	getBeaconContext(pBeaconID, pContext)
	{
		let tmpBeacon = this._BeaconRegistry[pBeaconID];
		if (!tmpBeacon || !tmpBeacon.Contexts)
		{
			return null;
		}
		return tmpBeacon.Contexts[pContext] || null;
	}

	/**
	 * List all registered beacons and their contexts.
	 *
	 * @returns {object} Map of BeaconID → { Contexts }
	 */
	listBeacons()
	{
		return JSON.parse(JSON.stringify(this._BeaconRegistry));
	}

	// ================================================================
	// Local Context Configuration
	// ================================================================

	/**
	 * Set the local beacon identity (for resolving self-references).
	 *
	 * @param {string} pBeaconID - This beacon's ID.
	 */
	setLocalBeaconID(pBeaconID)
	{
		this._LocalBeaconID = pBeaconID;
	}

	/**
	 * Register a local context path mapping.
	 *
	 * @param {string} pContext - The context name (e.g. 'File', 'Staging', 'Cache').
	 * @param {string} pBasePath - The absolute filesystem path for this context.
	 */
	setLocalContextPath(pContext, pBasePath)
	{
		this._LocalContextPaths[pContext] = pBasePath;
	}

	// ================================================================
	// Address Resolution
	// ================================================================

	/**
	 * Resolve a universal data address to a local filesystem path.
	 *
	 * Only works for addresses targeting the local beacon or addresses
	 * with explicit local context mappings. Returns null for remote addresses.
	 *
	 * @param {string} pAddress - The universal address string.
	 * @returns {object} Resolution result:
	 *   { Local: true, Path: '/absolute/path/to/file' }
	 *   or { Local: false, BeaconID: '...', Context: '...', Path: '...' }
	 *   or { Error: 'description' }
	 */
	resolve(pAddress)
	{
		let tmpParsed = this.parse(pAddress);
		if (!tmpParsed)
		{
			return { Error: `Invalid universal address: ${pAddress}` };
		}

		// Check if this targets the local beacon
		let tmpIsLocal = false;
		if (tmpParsed.BeaconID === this._LocalBeaconID)
		{
			tmpIsLocal = true;
		}

		if (tmpIsLocal)
		{
			let tmpBasePath = this._LocalContextPaths[tmpParsed.Context];
			if (!tmpBasePath)
			{
				return { Error: `Unknown local context: ${tmpParsed.Context}` };
			}

			let tmpResolvedPath = tmpParsed.Path
				? require('path').join(tmpBasePath, tmpParsed.Path)
				: tmpBasePath;

			return {
				Local: true,
				Path: tmpResolvedPath,
				BeaconID: tmpParsed.BeaconID,
				Context: tmpParsed.Context
			};
		}

		// Remote address — return the parsed components for the caller to handle
		return {
			Local: false,
			BeaconID: tmpParsed.BeaconID,
			Context: tmpParsed.Context,
			Path: tmpParsed.Path
		};
	}

	/**
	 * Build a URL for accessing a resource on a remote beacon.
	 *
	 * Uses the beacon's registered BaseURL for the context.
	 *
	 * @param {string} pAddress - The universal address string.
	 * @returns {string|null} The full URL, or null if the beacon/context is unknown.
	 */
	resolveToURL(pAddress)
	{
		let tmpParsed = this.parse(pAddress);
		if (!tmpParsed)
		{
			return null;
		}

		let tmpContextDef = this.getBeaconContext(tmpParsed.BeaconID, tmpParsed.Context);
		if (!tmpContextDef || !tmpContextDef.BaseURL)
		{
			return null;
		}

		let tmpBaseURL = tmpContextDef.BaseURL;
		// Ensure trailing slash on base
		if (tmpBaseURL.charAt(tmpBaseURL.length - 1) !== '/')
		{
			tmpBaseURL += '/';
		}

		return tmpBaseURL + (tmpParsed.Path || '');
	}

	/**
	 * Scan an object's values for universal addresses and return
	 * a list of all addresses found. Useful for pre-processing
	 * operation settings to identify file transfer requirements.
	 *
	 * @param {object} pObject - The object to scan (e.g. work item Settings).
	 * @returns {Array<{ Key: string, Address: object }>} List of found addresses.
	 */
	scanForAddresses(pObject)
	{
		let tmpResults = [];

		if (!pObject || typeof pObject !== 'object')
		{
			return tmpResults;
		}

		let tmpKeys = Object.keys(pObject);
		for (let i = 0; i < tmpKeys.length; i++)
		{
			let tmpValue = pObject[tmpKeys[i]];
			if (typeof tmpValue === 'string' && this.isUniversalAddress(tmpValue))
			{
				let tmpParsed = this.parse(tmpValue);
				if (tmpParsed)
				{
					tmpResults.push({ Key: tmpKeys[i], Address: tmpParsed });
				}
			}
			else if (typeof tmpValue === 'object' && tmpValue !== null)
			{
				// Recurse into nested objects
				let tmpNested = this.scanForAddresses(tmpValue);
				for (let j = 0; j < tmpNested.length; j++)
				{
					tmpNested[j].Key = tmpKeys[i] + '.' + tmpNested[j].Key;
					tmpResults.push(tmpNested[j]);
				}
			}
		}

		return tmpResults;
	}
}

module.exports = UltravisorBeaconAddressResolver;
