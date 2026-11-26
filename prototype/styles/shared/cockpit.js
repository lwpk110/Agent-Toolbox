/* Shared Agent-Toolbox cockpit markup. Each style page only changes tokens. */
(function () {
  var I = {
    hub: '<rect x="8" y="8" width="8" height="8" rx="1.5"/><path d="M12 2v6M12 16v6M2 12h6M16 12h6"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/>',
    pause: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    block: '<path d="M12 3 2.5 20h19L12 3z"/><path d="M12 10v4M12 17h.01"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
    sync: '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M4 3v5h5M20 21v-5h-5"/>'
  };
  function icon(n) {
    return '<svg class="od-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + I[n] + '</svg>';
  }
  var dot = '<svg class="od-icon" viewBox="0 0 8 8" aria-hidden="true"><circle cx="4" cy="4" r="4" fill="currentColor"/></svg>';

  var hosts = [['Antigravity', '9ms'], ['Claude Code', '11ms'], ['Codex CLI', '14ms'], ['OpenCode', '8ms']];
  var configs = {
    antigravity: 'agent-toolbox install --host antigravity',
    claude: 'claude mcp add agent-toolbox -- npx agent-toolbox serve --stdio',
    codex: '# ~/.codex/config.toml\n[mcp_servers.agent-toolbox]\ncommand = "npx"\nargs = ["agent-toolbox", "serve", "--stdio"]',
    opencode: '// opencode.json\n{ "mcp": { "agent-toolbox": { "type": "remote",\n  "url": "http://127.0.0.1:3000/api/mcp/sse" } } }'
  };

  function topo() {
    var L = hosts.map(function (h, i) {
      var y = 22 + i * 50, on = i === 1;
      return '<rect x="10" y="' + y + '" width="200" height="36" rx="6" fill="' + (on ? 'var(--accent-soft)' : 'var(--surface)') + '" stroke="' + (on ? 'var(--accent)' : 'var(--line-2)') + '"/>' +
        '<circle cx="30" cy="' + (y + 18) + '" r="4" fill="var(--ok-dot)"/>' +
        '<text x="44" y="' + (y + 23) + '" fill="var(--ink)" font-size="13"' + (on ? ' font-weight="600"' : '') + '>' + h[0] + '</text>' +
        '<text x="196" y="' + (y + 23) + '" text-anchor="end" fill="var(--ink-3)" font-family="var(--f-mono)" font-size="12">' + h[1] + '</text>';
    }).join('');
    var R = ['外部 MCP 连接池 · 5', '双层 Skill 运行时 · 2', '三位一体向量知识库', 'GitHub GitOps &amp; Vault'].map(function (t, i) {
      var y = 22 + i * 50;
      return '<rect x="790" y="' + y + '" width="200" height="36" rx="6" fill="var(--surface)" stroke="var(--line-2)"/><text x="806" y="' + (y + 23) + '" fill="var(--ink)" font-size="13">' + t + '</text>';
    }).join('');
    var paths = [40, 90, 140, 190].map(function (y) {
      return '<path d="M210 ' + y + ' C300 ' + y + ' 300 115 390 115"/><path d="M610 115 C700 115 700 ' + y + ' 790 ' + y + '"/>';
    }).join('');
    return '<svg viewBox="0 0 1000 230" role="img" aria-label="四个宿主经由 Agent-Toolbox Hub 连接到四类下游能力" style="font-family:var(--f-body)">' +
      '<g fill="none" stroke="var(--line-2)" stroke-width="1.5">' + paths + '</g>' +
      '<path d="M210 90 C300 90 300 115 390 115" fill="none" stroke="var(--accent)" stroke-width="2"/>' + L +
      '<rect x="390" y="55" width="220" height="120" rx="8" fill="var(--surface)" stroke="var(--accent)" stroke-width="1.5"/>' +
      '<text x="500" y="88" text-anchor="middle" fill="var(--accent-ink)" font-family="var(--f-mono)" font-size="11" letter-spacing="1.5">UNIFIED ENTRY</text>' +
      '<text x="500" y="117" text-anchor="middle" fill="var(--ink)" font-family="var(--f-display)" font-weight="var(--h-weight)" font-size="18">Agent-Toolbox Hub</text>' +
      '<text x="500" y="146" text-anchor="middle" fill="var(--ink-2)" font-family="var(--f-mono)" font-size="12">5 Meta · 5/5 Active</text>' + R + '</svg>';
  }
  /* SVG presentation attributes cannot read CSS variables; move them into style="" */
  function fixVars(svg) {
    return svg.replace(/<(\w+)([^>]*?)(\/?)>/g, function (m, tag, attrs, close) {
      var styles = [];
      attrs = attrs.replace(/\s(fill|stroke|font-family|font-weight)="(var\([^"]+\))"/g, function (_, k, v) { styles.push(k + ':' + v); return ''; });
      if (!styles.length) return m;
      return '<' + tag + attrs + ' style="' + styles.join(';') + '"' + close + '>';
    });
  }
  window.odFixSvgVars = fixVars;

  function seg(label, items, on, attr) {
    return '<div class="seg" role="group" aria-label="' + label + '">' + items.map(function (t, i) {
      var v = Array.isArray(t) ? t[1] : t, l = Array.isArray(t) ? t[0] : t;
      return '<button type="button" ' + (attr ? 'data-' + attr + '="' + v + '" ' : '') + 'aria-pressed="' + (i === on) + '">' + l + '</button>';
    }).join('') + '</div>';
  }

  function render(el) {
    var side = '<aside class="side" aria-label="本页分区与宿主状态"><span class="cap">本页分区</span>' +
      ['核心指标', '入口拓扑', '中间件流水线', '权限作用域', '接入配置'].map(function (t, i) { return '<a href="#" data-side' + (i === 0 ? ' aria-current="true"' : '') + '>' + t + '</a>'; }).join('') +
      '<span class="cap">已接入宿主 · 4</span>' +
      hosts.map(function (h) { return '<div class="host">' + dot + '<span class="od-fill">' + h[0] + '</span><span class="mono" style="color:var(--ink-3);font-size:12px">' + h[1] + '</span></div>'; }).join('') +
      '<span class="cap">工作区</span><a href="#" data-side>切换主题</a><a href="#" data-side>打开 JSON-RPC 沙箱</a></aside>';
    var kpis = [['Token 优化', '89.7%', '-16.3k tokens / 轮', ''], ['统一 MCP 路由池', '5 · 14', '服务 · 工具', ''], ['双层 Skill', '2 / 6', '已热挂载', ''], ['向量 RAG · 供应链', '98.6%', '召回 · 1 Quarantine', 'bad']]
      .map(function (k) { return '<div class="card kpi od-stat"><span class="cap">' + k[0] + '</span><span class="kpi-n">' + k[1] + '</span><span class="kpi-s ' + k[3] + '">' + k[2] + '</span></div>'; }).join('');
    var pipe = [['01 Vault 注入', 'ok', 'check', '运行中'], ['02 Quarantine', 'bad', 'block', '拦截 1 项'], ['03 HITL 审批', 'ok', 'check', '运行中'], ['04 输出脱敏', 'ok', 'check', '运行中'], ['05 Token 预算', 'warn', 'pause', '未启用']]
      .map(function (p) { return '<div><b>' + p[0] + '</b><span class="st ' + p[1] + '">' + icon(p[2]) + p[3] + '</span></div>'; }).join('');
    var scope = [['Claude Code', 0], ['Antigravity', 0], ['Codex CLI', 1], ['OpenCode', 1]]
      .map(function (s) { return '<div class="scope-row"><span class="od-fill">' + s[0] + '</span>' + seg(s[0] + ' 权限作用域', ['Full-Dev', 'Audit', 'Min'], s[1]) + '</div>'; }).join('');
    el.innerHTML =
      '<div class="app">' +
      '<header class="app-top"><span class="brand">' + icon('hub') + 'Agent-Toolbox</span>' +
      '<nav class="tabs" aria-label="主导航"><a href="#" aria-current="page">全景驾驶舱</a><a href="#">MCP 网关与安全</a><a href="#">Skill 动态中心</a><a href="#">向量知识库 RAG</a><a href="#">可行性报告与沙箱</a></nav>' +
      '<button class="btn pri" type="button">' + icon('sync') + '同步至 GitHub</button></header>' +
      '<div class="app-body">' + side +
      '<div class="main">' +
      '<div class="page-h"><div class="od-fill"><h1>全景驾驶舱</h1><p>4 个宿主通过唯一入口接入 · 5 级中间件运行中</p></div></div>' +
      '<div class="card entry"><span class="cap">唯一 MCP 入口</span><span class="mono od-fill">stdio://agent-toolbox<span class="sep">·</span>http://127.0.0.1:3000/api/mcp/sse</span><button class="btn sm" type="button" data-copy>' + icon('copy') + '<span>复制</span></button></div>' +
      '<div class="kpis od-grid">' + kpis + '</div>' +
      '<div class="sec-h"><span class="idx">01</span><h2>唯一入口集中式多路复用拓扑</h2></div>' +
      '<div class="card topo">' + fixVars(topo()) + '</div>' +
      '<div class="sec-h"><span class="idx">02</span><h2>可插拔中间件流水线</h2></div>' +
      '<div class="card pipe">' + pipe + '</div>' +
      '<div class="lower">' +
      '<div class="card panel"><h3>03 宿主权限作用域</h3><div>' + scope + '</div></div>' +
      '<div class="card panel"><h3>04 四大宿主一键接入配置</h3>' +
      seg('选择宿主', [['Antigravity', 'antigravity'], ['Claude Code', 'claude'], ['Codex', 'codex'], ['OpenCode', 'opencode']], 0, 'host') +
      '<pre class="code" data-config>' + configs.antigravity + '</pre>' +
      '<div class="row-end"><button class="btn sm" type="button" data-copy>' + icon('copy') + '<span>复制配置</span></button></div></div>' +
      '</div></div></div></div>';

    el.addEventListener('click', function (e) {
      var b = e.target.closest('button, a');
      if (!b || !el.contains(b)) return;
      if (b.tagName === 'A') {
        e.preventDefault();
        if (b.hasAttribute('data-side')) {
          el.querySelectorAll('[data-side]').forEach(function (a) { a.removeAttribute('aria-current'); });
          b.setAttribute('aria-current', 'true');
        }
        return;
      }
      var group = b.closest('.seg');
      if (group) {
        group.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
        if (b.dataset.host) {
          var pre = el.querySelector('[data-config]');
          if (pre) pre.textContent = configs[b.dataset.host];
        }
        return;
      }
      if (b.hasAttribute('data-copy')) {
        var label = b.querySelector('span'), old = label ? label.textContent : '';
        if (label) { label.textContent = '已复制'; setTimeout(function () { label.textContent = old; }, 1400); }
      }
    });
  }

  document.querySelectorAll('[data-cockpit]').forEach(render);
})();
