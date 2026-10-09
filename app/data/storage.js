(function (root) {
  'use strict';

  var CA = (root.CareerAgent = root.CareerAgent || {});
  CA.data = CA.data || {};

  // 浏览器 localStorage 驱动。localStorage 只在本文件被访问。
  function createBrowserDriver(win) {
    var listeners = [];
    function store() {
      return win.localStorage;
    }
    if (win.addEventListener) {
      win.addEventListener('storage', function (event) {
        listeners.forEach(function (fn) {
          fn({ key: event.key, newValue: event.newValue });
        });
      });
    }
    return {
      kind: 'browser',
      getItem: function (key) {
        return store().getItem(key);
      },
      setItem: function (key, value) {
        store().setItem(key, value);
      },
      removeItem: function (key) {
        store().removeItem(key);
      },
      onExternalChange: function (fn) {
        listeners.push(fn);
      }
    };
  }

  // 隔离测试驱动：只存在于内存，不读写真实 localStorage，用于故障场景验收。
  function createMemoryDriver(options) {
    var map = Object.create(null);
    var listeners = [];
    var faults = {
      probeFails: !!options.probeFails,
      failWrites: false,
      failBusinessWrites: !!options.failBusinessWrites,
      failReads: 0
    };
    Object.keys(options.preload || {}).forEach(function (key) {
      map[key] = options.preload[key];
    });
    function unavailable() {
      var err = new Error('测试场景：存储不可用');
      err.name = 'SecurityError';
      return err;
    }
    return {
      kind: 'memory',
      faults: faults,
      getItem: function (key) {
        if (faults.probeFails) throw unavailable();
        if (faults.failReads > 0) {
          faults.failReads -= 1;
          throw new Error('测试场景：读取失败');
        }
        return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null;
      },
      setItem: function (key, value) {
        if (faults.probeFails) throw unavailable();
        if (faults.failWrites) {
          var err = new Error('测试场景：写入失败（模拟超出配额）');
          err.name = 'QuotaExceededError';
          throw err;
        }
        // 探测键可写，但业务键写入失败：用于验收“探测成功但首次播种失败”。
        if (faults.failBusinessWrites && key !== CA.domain.constants.STORAGE_PROBE_KEY) {
          var err2 = new Error('测试场景：业务键写入失败');
          err2.name = 'QuotaExceededError';
          throw err2;
        }
        map[key] = String(value);
      },
      removeItem: function (key) {
        if (faults.probeFails) throw unavailable();
        delete map[key];
      },
      onExternalChange: function (fn) {
        listeners.push(fn);
      },
      peek: function (key) {
        return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null;
      },
      simulateExternalWrite: function (key, value) {
        map[key] = value;
        listeners.forEach(function (fn) {
          fn({ key: key, newValue: value });
        });
      }
    };
  }

  var TEST_SCENARIOS = {
    isolated: '隔离存储（空白开始，可注入写入失败与外部改动）',
    unavailable: '启动时存储不可用',
    corrupt: '本地数据损坏',
    incompatible: '本地数据版本不兼容',
    load_error: '首次读取失败',
    slow: '读取较慢',
    empty: '无岗位与待办的数据集',
    bad_evidence: '评估 evidence 为 null（结构损坏）'
  };

  function emptyEnvelope() {
    var env = CA.fixtures.demo.createEnvelope();
    ['jobs', 'assessments', 'applications', 'interviews', 'actionItems', 'events', 'documents', 'documentVersions', 'files'].forEach(function (name) {
      env.data[name] = [];
    });
    return env;
  }

  // 根据 URL 的 ?test= 参数选择驱动；正常访问一律使用浏览器 localStorage。
  function createDriverFromLocation(win) {
    var scenario = null;
    try {
      scenario = new URLSearchParams(win.location.search).get('test');
    } catch (e) {
      scenario = null;
    }
    if (!scenario) return { driver: createBrowserDriver(win), scenario: null, hooks: { loadDelayMs: 0, failLoads: 0 } };

    if (!TEST_SCENARIOS[scenario]) scenario = 'isolated';
    var key = CA.domain.constants.STORAGE_KEY;
    var preload = {};
    var hooks = { loadDelayMs: 0, failLoads: 0 };
    if (scenario === 'corrupt') preload[key] = '{"schemaVersion":"0.1","data":{"users":[{"id":"user_demo"';
    if (scenario === 'incompatible') preload[key] = JSON.stringify({ schemaVersion: '9.9', data: {}, ui: {} });
    if (scenario === 'empty') preload[key] = JSON.stringify(emptyEnvelope());
    if (scenario === 'bad_evidence') {
      var bad = CA.fixtures.demo.createEnvelope();
      bad.data.assessments[0].evidence = null;
      preload[key] = JSON.stringify(bad);
    }
    if (scenario === 'load_error') hooks.failLoads = 1;
    if (scenario === 'slow') hooks.loadDelayMs = 1500;

    var driver = createMemoryDriver({ preload: preload, probeFails: scenario === 'unavailable' });
    return { driver: driver, scenario: scenario, scenarioLabel: TEST_SCENARIOS[scenario], hooks: hooks };
  }

  CA.data.storage = {
    createBrowserDriver: createBrowserDriver,
    createMemoryDriver: createMemoryDriver,
    createDriverFromLocation: createDriverFromLocation,
    TEST_SCENARIOS: TEST_SCENARIOS,
    emptyEnvelope: emptyEnvelope
  };
})(typeof window !== 'undefined' ? window : globalThis);
