// lib/market-names.mjs —— 中文名 → Steam marketHashName 的归一化与匹配（纯函数：不读写文件、不联网）。
// 匹配键 = 武器 | 涂装 | 磨损 | 是否 StatTrak。两边（items.json 与 SteamDT 基础资料）都走同一套归一化，
// 并用英文 marketHashName 自带的磨损/StatTrak 信息交叉校验；对不上的一律不匹配，绝不猜。

export const WEAR_CN = [
  ['FN', ['崭新出厂', '崭新出廠', '全新出廠', '全新出厂']],
  ['MW', ['略有磨损', '略有磨損']],
  ['FT', ['久经沙场', '久經沙場']],
  ['WW', ['破损不堪', '破損不堪']],
  ['BS', ['战痕累累', '戰痕累累']]
];
export const WEAR_EN = {
  'Factory New': 'FN', 'Minimal Wear': 'MW', 'Field-Tested': 'FT', 'Well-Worn': 'WW', 'Battle-Scarred': 'BS'
};

const squash = s => String(s ?? '').normalize('NFKC').replace(/[\s()（）[\]【】★]/g, '');

// 解析英文 marketHashName：★ [StatTrak™ ]武器[ | 涂装][ (磨损)]
export function parseHashName(h) {
  if (typeof h !== 'string' || !h.trim()) return null;
  let s = h.trim();
  const star = s.startsWith('★');
  if (star) s = s.slice(1).trim();
  let st = false;
  if (/^StatTrak™\s*/.test(s)) { st = true; s = s.replace(/^StatTrak™\s*/, ''); }
  let wear = null;
  const m = s.match(/\s*\(([^()]+)\)\s*$/);
  if (m && WEAR_EN[m[1]]) { wear = WEAR_EN[m[1]]; s = s.slice(0, m.index); }
  return { star, st, wear, base: s.trim() };
}

// 解析中文名（兼容 “爪子刀（★ StatTrak™） | 多普勒 (崭新出厂)”、“★ StatTrak™ 爪子刀 | 多普勒 (崭新出厂)”、繁体磨损词等写法）
export function parseCnName(name) {
  let s = String(name ?? '').normalize('NFKC');
  const st = /stattrak|暗金/i.test(s);
  s = s.replace(/stattrak(tm)?|暗金/gi, ' ');
  let wear = null;
  for (const [code, words] of WEAR_CN) {
    for (const w of words) if (s.includes(w)) { wear = code; s = s.split(w).join(' '); }
  }
  const parts = s.split('|').map(squash).filter(Boolean);
  return { weapon: parts[0] || '', finish: parts.slice(1).join('|'), wear, st };
}

const keyOf = (weapon, finish, wear, st) => [weapon, finish, wear || '-', st ? 1 : 0].join('|');
export const itemKey = r => keyOf(squash(r.weapon), squash(r.finish || ''), r.wear || null, !!r.stattrak);
export const itemLabel = r => r.weapon + (r.finish ? ' | ' + r.finish : '') + (r.wear ? '（' + (r.stattrak ? 'StatTrak™ ' : '') + r.wear + '）' : (r.stattrak ? '（StatTrak™）' : ''));

// 从各种可能的返回外形里取出条目数组：裸数组 / {data:[..]} / {data:{list:[..]}} / 本工具保存的 {response:{..}}
export function extractEntries(json, depth = 0) {
  if (Array.isArray(json)) return json;
  if (!json || typeof json !== 'object' || depth > 3) return null;
  for (const k of ['response', 'data', 'list', 'dataList', 'items', 'records', 'rows', 'result']) {
    if (k in json) { const r = extractEntries(json[k], depth + 1); if (r) return r; }
  }
  return null;
}

const HASH_FIELDS = ['marketHashName', 'market_hash_name', 'hashName'];
const CN_FIELDS = ['name', 'cnName', 'chineseName', 'zhName', 'itemName', 'marketName', 'localName'];
const CJK = /[\u4e00-\u9fff]/;
const pick = (e, fields, ok) => fields.map(f => e[f]).find(v => typeof v === 'string' && v.trim() && ok(v));

export function readEntry(e) {
  if (!e || typeof e !== 'object') return null;
  const hash = pick(e, HASH_FIELDS, () => true);
  const cn = pick(e, CN_FIELDS, v => CJK.test(v));
  return { hash: hash ? hash.trim() : null, cn: cn ? cn.trim() : null };
}

// 把基础资料建成索引。只收录 ★ 开头的（刀与手套）。
export function buildIndex(entries) {
  const stats = { total: entries.length, no_hash: 0, no_chinese: 0, not_knife_glove: 0, inconsistent: 0, duplicate_hash: 0, usable: 0 };
  const index = new Map(), byHash = new Map(), seenKeys = new Map();
  for (const e of entries) {
    const r = readEntry(e);
    if (!r || !r.hash) { stats.no_hash++; continue; }
    const ph = parseHashName(r.hash);
    if (!ph || !ph.star) { stats.not_knife_glove++; continue; }
    if (!r.cn) { stats.no_chinese++; continue; }
    if (byHash.has(r.hash)) { stats.duplicate_hash++; continue; }
    const pc = parseCnName(r.cn);
    // 中文名里明确写了磨损 / StatTrak 却与英文名不一致 → 不可信，丢弃
    if ((pc.wear && pc.wear !== ph.wear) || (pc.st && !ph.st)) { stats.inconsistent++; continue; }
    const key = keyOf(pc.weapon, pc.finish, ph.wear, ph.st);       // 磨损与 StatTrak 以英文名为准
    const rec = { hash: r.hash, cn: r.cn, key };
    byHash.set(r.hash, rec);
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(rec);
    const fam = key.split('|').slice(0, 2).join('|');                // 同武器同涂装的其他磨损，用于诊断
    if (!seenKeys.has(fam)) seenKeys.set(fam, []);
    seenKeys.get(fam).push(r.hash);
    stats.usable++;
  }
  return { index, byHash, families: seenKeys, stats };
}

const HASH_OK = h => { const p = parseHashName(h); return !!(p && p.star && p.base); };

// 校验人工覆盖表：id → marketHashName。基础资料可用时，必须真实存在于其中。
export function checkOverrides(overrides, items, byHash) {
  const errors = [], ids = new Set(items.map(r => r.id));
  for (const [id, h] of Object.entries(overrides || {})) {
    if (!ids.has(id)) errors.push(`覆盖表里的 id 不存在于 items.json：${id}`);
    else if (typeof h !== 'string' || !HASH_OK(h)) errors.push(`覆盖项格式不对（需以 ★ 开头的 Steam 英文名）：${id} → ${h}`);
    else if (byHash && byHash.size && !byHash.has(h)) errors.push(`覆盖项的英文名不在基础资料里：${id} → ${h}`);
  }
  return errors;
}

export function matchItems(items, base, overrides = {}) {
  const matched = new Map(), review = [];
  for (const r of items) {
    const ov = overrides[r.id];
    if (ov) { matched.set(r.id, { market_hash_name: ov, by: 'override' }); continue; }
    const k = itemKey(r), hits = base.index.get(k) || [];
    const fam = k.split('|').slice(0, 2).join('|');
    if (hits.length === 1) { matched.set(r.id, { market_hash_name: hits[0].hash, by: 'name' }); continue; }
    review.push({
      id: r.id, name: itemLabel(r),
      reason: hits.length > 1 ? 'ambiguous' : 'unmatched',
      candidates: (hits.length > 1 ? hits.map(h => h.hash) : (base.families.get(fam) || [])).slice(0, 6)
    });
  }
  // 两件饰品不得对应同一个英文名
  const byHash = new Map();
  for (const [id, m] of matched) { if (!byHash.has(m.market_hash_name)) byHash.set(m.market_hash_name, []); byHash.get(m.market_hash_name).push(id); }
  const dupes = [...byHash].filter(([, ids]) => ids.length > 1).map(([hash, ids]) => ({ hash, ids }));
  return { matched, review, dupes };
}
