/* data-store.js — 行情数据层：读取、校验、统一结构、榜单计算。页面（index.html）只负责展示。
 * 统一记录（data/items.json 的 items[]）一件饰品在「一个市场」的一条记录，(id, market) 唯一：
 *   id, market, type(knife|glove), weapon, finish, wear(FN|MW|FT|WW|BS|null), stattrak,
 *   market_hash_name(暂为 null), currency, price, change_pct(百分数，-5.2 表示 -5.2%), period_days,
 *   volume(周期内成交件数), turnover(周期内成交额，货币单位), volume_ratio, listings, updated_at, source
 * 可选：prev_price（来源直接提供前周期价时填写）。未提供时由 price 与 change_pct 推算，并标 prev_price_derived=true。
 * 以后接入其他市场/API：只需输出同样结构的记录（market 不同即可），页面与榜单逻辑不用改。 */
(function (g) {
  var WEAR_ZH = { FN: '崭新出厂', MW: '略有磨损', FT: '久经沙场', WW: '破损不堪', BS: '战痕累累' };
  var LIMIT = 100;
  // 六个榜单的定义（顺序不可随意改动：买点建议按此顺序取首个出现的同名饰品）
  var RANKINGS = [
    { id: 'KG', type: 'knife', by: 'change_pct', dir: 'desc' },
    { id: 'KL', type: 'knife', by: 'change_pct', dir: 'asc' },
    { id: 'KS', type: 'knife', by: 'volume', dir: 'desc' },
    { id: 'GG', type: 'glove', by: 'change_pct', dir: 'desc' },
    { id: 'GL', type: 'glove', by: 'change_pct', dir: 'asc' },
    { id: 'GS', type: 'glove', by: 'volume', dir: 'desc' }
  ];
  var NUM = ['price', 'change_pct', 'period_days', 'volume', 'turnover', 'volume_ratio', 'listings'];
  var STR = ['id', 'market', 'type', 'weapon', 'currency', 'updated_at', 'source'];

  function validate(items) {
    var err = [], seen = {};
    if (!Array.isArray(items) || !items.length) throw new Error('items.json 为空或格式错误，已拒绝载入');
    items.forEach(function (r, i) {
      var p = '第 ' + (i + 1) + ' 条(' + (r && r.id) + ')：';
      if (!r || typeof r !== 'object') return err.push(p + '不是对象');
      STR.forEach(function (k) { if (typeof r[k] !== 'string' || !r[k]) err.push(p + '缺少文字字段 ' + k); });
      NUM.forEach(function (k) { if (typeof r[k] !== 'number' || !isFinite(r[k])) err.push(p + '数值字段 ' + k + ' 无效'); });
      if (r.type !== 'knife' && r.type !== 'glove') err.push(p + 'type 必须是 knife 或 glove');
      if (r.wear !== null && !WEAR_ZH[r.wear]) err.push(p + 'wear 无效');
      if (!(r.price > 0)) err.push(p + 'price 必须大于 0');
      if (!(r.volume >= 0) || !(r.turnover >= 0) || !(r.listings >= 0)) err.push(p + '成交量/成交额/挂单不能为负');
      if (!(r.period_days > 0)) err.push(p + 'period_days 必须大于 0');
      if (r.change_pct <= -100) err.push(p + 'change_pct 不能 ≤ -100%');
      var key = r.id + '@' + r.market;
      if (seen[key]) err.push(p + 'id+market 重复'); seen[key] = 1;
    });
    if (err.length) throw new Error('数据校验失败（共 ' + err.length + ' 项），例如：' + err.slice(0, 3).join('；'));
    return items;
  }

  function derive(r) { // 推算前周期价与涨跌金额；公式与原页面一致：price / (1 + 涨跌%/100)
    var o = Object.assign({}, r);
    if (typeof o.prev_price !== 'number') { o.prev_price = o.price / (1 + o.change_pct / 100); o.prev_price_derived = true; }
    o.change_amount = o.price - o.prev_price;
    return o;
  }

  function displayName(r) { // 简体名称，与原页面完全一致
    return r.weapon + '（★）' + (r.finish ? ' | ' + r.finish : '') +
      (r.wear ? '（' + (r.stattrak ? 'StatTrak™ ' : '') + WEAR_ZH[r.wear] + '）' : '');
  }

  function rank(items, def) { // 稳定排序：同值时保持 items.json 中的先后顺序
    return items.filter(function (r) { return r.type === def.type; })
      .sort(function (a, b) { return def.dir === 'desc' ? b[def.by] - a[def.by] : a[def.by] - b[def.by]; })
      .slice(0, LIMIT);
  }

  // 旧页面使用的行格式：[名称, 现价, 涨跌%, 成交件数, 成交额(万), 量比, 挂单, 'k'|'g']
  function legacyRow(r) {
    return [displayName(r), r.price, r.change_pct, r.volume, r.turnover / 1e4, r.volume_ratio, r.listings, r.type === 'glove' ? 'g' : 'k'];
  }

  function build(raw, market) {
    var all = validate(raw.items), m = market || raw.meta.default_market;
    var items = all.filter(function (r) { return r.market === m; }).map(derive);
    if (!items.length) throw new Error('找不到市场「' + m + '」的数据');
    var rankings = {}, legacy = {};
    RANKINGS.forEach(function (d) { rankings[d.id] = rank(items, d); legacy[d.id] = rankings[d.id].map(legacyRow); });
    return { meta: raw.meta, items: items, nameMap: raw.nameMap, rankings: rankings, legacy: legacy, market: m };
  }

  function load(base) {
    var get = function (f) {
      return fetch(base + '/data/' + f, { cache: 'no-store' }).then(function (x) {
        if (!x.ok) throw new Error(f + ' 读取失败（HTTP ' + x.status + '）'); return x.json();
      });
    };
    return Promise.all([get('items.json'), get('meta.json'), get('name-map.json')]).then(function (a) {
      return build({ items: a[0].items, meta: a[1], nameMap: a[2].names });
    });
  }

  g.CSStore = { load: load, build: build, validate: validate, derive: derive, displayName: displayName, RANKINGS: RANKINGS, LIMIT: LIMIT };
})(typeof window !== 'undefined' ? window : globalThis);
