# ProviderRegistry

Manages loaded capability providers, routes work items to the correct provider based on `Capability:Action` composite keys, and aggregates the capabilities list for beacon registration.

## Constructor

```javascript
const libProviderRegistry = require('ultravisor-beacon').ProviderRegistry;

let tmpRegistry = new libProviderRegistry();
```

---

## registerProvider()

Register a provider instance. Indexes each action by `Capability:Action` composite key.

### Signature

```javascript
registry.registerProvider(pProvider)
```

### Parameters

| Name | Type | Description |
|------|------|-------------|
| `pProvider` | `object` | Provider instance (extends `CapabilityProvider` or duck-types it) |

### Returns

`boolean` — `true` if registered successfully.

### Description

- Requires `pProvider.Capability` to be set
- Indexes each action in `pProvider.actions` by `Capability:Action` key
- First declared action becomes the default for capability-only routing
- Calls `pProvider.getCapabilities()` to update the aggregate list
- Stores the provider by `pProvider.Name`

### Example

```javascript
let tmpShell = new ShellProvider({ MaxBufferBytes: 20971520 });
tmpRegistry.registerProvider(tmpShell);
```

---

## resolve()

Resolve a Capability+Action pair to a provider and action name.

### Signature

```javascript
registry.resolve(pCapability, pAction)
```

### Parameters

| Name | Type | Description |
|------|------|-------------|
| `pCapability` | `string` | The capability to match |
| `pAction` | `string` | Optional action within the capability |

### Returns

`{ provider: object, action: string } | null`

### Description

1. Tries exact `Capability:Action` match first
2. Falls back to the default action for the capability (first declared action)
3. Returns `null` if no provider matches

### Example

```javascript
let tmpResolved = tmpRegistry.resolve('Shell', 'Execute');
if (tmpResolved)
{
	tmpResolved.provider.execute(tmpResolved.action, pWorkItem, pContext, fCallback);
}
```

---

## getCapabilities()

Get the aggregate capabilities list for beacon registration.

### Signature

```javascript
registry.getCapabilities()
```

### Returns

`string[]` — Copy of the aggregate capabilities array.

---

## getProviders()

Get all loaded providers.

### Signature

```javascript
registry.getProviders()
```

### Returns

`object` — Map of provider `Name` → provider instance.

---

## loadProvider()

Load a provider from a source descriptor.

### Signature

```javascript
registry.loadProvider(pDescriptor)
```

### Parameters

| Name | Type | Description |
|------|------|-------------|
| `pDescriptor` | `object` | `{ Source: string, Config?: object }` |

### Source Resolution

| Format | Resolution |
|--------|------------|
| `'Shell'`, `'FileSystem'`, `'LLM'` | Built-in: loaded from `./providers/` |
| `'./my-provider.cjs'` or `/absolute/path` | Local file: `require(resolved path)` |
| `'ultravisor-provider-ml'` | npm package: `require(name)` |

### Export Formats

The loaded module can export:

| Export Type | Behavior |
|-------------|----------|
| Class with `execute()` on prototype | Instantiated with `Config` |
| Factory function | Called with `Config`, result registered |
| Object with `execute()` method | Registered directly (singleton) |

### Returns

`boolean` — `true` if loaded and registered successfully.

### Example

```javascript
tmpRegistry.loadProvider({ Source: 'Shell', Config: { MaxBufferBytes: 5242880 } });
tmpRegistry.loadProvider({ Source: './my-custom-provider.cjs', Config: { key: 'val' } });
tmpRegistry.loadProvider({ Source: 'ultravisor-provider-ml', Config: {} });
```

---

## loadProviders()

Load all providers from a config array.

### Signature

```javascript
registry.loadProviders(pDescriptors)
```

### Parameters

| Name | Type | Description |
|------|------|-------------|
| `pDescriptors` | `Array<{ Source, Config? }>` | Array of provider descriptors |

### Returns

`number` — Count of successfully loaded providers.

### Example

```javascript
let tmpCount = tmpRegistry.loadProviders([
	{ Source: 'Shell', Config: {} },
	{ Source: 'FileSystem', Config: { AllowedPaths: ['/data'] } }
]);
console.log('Loaded', tmpCount, 'providers');
```

---

## initializeAll()

Initialize all loaded providers sequentially. Called before the beacon starts polling.

### Signature

```javascript
registry.initializeAll(fCallback)
```

### Callback

```javascript
function (pError)
```

### Description

Iterates all providers in registration order. For each provider with an `initialize()` method, calls it and waits for the callback before proceeding. Stops on the first error.

---

## shutdownAll()

Shut down all loaded providers sequentially. Called when the beacon is stopping.

### Signature

```javascript
registry.shutdownAll(fCallback)
```

### Callback

```javascript
function (pError)
```

### Description

Iterates all providers in registration order. For each provider with a `shutdown()` method, calls it and waits. Continues through errors (last error is reported).
