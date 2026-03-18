# BeaconService

A Fable service that turns any Fable/Pict application into an Ultravisor beacon. Host applications register capabilities with action handlers, then call `enable()` to connect.

**Extends:** `FableServiceProviderBase`

**Service Type:** `'UltravisorBeacon'`

## Constructor

```javascript
const libBeacon = require('ultravisor-beacon');

pFable.addAndInstantiateServiceType('UltravisorBeacon', libBeacon, pOptions);
```

### Options

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `Enabled` | `boolean` | `false` | Whether beacon starts enabled |
| `ServerURL` | `string` | `'http://localhost:54321'` | Ultravisor server endpoint |
| `Name` | `string` | `''` | Worker name (falls back to `fable.settings.Product`) |
| `Password` | `string` | `''` | Authentication password |
| `MaxConcurrent` | `number` | `1` | Maximum parallel work items |
| `PollIntervalMs` | `number` | `5000` | HTTP poll frequency (ms) |
| `HeartbeatIntervalMs` | `number` | `30000` | Heartbeat interval (ms) |
| `StagingPath` | `string` | `''` | Working directory for file transfer |
| `Tags` | `object` | `{}` | Metadata tags |

---

## registerCapability()

Register a capability from the host application.

### Signature

```javascript
beacon.registerCapability(pDescriptor)
```

### Parameters

| Name | Type | Description |
|------|------|-------------|
| `pDescriptor` | `object` | Capability descriptor (see below) |

### Descriptor Shape

```javascript
{
	Capability: 'ContentSystem',
	Name: 'ContentSystemProvider',   // optional
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
				// pWorkItem.Settings contains the work item settings
				// fCallback(pError, { Outputs: {...}, Log: [...] })
				// fReportProgress({ Percent, Message, Step, TotalSteps })
			}
		}
	},
	initialize: function (fCallback) { fCallback(null); },  // optional
	shutdown: function (fCallback) { fCallback(null); }      // optional
}
```

### Returns

`this` — chainable.

### Example

```javascript
tmpBeacon
	.registerCapability({
		Capability: 'ImageProcessor',
		actions:
		{
			'Resize':
			{
				Description: 'Resize an image',
				Handler: function (pWorkItem, pContext, fCallback)
				{
					// ... resize logic ...
					return fCallback(null, {
						Outputs: { Result: '/tmp/resized.jpg' },
						Log: ['Resized image.']
					});
				}
			}
		}
	})
	.registerCapability({
		Capability: 'VideoEncoder',
		actions: { /* ... */ }
	});
```

---

## removeCapability()

Remove a previously registered capability.

### Signature

```javascript
beacon.removeCapability(pCapabilityName)
```

### Parameters

| Name | Type | Description |
|------|------|-------------|
| `pCapabilityName` | `string` | The capability name to remove |

### Returns

`this` — chainable.

---

## getCapabilityNames()

Get the list of registered capability names.

### Signature

```javascript
beacon.getCapabilityNames()
```

### Returns

`string[]` — Array of capability names.

### Example

```javascript
console.log(tmpBeacon.getCapabilityNames());
// ['ContentSystem', 'ImageProcessor']
```

---

## enable()

Enable beacon mode: build providers from registered capabilities, create the thin client, authenticate, and connect.

### Signature

```javascript
beacon.enable(fCallback)
```

### Callback

```javascript
function (pError, pBeacon)
```

| Name | Type | Description |
|------|------|-------------|
| `pError` | `Error\|null` | Error if enable failed |
| `pBeacon` | `object` | `{ BeaconID: '...' }` on success |

### Description

1. Determines beacon name from `options.Name` or `fable.settings.Product`
2. Converts registered capabilities into provider adapters
3. Creates a `BeaconClient` with transport config
4. Registers adapters with the client's provider registry
5. Starts the client (authenticate → register → poll/WebSocket)

### Example

```javascript
tmpBeacon.enable(function (pError, pBeacon)
{
	if (pError)
	{
		console.error('Enable failed:', pError.message);
		return;
	}
	console.log('Online as', pBeacon.BeaconID);
});
```

### Notes

- Calling `enable()` when already enabled logs a warning and returns immediately.
- If no capabilities are registered, the beacon enables with a warning but has no providers.

---

## disable()

Disable beacon mode: stop polling, deregister from the server, and shut down providers.

### Signature

```javascript
beacon.disable(fCallback)
```

### Callback

```javascript
function (pError)
```

| Name | Type | Description |
|------|------|-------------|
| `pError` | `Error\|null` | Error if shutdown had issues (non-fatal) |

---

## isEnabled()

Check if beacon mode is currently enabled.

### Signature

```javascript
beacon.isEnabled()
```

### Returns

`boolean`

---

## getThinClient()

Get the underlying `BeaconClient` instance for advanced usage. Returns `null` if beacon is not enabled.

### Signature

```javascript
beacon.getThinClient()
```

### Returns

`UltravisorBeaconClient | null`

---

## getCapabilityManager()

Get the capability manager instance.

### Signature

```javascript
beacon.getCapabilityManager()
```

### Returns

`UltravisorBeaconCapabilityManager`
