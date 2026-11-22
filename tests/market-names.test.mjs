// 用法：node tests/market-names.test.mjs
// 用项目里真实的 538 条 items.json 测试名称匹配机制。基础资料用「合成数据」：英文名是占位符（W1/F2…），
// 只用来验证匹配逻辑，不代表 SteamDT 的真实命名，也不会写入 data/。
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import crypto from 'node:crypto'; import assert from 'node:assert/strict';
import { parseCnName, parseHashName, itemKey, extractEntries, buildIndex, matchItems, checkOverrides, WEAR_EN } from '../lib/market-names.mjs';
import { run } from '../tools/build-market-names.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ITEMS_FILE = path.join(ROOT, 'data/items.json');
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const ITEMS_SHA = sha(ITEMS_FILE), META_SHA = sha(path.join(ROOT, 'data/meta.json'));
const items = JSON.parse(fs.readFileSync(ITEMS_FILE, 'utf8')).items;
let n = 0; const T = async (name, fn) => { try { await fn(); console.log('PASS ', name); } catch (e) { n++; console.log('FAIL ', name, '\n      ', e.message.split('\n')[0]); } };

const WCN = { FN: '崭新出厂', MW: '略有磨损', FT: '久经沙场', WW: '破损不堪', BS: '战痕累累' }, WTW = { FN: '全新出廠', MW: '略有磨損', FT: '久經沙場', WW: '破損不堪', BS: '戰痕累累' };
const EN = Object.fromEntries(Object.entries(WEAR_EN).map(([k, v]) => [v, k]));
const fmts = [
  r => r.weapon + '（★）' + (r.finish ? ' | ' + r.finish : '') + (r.wear ? '（' + (r.stattrak ? 'StatTrak™ ' : '') + WCN[r.wear] + '）' : ''),   // 与 data-store 的显示名一致
  r => '★ ' + (r.stattrak ? 'StatTrak™ ' : '') + r.weapon + (r.finish ? ' | ' + r.finish : '') + (r.wear ? ' (' + WCN[r.wear] + ')' : ''),
  r => r.weapon + '（★' + (r.stattrak ? ' StatTrak™' : '') + '）' + (r.finish ? ' | ' + r.finish : '') + (r.wear ? ' (' + WTW[r.wear] + ')' : '')
];
const wi = new Map(), fi = new Map(); const idx = (m, k) => (m.has(k) ? m.get(k) : (m.set(k, m.size + 1), m.get(k)));
const hashOf = r => '★ ' + (r.stattrak ? 'StatTrak™ ' : '') + 'W' + idx(wi, r.weapon) + (r.finish ? ' | F' + idx(fi, r.weapon + r.finish) : '') + (r.wear ? ' (' + EN[r.wear] + ')' : '');
const synth = () => items.map((r, i) => ({ name: fmts[i % 3](r), marketHashName: hashOf(r) }));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mn-'));
const setup = (base) => { const d = tmp(); fs.mkdirSync(path.join(d, 'data/raw'), { recursive: true }); fs.copyFileSync(ITEMS_FILE, path.join(d, 'data/items.json')); if (base) fs.writeFileSync(path.join(d, 'data/raw/steamdt-base.json'), JSON.stringify(base)); return d; };
const quiet = () => { const L = []; return { log: s => L.push(s), L }; };

await T('真实 538 条的匹配键两两不同', () => assert.equal(new Set(items.map(itemKey)).size, items.length));
await T('三种中文写法（含繁体磨损词）全部归一化回同一个键（538 条 × 3）', () => {
  for (const r of items) for (const f of fmts) { const p = parseCnName(f(r)); assert.equal(itemKey({ weapon: p.weapon, finish: p.finish, wear: p.wear, stattrak: p.st }), itemKey(r), f(r)); }
});
await T('英文名解析：★、StatTrak™、磨损、无磨损的原版刀', () => {
  assert.deepEqual(parseHashName('★ StatTrak™ Karambit | Doppler (Factory New)'), { star: true, st: true, wear: 'FN', base: 'Karambit | Doppler' });
  assert.deepEqual(parseHashName('★ Karambit'), { star: true, st: false, wear: null, base: 'Karambit' });
  assert.equal(parseHashName('AK-47 | Redline (Field-Tested)').star, false);
});
await T('合成基础资料：538 件全部唯一匹配', () => {
  const b = buildIndex(synth()); const m = matchItems(items, b);
  assert.equal(m.matched.size, 538); assert.equal(m.review.length, 0);
  for (const r of items) assert.equal(m.matched.get(r.id).market_hash_name, hashOf(r));
});
await T('基础资料缺 3 件 → 恰好 3 件需复核（unmatched），其余不受影响', () => {
  const s = synth(); const gone = [s[0], s[100], s[400]].map(e => e.marketHashName);
  const m = matchItems(items, buildIndex(s.filter(e => !gone.includes(e.marketHashName))));
  assert.equal(m.matched.size, 535); assert.deepEqual(m.review.map(v => v.reason), ['unmatched', 'unmatched', 'unmatched']);
});
await T('同一中文名对应两个不同英文名 → ambiguous，不乱选', () => {
  const s = synth(); s.push({ name: s[5].name, marketHashName: s[5].marketHashName.replace(/(\s\([^)]*\))?$/, m => ' x' + m) });
  const m = matchItems(items, buildIndex(s)); const v = m.review.find(x => x.id === items[5].id);
  assert.equal(v.reason, 'ambiguous'); assert.equal(v.candidates.length, 2); assert.equal(m.matched.size, 537);
});
await T('交叉校验：中文写崭新出厂、英文却是久经沙场 → 丢弃；中文没写 StatTrak 但英文有 → 以英文为准', () => {
  const i = items.findIndex(r => r.wear === 'FN' && !r.stattrak), j = items.findIndex(r => r.stattrak && r.wear);
  const s = synth(); s[i] = { name: s[i].name, marketHashName: s[i].marketHashName.replace('Factory New', 'Field-Tested') };
  s[j] = { name: s[j].name.replace(/StatTrak™ ?/, ''), marketHashName: s[j].marketHashName };
  const b = buildIndex(s), m = matchItems(items, b);
  assert.equal(b.stats.inconsistent, 1); assert.equal(m.review.length, 1); assert.equal(m.review[0].id, items[i].id); assert.equal(m.matched.get(items[j].id).market_hash_name, hashOf(items[j]));
});
await T('基础资料外形兼容 + 无中文名/无英文名/非刀手套条目被正确统计', () => {
  const e = [{ name: '爪子刀（★） | 多普勒（崭新出厂）', marketHashName: '★ Karambit | Doppler (Factory New)' }];
  for (const shape of [e, { success: true, data: e }, { data: { list: e } }, { response: { data: e } }]) assert.equal(extractEntries(shape).length, 1);
  const st = buildIndex([...e, { marketHashName: '★ Bayonet' }, { name: '中文' }, { name: '枪', marketHashName: 'AK-47 | Redline (Field-Tested)' }]).stats;
  assert.deepEqual([st.usable, st.no_chinese, st.no_hash, st.not_knife_glove], [1, 1, 1, 1]);
});
await T('覆盖表校验：未知 id / 格式不对 / 不在基础资料里 都报错；合法的生效', () => {
  const s = synth(), b = buildIndex(s), id = items[0].id;
  assert.equal(checkOverrides({ nope: s[0].marketHashName }, items, b.byHash).length, 1);
  assert.equal(checkOverrides({ [id]: 'AK-47 | Redline' }, items, b.byHash).length, 1);
  assert.equal(checkOverrides({ [id]: '★ Not In Base' }, items, b.byHash).length, 1);
  assert.deepEqual(checkOverrides({ [id]: s[7].marketHashName }, items, b.byHash), []);
  const m = matchItems(items, b, { [id]: s[7].marketHashName }); assert.equal(m.matched.get(id).by, 'override');
});

await T('离线模式：不联网（fetch 被调用即失败）、写出结构正确的 market-names.json，且不改 items/meta', async () => {
  const d = setup({ _meta: { fetched_at: '2026-01-01T00:00:00.000Z' }, response: { success: true, data: synth() } }), q = quiet();
  const r = await run([], { root: d, fetchImpl: () => { throw new Error('不应联网'); }, log: q.log });
  const o = JSON.parse(fs.readFileSync(path.join(d, 'data/market-names.json'), 'utf8'));
  assert.deepEqual([o.summary.items, o.summary.matched, o.summary.needs_review], [538, 538, 0]); assert.equal(Object.keys(o.items).length, 538);
  assert.equal(o.base.fetched_at, '2026-01-01T00:00:00.000Z'); assert.equal(r.strictFail, false);
  assert.equal(sha(path.join(d, 'data/items.json')), ITEMS_SHA);
});
await T('--strict 在有未匹配项时标记失败；--dry-run 不写文件', async () => {
  const s = synth().slice(1), d = setup({ success: true, data: s });
  const r = await run(['--strict', '--dry-run'], { root: d, log: quiet().log });
  assert.equal(r.strictFail, true); assert.equal(fs.existsSync(path.join(d, 'data/market-names.json')), false);
});
await T('基础资料里没有中文名字段 → 报错并列出字段名，不写输出', async () => {
  const d = setup({ success: true, data: [{ marketHashName: '★ Karambit', price: 1 }] });
  await assert.rejects(run([], { root: d, log: quiet().log }), /第一条的字段：marketHashName, price/); assert.equal(fs.existsSync(path.join(d, 'data/market-names.json')), false);
});
await T('拒绝写入 items.json / meta.json', async () => {
  const d = setup({ success: true, data: synth() });
  await assert.rejects(run(['--out', 'data/items.json'], { root: d, log: quiet().log }), /拒绝写入/); assert.equal(sha(path.join(d, 'data/items.json')), ITEMS_SHA);
});
await T('--fetch：密钥只进 Authorization 头；保存的文件和日志不含密钥；已有本地文件时拒绝重复下载', async () => {
  const d = setup(null), q = quiet(); let calls = 0, seen;
  const f = async (u, o) => { calls++; seen = { u, o }; return { ok: true, status: 200, json: async () => ({ success: true, data: [{ name: '爪子刀', marketHashName: '★ Karambit' }] }) }; };
  await run(['--fetch'], { root: d, env: { STEAMDT_API_KEY: 'SECRET-XYZ' }, fetchImpl: f, log: q.log });
  assert.equal(seen.o.headers.Authorization, 'Bearer SECRET-XYZ'); assert.ok(!seen.u.includes('SECRET'));
  const saved = fs.readFileSync(path.join(d, 'data/raw/steamdt-base.json'), 'utf8'); assert.ok(!saved.includes('SECRET')); assert.ok(!q.L.join('\n').includes('SECRET'));
  assert.equal(JSON.parse(saved).response.data.length, 1);
  await assert.rejects(run(['--fetch'], { root: d, env: { STEAMDT_API_KEY: 'SECRET-XYZ' }, fetchImpl: f, log: q.log }), /已拒绝再次下载/); assert.equal(calls, 1);
});
await T('--fetch：缺密钥不联网；上游 success:false 不落盘；错误信息里的密钥被打码', async () => {
  const d = setup(null); let calls = 0;
  await assert.rejects(run(['--fetch'], { root: d, env: {}, fetchImpl: () => { calls++; }, log: quiet().log }), /STEAMDT_API_KEY/); assert.equal(calls, 0);
  const bad = async () => ({ ok: true, status: 200, json: async () => ({ success: false, errorMsg: 'no permission' }) });
  await assert.rejects(run(['--fetch'], { root: d, env: { STEAMDT_API_KEY: 'K1' }, fetchImpl: bad, log: quiet().log }), /no permission/); assert.equal(fs.existsSync(path.join(d, 'data/raw/steamdt-base.json')), false);
  const boom = async () => { throw new Error('connect failed for Bearer K1'); };
  await assert.rejects(run(['--fetch'], { root: d, env: { STEAMDT_API_KEY: 'K1' }, fetchImpl: boom, log: quiet().log }), e => !e.message.includes('K1') && e.message.includes('***'));
});
await T('测试结束后项目的 items.json / meta.json 内容未变', () => { assert.equal(sha(ITEMS_FILE), ITEMS_SHA); assert.equal(sha(path.join(ROOT, 'data/meta.json')), META_SHA); });

console.log(n ? `\n结果：${n} 项失败` : '\n结果：全部通过'); process.exit(n ? 1 : 0);
