'use strict';
// 浏览器扩展在哪儿装 —— 全仓唯一一处。
//
// 商店分配的地址只有**发布之后**才知道，所以它先是空的。空着的时候，应用里的引导页和官网上那个按钮
// 都退回到「加载已解压的扩展程序」那条路——不填不会坏，只是多三步手动。
// 拿到地址填在这里，三处会一起跟着变：
//   src/main/install-page.js              浏览器里那张引导页，商店那一步升到第一条
//   src/renderer/workspace/workspace.js   设置里的安装说明
//   site/index.html                       官网「装扩展」的按钮（npm run site 时注入）
//
// 提交材料见 docs/chrome-web-store.md。
//
// 这个文件**不许 require electron**：scripts/build-site.js 是一个普通的 node 脚本，
// 它要 require 这里拿同一个地址，才谈得上「唯一一处」。

/** 填了就生效。形如 https://chromewebstore.google.com/detail/<slug>/<32 位 id> */
const CHROME_WEB_STORE_URL = '';

/** Edge 商店是另一次提交，另一个地址。没有就留空，Edge 用户走 Chrome 商店也能装。 */
const EDGE_ADDONS_URL = '';

/**
 * 这个浏览器该去哪个商店。Edge 没单独上架时回落到 Chrome 商店——Edge 能装 Chrome 商店的扩展。
 * @param {string} [browser] 'edge' | 'chrome' | 其它
 * @returns {string} 商店地址，或空字符串表示还没发布
 */
function storeUrl(browser) {
  if (browser === 'edge' && EDGE_ADDONS_URL) return EDGE_ADDONS_URL;
  return CHROME_WEB_STORE_URL || '';
}

/** 发布了没有。没发布时，界面上不要出现一个点不开的「去商店」按钮。 */
function published() {
  return !!CHROME_WEB_STORE_URL;
}

module.exports = { CHROME_WEB_STORE_URL, EDGE_ADDONS_URL, storeUrl, published };
