/* history-chart.js — 历史价格走势（SteamDT K 线，经 /api/kline 服务端代理）。独立模块，只增加一个区块，不改动原有榜单。 */
(function (g) {
  var TX = {
    tw: { h: '歷史價格走勢', n: '資料來自 SteamDT K 線，經伺服器代理查詢（金鑰不在網頁中）。請輸入 Steam 官方英文名稱，例如 ★ Karambit | Doppler (Factory New)。價格單位以 SteamDT 回傳為準，預設視為人民幣。', ph: 'Steam 英文名稱 (marketHashName)', go: '查詢走勢', plat: '平台', ty: 'K 線類型', t1: '1（日線）', t2: '2', t3: '3', load: '載入中…', err: '查詢失敗：', e: { bad_name: '名稱不合法', no_data: '查不到這件飾品的資料，請確認英文名稱完全正確', server_not_configured: '伺服器尚未設定 API 金鑰', upstream_error: 'SteamDT 回傳錯誤', upstream_unreachable: '無法連線到 SteamDT', forbidden: '不允許的來源' }, last: '最新', hi: '最高', lo: '最低', chg: '區間漲跌', pts: '筆資料', range: '區間' },
    cn: { h: '历史价格走势', n: '数据来自 SteamDT K 线，经服务器代理查询（密钥不在网页中）。请输入 Steam 官方英文名称，例如 ★ Karambit | Doppler (Factory New)。价格单位以 SteamDT 返回为准，默认视为人民币。', ph: 'Steam 英文名称 (marketHashName)', go: '查询走势', plat: '平台', ty: 'K 线类型', t1: '1（日线）', t2: '2', t3: '3', load: '加载中…', err: '查询失败：', e: { bad_name: '名称不合法', no_data: '查不到这件饰品的数据，请确认英文名称完全正确', server_not_configured: '服务器尚未配置 API 密钥', upstream_error: 'SteamDT 返回错误', upstream_unreachable: '无法连接到 SteamDT', forbidden: '不允许的来源' }, last: '最新', hi: '最高', lo: '最低', chg: '区间涨跌', pts: '条数据', range: '区间' }
  };
  var A, box, st = { pts: null, err: '', busy: false }, IN = 'width:100%;max-width:280px;margin-bottom:8px;background:var(--sf);color:var(--tx);border:1px solid var(--ln);border-radius:6px;padding:5px 8px;font:inherit';
  var T = function () { return TX[A.lang()] || TX.tw; };
  var day = function (t) { return new Date(t).toISOString().slice(0, 10); };
  function svg(p) {
    var W = 640, H = 200, pl = 6, pr = 6, pt = 14, pb = 22, v = p.map(function (x) { return A.money(x.p); }), mn = Math.min.apply(0, v), mx = Math.max.apply(0, v), sp = mx - mn || 1;
    var X = function (i) { return pl + (p.length < 2 ? 0 : i * (W - pl - pr) / (p.length - 1)); }, Y = function (x) { return pt + (H - pt - pb) * (1 - (x - mn) / sp); };
    var s = '<polyline fill="none" stroke="var(--ac)" stroke-width="2" stroke-linejoin="round" points="' + v.map(function (x, i) { return X(i).toFixed(1) + ',' + Y(x).toFixed(1); }).join(' ') + '"/>';
    v.forEach(function (x, i) { s += '<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(x).toFixed(1) + '" r="4" fill="transparent"><title>' + day(p[i].t) + '：' + A.sym() + ' ' + x.toFixed(2) + '</title></circle>'; });
    return s + '<text x="' + pl + '" y="10">' + A.sym() + ' ' + A.fmt(mx) + '</text><text x="' + pl + '" y="' + (H - 4) + '">' + day(p[0].t) + '</text><text x="' + (W - pr) + '" y="' + (H - 4) + '" text-anchor="end">' + day(p[p.length - 1].t) + '</text>';
  }
  function draw() {
    var t = T(), o = box.querySelector('#hr'); if (!o) return;
    if (st.busy) return void (o.textContent = t.load);
    if (st.err) return void (o.textContent = t.err + st.err);
    if (!st.pts) return void (o.textContent = '');
    var p = st.pts, last = p[p.length - 1].p, hi = Math.max.apply(0, p.map(function (x) { return x.p; })), lo = Math.min.apply(0, p.map(function (x) { return x.p; })), c = last / p[0].p - 1, m = A.money;
    o.innerHTML = '<div class="kpi"><div><b>' + m(last).toFixed(2) + '</b><span>' + t.last + '（' + A.sym() + '）</span></div><div><b>' + m(hi).toFixed(2) + '</b><span>' + t.hi + '</span></div><div><b>' + m(lo).toFixed(2) + '</b><span>' + t.lo + '</span></div><div><b class="' + A.cls(c) + '">' + A.pc(c) + '</b><span>' + t.chg + '（' + day(p[0].t) + ' → ' + day(p[p.length - 1].t) + '，' + p.length + ' ' + t.pts + '）</span></div></div><div class="wrap"><svg viewBox="0 0 640 200" width="100%" role="img">' + svg(p) + '</svg></div>';
  }
  function build() {
    var t = T(), v = function (id) { var e = box.querySelector(id); return e ? e.value : ''; }, keep = [v('#hn'), v('#hp') || 'ALL', v('#ht') || '1'];
    box.innerHTML = '<h2>' + t.h + '</h2><p class="note">' + t.n + '</p><input id="hn" type="search" placeholder="' + A.esc(t.ph) + '" style="' + IN + ';max-width:420px"> <select id="hp" aria-label="' + t.plat + '" style="' + IN + ';width:auto">' + ['ALL', 'BUFF', 'YOUPIN', 'C5', 'STEAM', 'HALOSKINS'].map(function (x) { return '<option>' + x + '</option>'; }).join('') + '</select> <select id="ht" aria-label="' + t.ty + '" style="' + IN + ';width:auto"><option value="1">' + t.t1 + '</option><option value="2">' + t.t2 + '</option><option value="3">' + t.t3 + '</option></select><div><button class="btn" id="hg">' + t.go + '</button><span id="hr" style="font-size:13px;color:var(--wn)"></span></div>';
    box.querySelector('#hn').value = keep[0]; box.querySelector('#hp').value = keep[1]; box.querySelector('#ht').value = keep[2];
    box.querySelector('#hg').onclick = go; box.querySelector('#hn').onkeydown = function (e) { if (e.key === 'Enter') go(); };
    draw();
  }
  function go() {
    var n = box.querySelector('#hn').value.trim(); if (!n) return;
    st.busy = true; st.err = ''; st.pts = null; draw();
    fetch('/api/kline?name=' + encodeURIComponent(n) + '&type=' + box.querySelector('#ht').value + '&platform=' + box.querySelector('#hp').value)
      .then(function (r) { return r.json().catch(function () { return { error: 'upstream_unreachable' }; }); })
      .then(function (d) { st.busy = false; if (d.error) { st.err = (T().e[d.error] || d.error) + (d.message ? '（' + d.message + '）' : ''); } else st.pts = d.points; draw(); })
      .catch(function (e) { st.busy = false; st.err = String(e.message || e); draw(); });
  }
  g.HistoryChart = { init: function (a) { A = a; box = document.querySelector('#s-hist'); if (box) build(); }, refresh: function () { if (A && box) build(); } };
})(window);
