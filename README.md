Ultravisor Beacon
=================

A lightweight beacon client and Fable service for remote task execution. Ultravisor Beacon turns any Node.js application into a distributed worker node that connects to an Ultravisor server, advertises capabilities, and executes work items on demand.

## Features

- **Fable Service Integration** -- Register as a service in any Fable/Pict application with `addAndInstantiateServiceType()`
- **Pluggable Providers** -- Built-in Shell, FileSystem, and LLM providers; extend with custom providers via class, factory, or npm package
- **Automatic Transport** -- Tries WebSocket for push-based dispatch, falls back to HTTP polling transparently
- **File Transfer** -- Automatic source file download and output collection with affinity-scoped caching
- **Multi-Backend LLM** -- Unified interface across OpenAI, Anthropic, Ollama, and OpenAI-compatible APIs
- **Resilient Connectivity** -- Auto-reconnect with re-authentication on connection loss

## Documentation

Comprehensive documentation is available in the [docs](./docs) folder:

- [Overview](./docs/README.md) -- Introduction and getting started
- [Quick Start](./docs/quickstart.md) -- Step-by-step setup guide
- [Architecture](./docs/architecture.md) -- System design and mermaid diagrams
- [API Reference](./docs/api/README.md) -- All classes and methods
- [Providers](./docs/providers/README.md) -- Built-in and custom providers

## Install

```sh
$ npm install ultravisor-beacon
```

## Quick Start

### As a Fable Service

```javascript
const libFable = require('fable');
const libBeacon = require('ultravisor-beacon');

let tmpFable = new libFable({ Product: 'MyApp', ProductVersion: '1.0.0' });

tmpFable.addAndInstantiateServiceType('UltravisorBeacon', libBeacon, {
	ServerURL: 'http://localhost:54321',
	Name: 'my-app-beacon'
});

let tmpBeacon = tmpFable.services.UltravisorBeacon;

tmpBeacon.registerCapability({
	Capability: 'MyApp',
	actions:
	{
		'ProcessData':
		{
			Description: 'Process a data payload',
			Handler: function (pWorkItem, pContext, fCallback)
			{
				let tmpResult = doSomeWork(pWorkItem.Settings);
				return fCallback(null, { Outputs: { Result: tmpResult }, Log: ['Done.'] });
			}
		}
	}
});

tmpBeacon.enable(function (pError, pBeacon)
{
	console.log('Beacon online:', pBeacon.BeaconID);
});
```

### Standalone Client

```javascript
const libBeaconClient = require('ultravisor-beacon').BeaconClient;

let tmpClient = new libBeaconClient({
	ServerURL: 'http://localhost:54321',
	Name: 'shell-worker',
	Capabilities: ['Shell'],
	MaxConcurrent: 4
});

tmpClient.start(function (pError, pBeacon)
{
	console.log('Worker online:', pBeacon.BeaconID);
});
```

## Related Packages

- [fable](https://github.com/stevenvelozo/fable) -- Service dependency injection framework
- [fable-serviceproviderbase](https://github.com/stevenvelozo/fable-serviceproviderbase) -- Service provider base class
- [ultravisor](https://github.com/stevenvelozo/ultravisor) -- Process supervision and orchestration server

## License

MIT

## Contributing

Pull requests are welcome. For details on our code of conduct, contribution process, and testing requirements, see the [Retold Contributing Guide](https://github.com/stevenvelozo/retold/blob/main/docs/contributing.md).
