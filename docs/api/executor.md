# Executor

Routes work items to the appropriate capability provider and handles file transfer (download, path substitution, output collection, affinity caching).

## Constructor

```javascript
const libExecutor = require('ultravisor-beacon/source/Ultravisor-Beacon-Executor.cjs');

let tmpExecutor = new libExecutor({ StagingPath: '/tmp/staging' });
```

### Config

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `StagingPath` | `string` | `process.cwd()` | Base directory for work and affinity directories |

---

## providerRegistry

Getter for the `ProviderRegistry` instance. Used by `BeaconClient` for capability listing and provider lifecycle.

### Signature

```javascript
executor.providerRegistry
```

### Returns

`UltravisorBeaconProviderRegistry`

---

## execute()

Execute a work item by routing to the appropriate provider.

### Signature

```javascript
executor.execute(pWorkItem, fCallback, fReportProgress)
```

### Parameters

| Name | Type | Description |
|------|------|-------------|
| `pWorkItem` | `object` | Work item from the server |
| `fCallback` | `function` | `function(pError, pResult)` |
| `fReportProgress` | `function` | Optional: `function(pProgressData)` |

### Work Item Shape

```javascript
{
	WorkItemHash: '0x1234abcd',
	Capability: 'Shell',
	Action: 'Execute',
	Settings:
	{
		Command: 'echo hello',
		SourceURL: 'http://example.com/input.txt',    // optional
		SourceFilename: 'input.txt',                   // optional
		OutputFilename: 'output.txt',                  // optional
		ReturnOutputAsBase64: true,                    // optional
		AffinityKey: 'job-123'                         // optional
	},
	TimeoutMs: 300000
}
```

### Result Shape

```javascript
{
	Outputs:
	{
		StdOut: 'Command output',
		ExitCode: 0,
		Result: 'Primary result',
		OutputData: 'base64...',        // if ReturnOutputAsBase64
		OutputFilename: 'output.txt',   // if OutputFilename
		OutputSize: 12345               // if ReturnOutputAsBase64
	},
	Log: ['Log entry 1', 'Log entry 2']
}
```

### Description

1. **Resolve** — Finds the provider via `ProviderRegistry.resolve(Capability, Action)`
2. **Check file transfer** — If `SourceURL` or `OutputFilename` is set, delegates to the file transfer pipeline
3. **Execute** — Calls `provider.execute(action, workItem, context, callback, progress)`

If no provider matches, returns an error result with `ExitCode: -1`.

### File Transfer Pipeline

When file transfer settings are present:

1. **Download** — Fetches `SourceURL` to a local path (affinity-cached or per-work-item)
2. **Substitute** — Replaces `{SourcePath}` and `{OutputPath}` in `Settings.Command`
3. **Execute** — Runs the provider
4. **Collect** — If `OutputFilename` + `ReturnOutputAsBase64`, reads and base64-encodes the output file
5. **Cleanup** — Removes the per-work-item directory (affinity directories persist)

### Example

```javascript
tmpExecutor.execute(
	{
		WorkItemHash: '0xabc123',
		Capability: 'Shell',
		Action: 'Execute',
		Settings:
		{
			Command: 'wc -l {SourcePath}',
			SourceURL: 'http://files.example.com/data.csv',
			SourceFilename: 'data.csv',
			AffinityKey: 'dataset-v1'
		}
	},
	function (pError, pResult)
	{
		console.log('Line count:', pResult.Outputs.Result);
	});
```

---

## cleanupAffinityDirs()

Remove all affinity staging directories. Called during beacon shutdown.

### Signature

```javascript
executor.cleanupAffinityDirs()
```

### Description

Scans `StagingPath` for directories starting with `affinity-` and removes them recursively. Errors are logged but do not throw.

---

## Notes

- The `{SourcePath}` and `{OutputPath}` substitutions happen in the `Settings.Command` string before the provider sees it. Providers receive the already-substituted command.
- Affinity directories use a sanitized version of the `AffinityKey` (alphanumeric, underscores, hyphens; max 64 chars) as the directory name.
- File downloads follow HTTP redirects automatically.
- Download failures return an error result without calling the provider.
