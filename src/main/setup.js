'use strict';
// One-click setup: look at the machine, then get every local piece ready without the user choosing anything.
// Steps are deliberately few and named in plain language; details go to the log, not the progress bar.
const ocr = require('./ocr');
const stt = require('./stt');
const ollama = require('./ollama');
const llm = require('./llm');
const hardware = require('./hardware');
const { t } = require('./i18n');

let running = null;   // { cancelled }
let lastReport = null;

/**
 * @param {{store:object, onProgress:function}} deps
 * @param {{installOllama?:boolean}} opts  installing Ollama is opt-in: it is a system-wide install.
 */
async function run(deps, opts = {}) {
  if (running) throw new Error('setup already running');
  running = { cancelled: false };
  const { store, onProgress } = deps;
  const s = store.getSettings();
  const log = (line) => onProgress({ type: 'log', line });
  const report = (patch) => { lastReport = { ...lastReport, ...patch }; onProgress({ type: 'state', ...lastReport }); };

  // Which steps will run is decided up front so the progress bar is honest.
  const wantOllama = !!opts.installOllama;
  const steps = [
    { id: 'detect', label: t('setupDetect') },
    { id: 'ocr', label: t('setupOcr') },
    { id: 'stt', label: t('setupStt') },
  ];
  if (wantOllama) steps.push({ id: 'ollama', label: t('setupOllama') }, { id: 'model', label: t('setupModel') });
  steps.push({ id: 'done', label: t('setupFinish') });

  lastReport = { running: true, steps: steps.map((x) => ({ ...x, state: 'todo' })), index: 0, percent: 0, current: '', ok: null, summary: [] };
  report({});

  const summary = [];
  const setStep = (id, state, detail) => {
    const i = steps.findIndex((x) => x.id === id);
    lastReport.steps[i].state = state;
    if (detail) lastReport.steps[i].detail = detail;
    lastReport.index = i;
    lastReport.percent = Math.round(((i + (state === 'done' ? 1 : 0.35)) / steps.length) * 100);
    report({});
  };
  const sub = (percent, text) => { lastReport.current = text || ''; lastReport.percent = percent; report({}); };

  try {
    // 1. what is this machine
    setStep('detect', 'run');
    const hw = await hardware.detectCached(true);
    const rec = hardware.recommend(hw);
    log(`${hw.cpu} · ${hw.cores} threads · RAM ${hw.ramGB} GB`);
    log(hw.gpus.length ? hw.gpus.map((g) => `GPU ${g.name}${g.vramGB ? ` ${g.vramGB} GB` : ''} (${g.vendor})`).join('; ') : 'no discrete GPU');
    if (hw.vulkan && hw.vulkan.available) log(`Vulkan: ${hw.vulkan.device || 'available'}`);
    summary.push(t('setupSumMachine', { cpu: hw.cpu.split(' ').slice(0, 4).join(' '), ram: hw.ramGB, gpu: (hw.gpus[0] && hw.gpus[0].name) || '-' }));
    setStep('detect', 'done', `${hw.ramGB} GB RAM · ${(hw.gpus[0] && hw.gpus[0].name) || 'CPU'}`);

    // 2. OCR models (always local, never an LLM). The size is chosen from what the probe just found.
    setStep('ocr', 'run');
    if (!s.ocrModel) {
      const pick = hardware.ocrModel(hw);
      store.updateSettings({ ocrModelAuto: pick.model });
      log(`OCR model chosen for this machine: ${pick.model} (${pick.reason})`);
    }
    const ocrInfo = await ocr.prepare(
      { model: s.ocrModel || store.getSettings().ocrModelAuto, languages: s.languages, cacheDir: store.paths().ocrModels },
      (p) => {
        if (p.stage === 'download') { sub(lastReport.percent, t('setupOcrDownloading', { pct: p.percent, part: p.part, parts: p.parts })); if (p.percent === 100) log(`OCR model ${p.file} ready`); }
      },
    );
    summary.push(t('setupSumOcr', { name: ocrInfo.name || ocrInfo.engine }));
    setStep('ocr', 'done', ocrInfo.name || ocrInfo.engine);
    sub(lastReport.percent, '');

    // 3. speech model
    setStep('stt', 'run');
    // Same rule as the OCR step above: the language packs decide, because a model that cannot represent
    // the language is not a smaller choice, it is a wrong one.
    const sttPick = stt.modelForLanguages(s.languages, s.sttModel);
    if (sttPick.upgraded) {
      store.updateSettings({ sttModel: sttPick.model });
      log(`speech model ${s.sttModel} cannot handle "${sttPick.needed}" — using ${sttPick.model}`);
    }
    let sttName = sttPick.model;
    try {
      await stt.prepare({ model: sttPick.model, cacheDir: store.paths().models, mirror: s.hfMirror }, (stage, p, file) => {
        if (stage === 'download') sub(lastReport.percent, t('setupSttDownloading', { pct: Math.round(p * 100) }));
        if (stage === 'ready') log(`speech model ${file || sttPick.model} ready`);
      });
      summary.push(t('setupSumStt', { name: sttName }));
      setStep('stt', 'done', sttName);
    } catch (e) {
      log(`speech model failed: ${e.message}`);
      summary.push(t('setupSumSttFailed'));
      setStep('stt', 'warn', e.message.slice(0, 60));
    }
    sub(lastReport.percent, '');

    // 4 + 5. local language model (opt-in)
    if (wantOllama) {
      setStep('ollama', 'run');
      let st = await ollama.status(s.ollamaHost);
      if (!st.installed) {
        sub(lastReport.percent, t('setupInstallingOllama'));
        const r = await ollama.install((line) => log(line));
        if (r.manual) throw new Error(t('setupOllamaManual'));
        if (!r.ok) throw new Error(`${t('setupOllamaFailed')} (${r.exitCode !== undefined ? `exit ${r.exitCode}` : r.error || ''})`);
        st = await ollama.status(s.ollamaHost);
      }
      if (!st.running) {
        sub(lastReport.percent, t('setupStartingOllama'));
        const started = await ollama.startServer(s.ollamaHost);
        if (!started.ok) throw new Error(`${t('setupOllamaStartFailed')} ${started.error || ''}`);
        st = await ollama.status(s.ollamaHost);
      }
      log(`Ollama ${st.version || ''} running`);
      setStep('ollama', 'done', st.version || '');

      setStep('model', 'run');
      const model = s.ollamaModel || rec.model;
      const have = (st.models || []).some((m) => m.name === model || m.name.startsWith(`${model}:`));
      if (!have) {
        await ollama.pull(s.ollamaHost, model, (p) => {
          if (p.percent !== undefined) sub(lastReport.percent, t('setupPulling', { model, pct: p.percent }));
          if (p.status && p.status !== lastReport.lastPullStatus) { lastReport.lastPullStatus = p.status; log(`ollama: ${p.status}`); }
        });
      } else {
        log(`model ${model} already present`);
      }
      store.updateSettings({ provider: 'ollama', ollamaModel: model });
      summary.push(t('setupSumModel', { model }));
      setStep('model', 'done', model);
      sub(lastReport.percent, '');
    } else {
      const cfg = llm.config(store);
      summary.push(llm.isConfigured(cfg) ? t('setupSumProvider', { label: llm.label(cfg) }) : t('setupSumNoProvider'));
    }

    setStep('done', 'done');
    store.updateSettings({ setupDone: true });
    lastReport.ok = true;
    lastReport.summary = summary;
    lastReport.running = false;
    lastReport.percent = 100;
    lastReport.current = '';
    report({});
    return lastReport;
  } catch (e) {
    log(`error: ${e.message}`);
    const i = lastReport.index;
    if (lastReport.steps[i]) lastReport.steps[i].state = 'fail';
    lastReport.ok = false;
    lastReport.error = e.message;
    lastReport.running = false;
    lastReport.summary = summary;
    report({});
    return lastReport;
  } finally {
    running = null;
  }
}

function status() { return lastReport; }

module.exports = { run, status };
