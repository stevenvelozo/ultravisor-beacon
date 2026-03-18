# CapabilityManager

Manages capabilities registered by a host application via `BeaconService.registerCapability()`. When the beacon is enabled, the manager converts all registered descriptors into provider adapters that the thin client can execute.

## Constructor

```javascript
const libCapabilityManager = require('ultravisor-beacon').CapabilityManager;

let tmpManager = new libCapabilityManager();
```

---

## registerCapability()

Register a capability from the host application.

### Signature

```javascript
manager.registerCapability(pDescriptor)
```

### Parameters

| Name | Type | Description |
|------|------|-------------|
| `pDescriptor` | `object` | Capability descriptor |

### Descriptor Shape

```javascript
{
	Capability: 'ContentSystem',
	Name: 'ContentSystemProvider',   // optional, defaults to Capability
	actions:
	{
		'ReadFile':
		{
			Description: 'Read a content file',
			SettingsSchema:
			[
				{ Name: 'FilePath', DataType: 'String', Required: true }
			],
			Handler: function (pWorkItem, pContext, fCallback, fReportProgress)
			{
				return fCallback(null, { Outputs: { Result: '...' }, Log: [] });
			}
		}
	},
	initialize: function (fCallback) { fCallback(null); },  // optional
	shutdown: function (fCallback) { fCallback(null); }      // optional
}
```

### Returns

`boolean` — `true` if registered successfully. Returns `false` if the descriptor is missing a `Capability` name.

---

## removeCapability()

Remove a previously registered capability.

### Signature

```javascript
manager.removeCapability(pCapabilityName)
```

### Parameters

| Name | Type | Description |
|------|------|-------------|
| `pCapabilityName` | `string` | The capability to remove |

### Returns

`boolean` — `true` if the capability existed and was removed.

---

## getCapabilityNames()

Get the list of registered capability names.

### Signature

```javascript
manager.getCapabilityNames()
```

### Returns

`string[]` — Array of registered capability names.

---

## getCapabilities()

Get all registered capability descriptors.

### Signature

```javascript
manager.getCapabilities()
```

### Returns

`object` — Map of capability name → descriptor.

---

## buildProviderDescriptors()

Convert all registered capabilities into `CapabilityAdapter` instances suitable for the thin client's `ProviderRegistry`.

### Signature

```javascript
manager.buildProviderDescriptors()
```

### Returns

`CapabilityAdapter[]` — Array of adapter instances, one per registered capability.

### Description

Creates a `CapabilityAdapter` instance for each registered capability. Adapters implement the `CapabilityProvider` interface by delegating `execute()` calls to the descriptor's `Handler` functions. The adapters are pre-instantiated — `ProviderRegistry.registerProvider()` accepts them directly.

### Example

```javascript
let tmpAdapters = tmpManager.buildProviderDescriptors();

for (let i = 0; i < tmpAdapters.length; i++)
{
	tmpClient._Executor.providerRegistry.registerProvider(tmpAdapters[i]);
}
```

---

## Notes

- Capability names are unique — registering a second capability with the same name overwrites the first.
- The `Handler` functions in a descriptor are called by the `CapabilityAdapter` during execution. They receive the full work item, execution context, callback, and progress reporter.
- The `initialize()` and `shutdown()` hooks on the descriptor are called by the adapter's lifecycle methods, which the `ProviderRegistry` invokes during `initializeAll()` and `shutdownAll()`.
