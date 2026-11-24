'use strict';

/* =====================================================================
   DADOS
   Tudo fica salvo no aparelho (localStorage), num único objeto:
   - exercises: lista única de exercícios {id, name}. Um exercício que
     aparece em várias fichas é o MESMO item aqui, então o histórico,
     a "última vez" e o gráfico juntam tudo.
   - templates: fichas {id, name, exs: [ids de exercícios]}
   - workouts:  treinos concluídos {id, start, end, templateId, templateName,
                entries: [{exId, sets: [{kg, reps}]}]}
   - active:    treino em andamento (ou null)
   ===================================================================== */

const KEY = 'treino-dados';

function emptyData() {
  return { version: 1, exercises: [], templates: [], workouts: [], active: null, lastExport: null };
}

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    if (isValidData(d)) return { ...emptyData(), ...d };
  } catch (e) { /* dado corrompido: começa vazio */ }
  return emptyData();
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch (e) {
    alert('Não foi possível salvar os dados neste aparelho. Exporte um backup.');
  }
}

function isValidData(d) {
  return d && Array.isArray(d.exercises) && Array.isArray(d.templates) && Array.isArray(d.workouts);
}

let data = load();

// Estado só da tela (não é salvo)
const ui = { tab: 'treinar', editing: null, openWorkout: null, progressEx: null };

/* ---------- Pequenas ajudas ---------- */

const $ = sel => document.querySelector(sel);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// "Supino  Reto " e "supino reto" viram a mesma coisa (sem acento, minúsculo, espaços normais)
const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const parseNum = s => parseFloat(String(s).replace(',', '.'));
const fmtKg = n => String(Math.round(n * 100) / 100).replace('.', ',');
const fmtSet = s => `${fmtKg(s.kg)} kg × ${s.reps}`;
const fmtDate = ts => new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
const fmtDay = ts => new Date(ts).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
const fmtTime = ts => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 2200);
}

/* ---------- Exercícios ---------- */

const exById = id => data.exercises.find(e => e.id === id);
const exName = id => (exById(id) || { name: '(exercício removido)' }).name;
const tplById = id => data.templates.find(t => t.id === id);
const byName = (a, b) => a.name.localeCompare(b.name, 'pt-BR');

// Se já existe um exercício com esse nome (ignorando acentos/maiúsculas), reaproveita.
function findOrCreateExercise(name) {
  const clean = name.trim().replace(/\s+/g, ' ');
  let ex = data.exercises.find(e => norm(e.name) === norm(clean));
  if (!ex) {
    ex = { id: uid(), name: clean };
    data.exercises.push(ex);
  }
  return ex;
}

// Junta dois exercícios em um só (usado quando você renomeia um para o nome de outro).
function mergeExercise(fromId, toId) {
  for (const t of data.templates) {
    t.exs = t.exs.map(x => (x === fromId ? toId : x)).filter((x, i, arr) => arr.indexOf(x) === i);
  }
  const fix = e => { if (e.exId === fromId) e.exId = toId; };
  data.workouts.forEach(w => w.entries.forEach(fix));
  if (data.active) data.active.entries.forEach(fix);
  data.exercises = data.exercises.filter(e => e.id !== fromId);
  if (ui.progressEx === fromId) ui.progressEx = toId;
}

// Todas as séries de um exercício num treino (junta, caso ele apareça mais de uma vez)
const setsIn = (workout, exId) => workout.entries.filter(e => e.exId === exId).flatMap(e => e.sets);

// Última vez que o exercício foi feito, em qualquer ficha
function lastTime(exId) {
  for (let i = data.workouts.length - 1; i >= 0; i--) {
    const sets = setsIn(data.workouts[i], exId);
    if (sets.length) return { date: data.workouts[i].end, sets };
  }
  return null;
}

// Melhor série: maior carga; empate, mais repetições
const bestSet = sets => sets.reduce((b, s) => (s.kg > b.kg || (s.kg === b.kg && s.reps > b.reps) ? s : b));

/* =====================================================================
   TELAS
   ===================================================================== */

const TITLES = { treinar: 'Treinar', historico: 'Histórico', progresso: 'Progresso', fichas: 'Fichas', backup: 'Backup' };

function render() {
  $('#title').textContent = TITLES[ui.tab];
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === ui.tab));
  const view = $('#view');
  ({ treinar: renderTreinar, historico: renderHistorico, progresso: renderProgresso, fichas: renderFichas, backup: renderBackup })[ui.tab](view);
}

/* ---------- Treinar ---------- */

function renderTreinar(v) {
  if (data.active) return renderWorkout(v);

  if (!data.templates.length) {
    v.innerHTML = `
      <div class="empty">
        <p class="muted">Você ainda não tem nenhuma ficha de treino.</p>
        <button class="btn primary big" data-action="tab" data-tab="fichas">Criar minha primeira ficha</button>
      </div>`;
    return;
  }

  v.innerHTML = `<p class="muted">Escolha a ficha de hoje:</p>` + data.templates.map(t => {
    const last = [...data.workouts].reverse().find(w => w.templateId === t.id);
    return `
      <div class="card">
        <div>
          <div class="card-title">${esc(t.name)}</div>
          <div class="muted small">${plural(t.exs.length, 'exercício', 'exercícios')}${last ? ' · feito em ' + fmtDate(last.end) : ''}</div>
        </div>
        <button class="btn primary big" data-action="start" data-id="${t.id}">Iniciar</button>
      </div>`;
  }).join('');
}

function renderWorkout(v) {
  const a = data.active;
  const en = a.entries[a.idx];
  const lt = lastTime(en.exId);
  // Valores que já aparecem preenchidos: a última série de hoje, ou a 1ª série da última vez
  const pre = en.sets.length ? en.sets[en.sets.length - 1] : (lt ? lt.sets[0] : null);
  const isLast = a.idx === a.entries.length - 1;

  const chips = a.entries.map((e, i) => `
    <button class="chip ${i === a.idx ? 'active' : ''} ${e.sets.length ? 'done' : ''}" data-action="goto-ex" data-i="${i}">
      ${i + 1}. ${esc(exName(e.exId))}${e.sets.length ? ' ✓' + e.sets.length : ''}
    </button>`).join('');

  const last = lt
    ? `<div class="last"><span class="muted small">Última vez · ${fmtDate(lt.date)}</span><div>${lt.sets.map(s => `<span class="pill">${fmtSet(s)}</span>`).join('')}</div></div>`
    : `<div class="last muted">Primeira vez neste exercício</div>`;

  const sets = en.sets.map((s, i) => `
    <li>
      <span class="muted small">Série ${i + 1}</span>
      <strong>${fmtSet(s)}</strong>
      ${compare(s, lt && lt.sets[i])}
      <button class="x" data-action="del-set" data-i="${i}" aria-label="Apagar série">✕</button>
    </li>`).join('');

  v.innerHTML = `
    <div class="wk-meta">
      <strong>${esc(a.templateName)}</strong>
      <span class="muted small">início ${fmtTime(a.start)} · ${a.idx + 1} de ${a.entries.length}</span>
    </div>
    <div class="chips" id="chips">${chips}</div>

    <h2 class="ex-title">${esc(exName(en.exId))}</h2>
    ${last}
    ${sets ? `<ol class="sets">${sets}</ol>` : ''}

    <div class="inputs">
      <div class="field">
        <label for="in-kg">Carga (kg)</label>
        <div class="stepper">
          <button data-action="step" data-t="in-kg" data-d="-1" aria-label="Menos 1 kg">−</button>
          <input id="in-kg" type="text" inputmode="decimal" autocomplete="off" placeholder="0" value="${pre ? fmtKg(pre.kg) : ''}">
          <button data-action="step" data-t="in-kg" data-d="1" aria-label="Mais 1 kg">+</button>
        </div>
      </div>
      <div class="field">
        <label for="in-reps">Repetições</label>
        <div class="stepper">
          <button data-action="step" data-t="in-reps" data-d="-1" aria-label="Menos 1 repetição">−</button>
          <input id="in-reps" type="text" inputmode="numeric" autocomplete="off" placeholder="0" value="${pre ? pre.reps : ''}">
          <button data-action="step" data-t="in-reps" data-d="1" aria-label="Mais 1 repetição">+</button>
        </div>
      </div>
    </div>
    <button class="btn primary big" data-action="add-set">✓ Salvar série ${en.sets.length + 1}</button>

    <div class="row">
      <button class="btn" data-action="prev" ${a.idx === 0 ? 'disabled' : ''}>◀ Anterior</button>
      <button class="btn" data-action="next" ${isLast ? 'disabled' : ''}>Próximo ▶</button>
    </div>

    <hr>
    <div class="stack">
      <button class="btn outline" data-action="finish">Concluir treino</button>
      <button class="btn ghost danger" data-action="discard">Descartar treino</button>
    </div>`;

  // Deixa o exercício atual visível na fileira de botões
  const chip = v.querySelector('.chip.active');
  if (chip) chip.scrollIntoView({ block: 'nearest', inline: 'center' });
}

// Seta comparando a série de hoje com a mesma série da última vez
function compare(s, prev) {
  if (!prev) return '';
  if (s.kg > prev.kg || (s.kg === prev.kg && s.reps > prev.reps)) return '<span class="cmp up">▲</span>';
  if (s.kg === prev.kg && s.reps === prev.reps) return '<span class="cmp eq">=</span>';
  return '<span class="cmp down">▼</span>';
}

/* ---------- Histórico ---------- */

function renderHistorico(v) {
  if (!data.workouts.length) {
    v.innerHTML = `<div class="empty"><p class="muted">Nenhum treino concluído ainda.</p></div>`;
    return;
  }
  v.innerHTML = [...data.workouts].reverse().map(w => {
    const nSets = w.entries.reduce((n, e) => n + e.sets.length, 0);
    const mins = Math.max(1, Math.round((w.end - w.start) / 60000));
    const open = ui.openWorkout === w.id;
    const details = open ? `
      ${w.entries.map(e => `
        <div class="detail">
          <h4>${esc(exName(e.exId))}</h4>
          <div>${e.sets.map(s => `<span class="pill">${fmtSet(s)}</span>`).join('')}</div>
        </div>`).join('')}
      <button class="btn danger" data-action="del-w" data-id="${w.id}">Apagar este treino</button>` : '';
    return `
      <div class="card">
        <button class="card-head" data-action="toggle-w" data-id="${w.id}">
          <span class="grow">
            <span class="card-title">${esc(w.templateName)}</span>
            <span class="muted small">${fmtDay(w.end)} · ${plural(w.entries.length, 'exercício', 'exercícios')} · ${plural(nSets, 'série', 'séries')} · ${mins} min</span>
          </span>
          <span class="chev" aria-hidden="true">${open ? '▾' : '▸'}</span>
        </button>
        ${details}
      </div>`;
  }).join('');
}

/* ---------- Progresso ---------- */

function renderProgresso(v) {
  const done = new Set();
  data.workouts.forEach(w => w.entries.forEach(e => { if (e.sets.length) done.add(e.exId); }));

  if (!done.size) {
    v.innerHTML = `<div class="empty"><p class="muted">Conclua um treino para ver sua evolução aqui.</p></div>`;
    return;
  }

  if (!done.has(ui.progressEx)) {
    // Começa pelo último exercício treinado
    const lastW = data.workouts[data.workouts.length - 1];
    ui.progressEx = lastW.entries.find(e => e.sets.length).exId;
  }
  const id = ui.progressEx;
  const options = [...done].map(exById).filter(Boolean).sort(byName)
    .map(e => `<option value="${e.id}" ${e.id === id ? 'selected' : ''}>${esc(e.name)}</option>`).join('');

  // Um ponto por treino: a melhor série do dia
  const points = data.workouts.map(w => {
    const sets = setsIn(w, id);
    if (!sets.length) return null;
    const b = bestSet(sets);
    return { t: w.end, kg: b.kg, reps: b.reps, n: sets.length };
  }).filter(Boolean);

  const pr = points.reduce((b, p) => (p.kg > b.kg || (p.kg === b.kg && p.reps > b.reps) ? p : b));
  const diff = points[points.length - 1].kg - points[0].kg;

  v.innerHTML = `
    <label class="lbl" for="sel-ex" style="margin-top:0">Exercício</label>
    <select id="sel-ex" class="txt">${options}</select>

    ${chart(points)}

    <div class="stats">
      <div class="stat"><span class="muted small">Recorde</span><b>${fmtSet(pr)}</b><span class="muted small">${fmtDate(pr.t)}</span></div>
      ${points.length > 1
        ? `<div class="stat"><span class="muted small">Evolução da carga</span><b>${diff > 0 ? '+' : ''}${fmtKg(diff)} kg</b><span class="muted small">desde ${fmtDate(points[0].t)}</span></div>`
        : `<div class="stat"><span class="muted small">Evolução da carga</span><b>—</b><span class="muted small">aparece a partir do 2º treino</span></div>`}
    </div>

    <h3 class="section">Cada treino</h3>
    <table class="tbl">
      <tr><th>Data</th><th>Melhor série</th><th>Séries</th></tr>
      ${points.slice().reverse().map(p => `<tr><td>${fmtDate(p.t)}</td><td><strong>${fmtSet(p)}</strong></td><td>${p.n}</td></tr>`).join('')}
    </table>`;
}

// Gráfico de linha simples desenhado em SVG (carga máxima x data)
function chart(pts) {
  const W = 340, H = 200, L = 38, R = 14, T = 14, B = 26;
  let min = Math.min(...pts.map(p => p.kg));
  let max = Math.max(...pts.map(p => p.kg));
  if (min === max) { min -= 5; max += 5; } else { const pad = (max - min) * 0.15; min -= pad; max += pad; }
  if (min < 0) min = 0;
  // Ajusta para que as 4 linhas do eixo caiam em números inteiros
  min = Math.floor(min);
  const stepKg = Math.max(1, Math.ceil((max - min) / 3));
  max = min + 3 * stepKg;

  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  const x = t => (t1 === t0 ? L + (W - L - R) / 2 : L + ((t - t0) / (t1 - t0)) * (W - L - R));
  const y = kg => T + ((max - kg) / (max - min)) * (H - T - B);

  let grid = '';
  for (let i = 0; i <= 3; i++) {
    const val = min + ((max - min) * i) / 3;
    const yy = y(val).toFixed(1);
    grid += `<line class="grid" x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}"/>`;
    grid += `<text x="${L - 6}" y="${yy}" text-anchor="end" dominant-baseline="middle">${fmtKg(val)}</text>`;
  }

  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.kg).toFixed(1)}`).join(' ');
  const dots = pts.map(p => `<circle cx="${x(p.t).toFixed(1)}" cy="${y(p.kg).toFixed(1)}" r="4"/>`).join('');
  const day = t => new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  const labels = pts.length > 1
    ? `<text x="${L}" y="${H - 8}">${day(t0)}</text><text x="${W - R}" y="${H - 8}" text-anchor="end">${day(t1)}</text>`
    : `<text x="${x(t0)}" y="${H - 8}" text-anchor="middle">${day(t0)}</text>`;

  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfico da carga máxima por treino">
    ${grid}<path class="line" d="${path}"/>${dots}${labels}</svg>`;
}

/* ---------- Fichas ---------- */

function renderFichas(v) {
  if (ui.editing) return renderEditor(v);

  v.innerHTML = data.templates.map(t => `
    <button class="card card-btn" data-action="edit-tpl" data-id="${t.id}">
      <span class="card-title">${esc(t.name)}</span>
      <span class="muted small">${t.exs.length ? t.exs.map(id => esc(exName(id))).join(' · ') : 'Sem exercícios ainda'}</span>
    </button>`).join('') + `
    <button class="btn primary big" data-action="new-tpl">+ Nova ficha</button>`;
}

function renderEditor(v) {
  const t = tplById(ui.editing);
  if (!t) { ui.editing = null; return renderFichas(v); }

  v.innerHTML = `
    <button class="btn ghost" data-action="close-editor">◀ Voltar às fichas</button>

    <label class="lbl" for="tpl-name">Nome da ficha</label>
    <input id="tpl-name" class="txt" value="${esc(t.name)}" autocomplete="off">

    <h3 class="section">Exercícios</h3>
    <ul class="ex-list" id="tpl-list"></ul>

    <label class="lbl" for="ex-input">Adicionar exercício</label>
    <div class="add-row">
      <input id="ex-input" class="txt" placeholder="Ex: Supino reto" autocomplete="off" autocapitalize="sentences" enterkeyhint="done">
      <button class="btn primary" data-action="add-ex">Adicionar</button>
    </div>
    <div id="suggest-box"></div>

    <p class="muted small">Dica: toque no nome de um exercício para renomeá-lo. O novo nome vale para todas as fichas e para o histórico.</p>
    <hr>
    <button class="btn danger" data-action="del-tpl">Apagar esta ficha</button>`;

  renderTplList();
  renderSuggest();
}

function renderTplList() {
  const t = tplById(ui.editing);
  $('#tpl-list').innerHTML = t.exs.length ? t.exs.map((id, i) => `
    <li>
      <button class="ex-name-btn" data-action="rename-ex" data-id="${id}">${i + 1}. ${esc(exName(id))}</button>
      <button class="sq" data-action="move-ex" data-i="${i}" data-d="-1" ${i === 0 ? 'disabled' : ''} aria-label="Subir">↑</button>
      <button class="sq" data-action="move-ex" data-i="${i}" data-d="1" ${i === t.exs.length - 1 ? 'disabled' : ''} aria-label="Descer">↓</button>
      <button class="sq" data-action="rm-ex" data-i="${i}" aria-label="Tirar da ficha">✕</button>
    </li>`).join('') : `<li class="muted">Nenhum exercício nesta ficha ainda.</li>`;
}

// Sugere exercícios que já existem (de outras fichas), filtrando pelo que você digita
function renderSuggest() {
  const t = tplById(ui.editing);
  const words = norm($('#ex-input').value).split(' ').filter(Boolean);
  const list = data.exercises
    .filter(e => !t.exs.includes(e.id))
    .filter(e => words.every(w => norm(e.name).includes(w)))
    .sort(byName);

  $('#suggest-box').innerHTML = list.length ? `
    <p class="muted small">${words.length ? 'Já cadastrados parecidos' : 'Já cadastrados'} — toque para adicionar:</p>
    <div class="chips wrap">${list.map(e => `<button class="chip" data-action="add-ex-id" data-id="${e.id}">+ ${esc(e.name)}</button>`).join('')}</div>` : '';
}

function addToTemplate(ex) {
  const t = tplById(ui.editing);
  if (t.exs.includes(ex.id)) { toast(`"${ex.name}" já está nesta ficha`); return; }
  t.exs.push(ex.id);
  save();
  $('#ex-input').value = '';
  renderTplList();
  renderSuggest();
  toast(`"${ex.name}" adicionado`);
}

/* ---------- Backup ---------- */

function renderBackup(v) {
  v.innerHTML = `
    <div class="stats">
      <div class="stat"><span class="muted small">Treinos salvos</span><b>${data.workouts.length}</b></div>
      <div class="stat"><span class="muted small">Último backup</span><b>${data.lastExport ? fmtDate(data.lastExport) : 'nunca'}</b></div>
    </div>

    <div class="stack" style="margin-top:20px">
      <button class="btn primary big" data-action="export">Exportar backup</button>
      <label class="btn big" for="file-in">Importar backup</label>
      <input id="file-in" class="sr-only" type="file" accept=".json,application/json">
    </div>

    <h3 class="section">Como funciona</h3>
    <p class="muted small">Seus dados ficam guardados só neste aparelho. <b>Exportar</b> gera um arquivo (.json) com tudo: no iPhone, escolha "Salvar em Arquivos" ou mande para você mesmo. Faça isso de vez em quando.</p>
    <p class="muted small"><b>Importar</b> lê esse arquivo e <b>substitui</b> todos os dados atuais pelos do backup.</p>`;
}

async function exportBackup() {
  const json = JSON.stringify({ app: 'app-treino', exportedAt: new Date().toISOString(), data }, null, 1);
  // Data local (toISOString usaria o horário UTC e, à noite no Brasil, já seria o dia seguinte)
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const name = `treino-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
  const file = new File([json], name, { type: 'application/json' });

  // No celular, abre o menu de compartilhar (Salvar em Arquivos, AirDrop, WhatsApp...)
  const isPhone = matchMedia('(pointer: coarse)').matches;
  if (isPhone && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Backup do treino' });
      markExported();
    } catch (e) {
      if (e.name !== 'AbortError') alert('Não foi possível compartilhar o arquivo.');
    }
    return;
  }

  // No computador (ou se o compartilhar não existir), baixa o arquivo
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  markExported();
}

function markExported() {
  data.lastExport = Date.now();
  save();
  render();
  toast('Backup exportado');
}

function importBackup(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let obj;
    try { obj = JSON.parse(reader.result); } catch (e) { alert('Esse arquivo não é um backup válido.'); return; }
    const d = obj && obj.data ? obj.data : obj;
    if (!isValidData(d)) { alert('Esse arquivo não é um backup deste app.'); return; }

    const msg = `Importar backup com ${plural(d.templates.length, 'ficha', 'fichas')} e ${plural(d.workouts.length, 'treino', 'treinos')}?\n\nIsso SUBSTITUI todos os dados atuais deste aparelho.`;
    if (!confirm(msg)) return;

    data = { ...emptyData(), ...d };
    data.workouts.sort((a, b) => a.end - b.end);
    save();
    ui.editing = null;
    ui.openWorkout = null;
    ui.progressEx = null;
    render();
    toast('Backup importado');
  };
  reader.readAsText(file);
}

/* =====================================================================
   AÇÕES (o que cada botão faz)
   Cada botão tem data-action="nome", que chama a função de mesmo nome aqui.
   ===================================================================== */

const actions = {
  tab(el) {
    ui.tab = el.dataset.tab;
    ui.editing = null;
    render();
    scrollTo(0, 0);
  },

  // --- Treino ---
  start(el) {
    const t = tplById(el.dataset.id);
    if (!t.exs.length) { toast('Essa ficha não tem exercícios'); return; }
    data.active = {
      templateId: t.id, templateName: t.name, start: Date.now(), idx: 0,
      entries: t.exs.map(exId => ({ exId, sets: [] })),
    };
    save();
    render();
    scrollTo(0, 0);
  },
  'goto-ex'(el) { goToExercise(Number(el.dataset.i)); },
  prev() { goToExercise(data.active.idx - 1); },
  next() { goToExercise(data.active.idx + 1); },

  step(el) {
    const input = document.getElementById(el.dataset.t);
    const isKg = el.dataset.t === 'in-kg';
    const val = Math.max(0, (parseNum(input.value) || 0) + Number(el.dataset.d));
    input.value = isKg ? fmtKg(val) : String(Math.round(val));
  },

  'add-set'() {
    const kg = parseNum($('#in-kg').value || '0');
    const reps = parseInt($('#in-reps').value, 10);
    if (isNaN(kg) || kg < 0) { toast('Confira a carga'); return; }
    if (!reps || reps < 1) { toast('Informe as repetições'); return; }
    const en = data.active.entries[data.active.idx];
    en.sets.push({ kg: Math.round(kg * 100) / 100, reps });
    save();
    render();
    toast(`Série ${en.sets.length} salva`);
  },

  'del-set'(el) {
    if (!confirm('Apagar esta série?')) return;
    data.active.entries[data.active.idx].sets.splice(Number(el.dataset.i), 1);
    save();
    render();
  },

  finish() {
    const a = data.active;
    const entries = a.entries.filter(e => e.sets.length);
    if (!entries.length) {
      if (confirm('Nenhuma série registrada. Descartar este treino?')) { data.active = null; save(); render(); }
      return;
    }
    const missing = a.entries.length - entries.length;
    const msg = missing ? `Concluir treino? ${plural(missing, 'exercício ficou', 'exercícios ficaram')} sem séries.` : 'Concluir treino?';
    if (!confirm(msg)) return;

    data.workouts.push({ id: uid(), start: a.start, end: Date.now(), templateId: a.templateId, templateName: a.templateName, entries });
    data.active = null;
    save();
    ui.tab = 'historico';
    ui.openWorkout = data.workouts[data.workouts.length - 1].id;
    render();
    scrollTo(0, 0);
    toast('Treino salvo! 💪');
  },

  discard() {
    if (!confirm('Descartar este treino? As séries de hoje serão perdidas.')) return;
    data.active = null;
    save();
    render();
  },

  // --- Histórico ---
  'toggle-w'(el) {
    ui.openWorkout = ui.openWorkout === el.dataset.id ? null : el.dataset.id;
    render();
  },
  'del-w'(el) {
    if (!confirm('Apagar este treino do histórico? Não dá para desfazer.')) return;
    data.workouts = data.workouts.filter(w => w.id !== el.dataset.id);
    save();
    render();
  },

  // --- Fichas ---
  'new-tpl'() {
    const used = new Set(data.templates.map(t => norm(t.name)));
    let letter = 0;
    while (used.has(norm('Treino ' + String.fromCharCode(65 + letter)))) letter++;
    const t = { id: uid(), name: 'Treino ' + String.fromCharCode(65 + letter), exs: [] };
    data.templates.push(t);
    save();
    ui.editing = t.id;
    render();
  },
  'edit-tpl'(el) { ui.editing = el.dataset.id; render(); scrollTo(0, 0); },
  'close-editor'() { ui.editing = null; render(); },

  'add-ex'() {
    const name = $('#ex-input').value;
    if (!name.trim()) { toast('Digite o nome do exercício'); return; }
    addToTemplate(findOrCreateExercise(name));
  },
  'add-ex-id'(el) { addToTemplate(exById(el.dataset.id)); },

  'move-ex'(el) {
    const t = tplById(ui.editing);
    const i = Number(el.dataset.i), j = i + Number(el.dataset.d);
    [t.exs[i], t.exs[j]] = [t.exs[j], t.exs[i]];
    save();
    renderTplList();
  },
  'rm-ex'(el) {
    const t = tplById(ui.editing);
    t.exs.splice(Number(el.dataset.i), 1);
    save();
    renderTplList();
    renderSuggest();
  },

  'rename-ex'(el) {
    const ex = exById(el.dataset.id);
    const name = prompt('Novo nome do exercício (vale para todas as fichas e o histórico):', ex.name);
    if (name === null || !name.trim()) return;
    const other = data.exercises.find(e => e.id !== ex.id && norm(e.name) === norm(name));
    if (other) {
      if (!confirm(`Já existe "${other.name}". Juntar os dois num exercício só? O histórico dos dois fica junto.`)) return;
      mergeExercise(ex.id, other.id);
    } else {
      ex.name = name.trim().replace(/\s+/g, ' ');
    }
    save();
    renderTplList();
    renderSuggest();
  },

  'del-tpl'() {
    const t = tplById(ui.editing);
    if (!confirm(`Apagar a ficha "${t.name}"? Os treinos já feitos continuam no histórico.`)) return;
    data.templates = data.templates.filter(x => x.id !== t.id);
    ui.editing = null;
    save();
    render();
  },

  // --- Backup ---
  export() { exportBackup(); },
};

function goToExercise(i) {
  data.active.idx = Math.max(0, Math.min(i, data.active.entries.length - 1));
  save();
  render();
  scrollTo(0, 0);
}

/* ---------- Ligando os eventos ---------- */

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.action];
  if (fn) fn(el);
});

document.addEventListener('input', e => {
  if (e.target.id === 'tpl-name') {
    tplById(ui.editing).name = e.target.value;
    save();
  }
  if (e.target.id === 'ex-input') renderSuggest();
});

document.addEventListener('change', e => {
  if (e.target.id === 'tpl-name' && !e.target.value.trim()) {
    e.target.value = tplById(ui.editing).name = 'Sem nome';
    save();
  }
  if (e.target.id === 'sel-ex') { ui.progressEx = e.target.value; render(); }
  if (e.target.id === 'file-in' && e.target.files[0]) {
    importBackup(e.target.files[0]);
    e.target.value = '';
  }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.id === 'ex-input') { e.preventDefault(); actions['add-ex'](); }
  if (e.key === 'Enter' && (e.target.id === 'in-kg' || e.target.id === 'in-reps')) e.target.blur();
});

/* ---------- Início ---------- */

render();

// Pede ao navegador para não apagar os dados sozinho
if (navigator.storage && navigator.storage.persist) navigator.storage.persist();

// Permite abrir o app sem internet
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js');
}
