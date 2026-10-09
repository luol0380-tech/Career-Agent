(function (root) {
  'use strict';

  var CA = (root.CareerAgent = root.CareerAgent || {});
  CA.components = CA.components || {};

  // hash 路由：#/home、#/vault[/assetId]、#/jobs[/jobId]、#/prepare?job=&goal=、
  // #/interviews?job=&goal=、#/interview/:id、#/progress/:kind；其余为 not_found。
  function parseHash(hash) {
    var raw = (hash || '').replace(/^#/, '');
    if (raw === '' || raw === '/') return { name: 'redirect_home', params: {}, query: {}, hash: '#/home' };
    var qIndex = raw.indexOf('?');
    var pathPart = qIndex >= 0 ? raw.slice(0, qIndex) : raw;
    var query = {};
    if (qIndex >= 0) {
      new URLSearchParams(raw.slice(qIndex + 1)).forEach(function (value, key) {
        query[key] = value;
      });
    }
    var segments = pathPart.split('/').filter(Boolean).map(function (s) {
      try {
        return decodeURIComponent(s);
      } catch (e) {
        return s;
      }
    });
    var route = { name: 'not_found', params: {}, query: query, hash: '#' + raw };
    var first = segments[0];
    if (first === 'home' && segments.length === 1) route.name = 'home';
    else if (first === 'vault' && segments.length <= 2) {
      route.name = 'vault';
      route.params.assetId = segments[1] || null;
    } else if (first === 'jobs' && segments.length <= 2) {
      route.name = 'jobs';
      route.params.jobId = segments[1] || null;
    } else if (first === 'prepare' && segments.length === 1) route.name = 'prepare';
    else if (first === 'resume' && segments.length === 1) route.name = 'resume';
    else if (first === 'resume' && segments.length === 2 && segments[1] === 'revise') route.name = 'resume_revise';
    else if (first === 'assistant' && segments.length === 1) route.name = 'assistant';
    else if (first === 'interviews' && segments.length === 1) route.name = 'interviews';
    else if (first === 'interview' && segments.length === 2) {
      route.name = 'interview';
      route.params.interviewId = segments[1];
    } else if (first === 'progress' && segments.length === 2) {
      route.name = 'progress';
      route.params.kind = segments[1];
    }
    return route;
  }

  function buildHash(path, query) {
    var parts = [];
    Object.keys(query || {}).forEach(function (key) {
      var value = query[key];
      if (value !== null && value !== undefined && value !== '') parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(value));
    });
    return '#' + path + (parts.length ? '?' + parts.join('&') : '');
  }

  // guard 返回 true 表示有未保存草稿；confirmLeave 返回 Promise<boolean>，true 表示放弃草稿并离开。
  function createRouter(options) {
    var currentHash = null;
    var guard = null;
    var skipNext = false;

    function handle() {
      var nextHash = root.location.hash || '#/';
      if (skipNext) {
        skipNext = false;
        currentHash = nextHash;
        options.onRoute(parseHash(nextHash));
        return;
      }
      if (guard && guard.isDirty() && currentHash !== null && nextHash !== currentHash) {
        var target = nextHash;
        root.history.replaceState(null, '', currentHash);
        guard.confirmLeave().then(function (leave) {
          if (!leave) return;
          guard.discard();
          go(target);
        });
        return;
      }
      var route = parseHash(nextHash);
      if (route.name === 'redirect_home') {
        root.history.replaceState(null, '', route.hash);
        currentHash = route.hash;
        options.onRoute(parseHash(route.hash));
        return;
      }
      currentHash = nextHash;
      options.onRoute(route);
    }

    function go(hash) {
      if (hash === currentHash) {
        options.onRoute(parseHash(hash));
        return;
      }
      skipNext = true;
      root.location.hash = hash;
    }

    return {
      start: function () {
        root.addEventListener('hashchange', handle);
        handle();
      },
      navigate: function (hash) {
        if (guard && guard.isDirty() && hash !== currentHash) {
          guard.confirmLeave().then(function (leave) {
            if (!leave) return;
            guard.discard();
            go(hash);
          });
          return;
        }
        go(hash);
      },
      current: function () {
        return parseHash(currentHash || root.location.hash);
      },
      setGuard: function (g) {
        guard = g;
      },
      clearGuard: function (g) {
        if (!g || guard === g) guard = null;
      },
      // 目标切换、重置等非路由操作：只询问是否允许离开，不在这里清空草稿。
      // 调用方在后续动作真正成功后再 discard；取消或失败时必须保持草稿与离开保护。
      confirmIfDirty: function () {
        if (!guard || !guard.isDirty()) return Promise.resolve(true);
        return guard.confirmLeave().then(function (leave) {
          return leave;
        });
      },
      discardDirty: function () {
        if (guard) guard.discard();
      }
    };
  }

  CA.components.router = { parseHash: parseHash, buildHash: buildHash, createRouter: createRouter };
})(window);
