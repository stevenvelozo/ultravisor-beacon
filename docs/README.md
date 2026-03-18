# Ultravisor Beacon

> Lightweight beacon client and Fable service for remote task execution

Ultravisor Beacon turns any Node.js application into a distributed worker node. A beacon connects to an Ultravisor server, advertises the capabilities it can perform, and executes work items dispatched by the orchestrator. It handles authentication, transport negotiation, file transfer, and progress reporting so your application only needs to provide the business logic.

## Features

- **Fable Service Integration** — Register as a service in any Fable/Pict application with `addAndInstantiateServiceType()`
- **Pluggable Providers** — Built-in Shell, FileSystem, and LLM providers; extend with custom providers via class, factory function, or npm package
- **Automatic Transport** — Tries WebSocket for push-based dispatch, falls back to HTTP polling transparently; reconnects on disconnect
- **File Transfer** — Automatic source file download and output collection with affinity-scoped caching for repeated operations
- **Multi-Backend LLM** — Unified interface across OpenAI, Anthropic, Ollama, and OpenAI-compatible APIs
- **Resilient Connectivity** — Auto-reconnect with re-authentication on connection loss; WebSocket-to-HTTP fallback

## Quick Start

```javascript
const libFable = require('fable');
const libBeacon = require('ultravisor-beacon');

let tmpFable = new libFable({ Product: 'MyApp' });

tmpFable.addAndInstantiateServiceType('UltravisorBeacon', libBeacon, {
	ServerURL: 'http://localhost:54321',
	Name: 'my-worker'
});

let tmpBeacon = tmpFable.services.UltravisorBeacon;

tmpBeacon.registerCapability({
	Capability: 'DataProcessor',
	actions:
	{
		'Transform':
		{
			Description: 'Transform a data payload',
			Handler: function (pWorkItem, pContext, fCallback)
			{
				let tmpInput = pWorkItem.Settings.Payload || '';
				return fCallback(null, {
					Outputs: { Result: tmpInput.toUpperCase() },
					Log: ['Transformed payload.']
				});
			}
		}
	}
});

tmpBeacon.enable(function (pError, pBeacon)
{
	if (pError) throw pError;
	console.log('Beacon online:', pBeacon.BeaconID);
});
```

## Installation

```bash
npm install ultravisor-beacon
```

## Core Concepts

### Two Usage Modes

1. **Fable Service** — Use `UltravisorBeaconService` to embed beacon functionality into an existing Fable application. Register capabilities with handler functions and call `enable()`.

2. **Standalone Client** — Use `UltravisorBeaconClient` directly for headless worker nodes. Configure with provider descriptors and call `start()`.

### Capabilities and Providers

A **capability** is a named unit of work a beacon can perform (e.g. `Shell`, `FileSystem`, `LLM`). Each capability has one or more **actions** (e.g. `Execute`, `Read`, `Write`).

A **provider** implements a capability. Built-in providers handle common tasks; custom providers extend `CapabilityProvider` for application-specific work.

### Transport

Beacons auto-negotiate their transport:

1. Try WebSocket — server pushes work items immediately
2. Fall back to HTTP polling if WebSocket unavailable
3. Reconnect automatically on disconnection

The coordinator does not track transport type. It checks for a live WebSocket when dispatching and falls through to the queue for polling beacons.

## Documentation

- [Quick Start](quickstart.md) — Step-by-step setup
- [Architecture](architecture.md) — System design with diagrams
- [Providers](providers/README.md) — Built-in and custom providers
- [API Reference](api/README.md) — Complete class and method reference

## Related Packages

- [fable](https://github.com/stevenvelozo/fable) — Service dependency injection framework
- [fable-serviceproviderbase](https://github.com/stevenvelozo/fable-serviceproviderbase) — Service provider base class
- [ultravisor](https://github.com/stevenvelozo/ultravisor) — Process supervision and orchestration server
