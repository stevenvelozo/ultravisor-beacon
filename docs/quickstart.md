# Quick Start

This guide walks through setting up an Ultravisor Beacon in three common scenarios.

## Prerequisites

- Node.js 18+
- An Ultravisor server running (default: `http://localhost:54321`)

## Installation

```bash
npm install ultravisor-beacon
```

## Scenario 1: Fable Service with Custom Capability

Embed beacon functionality into an existing Fable application. The service manages the full lifecycle — authentication, registration, polling, and shutdown.

```javascript
const libFable = require('fable');
const libBeacon = require('ultravisor-beacon');

let tmpFable = new libFable({
	Product: 'ContentProcessor',
	ProductVersion: '1.0.0'
});

// Register the beacon service
tmpFable.addAndInstantiateServiceType('UltravisorBeacon', libBeacon, {
	ServerURL: 'http://localhost:54321',
	Name: 'content-processor',
	MaxConcurrent: 2,
	Tags: { environment: 'production' }
});

let tmpBeacon = tmpFable.services.UltravisorBeacon;

// Register a custom capability with multiple actions
tmpBeacon.registerCapability({
	Capability: 'ContentSystem',
	actions:
	{
		'ReadFile':
		{
			Description: 'Read a content file from the CMS',
			SettingsSchema:
			[
				{ Name: 'FilePath', DataType: 'String', Required: true }
			],
			Handler: function (pWorkItem, pContext, fCallback, fReportProgress)
			{
				let tmpPath = pWorkItem.Settings.FilePath;
				// ... your read logic here ...
				return fCallback(null, {
					Outputs: { Result: 'file contents here' },
					Log: ['Read file: ' + tmpPath]
				});
			}
		},
		'WriteFile':
		{
			Description: 'Write content to the CMS',
			SettingsSchema:
			[
				{ Name: 'FilePath', DataType: 'String', Required: true },
				{ Name: 'Content', DataType: 'String', Required: true }
			],
			Handler: function (pWorkItem, pContext, fCallback)
			{
				// ... your write logic here ...
				return fCallback(null, {
					Outputs: { Result: pWorkItem.Settings.FilePath },
					Log: ['Wrote file.']
				});
			}
		}
	},
	initialize: function (fCallback)
	{
		console.log('ContentSystem provider initializing...');
		return fCallback(null);
	},
	shutdown: function (fCallback)
	{
		console.log('ContentSystem provider shutting down...');
		return fCallback(null);
	}
});

// Enable the beacon
tmpBeacon.enable(function (pError, pBeacon)
{
	if (pError)
	{
		console.error('Failed to enable beacon:', pError.message);
		return;
	}
	console.log('Beacon online:', pBeacon.BeaconID);
});

// Later, to shut down:
// tmpBeacon.disable(function (pError) { ... });
```

## Scenario 2: Standalone Shell Worker

Use the thin client directly for a headless worker that executes shell commands.

```javascript
const libBeaconClient = require('ultravisor-beacon').BeaconClient;

let tmpClient = new libBeaconClient({
	ServerURL: 'http://localhost:54321',
	Name: 'build-worker',
	Password: 'worker-secret',
	Capabilities: ['Shell'],
	MaxConcurrent: 4,
	PollIntervalMs: 3000,
	StagingPath: '/tmp/beacon-staging'
});

tmpClient.start(function (pError, pBeacon)
{
	if (pError)
	{
		console.error('Start failed:', pError.message);
		return;
	}
	console.log('Shell worker online:', pBeacon.BeaconID);
});

// Graceful shutdown on SIGTERM
process.on('SIGTERM', function ()
{
	tmpClient.stop(function ()
	{
		console.log('Worker stopped.');
		process.exit(0);
	});
});
```

## Scenario 3: Custom Provider via npm Package

Load a custom provider from an npm package or local file.

```javascript
const libBeaconClient = require('ultravisor-beacon').BeaconClient;

let tmpClient = new libBeaconClient({
	ServerURL: 'http://localhost:54321',
	Name: 'ml-worker',
	Providers:
	[
		{ Source: 'Shell', Config: {} },
		{ Source: './providers/image-processor.cjs', Config: { MaxResolution: 4096 } },
		{ Source: 'ultravisor-provider-ml', Config: { ModelPath: '/models' } }
	],
	MaxConcurrent: 2
});

tmpClient.start(function (pError, pBeacon)
{
	if (pError) throw pError;
	console.log('ML worker online:', pBeacon.BeaconID);
});
```

## Configuration Reference

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `ServerURL` | `string` | `'http://localhost:54321'` | Ultravisor server endpoint |
| `Name` | `string` | `'beacon-worker'` | Worker name for registration |
| `Password` | `string` | `''` | Authentication password |
| `Capabilities` | `string[]` | `['Shell']` | Legacy: capability names to load as built-in providers |
| `Providers` | `object[]` | — | Provider descriptors: `[{ Source, Config }]` |
| `MaxConcurrent` | `number` | `1` | Maximum parallel work items |
| `PollIntervalMs` | `number` | `5000` | HTTP poll frequency (ms) |
| `HeartbeatIntervalMs` | `number` | `30000` | Heartbeat interval (ms) |
| `ReconnectIntervalMs` | `number` | `10000` | Reconnect delay (ms) |
| `StagingPath` | `string` | `process.cwd()` | Working directory for file transfer |
| `Tags` | `object` | `{}` | Metadata tags sent to the coordinator |

## Next Steps

- [Architecture](architecture.md) — Understand the component design
- [Providers](providers/README.md) — Built-in providers and writing custom ones
- [API Reference](api/README.md) — Complete method documentation
