// Netlify Function：SteamDT K 线服务端代理。GET /api/kline?name=<marketHashName>&type=1&platform=ALL
// API 密钥只从服务端环境变量 STEAMDT_API_KEY 读取，不会出现在网页代码、仓库或返回内容中。
const UPSTREAM = 'https://open.steamdt.com/open/cs2/item/v1/kline';
const PLATFORMS = ['ALL', 'BUFF', 'YOUPIN', 'C5', 'STEAM', 'HALOSKINS'];
const json = (status, body, cache) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cache || 'no-store', ...(status === 200 && cache ? { 'Netlify-CDN-Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' } : {}) } });

// 把上游返回的 data 解析成 [{t: 毫秒时间戳, p: 价格}]。
// 数组行默认 [时间戳, 开, 收, 高, 低...]，价格取第 PRICE_INDEX 列（可用环境变量 STEAMDT_KLINE_PRICE_INDEX 调整）；对象行取 close/price 等字段。
export function parseKline(data, priceIndex = 2) {
  const rows = Array.isArray(data) ? data : (data && (data.dataList || data.list || data.klineList)) || [];
  const seen = new Map();
  for (const r of rows) {
    let t, p;
    if (Array.isArray(r)) { t = Number(r[0]); p = Number(r[priceIndex]); }
    else if (r && typeof r === 'object') { t = Number(r.timestamp ?? r.time ?? r.t ?? r.date); p = Number(r.close ?? r.closePrice ?? r.price ?? r.c); }
    if (!Number.isFinite(t) || !Number.isFinite(p) || p <= 0) continue;
    if (t < 1e11) t *= 1000; // 秒 → 毫秒
    seen.set(t, p);
  }
  return [...seen].sort((a, b) => a[0] - b[0]).map(([t, p]) => ({ t, p }));
}

export default async (req) => {
  const key = process.env.STEAMDT_API_KEY;
  if (!key) return json(500, { error: 'server_not_configured' });
  const origin = req.headers.get('origin'), host = req.headers.get('host');
  if (origin && host && new URL(origin).host !== host) return json(403, { error: 'forbidden' }); // 只服务本站页面
  const q = new URL(req.url).searchParams;
  const name = (q.get('name') || '').trim(), type = Number(q.get('type') || 1), platform = (q.get('platform') || 'ALL').toUpperCase(), style = (q.get('style') || '').trim();
  if (!name || name.length > 200 || /[\u0000-\u001f]/.test(name)) return json(400, { error: 'bad_name' });
  if (![1, 2, 3].includes(type)) return json(400, { error: 'bad_type' });
  if (!PLATFORMS.includes(platform)) return json(400, { error: 'bad_platform' });
  if (style.length > 40) return json(400, { error: 'bad_style' });
  const body = { marketHashName: name, type, ...(platform !== 'ALL' ? { platform } : {}), ...(style ? { specialStyle: style } : {}) };
  let res, up;
  try {
    res = await fetch(UPSTREAM, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    up = await res.json();
  } catch (e) { return json(502, { error: 'upstream_unreachable' }); }
  if (!res.ok || !up || up.success !== true) return json(502, { error: 'upstream_error', message: String((up && (up.errorMsg || up.errorCodeStr)) || res.status).slice(0, 200) });
  const idx = Number(process.env.STEAMDT_KLINE_PRICE_INDEX ?? 2), points = parseKline(up.data, Number.isInteger(idx) ? idx : 2);
  if (q.get('debug') === '1') return json(200, { debug: true, sampleRows: (Array.isArray(up.data) ? up.data : []).slice(0, 3), dataKeys: up.data && !Array.isArray(up.data) ? Object.keys(up.data) : null, parsed: points.length });
  if (!points.length) return json(404, { error: 'no_data' });
  return json(200, { name, type, platform, source: 'SteamDT', fetched_at: new Date().toISOString(), count: points.length, points }, 'public, max-age=300');
};
export const config = { path: '/api/kline' };
