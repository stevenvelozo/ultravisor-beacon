# Providers

Providers implement capabilities that beacons advertise to the Ultravisor server. Each provider declares a capability name, one or more actions, and the execution logic for those actions.

## Built-in Providers

| Provider | Capability | Actions | Description |
|----------|------------|---------|-------------|
| [Shell](providers/shell.md) | `Shell` | `Execute` | Run shell commands via `child_process.exec()` |
| [FileSystem](providers/filesystem.md) | `FileSystem` | `Read`, `Write`, `List`, `Copy` | Local file operations with path restrictions |
| [LLM](providers/llm.md) | `LLM` | `ChatCompletion`, `Embedding`, `ToolUse` | Multi-backend LLM API calls |

## Loading Providers

Providers are loaded via the `ProviderRegistry`. The `Source` field determines resolution:

```javascript
// Built-in (by name)
{ Source: 'Shell', Config: { MaxBufferBytes: 20971520 } }

// Local file
{ Source: './providers/image-processor.cjs', Config: { MaxResolution: 4096 } }

// npm package
{ Source: 'ultravisor-provider-ml', Config: { ModelPath: '/models' } }
```

## Writing a Custom Provider

Extend `CapabilityProvider` and implement `actions` and `execute()`:

```javascript
const libCapabilityProvider = require('ultravisor-beacon').CapabilityProvider;

class ImageProcessor extends libCapabilityProvider
{
	constructor(pConfig)
	{
		super(pConfig);
		this.Name = 'ImageProcessor';
		this.Capability = 'ImageProcessing';
	}

	get actions()
	{
		return {
			'Resize':
			{
				Description: 'Resize an image to target dimensions.',
				SettingsSchema:
				[
					{ Name: 'Width', DataType: 'Number', Required: true },
					{ Name: 'Height', DataType: 'Number', Required: true }
				]
			},
			'Thumbnail':
			{
				Description: 'Generate a thumbnail.',
				SettingsSchema:
				[
					{ Name: 'Size', DataType: 'Number', Required: false }
				]
			}
		};
	}

	execute(pAction, pWorkItem, pContext, fCallback, fReportProgress)
	{
		let tmpSettings = pWorkItem.Settings || {};

		switch (pAction)
		{
			case 'Resize':
				// ... your resize logic ...
				return fCallback(null, {
					Outputs: { Result: '/tmp/resized.jpg', ExitCode: 0, StdOut: 'Resized' },
					Log: ['Resized to ' + tmpSettings.Width + 'x' + tmpSettings.Height]
				});

			case 'Thumbnail':
				// ... your thumbnail logic ...
				return fCallback(null, {
					Outputs: { Result: '/tmp/thumb.jpg', ExitCode: 0, StdOut: 'Thumbnail created' },
					Log: ['Thumbnail generated']
				});

			default:
				return fCallback(new Error('Unknown action: ' + pAction));
		}
	}

	initialize(fCallback)
	{
		// Verify that ImageMagick is installed
		require('child_process').exec('convert --version', function (pError)
		{
			if (pError)
			{
				return fCallback(new Error('ImageMagick not found'));
			}
			return fCallback(null);
		});
	}

	shutdown(fCallback)
	{
		return fCallback(null);
	}
}

module.exports = ImageProcessor;
```

### Export Formats

The provider module can export in three ways:

| Export | ProviderRegistry Behavior |
|--------|---------------------------|
| **Class** with `execute()` on prototype | Instantiated with `Config` |
| **Factory function** | Called with `Config`, result registered |
| **Object** with `execute()` method | Registered directly (singleton) |

### Provider Lifecycle

1. **`constructor(pConfig)`** — Receive per-provider configuration
2. **`initialize(fCallback)`** — Async initialization (validate prerequisites, connect to services)
3. **`execute(pAction, pWorkItem, pContext, fCallback, fReportProgress)`** — Handle work items
4. **`shutdown(fCallback)`** — Clean up on beacon stop

### Result Convention

All providers should return results in this shape:

```javascript
{
	Outputs:
	{
		StdOut: 'Human-readable output or status message',
		ExitCode: 0,     // 0 = success, non-zero = failure
		Result: '...'    // Primary machine-readable result
	},
	Log: ['Log entry 1', 'Log entry 2']
}
```

Providers should avoid throwing errors for expected failures (bad input, missing files). Instead, return a result with a non-zero `ExitCode` and an explanatory `StdOut`. Reserve `fCallback(error)` for truly exceptional situations.
