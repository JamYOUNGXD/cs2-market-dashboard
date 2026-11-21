// 用法：node tests/kline.test.mjs —— 用假的 SteamDT 返回测试代理函数的校验、解析、错误处理，并检查走势图模块能画出折线。
import fs from 'node:fs'; import vm from 'node:vm'; import assert from 'node:assert/strict';
const { default: handler, parseKline } = await import('../netlify/functions/steamdt-kline.mjs');
const req = (qs, h = {}) => new Request('https://site.test/api/kline?' + qs, { headers: { host: 'site.test', ...h } });
const up = (body, ok = true) => { globalThis.fetch = async (u, o) => { up.last = { u, o }; return { ok, status: ok ? 200 : 500, json: async () => body }; }; };
let n = 0; const T = (name, fn) => fn().then(() => console.log('PASS ', name), e => { n++; console.log('FAIL ', name, e.message); });
delete process.env.STEAMDT_API_KEY;
await T('未配置密钥时返回 500，且不泄露细节', async () => { const r = await handler(req('name=x')); assert.equal(r.status, 500); assert.deepEqual(await r.json(), { error: 'server_not_configured' }); });
process.env.STEAMDT_API_KEY = 'SECRET-KEY-123';
await T('参数校验：空名称/非法类型/非法平台/跨站来源', async () => {
  assert.equal((await handler(req('name='))).status, 400); assert.equal((await handler(req('name=x&type=9'))).status, 400);
  assert.equal((await handler(req('name=x&platform=EVIL'))).status, 400); assert.equal((await handler(req('name=x', { origin: 'https://evil.test' }))).status, 403); });
await T('数组行：秒级时间戳转毫秒、按时间排序、去重、丢弃无效价格', async () => {
  up({ success: true, data: [[1700086400, 1, 12, 13, 11], [1700000000, 1, 10, 11, 9], [1700000000, 1, 10.5, 11, 9], [1700172800, 1, 0, 1, 1], ['x', 1, 5]] });
  const r = await handler(req('name=%E2%98%85%20Karambit&type=1&platform=BUFF')); const j = await r.json();
  assert.equal(r.status, 200); assert.deepEqual(j.points, [{ t: 1700000000000, p: 10.5 }, { t: 1700086400000, p: 12 }]); });
await T('上游请求：密钥只放在 Authorization 头，请求体参数正确，返回内容不含密钥', async () => {
  up({ success: true, data: [[1700000000000, 1, 2, 3, 0.5]] }); const r = await handler(req('name=AK&type=2&platform=ALL')); const txt = await r.text();
  assert.equal(up.last.o.headers.Authorization, 'Bearer SECRET-KEY-123'); assert.deepEqual(JSON.parse(up.last.o.body), { marketHashName: 'AK', type: 2 }); assert.ok(!txt.includes('SECRET')); assert.ok(!up.last.u.includes('SECRET')); });
await T('对象行也能解析（close/timestamp）', async () => assert.deepEqual(parseKline([{ timestamp: 1700000000, close: '7.5' }]), [{ t: 1700000000000, p: 7.5 }]));
await T('上游 success:false / 空数据 / 网络失败 都不返回假数据', async () => {
  up({ success: false, errorMsg: 'no permission' }); let r = await handler(req('name=x')); assert.equal(r.status, 502);
  up({ success: true, data: [] }); r = await handler(req('name=x')); assert.equal(r.status, 404);
  globalThis.fetch = async () => { throw new Error('boom'); }; r = await handler(req('name=x')); assert.equal(r.status, 502); });
await T('走势图模块：拿到数据后绘制折线与统计；出错时显示错误文字', async () => {
  const mk = () => { const e = { innerHTML: '', textContent: '', value: '', style: {}, querySelector(s) { return els[s] ||= mk(); } }; return e; }, els = {}, box = mk();
  box.querySelector = s => els[s] ||= mk(); const ctx = vm.createContext({ window: {}, document: { querySelector: () => box }, fetch: null, encodeURIComponent, Math, Date, String, Array });
  vm.runInContext(fs.readFileSync(new URL('../js/history-chart.js', import.meta.url), 'utf8').replace('})(window);', '})(window);globalThis.HC=window.HistoryChart;'), ctx);
  ctx.HC.init({ lang: () => 'tw', money: x => x, sym: () => '¥', fmt: x => String(Math.round(x)), pc: x => (x * 100).toFixed(1) + '%', cls: () => '', esc: x => x });
  els['#hn'].value = '★ Karambit | Doppler (Factory New)'; els['#hp'].value = 'BUFF'; els['#ht'].value = '1';
  ctx.fetch = async () => ({ json: async () => ({ points: [{ t: 1700000000000, p: 10 }, { t: 1700086400000, p: 12 }, { t: 1700172800000, p: 11 }] }) });
  els['#hg'].onclick(); await new Promise(r => setTimeout(r, 10)); assert.match(els['#hr'].innerHTML, /<polyline/); assert.match(els['#hr'].innerHTML, /20\.0%|10\.0%/);
  ctx.fetch = async () => ({ json: async () => ({ error: 'no_data' }) }); els['#hg'].onclick(); await new Promise(r => setTimeout(r, 10)); assert.match(els['#hr'].textContent, /查不到/); });
console.log(n ? `\n结果：${n} 项失败` : '\n结果：全部通过'); process.exit(n ? 1 : 0);
