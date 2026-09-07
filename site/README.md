# site/ — briffy 的官网

线上：**<https://briffy.cc>**（中文）· **<https://briffy.cc/en/>**（English）

一份双语源文件，发布出去是**两个真正的单语页面**。没有构建依赖，`node` 就够。

```
site/                  源
  index.html           整页，两种语言都在 DOM 里（.zh / .en），本地预览靠按钮切
  site.css             版面。视觉标准见 ../.claude/skills/paper-ui/SKILL.md
  site.js              语言切换 · 回形针的表情 · 波形 · 瀑布流
  paper/tokens.css     ← assets/paper/tokens.css 的拷贝
  briffy-anim.js       ← assets/brand/briffy-anim.js 的拷贝
  favicon.svg  og.png  shot.svg

site-dist/             产物，不进版本库
  index.html           中文
  en/index.html        English
  404.html  _headers   + 上面那几个静态文件
```

## 三条命令

```bash
node dev/preview/serve.js   # 看源文件：http://localhost:5173/site/
npm run site                # 切成两页：site-dist/
npm run deploy              # 切完直接发到 briffy.cc
```

`npm run site` 之后，发布出去的那两页也能在本地看：
<http://localhost:5173/site-dist/> 和 <http://localhost:5173/site-dist/en/>。

## 为什么是两页，不是一页加个按钮

一个页面服务两种语言，链接分不开、搜索引擎收不进去、分享出去的标题永远是其中一种。
所以 [scripts/build-site.js](../scripts/build-site.js) 把另一种语言的元素整个删掉，
写上各自的 `<title>` / `description` / `og:*` / `canonical` / `hreflang`，
再把那个切换**按钮换成一条真链接**——两页之间靠 `href` 走，不靠 JS。

它还会在 `<html>` 上打一个 `data-fixed-lang`，`site.js` 见到就不再按浏览器语言去改 `<html lang>`——
不然仅存的那一份文案会被 CSS 藏掉，剩下一张空白的纸。

**站点的每一个字都只在 `site/index.html` 里**，包括两种语言的标题和描述
（躺在 `x-title-*` / `x-desc-*` 四个 meta 里，构建时挑走再删掉）。

## 部署

[wrangler.jsonc](../wrangler.jsonc) 在仓库根上，用的是 **Workers 静态资源**，不是 Pages：
域名写在 `routes` 里（`custom_domain: true`），部署时 Cloudflare 自己建 DNS 记录、签证书，
不用再去后台点一遍。只发静态文件的 Worker 不需要 `main`。

`/en` 会自动跳到 `/en/`（`html_handling: auto-trailing-slash`）——少了那道斜杠，
页面里的相对路径会落到站点根上。找不到的地址走 `404.html`。

第一次在别的机器上发之前要先 `npx wrangler login`。

## 两份拷贝

`paper/tokens.css` 和 `briffy-anim.js` 是从 `assets/` 复制过来的，和 `extension/paper/tokens.css`
是同一个道理：那两处都要能脱离仓库单独跑。**唯一来源仍然是 `assets/`**，改完那边同步一次：

```bash
cp assets/paper/tokens.css site/paper/tokens.css
cp assets/brand/briffy-anim.js site/briffy-anim.js
```

`briffy-anim.js` 一个字都不要在这里改——站点上那枚回形针做的表情，和桌面上那只是同一段代码算出来的，
这正是它值得复制而不是重画的原因。

## 站点和应用不一样的地方

只有两处，都写在 `site.css` 顶上的注释里：

1. **字阶另起一组**（`--t-*`）。应用的六级是坐在窗口前 13px 的阅读距离定的，网页不是。
   六级本身一个都没动——「五种纸」那一段用的就是应用里的真实尺寸（一列 240px），不然它就不是真的了。
2. **字体从 Google Fonts 取**。应用把字体随包带走、不联网取字；网页没有这条约束，
   所以直接取同样的三个 OFL 字面（Source Sans 3 / Noto Sans SC / IBM Plex Mono）。取不到会退回系统字。

别的都照 paper-ui 走：全直角、没有边框和分隔线、分组只靠留白、一种字体、一屏一个彩色。
**这一页上唯一有影子的东西是记录卡片本身**——标题、正文、导航、按钮全是印在底纸上的字，永远层 0。
