/* Gasto de IA (08/11/2026): cartão da vista Painel (PC) e da aba Resumo (celular).
   GET /api/uso?dias=1|7 → total, grupos (Responder / Gerenciar / Analisar), áreas, média por resposta e tokens por hora.
   Segue o seletor Hoje | 7 dias do topo e atualiza junto com o resto do painel. Sem innerHTML com dado de fora. */
(() => {
'use strict';
const params = new URLSearchParams(location.search);
const BASE = location.protocol === 'file:' ? 'http://127.0.0.1:8811' : '';
const ATUALIZA_MS = 20000;
const MOVEL = matchMedia('(max-width: 820px), (max-height: 500px) and (pointer: coarse)');
const NS = 'http://www.w3.org/2000/svg';
const appEl = document.getElementById('app');
const box = document.getElementById('c-uso'), subEl = document.getElementById('sub-uso');
if (!appEl || !box) return;

const GRUPOS = [['responder', 'Responder', 'Atende os clientes'], ['gerenciar', 'Gerenciar', 'Funil e atrasados'], ['analisar', 'Analisar', 'Releituras e lições']];
const AREAS = [['responder', 'Atendimento'], ['followup', 'Follow-ups'], ['funil', 'Funil e jornada'], ['backlog', 'Atrasados'], ['releitura', 'Releitura'], ['aprender', 'Leitura de 2 h'], ['lacunas', 'Lacunas'], ['jogadas', 'Livro de jogadas']];
const GRUPO_DA_AREA = { responder: 'responder', followup: 'responder', funil: 'gerenciar', backlog: 'gerenciar' };

function h(tag, p, ...f) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(p || {})) { if (v == null || v === false) continue; if (k === 'text') el.textContent = v; else el.setAttribute(k, v === true ? '' : v); }
  for (const x of f.flat()) if (x != null && x !== false) el.append(x);
  return el;
}
function ic() {   /* medidor: mesmo traço 1.8 dos outros ícones do painel */
  const s = document.createElementNS(NS, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) s.setAttribute(k, v);
  for (const d of ['M4.5 17a8 8 0 1 1 15 0', 'M12 13l3.5-3.5']) { const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); s.append(p); }
  return s;
}
const n0 = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
const dec = (v, casas) => v.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: casas });
/* 820 → "820"; 12.340 → "12,3 mil"; 3.400.000 → "3,4 mi" (devolve [número, unidade]) */
function curto(v) {
  v = Math.max(0, n0(v));
  if (v < 1000) return [String(Math.round(v)), ''];
  if (v < 1e6) { const k = v / 1000; return [dec(k, k < 100 ? 1 : 0), 'mil']; }
  const m = v / 1e6; return [dec(m, m < 100 ? 1 : 0), 'mi'];
}
const curtoTxt = v => curto(v).filter(Boolean).join(' ');
function dolar(v) {
  v = n0(v);
  if (v > 0 && v < .01) return 'menos de US$ 0,01';
  return 'US$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function inicioPeriodo(d) { const x = new Date(); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - (d - 1)); return x.getTime(); }
function horaData(iso) {
  const d = new Date(iso); if (!Number.isFinite(d.getTime())) return '';
  const p = n => String(n).padStart(2, '0');
  return { hora: `${p(d.getHours())}h${p(d.getMinutes())}`, data: `${p(d.getDate())}/${p(d.getMonth() + 1)}` };
}
const dias = () => (window.relatorios && window.relatorios.dias ? window.relatorios.dias() : (params.get('dias') === '7' ? 7 : 1));
const reduz = matchMedia('(prefers-reduced-motion: reduce)');

/* ---------- Desenho ---------- */
function vazio(d) {
  const ini = inicioPeriodo(d.dias || dias()), desde = d.desde ? Date.parse(d.desde) : null;
  let t1 = 'Nenhum gasto neste período.', t2 = 'O robô ainda não chamou a IA.';
  if (!desde) { t1 = 'Contando a partir de agora.'; t2 = 'O gasto aparece na próxima resposta do robô.'; }
  else if (desde >= ini) { const q = horaData(d.desde); t1 = `Contando a partir de ${q.hora} de ${q.data}.`; t2 = 'O gasto aparece na próxima resposta do robô.'; }
  box.dataset.modo = 'vazio';
  box.replaceChildren(h('div', { class: 'vazio uso-vazio' }, ic(), h('span', null, h('b', { text: t1 }), h('br'), t2)));
}

function montar() {
  box.dataset.modo = 'cheio';
  const heroi = h('div', { class: 'uso-heroi' },
    h('div', { class: 'uso-total' }, h('span', { class: 'uso-n', 'data-u': 'n' }), h('small', { 'data-u': 'un' })),
    h('dl', { class: 'uso-lado' },
      h('div', null, h('dt', { text: 'Por resposta' }), h('dd', { 'data-u': 'media' })),
      h('div', null, h('dt', { text: 'Chamadas' }), h('dd', { 'data-u': 'chamadas' }))));
  const grupos = h('ul', { class: 'uso-grupos', 'aria-label': 'Tokens por função' },
    GRUPOS.map(([g, nome, dica]) => h('li', { class: 'uso-g g-' + g, 'data-g': g },
      h('span', { class: 'uso-rot' }, h('i', { 'aria-hidden': 'true' }), h('b', { text: nome }), h('span', { class: 'uso-dica', text: dica })),
      h('span', { class: 'uso-trilho', 'aria-hidden': 'true' }, h('i')),
      h('span', { class: 'uso-qtd' }, h('b', { 'data-u': 'tok' }), h('small', { 'data-u': 'pct' })))));
  const areas = h('div', { class: 'uso-bloco' }, h('h3', { class: 'titulinho', text: 'Por área' }),
    h('ul', { class: 'uso-areas' }, AREAS.map(([a, nome]) => h('li', { class: 'g-' + (GRUPO_DA_AREA[a] || 'analisar'), 'data-a': a },
      h('i', { 'aria-hidden': 'true' }), h('span', { text: nome }), h('b', { 'data-u': 'tok' })))));
  const horas = h('div', { class: 'uso-bloco uso-horas', 'data-u': 'horas' }, h('h3', { class: 'titulinho', text: 'Tokens por hora' }),
    h('div', { class: 'uso-hg', role: 'img', 'data-u': 'hg' }, Array.from({ length: 24 }, () => h('span', null, h('i'))), h('b', { class: 'pico', 'data-u': 'pico', 'aria-hidden': 'true' })),
    h('div', { class: 'uso-hr', 'aria-hidden': 'true' }, ['00h', '06h', '12h', '18h', '23h'].map(t => h('span', { text: t }))));
  const pe = h('p', { class: 'uso-pe', 'data-u': 'pe' });
  box.replaceChildren(heroi, grupos, areas, horas, pe);
}

const $u = (k, raiz = box) => raiz.querySelector(`[data-u="${k}"]`);
function pintar(d) {
  const tot = n0(d.total && d.total.tokens), dd = d.dias || dias();
  const ini = inicioPeriodo(dd), desde = d.desde ? Date.parse(d.desde) : null;
  const ch = n0(d.total && d.total.chamadas);
  let sub = dd === 7 ? 'Últimos 7 dias' : 'Hoje';
  if (desde && desde > ini) { const q = horaData(d.desde); sub += ` · desde ${q.hora} de ${q.data}`; }
  subEl.textContent = sub;
  if (!tot) { if (box.dataset.modo !== 'vazio' || box._sig !== d.desde) { box._sig = d.desde; vazio(d); } return; }
  if (box.dataset.modo !== 'cheio') { montar(); box.classList.remove('uso-ok'); void box.offsetWidth; }

  const [n, un] = curto(tot);
  $u('n').textContent = n; $u('un').textContent = (un ? un + ' ' : '') + 'tokens';
  $u('n').parentElement.setAttribute('aria-label', `${curtoTxt(tot)} tokens no período`);
  $u('media').textContent = d.por_resposta ? curtoTxt(d.por_resposta) : '—';
  $u('chamadas').textContent = ch.toLocaleString('pt-BR');

  const maior = Math.max(1, ...GRUPOS.map(([g]) => n0(d.grupos && d.grupos[g] && d.grupos[g].tokens)));
  box.querySelectorAll('[data-g]').forEach(li => {
    const gr = (d.grupos && d.grupos[li.dataset.g]) || {}, t = n0(gr.tokens), pct = Math.round(t / tot * 100);
    $u('tok', li).textContent = t ? curtoTxt(t) : '—';
    $u('pct', li).textContent = t ? `${pct}%` : '';
    li.classList.toggle('zero', !t);
    li.title = `${GRUPOS.find(x => x[0] === li.dataset.g)[1]}: ${t.toLocaleString('pt-BR')} tokens em ${n0(gr.chamadas)} chamadas · ${dolar(gr.custo)} se fosse pago pela API`;
    const bar = li.querySelector('.uso-trilho i');
    requestAnimationFrame(() => { bar.style.transform = `scaleX(${t / maior})`; });
  });

  const porArea = Object.fromEntries((Array.isArray(d.areas) ? d.areas : []).map(a => [a.area, a]));
  box.querySelectorAll('[data-a]').forEach(li => {
    const a = porArea[li.dataset.a], t = n0(a && a.tokens);
    $u('tok', li).textContent = t ? curtoTxt(t) : '—';
    li.classList.toggle('zero', !t);
    li.title = t ? `${t.toLocaleString('pt-BR')} tokens em ${n0(a.chamadas)} chamadas` : 'Sem uso no período';
  });

  const hz = $u('horas'), ph = Array.isArray(d.por_hora) ? d.por_hora.map(n0) : null;
  hz.hidden = !ph || !ph.some(Boolean);
  if (!hz.hidden) {
    const pico = Math.max(1, ...ph), agora = new Date().getHours(), barras = $u('hg').querySelectorAll('span');
    let topo = 0; ph.forEach((v, i) => { if (v > ph[topo]) topo = i; });
    $u('hg').setAttribute('aria-label', `Pico às ${topo}h, com ${curtoTxt(ph[topo])} tokens`);
    $u('pico').textContent = `${curtoTxt(ph[topo])} às ${String(topo).padStart(2, '0')}h`;
    ph.forEach((v, i) => {
      const s = barras[i]; s.title = `${i}h: ${v ? curtoTxt(v) + ' tokens' : 'nada'}`;
      s.classList.toggle('futuro', dd === 1 && i > agora);
      requestAnimationFrame(() => { s.firstChild.style.transform = `scaleY(${v ? Math.max(.04, v / pico) : 0})`; });
    });
  }

  $u('pe').textContent = `${dolar(d.total.custo)} se fosse pago pela API`;
  $u('pe').title = d.nota || '';
  requestAnimationFrame(() => box.classList.add('uso-ok'));
}

/* ---------- Dados ---------- */
let busca = 0, ultimo = null;
async function carregar() {
  const minha = ++busca, dd = dias();
  try {
    const r = await fetch(`${BASE}/api/uso?dias=${dd}`, { cache: 'no-store', headers: { Accept: 'application/json' } });
    const tipo = r.headers.get('content-type') || '';
    if (!r.ok || !/json/i.test(tipo)) throw Object.assign(new Error('HTTP ' + r.status), { status: r.status });
    const d = await r.json();
    if (minha !== busca) return;
    ultimo = d; pintar(d);
  } catch (e) {
    if (minha !== busca) return;
    if (ultimo) return;   /* fica com o último número bom; o topo já avisa quando a rede cai */
    box.dataset.modo = 'erro'; subEl.textContent = '';
    box.replaceChildren(h('div', { class: 'vazio uso-vazio' }, ic(), h('span', { text: e && e.status === 404 ? 'A contagem de tokens ainda não está ligada neste servidor.' : 'Não consegui ler o gasto agora. Tentando de novo.' })));
  }
}

/* Só busca quando o cartão está na tela: vista Painel no PC, aba Resumo no celular */
function ver() { return MOVEL.matches ? appEl.dataset.aba === 'resumo' : appEl.dataset.vista === 'painel'; }
let vis = false;
function checar() {
  const v = ver();
  if (v && !vis) { vis = true; if (ultimo && !reduz.matches) { box.dataset.modo = ''; pintar(ultimo); } carregar(); }
  else if (!v) vis = false;
}
new MutationObserver(checar).observe(appEl, { attributes: true, attributeFilter: ['data-vista', 'data-aba'] });
MOVEL.addEventListener('change', checar);
const seletor = document.getElementById('seletor');
if (seletor) ['click', 'keydown'].forEach(ev => seletor.addEventListener(ev, () => setTimeout(() => { if (ver()) { ultimo = null; carregar(); } }, 0)));
setInterval(() => { if (!document.hidden && ver()) carregar(); }, ATUALIZA_MS);
document.addEventListener('visibilitychange', () => { if (!document.hidden && ver()) carregar(); });
checar();
})();
