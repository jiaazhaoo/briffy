'use strict';
// 出门前该盖的盖没盖上，不该盖的有没有误伤。
//
//   node dev/redact-test.js
//
// 假卡号是**现算的**（Luhn 补最后一位），不写死一个真号码进仓库；身份证同理。
const assert = require('assert');
const redact = require('../src/main/redact');

let pass = 0;
const ok = (name, fn) => { try { fn(); pass++; } catch (e) { console.error(`FAIL ${name}: ${e.message}`); process.exitCode = 1; } };
const M = (s, level = 'secrets') => redact.mask(s, { level }).text;
const N = (s, level = 'secrets') => redact.mask(s, { level }).n;

/** 给前 n-1 位补一个 Luhn 校验位，造一个「真的能过校验」的假卡号。 */
function card(prefix) {
  for (let d = 0; d <= 9; d++) if (redact.luhn(prefix + d)) return prefix + d;
  throw new Error('no check digit');
}
/** 同上，身份证第 18 位。 */
function idcard(body17) {
  for (const c of '0123456789X') if (redact.idOk(body17 + c)) return body17 + c;
  throw new Error('no check digit');
}

// ---------- 银行卡 ----------
const VISA = card('411111111111');          // 13 位
const MC = card('555555555555444');         // 16 位
const UNION = card('621234567890123');      // 16 位，银联
ok('a Visa number goes', () => assert.strictEqual(M(`卡号 ${VISA} 到期 09/28`), '卡号 [card number] 到期 09/28'));
ok('four-and-four with spaces goes', () => {
  const g = `${MC.slice(0, 4)} ${MC.slice(4, 8)} ${MC.slice(8, 12)} ${MC.slice(12)}`;
  assert.strictEqual(M(g), '[card number]');
});
ok('four-and-four with dashes goes', () => {
  const g = `${UNION.slice(0, 4)}-${UNION.slice(4, 8)}-${UNION.slice(8, 12)}-${UNION.slice(12)}`;
  assert.strictEqual(M(g), '[card number]');
});
ok('Amex 4-6-5 goes', () => {
  const a = card('37144963539843');
  assert.strictEqual(M(`${a.slice(0, 4)} ${a.slice(4, 10)} ${a.slice(10)}`), '[card number]');
});
ok('a number that fails Luhn stays', () => {
  const bad = VISA.slice(0, -1) + ((+VISA.slice(-1) + 1) % 10);
  assert.strictEqual(M(bad), bad);
});
ok('a long number starting 7-9 is not a card', () => {
  // 首位落在发卡行号段之外。这一条挡的是订单号、流水号。
  const s = '9876543210123456';
  assert.strictEqual(M(s), s);
});
ok('an all-same run is not a card even if Luhn passes', () => assert.strictEqual(M('0000000000000000'), '0000000000000000'));
ok('a decimal number is not a card', () => {
  const s = `3.${VISA}`;
  assert.strictEqual(M(s), s);
});
ok('a timestamp-length number stays', () => assert.strictEqual(M('1788955730960'), '1788955730960'));

// ---------- 身份证 ----------
const ID = idcard('11010519900307051');
ok('an id number with a valid check digit goes', () => assert.strictEqual(M(`身份证 ${ID}`), '身份证 [id number]'));
ok('...and one with a broken check digit stays', () => {
  const bad = ID.slice(0, 17) + (ID[17] === '1' ? '2' : '1');
  assert.strictEqual(M(bad), bad);
});
ok('18 digits whose date part is impossible stay', () => {
  const s = '110105199913075199';        // 13 月
  assert.strictEqual(M(s), s);
});

// ---------- 密钥 ----------
ok('an OpenAI-shaped key goes', () => assert.strictEqual(M('OPENAI_API_KEY=sk-proj-AbCdEf0123456789AbCdEf0123456789'), 'OPENAI_API_KEY=[api key]'));
ok('an Anthropic-shaped key goes', () => assert.strictEqual(M('sk-ant-api03-Zz0123456789Zz0123456789Zz'), '[api key]'));
ok('an AWS access key id goes', () => assert.strictEqual(M('AKIAIOSFODNN7EXAMPLE'), '[api key]'));
ok('a GitHub token goes', () => assert.strictEqual(M('ghp_0123456789abcdefghijklmnopqrstuvwxyz'), '[api key]'));
ok('a Slack token goes', () => assert.strictEqual(M('xoxb-123456789012-abcdefghijkl'), '[api key]'));
ok('a Google API key goes', () => assert.strictEqual(M('AIzaSyA0123456789abcdefghijklmnopqrstuv'), '[api key]'));
ok('a JWT goes', () => assert.strictEqual(M('Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'Bearer [api key]'));
ok('a PEM private key goes whole', () => {
  const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEow\nIBAAKC\n-----END RSA PRIVATE KEY-----';
  assert.strictEqual(M(`前面\n${pem}\n后面`), '前面\n[private key]\n后面');
});
ok('an ordinary sentence with sk- in it stays', () => assert.strictEqual(M('the sk-learn docs'), 'the sk-learn docs'));

// ---------- 写着名字的秘密 ----------
ok('password: value — the label stays, the value goes', () => assert.strictEqual(M('password: hunter2xyz'), 'password: [secret]'));
ok('密码：值 — same', () => assert.strictEqual(M('密码：Abc12345'), '密码：[secret]'));
ok('a quoted secret goes without the quotes', () => assert.strictEqual(M('api_key = "abcdef123456"'), 'api_key = "[secret]"'));
ok('验证码 123456 goes, the words stay', () => assert.strictEqual(M('您的验证码是 483920，5 分钟内有效'), '您的验证码是 [code]，5 分钟内有效'));
ok('verification code in English goes', () => assert.strictEqual(M('Your verification code is 8391'), 'Your verification code is [code]'));
ok('a short value after password: is not taken', () => assert.strictEqual(M('password: ok'), 'password: ok'));

// ---------- 联系方式：默认那档不碰，最严那档才盖 ----------
ok('an email survives the default level', () => assert.strictEqual(M('写信到 zhaojia789456@gmail.com'), '写信到 zhaojia789456@gmail.com'));
ok('...and goes at the strict level', () => assert.strictEqual(M('写信到 zhaojia789456@gmail.com', 'all'), '写信到 [email]'));
ok('a mainland mobile goes at the strict level only', () => {
  assert.strictEqual(M('13812345678'), '13812345678');
  assert.strictEqual(M('13812345678', 'all'), '[phone]');
});
ok('a UK mobile goes at the strict level', () => assert.strictEqual(M('07700 900123', 'all'), '[phone]'));
ok('an international number goes at the strict level', () => assert.strictEqual(M('+44 7700 900123', 'all'), '[phone]'));

// ---------- IBAN ----------
ok('a valid IBAN goes', () => assert.strictEqual(M('GB82 WEST 1234 5698 7654 32'), '[iban]'));
ok('a broken IBAN stays', () => assert.strictEqual(M('GB99 WEST 1234 5698 7654 32'), 'GB99 WEST 1234 5698 7654 32'));

// ---------- 开关、计数、原件 ----------
ok('off changes nothing', () => assert.strictEqual(M(`卡号 ${VISA}`, 'off'), `卡号 ${VISA}`));
ok('the count and the breakdown are right', () => {
  const r = redact.mask(`${VISA} 和 ${ID} 和 sk-ant-api03-Zz0123456789Zz0123456789Zz`, { level: 'secrets' });
  assert.strictEqual(r.n, 3);
  assert.deepStrictEqual(r.hits, { key: 1, card: 1, id: 1 });
});
ok('the original string is untouched', () => {
  const src = `卡号 ${VISA}`;
  redact.mask(src, { level: 'all' });
  assert.strictEqual(src, `卡号 ${VISA}`);
});
ok('nothing to mask means the same string back', () => {
  const s = '今天下午三点在 Runnymede 见面';
  const r = redact.mask(s, { level: 'all' });
  assert.strictEqual(r.text, s); assert.strictEqual(r.n, 0);
});
ok('empty and rubbish input do not throw', () => {
  assert.strictEqual(redact.mask('').text, '');
  assert.strictEqual(redact.mask(null).text, '');
  assert.strictEqual(redact.mask(undefined, { level: 'all' }).n, 0);
});
ok('two hits in a row both go', () => {
  assert.strictEqual(M(`${VISA} ${MC}`), '[card number] [card number]');
});
ok('the level comes from settings, unknown values fall back', () => {
  assert.strictEqual(redact.levelOf({ redact: 'all' }), 'all');
  assert.strictEqual(redact.levelOf({ redact: 'off' }), 'off');
  assert.strictEqual(redact.levelOf({}), 'secrets');
  assert.strictEqual(redact.levelOf({ redact: '什么' }), 'secrets');
  assert.strictEqual(redact.levelOf(null), 'secrets');
});

// ---------- 不该误伤的：这个工作区里真实出现过的字 ----------
for (const s of [
  '这块屏物理密度 296 PPI，LoDPI 的软化被高密度掩盖了大半',
  'Windsor Road, Egham TW20 0AE',
  '1st Half Challenge (~50km) Sat · 12 Sep 2026',
  '£10 接驳车直接送你回去取车',
  'https://upos-sz-mirrorcosov.bilivideo.com/upgcxcode/55/12/41597470255',
  '41597470255-1-192.mp4',
  '89791a3f1a2a4965bbd12aadc9abbbah',
  'ig8euxZM2rNcNbRMhwdVhwdlhWKVhwdVhoNvNC8BqJIzNbfq9rVEuxTEnE8L5F6VnEsSTx0vkX8fqJeYTj_lta53NCM',
  '00 0 Q 日 0 0 0 ² 米 8',
  '2026-09-09T08:29:30.116Z',
  'BitsPerColor: 10, EDID 报 10bit',
]) ok(`untouched: ${s.slice(0, 34)}`, () => assert.strictEqual(M(s, 'all'), s));

// ---------- 网址里的编号不是号码（这个工作区上量出来的三个近失） ----------
ok('a Luhn-valid number inside a url path is not a card', () => {
  const c = card('538149121642111');
  const u = `https://www.facebook.com/marketplace/item/${c}?referral_code=null`;
  assert.strictEqual(M(u), u);
});
ok('...and the same number on its own still is', () => assert.strictEqual(M(card('538149121642111')), '[card number]'));
ok('a url-borne token is masked deliberately, by its name', () => {
  assert.strictEqual(M('https://x.com/a?xsec_token=AB2O3h7FRTsELDJkUhsta&xsec_source=pc'),
    'https://x.com/a?xsec_token=[secret]&xsec_source=pc');
  assert.strictEqual(M('?access_token=abcdef123456'), '?access_token=[secret]');
});
ok('the label keeps its prefix, only the value goes', () => assert.strictEqual(M('refresh_token: abcdef123456'), 'refresh_token: [secret]'));
ok('inUrl only looks back to the nearest space', () => {
  assert.strictEqual(redact.inUrl('see https://a.b/c/12345', 15), true);
  assert.strictEqual(redact.inUrl('see 12345', 4), false);
});

console.log(`redact: ${pass} passed`);
