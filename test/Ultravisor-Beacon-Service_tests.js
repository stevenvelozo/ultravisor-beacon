/**
 * Ultravisor Beacon Service Tests
 *
 * Tests the Fable service layer: CapabilityManager, CapabilityAdapter,
 * ConnectivityHTTP, and the main BeaconService.
 *
 * NOTE: These tests do NOT require a running Ultravisor server.
 * They verify the service registration, capability management, and
 * adapter bridging logic in isolation.
 */

const libAssert = require('assert');

const libCapabilityProvider = require('../source/Ultravisor-Beacon-CapabilityProvider.cjs');
const libCapabilityAdapter = require('../source/Ultravisor-Beacon-CapabilityAdapter.cjs');
const libCapabilityManager = require('../source/Ultravisor-Beacon-CapabilityManager.cjs');
const libConnectivityHTTP = require('../source/Ultravisor-Beacon-ConnectivityHTTP.cjs');
const libProviderRegistry = require('../source/Ultravisor-Beacon-ProviderRegistry.cjs');

// We can require the service without Fable for standalone testing
const libBeaconService = require('../source/Ultravisor-Beacon-Service.cjs');

suite
(
	'Ultravisor Beacon',
	function ()
	{
		// ============================================================
		// CapabilityProvider Base Class
		// ============================================================
		suite
		(
			'CapabilityProvider Base',
			function ()
			{
				test
				(
					'Should instantiate with defaults',
					function ()
					{
						let tmpProvider = new libCapabilityProvider();
						libAssert.strictEqual(tmpProvider.Name, 'BaseProvider');
						libAssert.strictEqual(tmpProvider.Capability, 'Unknown');
						libAssert.deepStrictEqual(tmpProvider.actions, {});
						libAssert.deepStrictEqual(tmpProvider.getCapabilities(), ['Unknown']);
					}
				);

				test
				(
					'Should return error from default execute',
					function (fDone)
					{
						let tmpProvider = new libCapabilityProvider();
						tmpProvider.execute('DoSomething', {}, {}, function (pError)
						{
							libAssert.ok(pError);
							libAssert.ok(pError.message.includes('has not implemented execute()'));
							fDone();
						});
					}
				);

				test
				(
					'Should have no-op initialize and shutdown',
					function (fDone)
					{
						let tmpProvider = new libCapabilityProvider();
						tmpProvider.initialize(function (pError)
						{
							libAssert.ifError(pError);
							tmpProvider.shutdown(function (pError2)
							{
								libAssert.ifError(pError2);
								fDone();
							});
						});
					}
				);
			}
		);

		// ============================================================
		// CapabilityAdapter
		// ============================================================
		suite
		(
			'CapabilityAdapter',
			function ()
			{
				test
				(
					'Should create adapter from descriptor',
					function ()
					{
						let tmpAdapter = new libCapabilityAdapter({
							Capability: 'TestCap',
							Name: 'TestProvider',
							actions: {
								'DoThing': {
									Description: 'Does a thing',
									SettingsSchema: [{ Name: 'Input', DataType: 'String' }],
									Handler: function () {}
								}
							}
						});

						libAssert.strictEqual(tmpAdapter.Name, 'TestProvider');
						libAssert.strictEqual(tmpAdapter.Capability, 'TestCap');
						libAssert.deepStrictEqual(tmpAdapter.getCapabilities(), ['TestCap']);

						let tmpActions = tmpAdapter.actions;
						libAssert.ok(tmpActions.DoThing);
						libAssert.strictEqual(tmpActions.DoThing.Description, 'Does a thing');
						// Handler should not leak into actions
						libAssert.strictEqual(tmpActions.DoThing.Handler, undefined);
					}
				);

				test
				(
					'Should be an instance of CapabilityProvider',
					function ()
					{
						let tmpAdapter = new libCapabilityAdapter({
							Capability: 'TestCap',
							Name: 'TestProvider',
							actions: {}
						});

						libAssert.ok(tmpAdapter instanceof libCapabilityProvider);
					}
				);

				test
				(
					'Should execute action via Handler',
					function (fDone)
					{
						let tmpHandlerCalled = false;

						let tmpAdapter = new libCapabilityAdapter({
							Capability: 'TestCap',
							Name: 'TestProvider',
							actions: {
								'ReadFile': {
									Description: 'Read a file',
									Handler: function (pWorkItem, pContext, fCallback)
									{
										tmpHandlerCalled = true;
										fCallback(null, {
											Outputs: { Content: 'Hello World' },
											Log: ['Read complete']
										});
									}
								}
							}
						});

						let tmpWorkItem = { WorkItemHash: 'test-123', Settings: { FilePath: '/tmp/test.md' } };
						let tmpContext = { StagingPath: '/tmp' };

						tmpAdapter.execute('ReadFile', tmpWorkItem, tmpContext, function (pError, pResult)
						{
							libAssert.ifError(pError);
							libAssert.ok(tmpHandlerCalled);
							libAssert.strictEqual(pResult.Outputs.Content, 'Hello World');
							libAssert.strictEqual(pResult.Log[0], 'Read complete');
							fDone();
						});
					}
				);

				test
				(
					'Should error on unknown action',
					function (fDone)
					{
						let tmpAdapter = new libCapabilityAdapter({
							Capability: 'TestCap',
							Name: 'TestProvider',
							actions: {}
						});

						tmpAdapter.execute('NonExistent', {}, {}, function (pError)
						{
							libAssert.ok(pError);
							libAssert.ok(pError.message.includes('no Handler'));
							fDone();
						});
					}
				);

				test
				(
					'Should delegate initialize and shutdown',
					function (fDone)
					{
						let tmpInitCalled = false;
						let tmpShutdownCalled = false;

						let tmpAdapter = new libCapabilityAdapter({
							Capability: 'TestCap',
							Name: 'TestProvider',
							actions: {},
							initialize: function (fCallback)
							{
								tmpInitCalled = true;
								fCallback(null);
							},
							shutdown: function (fCallback)
							{
								tmpShutdownCalled = true;
								fCallback(null);
							}
						});

						tmpAdapter.initialize(function (pError)
						{
							libAssert.ifError(pError);
							libAssert.ok(tmpInitCalled);

							tmpAdapter.shutdown(function (pError2)
							{
								libAssert.ifError(pError2);
								libAssert.ok(tmpShutdownCalled);
								fDone();
							});
						});
					}
				);

				test
				(
					'Should catch Handler exceptions',
					function (fDone)
					{
						let tmpAdapter = new libCapabilityAdapter({
							Capability: 'TestCap',
							Name: 'TestProvider',
							actions: {
								'Boom': {
									Description: 'Throws',
									Handler: function ()
									{
										throw new Error('Intentional explosion');
									}
								}
							}
						});

						tmpAdapter.execute('Boom', {}, {}, function (pError)
						{
							libAssert.ok(pError);
							libAssert.strictEqual(pError.message, 'Intentional explosion');
							fDone();
						});
					}
				);
			}
		);

		// ============================================================
		// CapabilityManager
		// ============================================================
		suite
		(
			'CapabilityManager',
			function ()
			{
				test
				(
					'Should register and list capabilities',
					function ()
					{
						let tmpManager = new libCapabilityManager();

						tmpManager.registerCapability({
							Capability: 'ContentSystem',
							Name: 'ContentProvider',
							actions: {
								'ReadFile': { Description: 'Read', Handler: function () {} }
							}
						});

						tmpManager.registerCapability({
							Capability: 'MediaProcessing',
							Name: 'MediaProvider',
							actions: {
								'GenThumbnail': { Description: 'Thumbnail', Handler: function () {} }
							}
						});

						let tmpNames = tmpManager.getCapabilityNames();
						libAssert.strictEqual(tmpNames.length, 2);
						libAssert.ok(tmpNames.includes('ContentSystem'));
						libAssert.ok(tmpNames.includes('MediaProcessing'));
					}
				);

				test
				(
					'Should reject descriptor without Capability',
					function ()
					{
						let tmpManager = new libCapabilityManager();
						let tmpResult = tmpManager.registerCapability({ Name: 'BadProvider' });
						libAssert.strictEqual(tmpResult, false);
						libAssert.strictEqual(tmpManager.getCapabilityNames().length, 0);
					}
				);

				test
				(
					'Should remove capabilities',
					function ()
					{
						let tmpManager = new libCapabilityManager();

						tmpManager.registerCapability({
							Capability: 'TestCap',
							actions: { 'Do': { Handler: function () {} } }
						});

						libAssert.strictEqual(tmpManager.getCapabilityNames().length, 1);

						tmpManager.removeCapability('TestCap');
						libAssert.strictEqual(tmpManager.getCapabilityNames().length, 0);
					}
				);

				test
				(
					'Should build provider descriptors as adapter instances',
					function ()
					{
						let tmpManager = new libCapabilityManager();

						tmpManager.registerCapability({
							Capability: 'ContentSystem',
							Name: 'ContentProvider',
							actions: {
								'ReadFile': { Description: 'Read', Handler: function () {} },
								'SaveFile': { Description: 'Save', Handler: function () {} }
							}
						});

						let tmpDescriptors = tmpManager.buildProviderDescriptors();
						libAssert.strictEqual(tmpDescriptors.length, 1);

						let tmpAdapter = tmpDescriptors[0];
						libAssert.ok(tmpAdapter instanceof libCapabilityProvider);
						libAssert.strictEqual(tmpAdapter.Capability, 'ContentSystem');

						let tmpActions = tmpAdapter.actions;
						libAssert.ok(tmpActions.ReadFile);
						libAssert.ok(tmpActions.SaveFile);
					}
				);

				test
				(
					'Built adapters should be registrable with ProviderRegistry',
					function ()
					{
						let tmpManager = new libCapabilityManager();

						tmpManager.registerCapability({
							Capability: 'TestCap',
							Name: 'TestProvider',
							actions: {
								'DoThing': { Description: 'Do a thing', Handler: function () {} }
							}
						});

						let tmpDescriptors = tmpManager.buildProviderDescriptors();
						let tmpRegistry = new libProviderRegistry();

						let tmpResult = tmpRegistry.registerProvider(tmpDescriptors[0]);
						libAssert.strictEqual(tmpResult, true);

						let tmpCapabilities = tmpRegistry.getCapabilities();
						libAssert.ok(tmpCapabilities.includes('TestCap'));

						let tmpResolved = tmpRegistry.resolve('TestCap', 'DoThing');
						libAssert.ok(tmpResolved);
						libAssert.strictEqual(tmpResolved.action, 'DoThing');
					}
				);
			}
		);

		// ============================================================
		// ConnectivityHTTP
		// ============================================================
		suite
		(
			'ConnectivityHTTP',
			function ()
			{
				test
				(
					'Should return transport config',
					function ()
					{
						let tmpConn = new libConnectivityHTTP({
							ServerURL: 'http://myserver:9999',
							Password: 'secret',
							PollIntervalMs: 3000
						});

						let tmpConfig = tmpConn.getTransportConfig();
						libAssert.strictEqual(tmpConfig.ServerURL, 'http://myserver:9999');
						libAssert.strictEqual(tmpConfig.Password, 'secret');
						libAssert.strictEqual(tmpConfig.PollIntervalMs, 3000);
					}
				);

				test
				(
					'Should report HTTP transport type',
					function ()
					{
						let tmpConn = new libConnectivityHTTP();
						libAssert.strictEqual(tmpConn.getTransportType(), 'HTTP');
					}
				);

				test
				(
					'Should use defaults',
					function ()
					{
						let tmpConn = new libConnectivityHTTP();
						let tmpConfig = tmpConn.getTransportConfig();
						libAssert.strictEqual(tmpConfig.ServerURL, 'http://localhost:54321');
						libAssert.strictEqual(tmpConfig.PollIntervalMs, 5000);
						libAssert.strictEqual(tmpConfig.HeartbeatIntervalMs, 30000);
					}
				);
			}
		);

		// ============================================================
		// Beacon Service (standalone, no Fable)
		// ============================================================
		suite
		(
			'BeaconService Standalone',
			function ()
			{
				test
				(
					'Should instantiate without Fable',
					function ()
					{
						let tmpService = new libBeaconService({
							ServerURL: 'http://localhost:54321',
							Name: 'test-beacon'
						});

						libAssert.strictEqual(tmpService.serviceType, 'UltravisorBeacon');
						libAssert.strictEqual(tmpService.isEnabled(), false);
						libAssert.strictEqual(tmpService.options.ServerURL, 'http://localhost:54321');
					}
				);

				test
				(
					'Should register capabilities via public API',
					function ()
					{
						let tmpService = new libBeaconService({ Name: 'test' });

						let tmpResult = tmpService.registerCapability({
							Capability: 'ContentSystem',
							Name: 'ContentProvider',
							actions: {
								'ReadFile': { Description: 'Read', Handler: function () {} }
							}
						});

						// Should be chainable
						libAssert.strictEqual(tmpResult, tmpService);

						let tmpNames = tmpService.getCapabilityNames();
						libAssert.strictEqual(tmpNames.length, 1);
						libAssert.strictEqual(tmpNames[0], 'ContentSystem');
					}
				);

				test
				(
					'Should chain multiple registerCapability calls',
					function ()
					{
						let tmpService = new libBeaconService({ Name: 'test' });

						tmpService
							.registerCapability({
								Capability: 'ContentSystem',
								actions: { 'Read': { Handler: function () {} } }
							})
							.registerCapability({
								Capability: 'MediaProcessing',
								actions: { 'Thumb': { Handler: function () {} } }
							});

						libAssert.strictEqual(tmpService.getCapabilityNames().length, 2);
					}
				);

				test
				(
					'Should export sub-components',
					function ()
					{
						libAssert.ok(libBeaconService.BeaconClient);
						libAssert.ok(libBeaconService.CapabilityManager);
						libAssert.ok(libBeaconService.CapabilityAdapter);
						libAssert.ok(libBeaconService.CapabilityProvider);
						libAssert.ok(libBeaconService.ProviderRegistry);
						libAssert.ok(libBeaconService.ConnectivityHTTP);
					}
				);

				test
				(
					'Should report not enabled when disable called without enable',
					function (fDone)
					{
						let tmpService = new libBeaconService({ Name: 'test' });

						tmpService.disable(function (pError)
						{
							libAssert.ifError(pError);
							libAssert.strictEqual(tmpService.isEnabled(), false);
							fDone();
						});
					}
				);

				test
				(
					'Should return null thin client when not enabled',
					function ()
					{
						let tmpService = new libBeaconService({ Name: 'test' });
						libAssert.strictEqual(tmpService.getThinClient(), null);
					}
				);
			}
		);

		// ============================================================
		// Integration: Full adapter round-trip
		// ============================================================
		suite
		(
			'Integration',
			function ()
			{
				test
				(
					'Capability registered with service should be executable through adapter',
					function (fDone)
					{
						let tmpService = new libBeaconService({ Name: 'integration-test' });

						tmpService.registerCapability({
							Capability: 'TestSystem',
							Name: 'TestProvider',
							actions: {
								'Greet': {
									Description: 'Say hello',
									SettingsSchema: [{ Name: 'Name', DataType: 'String' }],
									Handler: function (pWorkItem, pContext, fCallback)
									{
										let tmpName = pWorkItem.Settings.Name || 'World';
										fCallback(null, {
											Outputs: { Greeting: `Hello, ${tmpName}!` },
											Log: ['Greeted successfully']
										});
									}
								}
							}
						});

						// Build adapters and test them directly
						let tmpAdapters = tmpService.getCapabilityManager().buildProviderDescriptors();
						libAssert.strictEqual(tmpAdapters.length, 1);

						let tmpAdapter = tmpAdapters[0];
						let tmpWorkItem = { WorkItemHash: 'int-test-1', Settings: { Name: 'Ultravisor' } };

						tmpAdapter.execute('Greet', tmpWorkItem, {}, function (pError, pResult)
						{
							libAssert.ifError(pError);
							libAssert.strictEqual(pResult.Outputs.Greeting, 'Hello, Ultravisor!');
							fDone();
						});
					}
				);
			}
		);
	}
);
