# CS 饰品行情（阶段 1：数据架构）

index.html          页面（只负责展示，样式与结构不变）
js/data-store.js    数据层：读取、校验、统一结构、六个榜单的计算
data/items.json     唯一数据源（538 件饰品，每件一条记录）
data/meta.json      更新时间、默认市场、手动填写的大盘汇总
data/name-map.json  英文名 ↔ 繁体 / 简体名称映射（原 ITEMS 里的名称部分）
backup/             原版 index.original.html + SHA256（可随时还原）
tests/compare.mjs   原版 vs 新版对照测试：node tests/compare.mjs（结果见 tests/REPORT.txt）

注意：页面用 fetch 读取 data/*.json，直接双击打开 index.html（file://）读不到数据；
请用 Netlify 预览，或在本目录运行 `npx serve` 后访问本地地址。

## 历史价格走势（SteamDT K 线）
netlify/functions/steamdt-kline.mjs  服务端代理，网页通过 /api/kline 调用，密钥不出服务器
js/history-chart.js                  走势图区块（index.html 里 #s-hist）
tests/kline.test.mjs                 代理与走势图测试：node tests/kline.test.mjs

环境变量（Netlify → Site configuration → Environment variables）：
  STEAMDT_API_KEY               必填，SteamDT 开放平台密钥（只配置在 Netlify，不要写进代码或提交到 GitHub）
  STEAMDT_KLINE_PRICE_INDEX     选填，K 线数组里“价格”所在列，默认 2；若接口列顺序不同再设置
配置后重新部署一次。上线后先打开 /api/kline?name=<英文名>&debug=1 查看返回的前几行，确认价格列。
本地调试：创建不入库的 .env 写入 STEAMDT_API_KEY，运行 npx netlify dev。
