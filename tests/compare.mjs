// 用法：node tests/compare.mjs   （在项目根目录运行）
// 在无浏览器的 DOM 替身里分别运行「原版」与「新版」页面，对比六个榜单数据与最终渲染出的页面内容。
import fs from 'node:fs'; import vm from 'node:vm'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rd = f => fs.readFileSync(path.join(root, f), 'utf8');
const INTENDED = new Set(['#meta', '#chart']), NEWONLY = ['#s-hist', '#hn', '#hp', '#ht', '#hg', '#hr']; // 原版用随机模拟数据生成的两处（页面上本就隐藏），新版有意不再生成

function makeCtx(html, extra) {
  const els = {}, mk = (key, k) => (els[key] ||= { key, _h: '', _t: '', get innerHTML() { return this._h; }, set innerHTML(v) { this._h = String(v); this._t = ''; }, get textContent() { return this._t; }, set textContent(v) { this._t = String(v); this._h = ''; }, value: '', placeholder: '', hidden: false, style: {}, dataset: k ? { k } : {}, attrs: {}, setAttribute(n, v) { this.attrs[n] = String(v); }, addEventListener() {} });
  const get = s => { const e = mk(s); e.parentNode ||= mk(s + ':parent'); return e; };
  const dk = [...html.matchAll(/data-k="(\w+)"/g)].map((m, i) => mk('dk' + i + ':' + m[1], m[1]));
  const doc = { querySelector: get, querySelectorAll: s => s === '[data-k]' ? dk : [], documentElement: {}, addEventListener() {}, title: '' };
  const ctx = vm.createContext({ document: doc, console, setTimeout, Promise, fetch: async u => { const p = path.join(root, u.replace(/^\.\//, '')); return fs.existsSync(p) ? { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(p, 'utf8')) } : { ok: false, status: 404 }; }, ...extra });
  return { ctx, els, get };
}
const run = (c, code) => vm.runInContext(code, c.ctx);
const script = h => h.match(/<script>([\s\S]*?)<\/script>/)[1];
async function boot(file, withStore) {
  const html = file === 'orig' ? rd('backup/index.original.html') : rd('index.html');
  const c = makeCtx(html, {}); if (withStore) vm.runInContext(rd('js/data-store.js'), c.ctx);
  run(c, script(html));
  for (let i = 0; i < 50 && !run(c, file === 'orig' ? 'true' : '!!META'); i++) await new Promise(r => setTimeout(r, 5));
  return c;
}
const snap = c => Object.fromEntries(Object.entries(c.els).filter(([k]) => !k.includes(':parent')).map(([k, e]) => [k.replace(/^dk\d+:/, 'data-k:'), JSON.stringify([e.innerHTML, e.textContent, e.placeholder, e.value, e.hidden, e.attrs, e.style])]));
const A = await boot('orig', false), B = await boot('new', true);
let fail = 0, lines = [];
const say = s => { lines.push(s); console.log(s); };
// 1) 数据层：六个榜单
for (const k of ['KG', 'KL', 'KS', 'GG', 'GL', 'GS']) {
  const a = JSON.parse(run(A, `JSON.stringify(DS.${k})`)), b = JSON.parse(run(B, `JSON.stringify(DS.${k})`));
  let bad = 0; a.forEach((r, i) => { if (JSON.stringify(r) !== JSON.stringify(b[i])) bad++; });
  const ok = a.length === b.length && !bad; if (!ok) fail++;
  say(`${ok ? 'PASS' : 'FAIL'}  榜单 ${k}：原版 ${a.length} 行 / 新版 ${b.length} 行；名称、现价、涨跌%、成交件数、成交额、量比、挂单逐行比对，不一致 ${bad} 行`);
}
for (const [n, code] of [['REAL.rows（跌幅榜快照）', 'JSON.stringify(REAL.rows)'], ['REAL.cat（大盘指数）', 'JSON.stringify(REAL.cat)'], ['买点建议样本 allRec()', 'JSON.stringify(allRec())'], ['跌幅前10 allD()', 'JSON.stringify(allD())'], ['更新时间 UPD', 'UPD']]) {
  const ok = run(A, code) === run(B, code); if (!ok) fail++; say(`${ok ? 'PASS' : 'FAIL'}  ${n}`);
}
// 2) 页面渲染：多种语言/币种/汇率/搜索/排序/筛选组合
const csv = Array.from({ length: 14 }, (_, d) => Array.from({ length: 12 }, (_, i) => `2026-11-${String(d + 1).padStart(2, '0')},Karambit | Test${i} (FN),${(100 + i * 10 + Math.sin(d + i) * 8).toFixed(2)},${20 + ((d * 7 + i * 3) % 15)}`).join('\n')).join('\n');
globalThis.__csv = csv; run(A, 'globalThis.__csv=' + JSON.stringify(csv)); run(B, 'globalThis.__csv=' + JSON.stringify(csv));
const scen = [['匯入資料功能', "apply(__csv)"], ['匯入後切換簡體', "setLang('cn')"], ['匯入後還原', "$('#reset').onclick();setLang('tw')"], ['初始', ''], ['简体', "setLang('cn')"], ['繁体+TWD(4.75)', "setLang('tw');setCur('twd')"], ['简体+TWD(4.4)', "setLang('cn');rate=4.4;render()"], ['TWD(4.4)', "rate=4.4;render()"],
  ['刀涨幅榜搜索', "setCur('cny');$('#kq').value='蝴蝶';renderKnives()"], ['销量榜按成交额升序', "$('#kq').value='';SO.stab={c:6,d:1};renderSL()"], ['手套跌幅按量比降序', "SO.gtab2={c:7,d:-1};renderGL()"],
  ['买点建议-观察机会', "bf='b';renderBuy()"], ['买点建议-偏热+搜索', "bf='h';$('#bq2').value='手套';renderBuy()"], ['买点建议-按评分升序', "bf='all';$('#bq2').value='';SO.btab={c:8,d:1};renderBuy()"], ['跌幅榜按现价排序', "SO.rtab={c:1,d:-1};renderReal()"]];
for (const [name, code] of scen) {
  if (code) { run(A, code); run(B, code); }
  const a = snap(A), b = snap(B), diff = Object.keys({ ...a, ...b }).filter(k => a[k] !== b[k]), real = diff.filter(k => !INTENDED.has(k)), intended = diff.filter(k => INTENDED.has(k));
  const ok = !real.length; if (!ok) fail++;
  say(`${ok ? 'PASS' : 'FAIL'}  页面渲染「${name}」：对比 ${Object.keys(a).length} 个页面元素，非预期差异 ${real.length} 处${real.length ? '：' + real.join(',') : ''}${intended.length ? `（另有预期差异 ${intended.join('、')}：原版里是随机模拟数据，新版不再生成）` : ''}`);
}
// 3) 模拟数据残留检查
const hasGen = /function\s+gen\s*\(|function\s+rng\s*\(|Math\.random|const ITEMS=/.test(rd('index.html')); if (hasGen) fail++;
say(`${hasGen ? 'FAIL' : 'PASS'}  新版 index.html 中不含随机数/模拟数据生成代码`);
say(fail ? `\n结果：${fail} 项失败` : '\n结果：全部通过');
fs.writeFileSync(path.join(root, 'tests/REPORT.txt'), lines.join('\n') + '\n'); process.exit(fail ? 1 : 0);
