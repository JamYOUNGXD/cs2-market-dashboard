// tools/build-market-names.mjs —— 为 data/items.json 的每件饰品匹配 Steam 英文名（marketHashName），输出 data/market-names.json。
// 只读 items.json，绝不写 items.json / meta.json；默认只读本地基础资料，不联网。
//
// 用法（在项目根目录）：
//   1) 一次性下载基础资料（只有你明确执行这一步才会请求 SteamDT；已存在本地文件时拒绝，除非加 --force）：
//        node --env-file=.env tools/build-market-names.mjs --fetch
//      .env 里写 STEAMDT_API_KEY=你的密钥（.env 已在 .gitignore 中，不会提交）。
//   2) 离线匹配（读 data/raw/steamdt-base.json，可反复运行，不联网）：
//        node tools/build-market-names.mjs
//   可选：--base <文件> --items <文件> --out <文件> --overrides <文件> --dry-run --strict
//        --url <地址> --method GET|POST   （--fetch 用；默认地址按官方文档填写，请自行核对，不同时用 --url 覆盖）
// 无法自动匹配的项目会列在输出文件的 needs_review 里；确认后把 id → 英文名 填进 data/market-names.overrides.json 再运行。
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { extractEntries, buildIndex, matchItems, checkOverrides } from '../lib/market-names.mjs';

const DEFAULT_URL = 'https://open.steamdt.com/open/cs2/v1/base';

function parseArgs(argv) {
  const o = { flags: new Set(), val: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error('未知参数：' + a);
    const k = a.slice(2);
    if (['base', 'items', 'out', 'overrides', 'url', 'method'].includes(k)) {
      if (i + 1 >= argv.length) throw new Error('--' + k + ' 缺少取值');
      o.val[k] = argv[++i];
    } else if (['fetch', 'force', 'dry-run', 'strict'].includes(k)) o.flags.add(k);
    else throw new Error('未知参数：' + a);
  }
  return o;
}

const writeAtomic = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, text); fs.renameSync(tmp, file);
};
const readJson = (file, what) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { throw new Error(`读取${what}失败（${file}）：${e.message}`); }
};

export async function run(argv, { env = process.env, fetchImpl = globalThis.fetch, root = process.cwd(), log = console.log } = {}) {
  const a = parseArgs(argv), R = p => path.resolve(root, p);
  const baseFile = R(a.val.base || 'data/raw/steamdt-base.json');
  const itemsFile = R(a.val.items || 'data/items.json');
  const outFile = R(a.val.out || 'data/market-names.json');
  const ovFile = R(a.val.overrides || 'data/market-names.overrides.json');

  // ---------- 下载基础资料（仅 --fetch） ----------
  if (a.flags.has('fetch')) {
    const key = env.STEAMDT_API_KEY;
    if (!key) throw new Error('缺少 STEAMDT_API_KEY：请在 .env 中设置，并用 node --env-file=.env 运行');
    if (fs.existsSync(baseFile) && !a.flags.has('force')) throw new Error(`本地已有基础资料：${baseFile}。为避免浪费接口额度，已拒绝再次下载（确需重下请加 --force）`);
    const url = a.val.url || DEFAULT_URL, method = (a.val.method || 'GET').toUpperCase();
    if (!['GET', 'POST'].includes(method)) throw new Error('--method 只能是 GET 或 POST');
    const scrub = s => String(s).split(key).join('***');
    let res, body;
    try {
      res = await fetchImpl(url, { method, headers: { Authorization: 'Bearer ' + key, ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) }, ...(method === 'POST' ? { body: '{}' } : {}), signal: AbortSignal.timeout(60000) });
      body = await res.json();
    } catch (e) { throw new Error('请求基础资料失败：' + scrub(e.message)); }
    if (!res.ok || (body && body.success === false)) throw new Error('SteamDT 返回错误：' + scrub((body && (body.errorMsg || body.errorCodeStr)) || res.status).slice(0, 200));
    const entries = extractEntries(body);
    if (!entries || !entries.length) throw new Error('返回内容里找不到条目数组，未保存。顶层字段：' + Object.keys(body || {}).join(','));
    writeAtomic(baseFile, JSON.stringify({ _meta: { fetched_at: new Date().toISOString(), url, method }, response: body }));
    log(`已保存基础资料：${path.relative(root, baseFile)}（${entries.length} 条）。第一条的字段：${Object.keys(entries[0] || {}).join(', ')}`);
    log('下一步（离线，不再联网）：node tools/build-market-names.mjs');
    return { fetched: entries.length };
  }

  // ---------- 离线匹配 ----------
  if (!fs.existsSync(baseFile)) throw new Error(`找不到本地基础资料：${baseFile}。请先执行一次 --fetch，或把已有的基础资料 JSON 放到该路径`);
  if ([itemsFile].some(f => outFile === f) || /(^|[\\/])(items|meta)\.json$/.test(outFile)) throw new Error('拒绝写入 items.json / meta.json');
  const items = readJson(itemsFile, ' items.json').items;
  if (!Array.isArray(items) || !items.length) throw new Error('items.json 里没有 items 数组');
  const raw = readJson(baseFile, '基础资料');
  const entries = extractEntries(raw);
  if (!entries) throw new Error('基础资料里找不到条目数组，顶层字段：' + Object.keys(raw || {}).join(','));
  const base = buildIndex(entries);
  if (!base.stats.usable) {
    const first = entries.find(e => e && typeof e === 'object') || {};
    throw new Error(`基础资料里没有可用条目（需要同时有 marketHashName 和含中文的名称字段）。统计：${JSON.stringify(base.stats)}；第一条的字段：${Object.keys(first).join(', ')}`);
  }
  const overrides = fs.existsSync(ovFile) ? readJson(ovFile, '覆盖表') : {};
  const ovErr = checkOverrides(overrides, items, base.byHash);
  if (ovErr.length) throw new Error('覆盖表有误：\n  ' + ovErr.join('\n  '));

  const { matched, review, dupes } = matchItems(items, base, overrides);
  if (dupes.length) throw new Error('出现两件饰品对应同一个英文名：' + JSON.stringify(dupes.slice(0, 3)));

  const itemsOut = {};
  for (const r of items) if (matched.has(r.id)) itemsOut[r.id] = matched.get(r.id);
  const nOv = [...matched.values()].filter(m => m.by === 'override').length;
  const out = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    base: { file: path.relative(root, baseFile).split(path.sep).join('/'), fetched_at: (raw._meta && raw._meta.fetched_at) || fs.statSync(baseFile).mtime.toISOString(), ...base.stats },
    summary: { items: items.length, matched: matched.size, by_override: nOv, needs_review: review.length },
    items: itemsOut,
    needs_review: review
  };
  log(`饰品 ${items.length} 件：匹配 ${matched.size}（其中人工覆盖 ${nOv}），需复核 ${review.length}。基础资料可用条目 ${base.stats.usable}/${base.stats.total}。`);
  log('基础资料统计：' + JSON.stringify(base.stats));
  for (const v of review.slice(0, 15)) log(`  [${v.reason}] ${v.id}  ${v.name}${v.candidates.length ? '  候选：' + v.candidates.join(' ; ') : ''}`);
  if (review.length > 15) log(`  …另有 ${review.length - 15} 项，见输出文件 needs_review`);
  if (a.flags.has('dry-run')) log('（--dry-run：未写入文件）');
  else { writeAtomic(outFile, JSON.stringify(out, null, 1) + '\n'); log('已写入：' + path.relative(root, outFile)); }
  return { out, strictFail: a.flags.has('strict') && review.length > 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2)).then(r => { if (r && r.strictFail) process.exit(1); }, e => { console.error('错误：' + e.message); process.exit(2); });
}
