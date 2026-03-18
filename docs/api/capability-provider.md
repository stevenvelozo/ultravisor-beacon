# CapabilityProvider

Base class for all capability providers. Extend this class to implement a custom provider that the beacon can load and execute work items for.

## Constructor

```javascript
const libCapabilityProvider = require('ultravisor-beacon').CapabilityProvider;

class MyProvider extends libCapabilityProvider
{
	constructor(pProviderConfig)
	{
		super(pProviderConfig);
		this.Name = 'MyProvider';
		this.Capability = 'MyCapability';
	}
}
```

### Parameters

| Name | Type | Description |
|------|------|-------------|
| `pProviderConfig` | `object` | Per-provider configuration (available as `this._ProviderConfig`) |

### Properties

| Name | Type | Description |
|------|------|-------------|
| `Name` | `string` | Provider display name (set by subclass) |
| `Capability` | `string` | Capability name (set by subclass) |

---

## actions (getter)

Return the actions this provider supports. Override in subclasses.

### Signature

```javascript
get actions()
```

### Returns

`object` — Map of action name → action definition.

### Action Definition Shape

```javascript
{
	'Execute':
	{
		Description: 'Run a shell command.',
		SettingsSchema:
		[
			{ Name: 'Command', DataType: 'String', Required: true, Description: 'The command' }
		]
	}
}
```

`SettingsSchema` is optional and used for introspection and validation. Each entry has:

| Field | Type | Description |
|-------|------|-------------|
| `Name` | `string` | Setting name |
| `DataType` | `string` | `'String'`, `'Number'`, `'Boolean'` |
| `Required` | `boolean` | Whether the setting is required |
| `Description` | `string` | Human-readable description |

---

## execute()

Execute a work item for the given action. Override in subclasses.

### Signature

```javascript
provider.execute(pAction, pWorkItem, pContext, fCallback, fReportProgress)
```

### Parameters

| Name | Type | Description |
|------|------|-------------|
| `pAction` | `string` | The action to perform (e.g. `'Execute'`, `'Read'`) |
| `pWorkItem` | `object` | Full work item from the server |
| `pContext` | `object` | Execution context: `{ StagingPath }` |
| `fCallback` | `function` | `function(pError, pResult)` |
| `fReportProgress` | `function` | Optional: `function(pProgressData)` |

### Work Item Shape

```javascript
{
	WorkItemHash: '0x1234abcd',
	Capability: 'MyCapability',
	Action: 'Process',
	Settings: { /* action-specific settings */ },
	TimeoutMs: 300000,
	OperationHash: '0xabcd1234'
}
```

### Result Shape

```javascript
{
	Outputs:
	{
		StdOut: 'Human-readable output',
		ExitCode: 0,
		Result: 'Primary result value'
	},
	Log: ['Execution log entry']
}
```

### Progress Data Shape

```javascript
{
	Percent: 50,          // 0-100
	Message: 'Halfway',   // status text
	Step: 3,              // current step number
	TotalSteps: 6,        // total steps
	Log: ['Step 3 done']  // log entries
}
```

All fields are optional.

### Example

```javascript
class ImageResizer extends libCapabilityProvider
{
	constructor(pConfig)
	{
		super(pConfig);
		this.Name = 'ImageResizer';
		this.Capability = 'ImageProcessing';
	}

	get actions()
	{
		return {
			'Resize':
			{
				Description: 'Resize an image to specified dimensions.',
				SettingsSchema:
				[
					{ Name: 'Width', DataType: 'Number', Required: true },
					{ Name: 'Height', DataType: 'Number', Required: true }
				]
			}
		};
	}

	execute(pAction, pWorkItem, pContext, fCallback, fReportProgress)
	{
		let tmpSettings = pWorkItem.Settings || {};

		if (pAction !== 'Resize')
		{
			return fCallback(new Error('Unknown action: ' + pAction));
		}

		// Report progress
		if (fReportProgress)
		{
			fReportProgress({ Percent: 0, Message: 'Starting resize' });
		}

		// ... resize logic ...

		return fCallback(null, {
			Outputs: { StdOut: 'Resized to ' + tmpSettings.Width + 'x' + tmpSettings.Height, ExitCode: 0, Result: '/tmp/resized.jpg' },
			Log: ['Image resized successfully.']
		});
	}
}

module.exports = ImageResizer;
```

---

## getCapabilities()

Return the list of capability strings this provider advertises.

### Signature

```javascript
provider.getCapabilities()
```

### Returns

`string[]` — Usually `[this.Capability]`. Override for multi-capability providers.

---

## describeActions()

Return a structured description of all supported actions. Used for logging and introspection.

### Signature

```javascript
provider.describeActions()
```

### Returns

`Array<{ Capability: string, Action: string, Description: string }>`

---

## initialize()

Optional lifecycle hook called after the provider is loaded, before the beacon starts polling. Use for async initialization (verifying prerequisites, connecting to APIs, etc.).

### Signature

```javascript
provider.initialize(fCallback)
```

### Callback

```javascript
function (pError)
```

The base implementation calls `fCallback(null)` immediately.

---

## shutdown()

Optional lifecycle hook called when the beacon is shutting down. Use for cleanup (closing connections, flushing buffers, etc.).

### Signature

```javascript
provider.shutdown(fCallback)
```

### Callback

```javascript
function (pError)
```

The base implementation calls `fCallback(null)` immediately.
