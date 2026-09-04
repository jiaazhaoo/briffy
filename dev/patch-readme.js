// Rewrites the gesture table and the first-run paragraph for the new capture modes.
const fs = require('fs');
let r = fs.readFileSync('README.md', 'utf8');

const start = r.indexOf('| 动作 | 效果 |');
const end = r.indexOf('\n\n', start);
if (start < 0 || end < 0) throw new Error('gesture table not found');

const rows = [
  '| 动作 | 效果 |',
  '| --- | --- |',
  '| **单击小猫** | 截整个屏幕，原图保存 + OCR，同时复制到系统剪贴板 |',
  '| **双击小猫** | 框选截图：屏幕冻结后拖拽选区，回车确认、Esc 取消，同样保存 + OCR + 复制 |',
  '| **中键点击小猫**（或长按 0.55 秒） | 开始 / 结束录音。触控板没有中键，长按是等价操作 |',
  '| `Ctrl+Alt+A`（macOS `Cmd+Shift+A`） | 框选截图 |',
  '| `Ctrl+Alt+S`（macOS `Cmd+Shift+S`） | 整屏截图 |',
  '| `Ctrl+Alt+V`（macOS `Cmd+Shift+V`） | 开始 / 结束录音 |',
  '| 把图片 / 文件 / 链接 / 文字拖到小猫身上 | 存入工作区（图片会 OCR，PDF 和网页会读取内容） |',
  '| 右键小猫 / 托盘图标 | 打开工作区、设置、手动生成摘要、隐藏小猫、退出 |',
  '| 复制任何东西（Ctrl+C / Cmd+C） | 剪贴板里的文字、图片、文件都会实时存入工作区并打五个词；设置 › 剪贴板 或托盘菜单可以关掉 |',
  '| 浏览器里按 Alt+Shift+D | 浏览器扩展列出当前网页所有图片 / 视频 / 音频，勾选后一键存入工作区 |',
].join('\n');

r = `${r.slice(0, start)}${rows}${r.slice(end)}`;

r = r.replace(
  /首次运行：\*\*设置 › 一键配置 › 开始自动配置\*\*。[^\n]*\n/,
  '**不需要任何配置步骤**：第一次启动时程序自己检查这台电脑并准备好本地的文字识别和语音识别引擎，需要下载时小猫会在气泡里说一声。设置 › 本机准备情况 里能看到结果，每一项都可以自己改，也能点「重新检查」再跑一遍。\n',
);

// note about clipboard + double-recording, right after the table's following paragraph
if (!r.includes('截图会同时进系统剪贴板')) {
  r = r.replace(
    /(\*\*不做任何翻译\*\*)/,
    '截图会同时进系统剪贴板（像微信截图那样，截完直接粘贴），但**不会因此被记录两次**——程序会告诉剪贴板监听器跳过自己刚放进去的那张图。不想进剪贴板可以在 设置 › 截图快捷键 里关掉。\n\n$1',
  );
}

fs.writeFileSync('README.md', r);
console.log('readme updated');
