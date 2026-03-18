# FileSystem Provider

Local file operations on the beacon worker with configurable path restrictions.

**Capability:** `FileSystem`

## Configuration

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `AllowedPaths` | `string[]` | `[]` (allow all) | Path prefixes the provider may access |
| `MaxFileSizeBytes` | `number` | `104857600` (100 MB) | Maximum file size for read/write |

```javascript
{ Source: 'FileSystem', Config: { AllowedPaths: ['/data', '/tmp'], MaxFileSizeBytes: 52428800 } }
```

### Path Security

When `AllowedPaths` is non-empty, every file operation validates that the resolved absolute path starts with one of the allowed prefixes. Operations on paths outside the allowed list return `ExitCode: -1`.

---

## Actions

### Read

Read a file from disk.

#### Settings

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `FilePath` | `string` | Yes | Path to the file |
| `Encoding` | `string` | No | File encoding (default: `'utf8'`) |

#### Outputs

| Name | Type | Description |
|------|------|-------------|
| `StdOut` | `string` | Status message with bytes read |
| `ExitCode` | `number` | `0` on success |
| `Result` | `string` | File contents |

#### Example

```javascript
// Work item settings
{ FilePath: '/data/config.json', Encoding: 'utf8' }

// Result
{
	Outputs: { StdOut: 'Read 1234 bytes from /data/config.json', ExitCode: 0, Result: '{"key": "value"}' },
	Log: ['FileSystem Read: read 1234 bytes from /data/config.json']
}
```

---

### Write

Write content to a file on disk. Creates parent directories if they don't exist.

#### Settings

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `FilePath` | `string` | Yes | Path to the output file |
| `Content` | `string` | Yes | Content to write |
| `Encoding` | `string` | No | File encoding (default: `'utf8'`) |

#### Outputs

| Name | Type | Description |
|------|------|-------------|
| `StdOut` | `string` | Status message with bytes written |
| `ExitCode` | `number` | `0` on success |
| `Result` | `string` | Written file path |

#### Example

```javascript
// Work item settings
{ FilePath: '/data/output.txt', Content: 'Hello, world!' }

// Result
{
	Outputs: { StdOut: 'Wrote 13 bytes to /data/output.txt', ExitCode: 0, Result: '/data/output.txt' },
	Log: ['FileSystem Write: wrote 13 bytes to /data/output.txt']
}
```

---

### List

List files in a directory with optional glob-style filtering.

#### Settings

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `Folder` | `string` | Yes | Directory path to list |
| `Pattern` | `string` | No | Glob-style filter (e.g. `'*.txt'`, `'report_*'`) |

#### Outputs

| Name | Type | Description |
|------|------|-------------|
| `StdOut` | `string` | Status message with file count |
| `ExitCode` | `number` | `0` on success |
| `Result` | `string` | JSON array of matching filenames |

#### Example

```javascript
// Work item settings
{ Folder: '/data/reports', Pattern: '*.csv' }

// Result
{
	Outputs: { StdOut: 'Found 3 files in /data/reports', ExitCode: 0, Result: '["q1.csv","q2.csv","q3.csv"]' },
	Log: ['FileSystem List: found 3 files in /data/reports']
}
```

---

### Copy

Copy a file from source to target. Creates parent directories for the target if needed.

#### Settings

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `Source` | `string` | Yes | Source file path |
| `TargetFile` | `string` | Yes | Target file path |

#### Outputs

| Name | Type | Description |
|------|------|-------------|
| `StdOut` | `string` | Status message |
| `ExitCode` | `number` | `0` on success |
| `Result` | `string` | Target file path |

#### Example

```javascript
// Work item settings
{ Source: '/data/original.pdf', TargetFile: '/backup/original.pdf' }

// Result
{
	Outputs: { StdOut: 'Copied /data/original.pdf → /backup/original.pdf', ExitCode: 0, Result: '/backup/original.pdf' },
	Log: ['FileSystem Copy: copied /data/original.pdf → /backup/original.pdf']
}
```

---

## Notes

- Relative paths are resolved against the beacon's `StagingPath`.
- Both `Source` and `TargetFile` paths are validated against `AllowedPaths` for the Copy action.
- Non-string `Content` values in Write are JSON-serialized with tab indentation before writing.
- Pattern matching converts `*` to `.*` and `?` to `.` for regex filtering.
