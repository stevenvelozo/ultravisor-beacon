#!/usr/bin/env node
/**
 * Ultravisor Beacon CLI
 *
 * Usage:
 *   node Ultravisor-Beacon-CLI.cjs --server http://localhost:54321 --name GPU-Worker-1 --capabilities Shell,FileSystem
 *
 * Options:
 *   --server URL          Ultravisor server URL (default: http://localhost:54321)
 *   --name NAME           Beacon worker name (default: beacon-worker)
 *   --capabilities LIST   Comma-separated capabilities (default: Shell)
 *   --password PASSWORD    Authentication password for server connection
 *
 * For advanced provider configuration, use a .ultravisor-beacon.json file
 * with a "Providers" array instead of --capabilities.
 *   --max-concurrent N    Max concurrent work items (default: 1)
 *   --poll-interval MS    Poll interval in ms (default: 5000)
 *   --staging-path PATH   Local staging directory (default: cwd)
 */

const libPath = require('path');
const libFS = require('fs');

const libBeaconClient = require('./Ultravisor-Beacon-Client.cjs');

// Parse command-line arguments
let tmpConfig = {
	ServerURL: 'http://localhost:54321',
	Name: 'beacon-worker',
	Capabilities: ['Shell'],
	MaxConcurrent: 1,
	PollIntervalMs: 5000,
	HeartbeatIntervalMs: 30000,
	StagingPath: process.cwd(),
	Password: '',
	Tags: {}
};

// Check for config file
let tmpConfigFilePath = libPath.resolve(process.cwd(), '.ultravisor-beacon.json');
if (libFS.existsSync(tmpConfigFilePath))
{
	try
	{
		let tmpFileConfig = JSON.parse(libFS.readFileSync(tmpConfigFilePath, 'utf8'));
		tmpConfig = Object.assign(tmpConfig, tmpFileConfig);
		console.log(`[Beacon CLI] Loaded config from ${tmpConfigFilePath}`);
	}
	catch (pError)
	{
		console.warn(`[Beacon CLI] Warning: could not parse ${tmpConfigFilePath}: ${pError.message}`);
	}
}

// Parse CLI arguments (override config file)
for (let i = 2; i < process.argv.length; i++)
{
	switch (process.argv[i])
	{
		case '--server':
			tmpConfig.ServerURL = process.argv[++i] || tmpConfig.ServerURL;
			break;
		case '--name':
			tmpConfig.Name = process.argv[++i] || tmpConfig.Name;
			break;
		case '--capabilities':
			tmpConfig.Capabilities = (process.argv[++i] || 'Shell').split(',').map(s => s.trim());
			break;
		case '--max-concurrent':
			tmpConfig.MaxConcurrent = parseInt(process.argv[++i]) || 1;
			break;
		case '--poll-interval':
			tmpConfig.PollIntervalMs = parseInt(process.argv[++i]) || 5000;
			break;
		case '--staging-path':
			tmpConfig.StagingPath = process.argv[++i] || process.cwd();
			break;
		case '--password':
			tmpConfig.Password = process.argv[++i] || '';
			break;
		case '--help':
		case '-h':
			console.log('Ultravisor Beacon Worker');
			console.log('');
			console.log('Usage: node Ultravisor-Beacon-CLI.cjs [options]');
			console.log('');
			console.log('Options:');
			console.log('  --server URL          Ultravisor server URL (default: http://localhost:54321)');
			console.log('  --name NAME           Beacon worker name (default: beacon-worker)');
			console.log('  --capabilities LIST   Comma-separated capabilities (default: Shell)');
			console.log('  --max-concurrent N    Max concurrent work items (default: 1)');
			console.log('  --poll-interval MS    Poll interval in ms (default: 5000)');
			console.log('  --staging-path PATH   Local staging directory (default: cwd)');
			console.log('  --password PASSWORD   Authentication password for server connection');
			console.log('  --help, -h            Show this help');
			console.log('');
			console.log('Provider Configuration:');
			console.log('  For advanced provider configuration, create a .ultravisor-beacon.json');
			console.log('  file with a "Providers" array:');
			console.log('');
			console.log('  {');
			console.log('    "Providers": [');
			console.log('      { "Source": "Shell" },');
			console.log('      { "Source": "FileSystem", "Config": { "AllowedPaths": ["/data"] } },');
			console.log('      { "Source": "./my-custom-provider.cjs", "Config": {} }');
			console.log('    ]');
			console.log('  }');
			process.exit(0);
	}
}

// Create and start the Beacon client
let tmpClient = new libBeaconClient(tmpConfig);

tmpClient.start((pError) =>
{
	if (pError)
	{
		console.error(`[Beacon CLI] Failed to start: ${pError.message}`);
		process.exit(1);
	}

	console.log(`[Beacon CLI] Beacon is running. Polling every ${tmpConfig.PollIntervalMs}ms.`);
	console.log(`[Beacon CLI] Press Ctrl+C to stop.`);
});

// Handle graceful shutdown
process.on('SIGINT', () =>
{
	console.log('\n[Beacon CLI] Shutting down...');
	tmpClient.stop(() =>
	{
		process.exit(0);
	});
});

process.on('SIGTERM', () =>
{
	tmpClient.stop(() =>
	{
		process.exit(0);
	});
});
