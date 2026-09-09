'use strict';
// **一条也不许漏。** 这个测试不查某一段正则，它查的是「llm.js 有五条路通向外面，每一条都
// 真的把秘密盖掉了」——把四个服务商全换成假的，问它们收到了什么。
//
//   node dev/redact-leak-test.js
//
// 为什么值得单独写一个：漏的从来不是脱敏本身，是**新加的第六条路忘了接**。这个测试认的是
// 「发出去的字里有没有那串卡号」，所以将来谁加一条新路而没接 outbound，它就会红。
const assert = require('assert');
const Module = require('module');

// 四个服务商全部换成「把收到的东西记下来，回一句空的 JSON」。要在 require llm.js 之前换。
const sent = [];
const real = Module._load;
const stub = {
  './openai-compat': { chat: async (_c, o) => { sent.push(o); return { text: '{}', model: 'stub' }; }, openrouterClient: () => ({}), prepareImage: () => null },
  './ollama': { chat: async (_c, o) => { sent.push(o); return { text: '{}', model: 'stub' }; }, DEFAULT_HOST: 'http://127.0.0.1:11434' },
};
Module._load = function (req, parent, isMain) {
  if (stub[req] && parent && parent.filename.endsWith('llm.js')) return stub[req];
  return real.apply(this, arguments);
};
const llm = require('../src/main/llm');
const redact = require('../src/main/redact');

let pass = 0;
const ok = (name, fn) => fn().then(() => { pass++; }, (e) => { console.error(`FAIL ${name}: ${e.message}`); process.exitCode = 1; });

// 一张能过 Luhn 的假卡、一把形状对的假钥匙、一个真的对得上校验位的假身份证。
const CARD = (() => { for (let d = 0; d <= 9; d++) if (redact.luhn('455673812345678' + d)) return '455673812345678' + d; })();
const KEY = 'sk-ant-api03-Zz0123456789Zz0123456789Zz';
const ID = (() => { for (const c of '0123456789X') if (redact.idOk('11010519900307051' + c)) return '11010519900307051' + c; })();
const EMAIL = 'zhaojia789456@gmail.com';
const SECRETS = [CARD, KEY, ID];

const storeFor = (level) => ({
  getSettings: () => ({ provider: 'openrouter', languages: ['zh-Hans', 'en'], redact: level }),
  getSecret: () => 'k',
});
const entry = (text) => ({ id: 'e1', dateKey: '2026-09-09', createdAt: '2026-09-09T10:00:00.000Z', type: 'note', title: '账单', text });

/** 这一轮发出去的所有字。 */
function outText() { return sent.map((o) => String(o.text || '')).join('\n'); }

async function main() {
  const loaded = ['openrouter', 'ollama'];
  for (const provider of loaded) {
    const cfg = { ...llm.config(storeFor('secrets')), provider };
    const body = `我的卡号 ${CARD}，钥匙 ${KEY}，身份证 ${ID}，邮箱 ${EMAIL}`;

    await ok(`${provider}: 起标题`, async () => {
      sent.length = 0;
      await llm.describe(cfg, { kind: 'text', text: body });
      assert.ok(sent.length, '没发出去任何东西，这个测试就没在测东西');
      for (const x of SECRETS) assert.ok(!outText().includes(x), `${x.slice(0, 8)}… 漏出去了`);
      assert.ok(outText().includes('[card number]'), '该留个占位词');
    });
    await ok(`${provider}: 每日摘要`, async () => {
      sent.length = 0;
      await llm.dailySummary(cfg, { dateKey: '2026-09-09', entries: [entry(body)] });
      for (const x of SECRETS) assert.ok(!outText().includes(x), `${x.slice(0, 8)}… 漏出去了`);
    });
    await ok(`${provider}: 问`, async () => {
      sent.length = 0;
      await llm.answerQuestion(cfg, { question: '我的卡号是多少', entries: [entry(body)], terms: ['卡号'] });
      for (const x of SECRETS) assert.ok(!outText().includes(x), `${x.slice(0, 8)}… 漏出去了`);
    });
    await ok(`${provider}: 改写查询（连用户自己打进去的那句也算）`, async () => {
      sent.length = 0;
      await llm.searchPlan(cfg, { question: `${CARD} 这张卡`, history: [{ question: '上次那个', answer: `钥匙是 ${KEY}` }], seeds: [ID] });
      for (const x of SECRETS) assert.ok(!outText().includes(x), `${x.slice(0, 8)}… 漏出去了`);
    });
    await ok(`${provider}: 一键翻译`, async () => {
      sent.length = 0;
      await llm.translate(cfg, { text: body });
      for (const x of SECRETS) assert.ok(!outText().includes(x), `${x.slice(0, 8)}… 漏出去了`);
    });
  }

  // 档位真的管用：关了就原样发，最严那档连邮箱也盖。
  await ok('off：一个字不动', async () => {
    sent.length = 0;
    const cfg = llm.config(storeFor('off'));
    await llm.translate(cfg, { text: `卡号 ${CARD}` });
    assert.ok(outText().includes(CARD), 'off 这一档不该动它');
  });
  await ok('secrets：邮箱留着（不然「谁给我发的邮件」就问不出来了）', async () => {
    sent.length = 0;
    await llm.translate(llm.config(storeFor('secrets')), { text: `写信到 ${EMAIL}` });
    assert.ok(outText().includes(EMAIL));
  });
  await ok('all：邮箱也盖', async () => {
    sent.length = 0;
    await llm.translate(llm.config(storeFor('all')), { text: `写信到 ${EMAIL}` });
    assert.ok(!outText().includes(EMAIL));
    assert.ok(outText().includes('[email]'));
  });
  await ok('没设置过就是默认那档', async () => {
    assert.strictEqual(llm.config({ getSettings: () => ({}), getSecret: () => '' }).redactLevel, 'secrets');
  });

  console.log(`redact leak: ${pass} passed`);
}
main();
