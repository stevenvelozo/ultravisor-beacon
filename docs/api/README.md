# API Reference

Complete reference documentation for all public classes and methods in the Ultravisor Beacon module.

## Module Exports

```javascript
const libBeacon = require('ultravisor-beacon');
```

The default export is `UltravisorBeaconService`. Sub-components are available as named properties:

| Export | Class | Description |
|--------|-------|-------------|
| *(default)* | [BeaconService](api/beacon-service.md) | Fable service wrapper |
| `.BeaconClient` | [BeaconClient](api/beacon-client.md) | Thin client for standalone workers |
| `.CapabilityManager` | [CapabilityManager](api/capability-manager.md) | Host app capability registry |
| `.CapabilityAdapter` | CapabilityAdapter | Descriptor-to-provider bridge |
| `.CapabilityProvider` | [CapabilityProvider](api/capability-provider.md) | Base class for providers |
| `.ProviderRegistry` | [ProviderRegistry](api/provider-registry.md) | Provider index and router |
| `.ConnectivityHTTP` | ConnectivityHTTP | HTTP transport configuration |
| `.ConnectivityWebSocket` | ConnectivityWebSocket | WebSocket transport configuration |

## Class Hierarchy

```
UltravisorBeaconService (extends FableServiceProviderBase)
├── CapabilityManager
├── ConnectivityHTTP
└── BeaconClient
    └── Executor
        └── ProviderRegistry
            ├── Shell (extends CapabilityProvider)
            ├── FileSystem (extends CapabilityProvider)
            ├── LLM (extends CapabilityProvider)
            └── CapabilityAdapter (extends CapabilityProvider)
```

## Common Patterns

### Callback Convention

All async methods use Node.js-style callbacks:

```javascript
function (pError, pResult) { ... }
```

### Work Item Shape

Work items passed to providers have this structure:

```javascript
{
	WorkItemHash: '0x1234abcd',
	Capability: 'Shell',
	Action: 'Execute',
	Settings: { Command: 'echo hello', Parameters: '' },
	TimeoutMs: 300000,
	OperationHash: '0xabcd1234'
}
```

### Result Shape

Provider execution results follow this format:

```javascript
{
	Outputs:
	{
		StdOut: 'Command output text',
		ExitCode: 0,
		Result: 'Primary result value'
	},
	Log: ['Log message 1', 'Log message 2']
}
```

### Progress Reporting

Long-running operations can report progress:

```javascript
fReportProgress({
	Percent: 50,
	Message: 'Halfway done',
	Step: 3,
	TotalSteps: 6,
	Log: ['Step 3 complete']
});
```

All fields are optional. The beacon client sends progress updates to the server via WebSocket or HTTP.
