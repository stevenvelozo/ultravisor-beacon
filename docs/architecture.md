# Architecture

Ultravisor Beacon is designed as a composable system of small, focused classes. The Fable service wrapper (`BeaconService`) provides a high-level API for host applications, while the thin client (`BeaconClient`) handles transport, polling, and execution independently.

## Class Hierarchy

```mermaid
graph TD
    BS[BeaconService<br/><small>Fable service wrapper</small>]
    CM[CapabilityManager<br/><small>Host app capabilities</small>]
    CA[CapabilityAdapter<br/><small>Descriptor → Provider bridge</small>]
    CS[ConnectivityHTTP<br/><small>Transport config</small>]
    BC[BeaconClient<br/><small>Thin client</small>]
    EX[Executor<br/><small>Work item router</small>]
    PR[ProviderRegistry<br/><small>Provider index</small>]
    CP[CapabilityProvider<br/><small>Base class</small>]
    SP[Shell Provider]
    FP[FileSystem Provider]
    LP[LLM Provider]
    UP[Custom Provider]

    BS --> CM
    BS --> CS
    BS --> BC

    CM -->|buildProviderDescriptors| CA
    CA -->|registerProvider| PR

    BC --> EX
    EX --> PR

    PR --> SP
    PR --> FP
    PR --> LP
    PR --> UP

    CP -.->|extends| SP
    CP -.->|extends| FP
    CP -.->|extends| LP
    CP -.->|extends| UP
    CP -.->|extends| CA
```

### Component Responsibilities

| Component | Responsibility |
|-----------|----------------|
| **BeaconService** | Fable service lifecycle, capability registration, thin client creation |
| **CapabilityManager** | Stores capability descriptors from the host application |
| **CapabilityAdapter** | Bridges host-app descriptors to the CapabilityProvider interface |
| **BeaconClient** | Authentication, transport negotiation, polling/WebSocket, heartbeat |
| **Executor** | Routes work items to providers, handles file transfer |
| **ProviderRegistry** | Indexes providers by `Capability:Action`, resolves work items to handlers |
| **CapabilityProvider** | Base class for all providers (built-in and custom) |

## Transport Flow

The beacon automatically negotiates the best transport. No configuration is needed — the decision happens at runtime.

```mermaid
sequenceDiagram
    participant B as Beacon Client
    participant S as Ultravisor Server

    B->>S: POST /1.0/Authenticate
    S-->>B: 200 + session cookie

    alt WebSocket available
        B->>S: WebSocket upgrade (with cookie)
        S-->>B: Connection established
        B->>S: { Action: BeaconRegister, ... }
        S-->>B: { EventType: BeaconRegistered, BeaconID }
        Note over B,S: Push-based dispatch
        S->>B: { EventType: WorkItem, WorkItem: {...} }
        B->>S: { Action: WorkComplete, ... }
    else WebSocket unavailable
        B->>S: POST /Beacon/Register
        S-->>B: { BeaconID }
        Note over B,S: HTTP polling
        loop Every PollIntervalMs
            B->>S: POST /Beacon/Work/Poll
            S-->>B: { WorkItem } or empty
        end
        B->>S: POST /Beacon/Work/{hash}/Complete
    end

    Note over B: On disconnect: re-auth → try WS → fallback HTTP
```

### Reconnection Behavior

When a WebSocket connection drops:

1. Re-authenticate (get a new session cookie)
2. Attempt WebSocket reconnection
3. If WebSocket fails, fall back to HTTP polling
4. If HTTP also fails, retry after `ReconnectIntervalMs`

The coordinator does not track transport type per beacon. When dispatching a work item, it simply checks if a live WebSocket exists for the target beacon. If not, the work item stays in the queue for polling.

## Work Item Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Pending: Enqueued by coordinator

    Pending --> Running: Assigned to beacon
    Pending --> Running: Pushed via WebSocket

    Running --> Complete: Execution succeeded
    Running --> Error: Execution failed

    Complete --> [*]
    Error --> [*]

    note right of Pending
        Coordinator checks all online
        beacons for capacity + capability
        match, tries WebSocket push first
    end note

    note right of Running
        Beacon downloads source files,
        routes to provider, collects
        output, reports progress
    end note
```

### Execution Pipeline

When the Executor receives a work item:

1. **Resolve** — `ProviderRegistry.resolve(Capability, Action)` finds the provider
2. **Download** — If `SourceURL` is set, download the source file (with affinity caching)
3. **Substitute** — Replace `{SourcePath}` and `{OutputPath}` in the command string
4. **Execute** — Call `provider.execute(action, workItem, context, callback, progress)`
5. **Collect** — If `OutputFilename` + `ReturnOutputAsBase64`, encode and attach output
6. **Report** — Send completion/error/progress to the server (via WebSocket or HTTP)

### File Transfer and Affinity

Work items can include file transfer directives:

- **`SourceURL`** — URL to download before execution
- **`SourceFilename`** — Local name for the downloaded file
- **`OutputFilename`** — Expected output file to collect after execution
- **`ReturnOutputAsBase64`** — Encode the output file into the result
- **`AffinityKey`** — Cache downloaded files across work items with the same key

Affinity directories (`affinity-{key}`) persist across work items, avoiding redundant downloads when the same source file is processed multiple times. Work directories (`work-{hash}`) are cleaned up after each work item completes. All affinity directories are cleaned at beacon shutdown.

## Provider Loading

The `ProviderRegistry` supports three provider source types:

| Source Format | Resolution |
|---------------|------------|
| `'Shell'`, `'FileSystem'`, `'LLM'` | Built-in: loaded from `./providers/` |
| `'./my-provider.cjs'` or `/absolute/path` | Local file: `require(resolved path)` |
| `'ultravisor-provider-ml'` | npm package: `require(name)` |

Provider exports can be:

- **Class** — with `execute()` on the prototype → instantiated with config
- **Factory function** — called with config → returns provider instance
- **Pre-instantiated object** — with `execute()` method → registered directly
