/**
 * The embeddable chat widget, served at GET /widget.js. Plain ES2017, no dependencies, rendered in a Shadow DOM so the
 * host page's CSS cannot break it and ours cannot leak. All visitor-supplied text is inserted with textContent (no HTML).
 * Usage: <script src="https://API/widget.js" data-key="pk_..." async></script>
 */
export const WIDGET_JS = String.raw`(function () {
  'use strict';
  var script = document.currentScript || document.querySelector('script[data-key][src*="widget.js"]');
  if (!script) return;
  var key = script.getAttribute('data-key');
  var api = new URL(script.src).origin;
  if (!key || window.__lpWidget === key) return;
  window.__lpWidget = key;
  var STORE = 'lp_widget_' + key;
  var state = { token: null, open: false, lastCount: 0, timer: null, cfg: null };
  try { state.token = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (e) { state.token = null; }

  function req(path, opts) {
    opts = opts || {};
    var headers = { 'content-type': 'application/json' };
    if (state.token) headers.authorization = 'Bearer ' + state.token.t;
    if (opts.botToken) headers['x-turnstile-token'] = opts.botToken;
    return fetch(api + path, { method: opts.method || 'GET', headers: headers, body: opts.body ? JSON.stringify(opts.body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { var err = new Error((j.error && j.error.message) || 'Something went wrong'); err.status = r.status; throw err; } return j; }); });
  }
  function el(tag, props, children) {
    var n = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) { if (k === 'text') n.textContent = props[k]; else if (k === 'class') n.className = props[k]; else n.setAttribute(k, props[k]); });
    (children || []).forEach(function (c) { n.appendChild(c); });
    return n;
  }

  req('/widget/config?key=' + encodeURIComponent(key)).then(function (cfg) {
    if (!cfg.enabled) return;
    state.cfg = cfg; build();
  }).catch(function () { /* widget stays hidden if the key or origin is not valid */ });

  /* Bot check (Cloudflare Turnstile). Only when the owner's server has it switched on: config.botCheck = { mode, siteKey }. */
  var tsPromise = null;
  function loadTurnstile() {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (!tsPromise) tsPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; s.async = true;
      s.onload = function () { resolve(window.turnstile); }; s.onerror = function () { tsPromise = null; reject(new Error('Could not load the verification check. Please try again.')); };
      document.head.appendChild(s);
    });
    return tsPromise;
  }
  function botToken(mount) {
    var bc = state.cfg && state.cfg.botCheck;
    if (!bc) return Promise.resolve(undefined);
    if (bc.mode === 'mock') return Promise.resolve('mock-pass');
    return loadTurnstile().then(function (ts) {
      return new Promise(function (resolve, reject) {
        var holder = el('div'); (mount || document.body).appendChild(holder);
        var id = ts.render(holder, { sitekey: bc.siteKey, execution: 'execute', appearance: 'interaction-only',
          callback: function (t) { holder.remove(); resolve(t); },
          'error-callback': function () { holder.remove(); reject(new Error('Verification failed. Please try again.')); },
          'timeout-callback': function () { holder.remove(); reject(new Error('Verification timed out. Please try again.')); } });
        ts.execute(id);
      });
    });
  }

  function build() {
    var cfg = state.cfg;
    var host = el('div', { id: 'leadpilot-widget' });
    var root = host.attachShadow({ mode: 'open' });
    var side = cfg.position === 'left' ? 'left' : 'right';
    var css = ':host{all:initial}*{box-sizing:border-box;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}' +
      '.btn{position:fixed;bottom:20px;' + side + ':20px;width:56px;height:56px;border-radius:50%;border:0;background:' + cfg.color + ';color:#fff;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;z-index:2147483646}' +
      '.btn:focus-visible,button:focus-visible,input:focus-visible{outline:2px solid ' + cfg.color + ';outline-offset:2px}' +
      '.panel{position:fixed;bottom:88px;' + side + ':20px;width:360px;max-width:calc(100vw - 24px);height:520px;max-height:calc(100vh - 110px);background:#fff;color:#111;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.28);display:none;flex-direction:column;overflow:hidden;z-index:2147483647}' +
      '.panel.open{display:flex}@media(max-width:480px){.panel{inset:0;width:100%;max-width:none;height:100%;max-height:none;border-radius:0}}' +
      '.head{background:' + cfg.color + ';color:#fff;padding:14px 16px;font-weight:600;display:flex;justify-content:space-between;align-items:center}' +
      '.x{background:none;border:0;color:#fff;font-size:22px;cursor:pointer;line-height:1}' +
      '.msgs{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:8px;background:#f6f7f9}' +
      '.m{max-width:82%;padding:8px 12px;border-radius:12px;font-size:14px;line-height:1.4;white-space:pre-wrap;word-wrap:break-word}' +
      '.m.v{align-self:flex-end;background:' + cfg.color + ';color:#fff;border-bottom-right-radius:3px}.m.t{align-self:flex-start;background:#fff;border:1px solid #e3e6ec;border-bottom-left-radius:3px}' +
      '.form{padding:14px;display:flex;flex-direction:column;gap:10px;overflow-y:auto}.form label{font-size:12px;color:#555}' +
      'input{width:100%;padding:9px 10px;border:1px solid #cfd4de;border-radius:8px;font-size:14px}' +
      '.go{background:' + cfg.color + ';color:#fff;border:0;border-radius:8px;padding:10px 14px;font-size:14px;cursor:pointer}.go:disabled{opacity:.6}' +
      '.row{display:flex;gap:8px;padding:10px;border-top:1px solid #e3e6ec;background:#fff}.row input{flex:1}' +
      '.err{color:#c62828;font-size:12px;min-height:16px}';
    root.appendChild(el('style', { text: css }));

    var btn = el('button', { class: 'btn', 'aria-label': cfg.title, 'aria-expanded': 'false' });
    btn.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
    var closeBtn = el('button', { class: 'x', 'aria-label': 'Close chat', text: '×' });
    var panel = el('div', { class: 'panel', role: 'dialog', 'aria-label': cfg.title }, [el('div', { class: 'head' }, [el('span', { text: cfg.title }), closeBtn])]);
    var body = el('div', { style: 'display:flex;flex-direction:column;flex:1;min-height:0' });
    panel.appendChild(body);
    root.appendChild(btn); root.appendChild(panel);
    document.body.appendChild(host);

    function toggle(open) {
      state.open = open; panel.classList.toggle('open', open); btn.setAttribute('aria-expanded', String(open));
      if (open) { state.token ? showChat() : showForm(); } else if (state.timer) { clearInterval(state.timer); state.timer = null; }
    }
    btn.addEventListener('click', function () { toggle(!state.open); });
    closeBtn.addEventListener('click', function () { toggle(false); btn.focus(); });
    root.addEventListener('keydown', function (e) { if (e.key === 'Escape' && state.open) { toggle(false); btn.focus(); } });

    function showForm() {
      body.textContent = '';
      var greet = el('div', { class: 'm t', text: cfg.greeting });
      var name = el('input', { id: 'lp-name', autocomplete: 'name', maxlength: '120' });
      var contact = el('input', { id: 'lp-contact', autocomplete: 'tel', maxlength: '254', placeholder: 'Phone number or email' });
      var err = el('div', { class: 'err', role: 'alert' });
      var go = el('button', { class: 'go', type: 'submit', text: 'Start chat' });
      var form = el('form', { class: 'form' }, [greet, el('label', { for: 'lp-name', text: 'Your name' }), name, el('label', { for: 'lp-contact', text: 'Phone or email, so we can follow up' }), contact, err, go]);
      form.addEventListener('submit', function (e) {
        e.preventDefault(); err.textContent = ''; go.disabled = true;
        var v = contact.value.trim(); var payload = { key: key, name: name.value.trim() };
        if (v.indexOf('@') > -1) payload.email = v; else payload.phone = v;
        botToken(root).then(function (bt) { return req('/widget/sessions', { method: 'POST', body: payload, botToken: bt }); }).then(function (r) {
          state.token = { t: r.token }; try { localStorage.setItem(STORE, JSON.stringify(state.token)); } catch (x) { /* storage unavailable */ }
          showChat();
        }).catch(function (x) { err.textContent = x.message; go.disabled = false; });
      });
      body.appendChild(form); name.focus();
    }

    function showChat() {
      body.textContent = '';
      var msgs = el('div', { class: 'msgs', 'aria-live': 'polite' });
      var input = el('input', { 'aria-label': 'Type your message', placeholder: 'Type your message', maxlength: '2000' });
      var send = el('button', { class: 'go', type: 'submit', text: 'Send' });
      var row = el('form', { class: 'row' }, [input, send]);
      body.appendChild(msgs); body.appendChild(row);
      function render(list) {
        msgs.textContent = '';
        msgs.appendChild(el('div', { class: 'm t', text: cfg.greeting }));
        list.forEach(function (m) { msgs.appendChild(el('div', { class: 'm ' + (m.from === 'visitor' ? 'v' : 't'), text: m.text })); });
        if (list.length !== state.lastCount) { msgs.scrollTop = msgs.scrollHeight; state.lastCount = list.length; }
      }
      function poll() { req('/widget/messages').then(function (r) { render(r.items); }).catch(function (x) { if (x.status === 401 || x.status === 403) { state.token = null; try { localStorage.removeItem(STORE); } catch (e) {} showForm(); } }); }
      row.addEventListener('submit', function (e) {
        e.preventDefault(); var text = input.value.trim(); if (!text) return; input.value = ''; send.disabled = true;
        req('/widget/messages', { method: 'POST', body: { text: text } }).then(poll).catch(function (x) { input.value = text; msgs.appendChild(el('div', { class: 'err', text: x.message })); }).then(function () { send.disabled = false; input.focus(); });
      });
      poll(); if (state.timer) clearTimeout(state.timer);
      // Keep checking even when this tab is in the background (a team member often replies from another tab): every 2 s when the tab is in
      // front, every 8 s when it is not, and straight away when the visitor comes back to the tab.
      function next() { state.timer = setTimeout(function () { poll(); next(); }, document.hidden ? 8000 : 2000); }
      next();
      if (!state.wired) { state.wired = true; document.addEventListener('visibilitychange', function () { if (!document.hidden && state.token) poll(); }); window.addEventListener('focus', function () { if (state.token) poll(); }); }
      input.focus();
    }
  }
})();`;
