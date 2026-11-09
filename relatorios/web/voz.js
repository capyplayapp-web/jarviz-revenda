/* Voz do Jarvis (09/11/2026): cápsula no topo + área própria (popover) para ligar a resposta em áudio
   e acompanhar o processador enquanto a voz está ligada.
   GET /api/voz → modo, voicestudio, agora {cpu,temp,gpu_temp,gpu_uso}, historico [[t,cpu,temp,gpuT,gpuU]], audios.
   POST /api/voz {modo: desligada|primeira|todas}. Sem innerHTML com dado de fora. */
(() => {
'use strict';
const BASE = location.protocol === 'file:' ? 'http://127.0.0.1:8811' : '';
const NS = 'http://www.w3.org/2000/svg';
const acoes = document.querySelector('.acoes-topo');
if (!acoes) return;
const reduz = matchMedia('(prefers-reduced-motion: reduce)');

const MODOS = [
  ['desligada', 'Desligada', 'O robô responde só em texto.'],
  ['primeira', '1ª resposta', 'Metade dos leads novos ouve a 1ª resposta em áudio (teste A/B).'],
  ['todas', 'Todas', 'Toda resposta ao vivo sai em áudio. Links seguem em texto.'],
];

function h(tag, p, ...f) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(p || {})) { if (v == null || v === false) continue; if (k === 'text') el.textContent = v; else el.setAttribute(k, v === true ? '' : v); }
  for (const x of f.flat()) if (x != null && x !== false) el.append(x);
  return el;
}
function svg(attrs, ...paths) {
  const s = document.createElementNS(NS, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', ...attrs })) s.setAttribute(k, v);
  for (const d of paths) { const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); s.append(p); }
  return s;
}
const icMic = () => svg({}, 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z', 'M5.5 11a6.5 6.5 0 0 0 13 0', 'M12 17.5V21');
const icX = () => svg({}, 'M6 6l12 12M18 6 6 18');

/* faixas: abaixo de 70 °C tranquilo, 70–84 atenção, 85+ quente (notebook i7 13ª geração) */
const nivelTemp = t => (t == null ? '' : t >= 85 ? 'quente' : t >= 70 ? 'morno' : 'ok');
const nivelUso = u => (u == null ? '' : u >= 85 ? 'quente' : u >= 60 ? 'morno' : 'ok');
const txt = (v, u) => (v == null ? '—' : v + u);

/* ---------- cápsula do topo ---------- */
const capsula = h('button', { type: 'button', class: 'voz-cap', id: 'voz-cap', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-controls': 'voz-pop' });
const capIc = icMic();
const capRot = h('span', { class: 'voz-cap-rot', text: 'Voz' });
const capEst = h('span', { class: 'voz-cap-est', text: 'desligada' });
const capMed = h('span', { class: 'voz-cap-med', hidden: true });
const capCpu = h('b', { text: '—' }), capTmp = h('b', { text: '—' });
capMed.append(h('span', {}, 'CPU ', capCpu), h('i', { 'aria-hidden': 'true' }), h('span', {}, capTmp));
capsula.append(capIc, capRot, capEst, capMed);
/* no celular a cápsula mora na linha de estado ("Robô ligado"); no PC, no topo antes das vistas */
const mqCel = matchMedia('(max-width: 820px), (max-height: 500px) and (pointer: coarse)');
const estadoLinha = document.getElementById('estado');
function lugar() { if (mqCel.matches && estadoLinha) estadoLinha.append(capsula); else acoes.prepend(capsula); }
lugar(); mqCel.addEventListener('change', () => { lugar(); if (S.aberto) posicionar(); });

/* ---------- área (popover) ---------- */
const S = { aberto: false, dado: null, timer: null, ocupado: false, poll: null };
const pop = h('section', { class: 'voz-pop', id: 'voz-pop', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'voz-t', tabindex: '-1', hidden: true });
const fechar_ = h('button', { type: 'button', class: 'ver-x', 'aria-label': 'Fechar' }, icX());
const sub = h('span', { id: 'voz-sub', text: 'Conferindo o VoiceStudio…' });
pop.append(h('header', { class: 'voz-topo' }, h('h2', { id: 'voz-t' }, 'Voz do Jarvis', sub), fechar_));

const seg = h('div', { class: 'voz-seg', role: 'radiogroup', 'aria-label': 'Resposta por voz', 'data-pos': '0' }, h('span', { class: 'pilula', 'aria-hidden': 'true' }));
const botoes = MODOS.map(([m, rot], i) => { const b = h('button', { type: 'button', role: 'radio', 'aria-checked': 'false', 'data-modo': m, tabindex: '-1', text: rot }); b.addEventListener('click', () => mudar(m)); seg.append(b); return b; });
seg.addEventListener('keydown', (e) => {
  const i = botoes.findIndex(b => b.getAttribute('aria-checked') === 'true');
  const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if (!d) return;
  e.preventDefault(); const n = botoes[(i + d + botoes.length) % botoes.length]; n.focus(); mudar(n.dataset.modo);
});
const explica = h('p', { class: 'voz-exp', 'aria-live': 'polite' });

function medidor(rotulo) {
  const val = h('b', { class: 'voz-val', text: '—' }), barra = h('i', { class: 'voz-barra' }), nota = h('span', { class: 'voz-nota' });
  const el = h('div', { class: 'voz-med' }, h('span', { class: 'voz-rot', text: rotulo }), val, h('span', { class: 'voz-trilho', 'aria-hidden': 'true' }, barra), nota);
  return { el, val, barra, nota };
}
const mCpu = medidor('Processador'), mTmp = medidor('Temperatura'), mGpu = medidor('Placa de vídeo');
const medidores = h('div', { class: 'voz-meds' }, mCpu.el, mTmp.el, mGpu.el);

const grafico = document.createElementNS(NS, 'svg'); grafico.setAttribute('class', 'voz-graf'); grafico.setAttribute('viewBox', '0 0 300 72'); grafico.setAttribute('preserveAspectRatio', 'none'); grafico.setAttribute('role', 'img');
const linhaCpu = document.createElementNS(NS, 'path'), linhaTmp = document.createElementNS(NS, 'path'), areaCpu = document.createElementNS(NS, 'path');
areaCpu.setAttribute('class', 'a-cpu'); linhaCpu.setAttribute('class', 'l-cpu'); linhaTmp.setAttribute('class', 'l-tmp');
grafico.append(areaCpu, linhaCpu, linhaTmp);
const janela = h('span', { class: 'voz-janela', text: 'últimos 10 min' });
const legenda = h('div', { class: 'voz-leg', 'aria-hidden': 'true' }, h('span', {}, h('i', { class: 'cpu' }), 'Uso %'), h('span', {}, h('i', { class: 'tmp' }), 'Temperatura °C'), janela);
const blocoMed = h('div', { class: 'voz-bloco' }, medidores, h('div', { class: 'voz-graf-box' }, grafico, legenda));
const desligadoMsg = h('p', { class: 'voz-desl', text: 'Com a voz desligada o PC não é medido. Ligue para acompanhar o processador.' });
const audios = h('p', { class: 'voz-audios' });

pop.append(h('div', { class: 'voz-corpo' }, seg, explica, blocoMed, desligadoMsg, audios));
document.body.append(pop);

/* ---------- pintura ---------- */
function pintar(d) {
  S.dado = d; const ligado = d.modo !== 'desligada';
  const i = Math.max(0, MODOS.findIndex(m => m[0] === d.modo));
  seg.dataset.pos = String(i);
  botoes.forEach((b, j) => { b.setAttribute('aria-checked', String(j === i)); b.tabIndex = j === i ? 0 : -1; });
  explica.textContent = MODOS[i][2];
  sub.textContent = d.voicestudio ? 'VoiceStudio ligado · voz do Pretchia' : 'VoiceStudio fechado: o robô cai no texto';
  sub.className = d.voicestudio ? '' : 'alerta';

  const a = d.agora || {};
  capsula.classList.toggle('on', ligado);
  capsula.classList.toggle('sem-vs', ligado && !d.voicestudio);
  capEst.textContent = ligado ? (d.modo === 'todas' ? 'todas' : '1ª resposta') : 'desligada';
  capMed.hidden = !ligado;
  capCpu.textContent = txt(a.cpu, '%'); capTmp.textContent = txt(a.temp, '°C');
  capMed.dataset.nivel = nivelTemp(a.temp);
  capsula.setAttribute('aria-label', ligado ? `Voz ligada (${capEst.textContent}). Processador ${txt(a.cpu, '%')}, ${txt(a.temp, ' graus')}. Abrir controles da voz.` : 'Voz desligada. Abrir controles da voz.');

  blocoMed.hidden = !ligado; desligadoMsg.hidden = ligado;
  pintarMed(mCpu, a.cpu, '%', a.cpu, nivelUso(a.cpu), a.cpu == null ? '' : a.cpu >= 85 ? 'Muito ocupado' : a.cpu >= 60 ? 'Ocupado' : 'Folgado');
  pintarMed(mTmp, a.temp, '°C', a.temp == null ? 0 : Math.min(100, Math.max(0, (a.temp - 30) / 70 * 100)), nivelTemp(a.temp), a.temp == null ? 'Sensor sem leitura' : a.temp >= 85 ? 'Quente' : a.temp >= 70 ? 'Morno' : 'Tranquilo');
  pintarMed(mGpu, a.gpu_temp, '°C', a.gpu_uso, nivelTemp(a.gpu_temp), a.gpu_uso == null ? 'Sem leitura' : `${a.gpu_uso}% de uso`);
  pintarGrafico(d.historico || []);

  const au = d.audios || {};
  audios.textContent = !au.hoje ? 'Nenhum áudio gerado hoje.'
    : `${au.hoje} ${au.hoje === 1 ? 'áudio gerado' : 'áudios gerados'} hoje` + (au.media_ms ? ` · ${(au.media_ms / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} s em média para gerar` : '') + (au.falhas ? ` · ${au.falhas} ${au.falhas === 1 ? 'falhou' : 'falharam'} (foi em texto)` : '');
}
function pintarMed(m, v, u, pct, nivel, nota) {
  m.val.textContent = txt(v, u); m.el.dataset.nivel = nivel; m.nota.textContent = nota;
  m.barra.style.transform = `scaleX(${pct == null ? 0 : Math.min(1, Math.max(0, pct / 100))})`;
}
function pintarGrafico(hist) {
  if (hist.length < 2) { linhaCpu.setAttribute('d', ''); linhaTmp.setAttribute('d', ''); areaCpu.setAttribute('d', ''); grafico.setAttribute('aria-label', 'Gráfico aparece em alguns segundos'); return; }
  const fim = hist[hist.length - 1][0], ini = Math.max(fim - 600000, hist[0][0]), jan = Math.max(1, fim - ini);
  const min = Math.max(1, Math.round(jan / 60000)); janela.textContent = jan >= 590000 ? 'últimos 10 min' : `último${min > 1 ? 's' : ''} ${min} min`;
  const x = t => ((t - ini) / jan) * 300, y = (v, max) => 70 - (Math.min(max, Math.max(0, v)) / max) * 66;
  const caminho = (col, max) => { let d = '', ab = false; for (const p of hist) { if (p[0] < ini || p[col] == null) { ab = false; continue; } d += (ab ? 'L' : 'M') + x(p[0]).toFixed(1) + ' ' + y(p[col], max).toFixed(1); ab = true; } return d; };
  const dc = caminho(1, 100);
  linhaCpu.setAttribute('d', dc); linhaTmp.setAttribute('d', caminho(2, 100));
  const pts = hist.filter(p => p[0] >= ini && p[1] != null);
  areaCpu.setAttribute('d', pts.length > 1 ? dc + `L${x(pts[pts.length - 1][0]).toFixed(1)} 72L${x(pts[0][0]).toFixed(1)} 72Z` : '');
  const cpus = pts.map(p => p[1]), temps = hist.map(p => p[2]).filter(v => v != null);
  grafico.setAttribute('aria-label', `Últimos 10 minutos: uso máximo ${Math.max(...cpus)}%` + (temps.length ? `, temperatura máxima ${Math.max(...temps)} graus` : ''));
}

/* ---------- dados ---------- */
async function carregar() {
  try { const r = await fetch(BASE + '/api/voz', { cache: 'no-store' }); if (!r.ok) throw new Error(r.status); pintar(await r.json()); }
  catch { sub.textContent = 'Sem resposta do robô. Tentando de novo…'; sub.className = 'alerta'; if (!S.dado) { capEst.textContent = 'sem sinal'; explica.textContent = 'Não consegui ler o estado da voz agora.'; } }
}
async function mudar(modo) {
  if (S.ocupado || (S.dado && S.dado.modo === modo)) return;
  S.ocupado = true; pop.classList.add('ocupado');
  const antes = S.dado; if (antes) pintar({ ...antes, modo });   // anda já; desfaz se der erro
  try {
    const r = await fetch(BASE + '/api/voz', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ modo }) });
    if (!r.ok) throw new Error(r.status); pintar(await r.json());
  } catch { if (antes) pintar(antes); explica.textContent = 'Não consegui mudar a voz. Tente de novo.'; }
  S.ocupado = false; pop.classList.remove('ocupado');
}
function ritmo() {   /* 5 s com a área aberta ou voz ligada; 30 s parado */
  clearTimeout(S.poll);
  const ms = S.aberto || (S.dado && S.dado.modo !== 'desligada') ? 5000 : 30000;
  S.poll = setTimeout(async () => { if (document.visibilityState === 'visible') await carregar(); ritmo(); }, ms);
}

/* ---------- abrir / fechar ---------- */
function posicionar() {
  const r = capsula.getBoundingClientRect(), larg = pop.offsetWidth || 400;
  const esq = Math.max(12, Math.min(innerWidth - larg - 12, r.right - larg));
  pop.style.left = esq + 'px'; pop.style.top = Math.round(r.bottom + 8) + 'px';
  pop.style.setProperty('--ox', Math.round(r.left + r.width / 2 - esq) + 'px');
}
function abrir() {
  clearTimeout(S.timer); S.aberto = true;
  pop.hidden = false; posicionar(); capsula.setAttribute('aria-expanded', 'true');
  requestAnimationFrame(() => requestAnimationFrame(() => pop.classList.add('on')));
  (botoes.find(b => b.tabIndex === 0) || pop).focus({ preventScroll: true });
  carregar(); ritmo();
}
function fechar(focar) {
  if (!S.aberto) return;
  S.aberto = false; pop.classList.remove('on'); capsula.setAttribute('aria-expanded', 'false');
  S.timer = setTimeout(() => { pop.hidden = true; }, reduz.matches ? 0 : 130);
  if (focar) capsula.focus({ preventScroll: true });
  ritmo();
}
capsula.addEventListener('click', (e) => { e.stopPropagation(); S.aberto ? fechar(false) : abrir(); });
fechar_.addEventListener('click', () => fechar(true));
document.addEventListener('pointerdown', (e) => { if (S.aberto && !pop.contains(e.target) && !capsula.contains(e.target)) fechar(false); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.aberto) { e.preventDefault(); fechar(true); } });
addEventListener('resize', () => { if (S.aberto) posicionar(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') carregar(); });

carregar().then(ritmo);
window.__voz = { abrir, fechar, carregar };
})();
