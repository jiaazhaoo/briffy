'use strict';
// Local fallback for the "five words" tagger: used when no AI provider is configured or the provider fails.
// Uses Intl.Segmenter (full ICU ships with Electron) so Chinese/Japanese text is split into words, scores
// candidates with TF-IDF against the user's own history (so recurring UI chrome such as browser tabs, tray
// icons and menu labels sinks), and prefers multi-word names ("Facebook Marketplace") over loose tokens.

const STOP = new Set([
  // English function words
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'for', 'with', 'by', 'from', 'as', 'is', 'are',
  'was', 'were', 'be', 'been', 'being', 'it', 'its', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'we',
  'they', 'them', 'my', 'your', 'our', 'their', 'me', 'him', 'her', 'us', 'not', 'no', 'yes', 'if', 'then', 'than',
  'so', 'do', 'does', 'did', 'done', 'have', 'has', 'had', 'will', 'would', 'can', 'could', 'should', 'may', 'might',
  'about', 'into', 'over', 'under', 'up', 'down', 'out', 'more', 'most', 'some', 'any', 'all', 'each', 'other', 'such',
  'only', 'also', 'just', 'very', 'there', 'here', 'when', 'where', 'which', 'who', 'what', 'how', 'why', 'www', 'http',
  'https', 'com', 'html', 'null', 'undefined', 'true', 'false', 'new', 'one', 'two', 'get', 'set', 'use', 'via', 'per',
  // UI chrome (browser / OS / social apps) that shows up in nearly every screenshot
  'tab', 'tabs', 'search', 'home', 'explore', 'notifications', 'notification', 'messages', 'message', 'bookmarks',
  'profile', 'settings', 'setting', 'menu', 'file', 'edit', 'view', 'help', 'window', 'close', 'back', 'forward',
  'reload', 'login', 'log', 'sign', 'signin', 'signup', 'subscribe', 'follow', 'following', 'followers', 'share',
  'like', 'likes', 'reply', 'replies', 'repost', 'reposts', 'views', 'ago', 'min', 'mins', 'hour', 'hours', 'today',
  'yesterday', 'trending', 'show', 'see', 'read', 'open', 'save', 'saved', 'cancel', 'ok', 'next', 'previous', 'page',
  'chat', 'send', 'type', 'enter', 'click', 'add', 'delete', 'remove', 'copy', 'paste', 'select', 'name', 'date',
  'time', 'day', 'week', 'month', 'year', 'am', 'pm', 'for', 'sale', 'free', 'online', 'download', 'upload', 'loading',
  'hello', 'hi', 'hey', 'thanks', 'thank', 'please', 'remember', 'quick', 'test', 'tomorrow', 'morning', 'afternoon',
  'evening', 'tonight', 'something', 'anything', 'everything', 'thing', 'things', 'really', 'actually', 'maybe',
  // Chinese function words + UI chrome
  '的', '了', '和', '是', '在', '我', '有', '就', '不', '人', '都', '一', '一个', '上', '也', '很', '到', '说', '要', '去',
  '你', '会', '着', '没有', '看', '好', '自己', '这', '那', '他', '她', '它', '我们', '你们', '他们', '这个', '那个',
  '什么', '可以', '这样', '那样', '因为', '所以', '但是', '如果', '而且', '或者', '以及', '还是', '然后', '已经',
  '没', '与', '及', '等', '被', '把', '让', '给', '从', '对', '为', '以', '之', '中', '里', '后', '前', '时', '年',
  '月', '日', '点', '分', '秒', '个', '些', '样', '吗', '呢', '吧', '啊', '呀', '哦', '嗯', '啦', '将', '并',
  '于', '其', '此', '该', '各', '每', '又', '再', '还', '只', '才', '却', '更', '最', '太', '非常', '比较', '进行',
  '通过', '根据', '关于', '以上', '以下', '这些', '那些', '一下', '一些', '一种', '一样', '如何', '怎么', '为什么',
  '首页', '搜索', '设置', '更多', '登录', '注册', '关注', '分享', '评论', '转发', '点赞', '收藏', '消息', '通知',
  '无线', '网络', '电量', '输入法', '菜单', '文件', '编辑', '视图', '帮助', '窗口', '关闭', '返回', '刷新', '发送',
  '打开', '保存', '取消', '确定', '下一步', '上一步', '页面', '查看', '显示', '全部', '今天', '昨天', '小时', '分钟',
  '在线', '下载', '上传', '加载', '正在', '推荐', '热门', '最新', '免费', '出售', '广告',
  '明天', '后天', '上午', '下午', '晚上', '早上', '时候', '时间', '问题', '东西', '事情', '现在', '可能', '需要',
  '知道', '觉得', '开始', '结束', '记得', '这是', '一段', '一点', '一起', '大家', '其他', '还有', '起来', '出来',
  '看到', '听到', '感觉', '应该', '可能', '不是', '就是', '这里', '那里', '一次', '第一', '第二', '几个', '两个',
  // Japanese particles
  'の', 'に', 'は', 'を', 'た', 'が', 'で', 'て', 'と', 'し', 'れ', 'さ', 'ある', 'いる', 'も', 'する', 'から', 'な',
  'こと', 'として', 'い', 'や', 'など', 'なっ', 'ない', 'この', 'ため', 'その', 'あっ', 'よう', 'また', 'もの',
]);

const CJK = /[぀-ヿ㐀-䶿一-鿿가-힯]/u;
const LETTER = /\p{L}/u;
// Common Chinese verbs/adverbs: fine as single words, but they must not be glued into compounds ("讨论第三").
const NO_COMPOUND = new Set([
  '讨论', '开会', '见过', '发给', '记得', '进行', '使用', '支持', '需要', '可以', '认为', '觉得', '希望', '提供',
  '包括', '通过', '成为', '出现', '发生', '表示', '显示', '选择', '打开', '关闭', '登录', '点击', '看到', '听到',
  '知道', '告诉', '准备', '继续', '完成', '开始', '结束', '决定', '带来', '得到', '拿到', '放在', '处理', '解决',
  '哪些', '这些', '那些', '什么', '怎么', '为什么', '如何', '是否', '已经', '还是', '就是', '不是', '可能',
]);

// Drops OCR garbage lines (icon bars, tray text) where most characters are not letters.
function cleanLines(text) {
  return String(text).split(/\r?\n/).filter((line) => {
    const t = line.trim();
    if (t.length < 2) return false;
    let letters = 0; let total = 0;
    for (const ch of t) { if (/\s/.test(ch)) continue; total++; if (LETTER.test(ch)) letters++; }
    return total > 0 && letters / total >= 0.6;
  }).join('\n');
}

function segment(text, lang) {
  const words = [];
  try {
    const seg = new Intl.Segmenter(lang || 'zh', { granularity: 'word' });
    for (const s of seg.segment(text)) words.push({ w: s.segment, wordLike: !!s.isWordLike });
  } catch (_) {
    for (const w of text.split(/([^\p{L}\p{N}_-]+)/u)) if (w) words.push({ w, wordLike: /[\p{L}\p{N}]/u.test(w) });
  }
  return words;
}

function acceptable(w) {
  if (!w) return false;
  const lower = w.toLowerCase();
  if (STOP.has(lower)) return false;
  if (/^[\d\s\p{P}\p{S}]+$/u.test(w)) return false;          // numbers / punctuation only
  if (!/\p{L}/u.test(w)) return false;
  const isCjk = CJK.test(w);
  if (isCjk) return w.length >= 2 && w.length <= 6 && !/[\p{P}\p{S}\d]/u.test(w);
  if (w.length < 3 || w.length > 24) return false;
  if (/\d/.test(w) && !/^[A-Za-z]+\d{1,3}[A-Za-z]*$/.test(w)) return false; // keep "Neo6", "GPT5"; drop hashes/ids
  if (!/[aeiouy]/i.test(w) && !/[A-Z]{2,}/.test(w)) return false;  // consonant soup from OCR
  return true;
}

// Candidate terms: single words, Latin multi-word names (runs of Capitalized tokens such as "Facebook
// Marketplace", broken by punctuation) and CJK compounds made of two adjacent content words ("产品团队").
function candidates(text, lang) {
  const counts = new Map();
  const bump = (key, display, multi) => { const c = counts.get(key) || { n: 0, display, multi }; c.n++; counts.set(key, c); };
  for (const line of cleanLines(text).split('\n')) {
    let run = [];
    let prevCjk = null;
    let prevLatin = null;
    const flushRun = () => {
      if (run.length >= 2 && run.length <= 4 && run.some((t) => t.length >= 4)
        && run.every((t) => acceptable(t) || /^[A-Z]{3,}$/.test(t))) {
        bump(run.join(' ').toLowerCase(), run.join(' '), 'name');
      }
      run = [];
    };
    for (const s of segment(line, lang)) {
      const w = s.w.trim();
      if (!s.wordLike) {
        if (w !== '') { flushRun(); prevCjk = null; prevLatin = null; } // punctuation breaks phrases; whitespace does not
        continue;
      }
      const ok = acceptable(w);
      const isCjk = CJK.test(w);
      if (ok) bump(isCjk ? w : w.toLowerCase(), w, null);
      if (/^[A-Z][A-Za-z0-9]+$/.test(w)) run.push(w); else flushRun();
      if (isCjk && ok && !NO_COMPOUND.has(w)) {
        if (prevCjk && prevCjk.length + w.length <= 6) bump(prevCjk + w, prevCjk + w, 'compound');
        prevCjk = w;
      } else {
        prevCjk = null;
      }
      if (!isCjk && ok) {
        if (prevLatin) bump(`${prevLatin} ${w}`.toLowerCase(), `${prevLatin} ${w}`, 'bigram');
        prevLatin = w;
      } else {
        prevLatin = null;
      }
    }
    flushRun();
  }
  return counts;
}

/**
 * @param {string} text
 * @param {{count?:number, lang?:string, df?:Map<string,number>, docs?:number}} [opts]
 *   df/docs: document frequencies from the user's own workspace, used to demote recurring UI chrome.
 */
function extractKeywords(text, { count = 5, lang, df = null, docs = 0 } = {}) {
  if (!text) return [];
  const cands = candidates(String(text), lang);
  const scored = [];
  for (const [key, { n, display, multi }] of cands) {
    if (multi === 'bigram' && n < 2) continue;                // lowercase word pairs must recur to count as a phrase
    const isCjk = CJK.test(key);
    const tf = 1 + Math.log(n);                               // repeated handles should not dominate
    const idf = df && docs >= 3 ? Math.log((docs + 1) / ((df.get(key) || 0) + 1)) + 0.3 : 1;
    const length = isCjk ? Math.min(key.length, 4) / 4 + 0.5 : Math.min(key.length, 10) / 10 + 0.4;
    const phraseBonus = multi === 'name' ? 1.4 : multi === 'bigram' ? 1.3 : multi === 'compound' ? 1.15 : 1;
    const caseBonus = !isCjk && /^[A-Z]/.test(display) ? 1.15 : 1;
    scored.push({ key, display, score: tf * idf * length * phraseBonus * caseBonus });
  }
  scored.sort((a, b) => b.score - a.score);
  const out = [];
  for (const s of scored) {
    if (out.length >= count) break;
    // skip a single word already covered by a chosen phrase (and vice versa)
    if (out.some((o) => o.toLowerCase().includes(s.key) || s.key.includes(o.toLowerCase()))) continue;
    out.push(s.display);
  }
  return out;
}

// Builds document frequencies over existing entries' texts (call with all entries; cheap enough for thousands).
function documentFrequencies(texts, lang) {
  const df = new Map();
  let docs = 0;
  for (const text of texts) {
    if (!text) continue;
    docs++;
    for (const key of candidates(String(text).slice(0, 20000), lang).keys()) df.set(key, (df.get(key) || 0) + 1);
  }
  return { df, docs };
}

// Guarantees an array of at most `count` distinct short strings, topping up from the text when needed.
function normalizeWords(words, fallbackText, count = 5) {
  let out = (Array.isArray(words) ? words : [])
    .map((w) => String(w || '').trim().replace(/[，,。.;；:：!！?？"'“”]+$/g, ''))
    .filter(Boolean);
  out = [...new Set(out)];
  if (out.length < count) {
    for (const w of extractKeywords(fallbackText || '', { count: count * 2 })) {
      if (out.length >= count) break;
      if (!out.some((x) => x.toLowerCase() === w.toLowerCase())) out.push(w);
    }
  }
  return out.slice(0, count);
}

module.exports = { extractKeywords, normalizeWords, documentFrequencies, cleanLines };
