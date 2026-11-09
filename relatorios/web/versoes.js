/* Versões do robô (09/11/2026): selo "v1.4.0" no cabeçalho; clique abre o histórico (GET /api/versoes).
   A fonte da verdade é ..\versoes.json, lido pelo servidor a cada chamada. O popover nasce do selo.
   Sem innerHTML com dado de fora. */
(() => {
'use strict';
const BASE = location.protocol === 'file:' ? 'http://127.0.0.1:8811' : '';
const NS = 'http://www.w3.org/2000/svg';
const ICO = {
  fechar: '<path d="M6 6l12 12M18 6 6 18"/>',
  ok: '<path d="M5 12.5 10 17.5 19 7"/>',
  relogio: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  alerta: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5"/><path d="M12 16.5h.01"/>',
};
function ic(n) { const s = document.createElementNS(NS, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.8'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true'); s.innerHTML = ICO[n] || ''; return s; }
function h(tag, p, ...f) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(p || {})) { if (v == null || v === false) continue; if (k === 'text') el.textContent = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v === true ? '' : v); }
  for (const x of f.flat()) if (x != null && x !== false) el.append(x);
  return el;
}
const txt = (v) => (v == null ? '' : String(v)).trim();
const vv = (v) => { const t = txt(v); return t ? (/^v/i.test(t) ? t : 'v' + t) : ''; };
function dataBR(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(txt(iso));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : txt(iso);
}
// "revisao" pode vir como texto ("aprovado"), booleano ou objeto ({status|resultado|veredito|aprovado, por, em, nota}).
function revisao(r) {
  if (r == null || r === '') return { estado: 'pendente' };
  if (typeof r === 'boolean') return { estado: r ? 'aprovado' : 'pendente' };
  if (typeof r === 'string') return { estado: /reprov|recus/i.test(r) ? 'reprovado' : /aprov/i.test(r) ? 'aprovado' : 'pendente', nota: /aprov|reprov|pendent|recus/i.test(r) ? '' : r };
  if (typeof r === 'object') {
    const s = txt(r.status ?? r.resultado ?? r.veredito ?? r.estado ?? '');
    let estado = r.aprovado === true ? 'aprovado' : 'pendente';
    if (/reprov|recus/i.test(s)) estado = 'reprovado'; else if (/aprov/i.test(s)) estado = 'aprovado';
    const por = txt(r.por ?? r.revisor ?? ''), em = txt(r.em ?? r.data ?? '');
    const nota = [por && 'por ' + por, em && dataBR(em), txt(r.nota ?? r.obs ?? r.comentario ?? '')].filter(Boolean).join(' · ');
    return { estado, nota };
  }
  return { estado: 'pendente' };
}
const ROT = { aprovado: ['Revisão aprovada', 'ok'], pendente: ['Revisão pendente', 'relogio'], reprovado: ['Revisão reprovada', 'alerta'] };

const S = { dados: null, pop: null, lista: null, sub: null, aberto: false, timer: 0 };
const selo = document.getElementById('ver-selo');
const seloTxt = document.getElementById('ver-selo-txt');
if (!selo) return;

async function carregar() {
  try {
    const r = await fetch(BASE + '/api/versoes', { cache: 'no-store' });
    if (!r.ok) throw new Error('http ' + r.status);
    S.dados = await r.json();
  } catch { S.dados = S.dados || null; }
  pintarSelo();
  if (S.aberto) pintarLista();
}

function pintarSelo() {
  const d = S.dados, atual = d && txt(d.atual);
  if (!atual) { selo.hidden = true; return; }
  const ent = (d.versoes || []).find((v) => txt(v.versao) === atual);
  const est = ent ? revisao(ent.revisao).estado : 'pendente';
  seloTxt.textContent = vv(atual);
  selo.classList.toggle('pendente', est !== 'aprovado');
  selo.setAttribute('aria-label', `Versão ${atual} do robô, ${ROT[est][0].toLowerCase()}. Abrir histórico`);
  selo.hidden = false;
}

function montar() {
  if (S.pop) return;
  S.sub = h('span');
  S.lista = h('ul', { class: 'ver-lista' });
  S.pop = h('section', { class: 'ver-pop', id: 'ver-pop', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'ver-pop-t', hidden: true, tabindex: '-1' },
    h('div', { class: 'ver-topo' },
      h('h2', { id: 'ver-pop-t' }, 'Versões do robô', S.sub),
      h('button', { type: 'button', class: 'ver-x', 'aria-label': 'Fechar', onclick: () => fechar(true) }, ic('fechar'))),
    S.lista);
  document.body.append(S.pop);
}

function pintarLista() {
  const d = S.dados || { atual: null, versoes: [] };
  const vs = [...(d.versoes || [])].sort((a, b) => txt(b.data).localeCompare(txt(a.data)) || txt(b.versao).localeCompare(txt(a.versao), undefined, { numeric: true }));
  S.sub.textContent = d.atual ? `Em uso: ${vv(d.atual)} · ${vs.length} ${vs.length === 1 ? 'versão' : 'versões'}` : 'Sem versão registrada';
  S.lista.replaceChildren();
  if (!vs.length) { S.lista.append(h('li', { class: 'ver-vazio', text: 'Nenhuma versão registrada ainda.' })); return; }
  for (const v of vs) {
    const rv = revisao(v.revisao), [rot, ico] = ROT[rv.estado];
    const mud = (Array.isArray(v.mudancas) ? v.mudancas : []).map((m) => h('li', { text: txt(m) }));
    S.lista.append(h('li', { class: 'ver-item' + (txt(v.versao) === txt(d.atual) ? ' atual' : '') },
      h('div', { class: 'ver-cab' },
        h('span', { class: 'ver-num', text: vv(v.versao) }),
        h('span', { class: 'ver-data', text: dataBR(v.data) }),
        h('span', { class: 'ver-rev ' + rv.estado }, ic(ico), h('span', { text: rot }))),
      txt(v.titulo) ? h('p', { class: 'ver-tit', text: txt(v.titulo) }) : null,
      mud.length ? h('ul', { class: 'ver-mud' }, mud) : null,
      rv.nota ? h('p', { class: 'ver-nota', text: rv.nota }) : null));
  }
}

function posicionar() {
  const r = selo.getBoundingClientRect(), larg = S.pop.offsetWidth || 416;
  const esq = Math.max(12, Math.min(r.left, innerWidth - larg - 12));
  S.pop.style.left = esq + 'px';
  S.pop.style.top = Math.round(r.bottom + 8) + 'px';
  S.pop.style.setProperty('--ox', Math.round(r.left + r.width / 2 - esq) + 'px');   // a escala nasce do selo
}

function abrir() {
  montar(); clearTimeout(S.timer);
  S.aberto = true; pintarLista();
  S.pop.hidden = false; posicionar();
  selo.setAttribute('aria-expanded', 'true');
  requestAnimationFrame(() => requestAnimationFrame(() => S.pop.classList.add('on')));
  S.pop.focus({ preventScroll: true });
  carregar();                                   // relê: o revisor pode ter marcado a revisão agora
}
function fechar(focarSelo) {
  if (!S.aberto) return;
  S.aberto = false;
  S.pop.classList.remove('on');
  selo.setAttribute('aria-expanded', 'false');
  S.timer = setTimeout(() => { S.pop.hidden = true; }, 130);
  if (focarSelo) selo.focus({ preventScroll: true });
}

selo.addEventListener('click', (e) => { e.stopPropagation(); S.aberto ? fechar(false) : abrir(); });
document.addEventListener('pointerdown', (e) => { if (S.aberto && !S.pop.contains(e.target) && !selo.contains(e.target)) fechar(false); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.aberto) { e.preventDefault(); fechar(true); } });
addEventListener('resize', () => { if (S.aberto) posicionar(); });

carregar();
setInterval(() => { if (document.visibilityState === 'visible') carregar(); }, 60000);
window.__versoes = { abrir, fechar, carregar };
})();
