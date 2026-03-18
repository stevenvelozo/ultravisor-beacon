# BeaconClient

A lightweight worker node that connects to an Ultravisor server, registers its capabilities, and executes work items. Used directly for standalone workers or internally by `BeaconService`.

## Constructor

```javascript
const libBeaconClient = require('ultravisor-beacon').BeaconClient;

let tmpClient = new libBeaconClient(pConfig);
```

### Config

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `ServerURL` | `string` | `'http://localhost:54321'` | Server endpoint |
| `Name` | `string` | `'beacon-worker'` | Worker name |
| `Password` | `string` | `''` | Authentication password |
| `Capabilities` | `string[]` | `['Shell']` | Legacy: built-in provider names to load |
| `Providers` | `object[]` | — | Provider descriptors: `[{ Source, Config }]` |
| `MaxConcurrent` | `number` | `1` | Max parallel work items |
| `PollIntervalMs` | `number` | `5000` | HTTP poll frequency (ms) |
| `HeartbeatIntervalMs` | `number` | `30000` | Heartbeat interval (ms) |
| `ReconnectIntervalMs` | `number` | `10000` | Reconnect delay (ms) |
| `StagingPath` | `string` | `process.cwd()` | Working directory for file transfer |
| `Tags` | `object` | `{}` | Metadata tags |

### Provider Loading

If `Providers` is specified, the client loads each descriptor via `ProviderRegistry.loadProvider()`. Otherwise, the legacy `Capabilities` array is converted to provider descriptors automatically (e.g. `['Shell', 'FileSystem']` becomes `[{ Source: 'Shell' }, { Source: 'FileSystem' }]`).

---

## start()

Start the beacon client: initialize providers, authenticate, register, and begin accepting work.

### Signature

```javascript
client.start(fCallback)
```

### Callback

```javascript
function (pError, pBeacon)
```

| Name | Type | Description |
|------|------|-------------|
| `pError` | `Error\|null` | Error if start failed |
| `pBeacon` | `object` | `{ BeaconID: '...' }` on success |

### Description

1. Initialize all providers via `providerRegistry.initializeAll()`
2. Authenticate with `POST /1.0/Authenticate`
3. Try WebSocket transport (if `ws` library is available)
4. Fall back to HTTP polling if WebSocket fails
5. Begin heartbeat at `HeartbeatIntervalMs`

### Transport Auto-Detection

The client automatically tries WebSocket first:

- If the `ws` npm package is installed and the server accepts the upgrade, the client registers over WebSocket and receives pushed work items.
- If WebSocket fails for any reason (library not installed, server doesn't support it, network blocks upgrades), the client falls back to HTTP polling transparently.
- No configuration flag is needed.

### Example

```javascript
let tmpClient = new libBeaconClient({
	ServerURL: 'http://localhost:54321',
	Name: 'my-worker',
	Capabilities: ['Shell', 'FileSystem'],
	MaxConcurrent: 4
});

tmpClient.start(function (pError, pBeacon)
{
	if (pError)
	{
		console.error('Start failed:', pError.message);
		return;
	}
	console.log('Worker online:', pBeacon.BeaconID);
});
```

---

## stop()

Stop the beacon client: stop polling, close WebSocket, shutdown providers, deregister.

### Signature

```javascript
client.stop(fCallback)
```

### Callback

```javascript
function (pError)
```

| Name | Type | Description |
|------|------|-------------|
| `pError` | `Error\|null` | Error if shutdown had issues (non-fatal) |

### Description

1. Stop poll and heartbeat intervals
2. Close WebSocket (sends `Deregister` message first)
3. Clean up affinity staging directories
4. Shut down all providers via `providerRegistry.shutdownAll()`
5. Deregister from the server via `DELETE /Beacon/{id}`

### Example

```javascript
process.on('SIGTERM', function ()
{
	tmpClient.stop(function (pError)
	{
		console.log('Worker stopped.');
		process.exit(0);
	});
});
```

---

## Reconnection

The client handles disconnection automatically:

**HTTP transport** — On a `401 Unauthorized` response, the client re-authenticates, re-registers, and restarts polling.

**WebSocket transport** — On connection close, the client:

1. Re-authenticates (new session cookie)
2. Tries WebSocket reconnection
3. If WebSocket fails, falls back to HTTP polling
4. If HTTP also fails, retries after `ReconnectIntervalMs`

No user intervention is needed. The beacon recovers silently.

---

## WebSocket Protocol

When connected via WebSocket, the client uses JSON messages:

### Client → Server

| Action | Fields | Description |
|--------|--------|-------------|
| `BeaconRegister` | `Name`, `Capabilities`, `MaxConcurrent`, `Tags` | Register the beacon |
| `BeaconHeartbeat` | `BeaconID` | Keep-alive heartbeat |
| `WorkComplete` | `WorkItemHash`, `Outputs`, `Log` | Report successful execution |
| `WorkError` | `WorkItemHash`, `ErrorMessage`, `Log` | Report execution failure |
| `WorkProgress` | `WorkItemHash`, `ProgressData` | Report execution progress |
| `Deregister` | `BeaconID` | Deregister before disconnect |

### Server → Client

| EventType | Fields | Description |
|-----------|--------|-------------|
| `BeaconRegistered` | `BeaconID` | Registration confirmation |
| `WorkItem` | `WorkItem` | Pushed work item to execute |
| `Deregistered` | — | Server-initiated deregistration |
