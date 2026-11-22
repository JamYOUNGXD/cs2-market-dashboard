
const UPSTREAM = 'https://open.steamdt.com/open/cs2/item/v1/kline';

const PLATFORMS = [
  'ALL', 'BUFF', 'YOUPIN', 'C5', 'STEAM', 'HALOSKINS'
];

function json(res, status, body, cache = 'no-store') {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cache);
  return res.status(status).json(body);
}

export function parseKline(data, priceIndex = 2) {
  const rows = Array.isArray(data)
    ? data
    : (data && (data.dataList || data.list || data.klineList)) || [];

  const seen = new Map();

  for (const r of rows) {
    let t, p;

    if (Array.isArray(r)) {
      t = Number(r[0]);
      p = Number(r[priceIndex]);
    } else if (r && typeof r === 'object') {
      t = Number(r.timestamp ?? r.time ?? r.t ?? r.date);
      p = Number(r.close ?? r.closePrice ?? r.price ?? r.c);
    }

    if (!Number.isFinite(t) || !Number.isFinite(p) || p <= 0) continue;

    if (t < 1e11) t *= 1000;

    seen.set(t, p);
  }

  return [...seen]
    .sort((a, b) => a[0] - b[0])
    .map(([t, p]) => ({ t, p }));
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return json(res, 405, { error: 'method_not_allowed' });
  }

  const key = process.env.STEAMDT_API_KEY;

  if (!key) {
    return json(res, 500, { error: 'server_not_configured' });
  }

  const origin = req.headers.origin;
  const host = req.headers.host;

  if (origin && host) {
    try {
      if (new URL(origin).host !== host) {
        return json(res, 403, { error: 'forbidden' });
      }
    } catch {
      return json(res, 403, { error: 'forbidden' });
    }
  }

  const q = new URL(req.url, `https://${host || 'localhost'}`).searchParams;

  const name = (q.get('name') || '').trim();
  const type = Number(q.get('type') || 1);
  const platform = (q.get('platform') || 'ALL').toUpperCase();
  const style = (q.get('style') || '').trim();

  if (!name || name.length > 200 || /[\u0000-\u001f]/.test(name)) {
    return json(res, 400, { error: 'bad_name' });
  }

  if (![1, 2, 3].includes(type)) {
    return json(res, 400, { error: 'bad_type' });
  }

  if (!PLATFORMS.includes(platform)) {
    return json(res, 400, { error: 'bad_platform' });
  }

  if (style.length > 40) {
    return json(res, 400, { error: 'bad_style' });
  }

  const body = {
    marketHashName: name,
    type,
    ...(platform !== 'ALL' ? { platform } : {}),
    ...(style ? { specialStyle: style } : {})
  };

  let upstream;

  try {
    const response = await fetch(UPSTREAM, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + key
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000)
    });

    upstream = await response.json();

    if (!response.ok || !upstream || upstream.success !== true) {
      return json(res, 502, {
        error: 'upstream_error',
        message: String(
          (upstream && (upstream.errorMsg || upstream.errorCodeStr))
          || response.status
        ).slice(0, 200)
      });
    }
  } catch {
    return json(res, 502, { error: 'upstream_unreachable' });
  }

  const idx = Number(process.env.STEAMDT_KLINE_PRICE_INDEX ?? 2);

  const points = parseKline(
    upstream.data,
    Number.isInteger(idx) ? idx : 2
  );

  if (q.get('debug') === '1') {
    return json(res, 200, {
      debug: true,
      sampleRows: (Array.isArray(upstream.data)
        ? upstream.data : []).slice(0, 3),
      dataKeys: upstream.data && !Array.isArray(upstream.data)
        ? Object.keys(upstream.data) : null,
      parsed: points.length
    });
  }

  if (!points.length) {
    return json(res, 404, { error: 'no_data' });
  }

  return json(res, 200, {
    name,
    type,
    platform,
    source: 'SteamDT',
    fetched_at: new Date().toISOString(),
    count: points.length,
    points
  }, 'public, max-age=300, s-maxage=300');
}
