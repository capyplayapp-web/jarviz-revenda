/* Aba Sigma (09/11/2026): o painel painel.capyplay.site resumido numa tela. Fonte: GET /api/sigma (sigma-lib.mjs), POST /api/sigma/atualizar.
   Autônoma, prefixo sg-. Só no PC (vista "Sigma"). O servidor lê o Sigma só com GET, numa cópia do login do robô, e guarda 10 min. */
(() => {
'use strict';
const raiz = document.getElementById('sg'), appEl = document.getElementById('app');
if (!raiz || !appEl) return;
const BASE = location.protocol === 'file:' ? 'http://127.0.0.1:8811' : '';
const SIGMA = 'https://painel.capyplay.site/#/dashboard';

function h(tag, props, ...filhos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v; else if (k === 'text') el.textContent = v;
    else if (k === 'style') el.style.cssText = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const f of filhos.flat()) if (f != null && f !== false) el.append(f.nodeType ? f : document.createTextNode(String(f)));
  return el;
}
const NS = 'http://www.w3.org/2000/svg';
const ICONES = {
  usuarios: 'M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19M10 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM20 19v-1.5a3.5 3.5 0 0 0-2.5-3.35M15.5 5.2a3 3 0 0 1 0 5.6',
  tv: 'M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1ZM8 21h8',
  sol: 'M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  relogio: 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  moeda: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v10M15 9.5c0-1.1-1.3-2-3-2s-3 .9-3 2 1.3 2 3 2 3 .9 3 2-1.3 2-3 2-3-.9-3-2',
  pausa: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM10 9v6M14 9v6',
  sumiu: 'M17 8l4 4-4 4M21 12H9M13 20H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h8',
  ok: 'M5 12.5 10 17.5 19 7', busca: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4',
  girar: 'M21 12a8 8 0 0 1-13.6 5.7L4 15M3 12a8 8 0 0 1 13.6-5.7L20 9M4 20v-5h5M20 4v5h-5',
  abrir: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  chat: 'M20 12a8 8 0 0 1-11.5 7.2L4 20l1-4.2A8 8 0 1 1 20 12Z', copiar: 'M9 9h10v10H9zM5 15V5h10',
  alerta: 'M12 8v5M12 16.5v.01M10.3 4.2 2.8 17.2A2 2 0 0 0 4.5 20h15a2 2 0 0 0 1.7-2.8L13.7 4.2a2 2 0 0 0-3.4 0Z',
  mais: 'M12 5v14M5 12h14', seta: 'M5 12h14M13 6l6 6-6 6', teste: 'M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3',
};
function ic(nome) {
  const s = document.createElementNS(NS, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '1.8'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(NS, 'path'); p.setAttribute('d', ICONES[nome] || ICONES.ok); s.append(p); return s;
}
const int = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString('pt-BR') : '—');
const plural = (n, a, b) => (n === 1 ? a : b);
const hora = (iso) => { const d = new Date(iso); return Number.isFinite(+d) ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''; };
function haQuanto(iso) {
  const t = Date.parse(iso || ''); if (!Number.isFinite(t)) return 'nunca';
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 2) return 'agora'; if (m < 60) return `há ${m} min`;
  const hs = Math.round(m / 60); if (hs < 24) return `há ${hs} h`;
  const d = Math.round(hs / 24); return d === 1 ? 'ontem' : `há ${d} dias`;
}
const zap = (n) => n ? 'https://web.whatsapp.com/send?phone=' + (n.length <= 11 ? '55' + n : n) : null;
const ehHoje = (iso) => { const d = new Date(iso), a = new Date(); return d.getFullYear() === a.getFullYear() && d.getMonth() === a.getMonth() && d.getDate() === a.getDate(); };

/* ---------- Estado ---------- */
const S = { d: null, lendo: false, erro: null, busca: '', ordem: 'clientes', vis: false, timer: 0, sig: '' };
try { const o = localStorage.getItem('sg-ordem'); if (['clientes', 'recentes', 'creditos'].includes(o)) S.ordem = o; } catch {}

/* ---------- Esqueleto ---------- */
const sub = h('p', { class: 'sg-sub', text: 'painel.capyplay.site' });
const btnAtualizar = h('button', { type: 'button', class: 'btn', id: 'sg-atualizar' }, ic('girar'), h('span', { text: 'Atualizar' }));
const btnAbrir = h('a', { class: 'btn', href: SIGMA, target: '_blank', rel: 'noopener noreferrer' }, ic('abrir'), h('span', { text: 'Abrir o Sigma' }));
const avisoEl = h('div', { class: 'sg-aviso', role: 'status', hidden: true }, ic('alerta'), h('span'));
const cKpis = h('div', { class: 'sg-kpis' });
const cPrecisa = h('article', { class: 'cartao sg-card sg-precisa', 'aria-labelledby': 'sg-t-precisa' });
const cRev = h('article', { class: 'cartao sg-card sg-rev', 'aria-labelledby': 'sg-t-rev' });
const cMov = h('article', { class: 'cartao sg-card sg-mov', 'aria-labelledby': 'sg-t-mov' });

const busca = h('label', { class: 'sg-busca' }, ic('busca'),
  h('input', { type: 'search', placeholder: 'Nome, usuário ou WhatsApp', 'aria-label': 'Buscar revendedor', autocomplete: 'off', spellcheck: 'false' }));
const inputBusca = busca.querySelector('input');
const ORDENS = [['clientes', 'Mais clientes'], ['recentes', 'Mais novos'], ['creditos', 'Menos créditos']];
const segOrdem = h('div', { class: 'seletor sg-seg', role: 'radiogroup', 'aria-label': 'Ordenar revendedores', 'data-pos': '0' },
  h('span', { class: 'pilula', 'aria-hidden': 'true' }),
  ...ORDENS.map(([k, t]) => h('button', { type: 'button', role: 'radio', 'aria-checked': 'false', 'data-ordem': k, tabindex: '-1', text: t })));
const listaRev = h('ul', { class: 'sg-lista', id: 'sg-lista' });
const contaRev = h('span', { class: 'sub' });
cRev.append(
  h('header', null, h('h2', { id: 'sg-t-rev', text: 'Revendedores' }), contaRev),
  h('div', { class: 'sg-ferr' }, busca, segOrdem),
  h('div', { class: 'sg-cab', 'aria-hidden': 'true' }, h('span', { text: 'Revendedor' }), h('span', { text: 'Clientes' }), h('span', { text: 'Testes' }), h('span', { text: 'Créditos' }), h('span', { text: 'Último acesso' }), h('span')),
  h('div', { class: 'corpo', tabindex: '0', role: 'region', 'aria-label': 'Lista de revendedores' }, listaRev));

raiz.append(
  h('header', { class: 'sg-topo' },
    h('div', { class: 'sg-titulo' }, h('h2', { text: 'Sigma' }), sub),
    h('div', { class: 'sg-acoes' }, btnAtualizar, btnAbrir)),
  avisoEl, cKpis, h('div', { class: 'sg-grade' }, cPrecisa, cRev, cMov));

function pintarSeg() {
  segOrdem.dataset.pos = String(ORDENS.findIndex(([k]) => k === S.ordem));
  segOrdem.querySelectorAll('button').forEach((b) => { const on = b.dataset.ordem === S.ordem; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; });
}
segOrdem.addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-ordem]'); if (!b || b.dataset.ordem === S.ordem) return;
  S.ordem = b.dataset.ordem; try { localStorage.setItem('sg-ordem', S.ordem); } catch {}
  pintarSeg(); pintarRev();
});
segOrdem.addEventListener('keydown', (ev) => {
  if (!['ArrowRight', 'ArrowLeft'].includes(ev.key)) return;
  ev.preventDefault(); const i = ORDENS.findIndex(([k]) => k === S.ordem), p = ev.key === 'ArrowRight' ? 1 : -1;
  segOrdem.querySelectorAll('button')[(i + p + 3) % 3].click(); segOrdem.querySelector('[aria-checked="true"]').focus();
});
let tBusca = 0;
inputBusca.addEventListener('input', () => { clearTimeout(tBusca); tBusca = setTimeout(() => { S.busca = inputBusca.value.trim(); pintarRev(); }, 120); });
pintarSeg();

/* ---------- Peças ---------- */
function kpi(i, icone, rotulo, valor, nota, cls, extra) {
  return h('div', { class: 'sg-kpi ' + (cls || ''), style: `--i:${i}` },
    h('span', { class: 'sg-kpi-r' }, ic(icone), rotulo),
    h('span', { class: 'sg-kpi-v' }, h('b', { text: valor })),
    h('span', { class: 'sg-kpi-n', text: nota }), extra || null);
}
function vazio(icone, t, d) { return h('div', { class: 'sg-vazio' }, ic(icone), h('b', { text: t }), d ? h('span', { text: d }) : null); }
function botaoZap(numero, nome) {
  const u = zap(numero);
  return u ? h('a', { class: 'sg-zap', href: u, target: '_blank', rel: 'noopener noreferrer', 'aria-label': `Conversar com ${nome} no WhatsApp`, title: 'Abrir no WhatsApp Web' }, ic('chat'))
    : h('span', { class: 'sg-zap off', 'aria-hidden': 'true' });
}
function inicial(nome) { return h('span', { class: 'sg-av', 'aria-hidden': 'true', text: (String(nome || '?').trim()[0] || '?').toUpperCase() }); }
function selo(r) { return r.do_robo ? h('span', { class: 'sg-selo', title: 'Fechou o painel pelo robô do WhatsApp', text: 'robô' }) : null; }

async function copiar(texto, btn) {
  try { await navigator.clipboard.writeText(texto); } catch { const t = h('textarea', { style: 'position:fixed;opacity:0' }); t.value = texto; document.body.append(t); t.select(); document.execCommand('copy'); t.remove(); }
  const span = btn.querySelector('span'), antes = span.textContent; span.textContent = 'Copiado'; btn.classList.add('ok');
  setTimeout(() => { span.textContent = antes; btn.classList.remove('ok'); }, 1600);
}

/* ---------- Pintura ---------- */
function pintarKpis(d) {
  const n = d.numeros, l = d.link;
  const conv = l && l.visitas ? Math.round((l.cadastros / l.visitas) * 100) : null;
  const btnLink = l ? h('button', { type: 'button', class: 'sg-copiar', onclick: (ev) => copiar(l.url, ev.currentTarget) }, ic('copiar'), h('span', { text: 'Copiar link' })) : null;
  cKpis.replaceChildren(
    kpi(0, 'usuarios', 'Revendedores', int(n.revendedores), `${int(n.revendedores_ativos_7d)} entraram na semana · ${int(n.novos_revendedores_7d)} novos`),
    kpi(1, 'tv', 'Clientes ativos', int(n.clientes_ativos), `${int(n.testes_agora)} ${plural(n.testes_agora, 'teste rodando', 'testes rodando')} agora`, 'ciano'),
    kpi(2, 'sol', 'Clientes novos hoje', int(n.hoje.clientes), `${int(n.hoje.testes)} ${plural(n.hoje.testes, 'teste', 'testes')} · ${int(n.hoje.recargas)} ${plural(n.hoje.recargas, 'recarga', 'recargas')} · ${int(n.mes.clientes)} em 30 dias`, 'ok'),
    kpi(3, 'relogio', 'Vencem em 7 dias', int(n.vencem_7d), n.venceram_7d ? `${int(n.venceram_7d)} ${plural(n.venceram_7d, 'venceu', 'venceram')} na última semana` : 'nenhum venceu na última semana', n.vencem_7d ? 'warn' : ''),
    l ? kpi(4, 'link', 'Cadastros pelo link', int(l.cadastros), `${int(l.visitas)} visitas${conv != null ? ` · ${conv}% viram painel` : ''}`, '', btnLink) : null);
}

const TIPOS_PRECISA = {
  vencendo: { ic: 'relogio', t: 'Clientes vencendo', cls: 'warn' },
  credito: { ic: 'moeda', t: 'Sem crédito', cls: 'warn' },
  parado: { ic: 'pausa', t: 'Ainda sem cliente', cls: 'ciano' },
  sumiu: { ic: 'sumiu', t: 'Sumiram do painel', cls: '' },
};
function pintarPrecisa(d) {
  const porId = new Map(d.revendedores.map((r) => [r.id, r]));
  const grupos = {};
  for (const p of d.precisa) (grupos[p.tipo] = grupos[p.tipo] || []).push(p);
  const total = d.precisa.length;
  const corpoEl = h('div', { class: 'corpo', tabindex: '0', role: 'region', 'aria-label': 'O que precisa de atenção' });
  if (!total) corpoEl.append(vazio('ok', 'Nada pendente', 'Ninguém sem crédito, vencendo ou parado.'));
  for (const [tipo, cfg] of Object.entries(TIPOS_PRECISA)) {
    const itens = grupos[tipo]; if (!itens) continue;
    corpoEl.append(h('section', { class: 'sg-grupo ' + cfg.cls },
      h('h3', null, ic(cfg.ic), cfg.t, Object.keys(grupos).length > 1 ? h('span', { class: 'sg-qtd', text: int(itens.length) }) : null),
      h('ul', null, ...itens.map((p) => {
        const r = porId.get(p.revendedor) || {};
        return h('li', { class: 'sg-item' }, inicial(r.nome),
          h('div', { class: 'sg-item-t' }, h('b', null, r.nome || r.usuario || '—', selo(r)), h('span', { text: p.texto.replace(/ e ainda não criou cliente$/, '') })),
          botaoZap(r.whatsapp, r.nome || 'o revendedor'));
      }))));
  }
  cPrecisa.replaceChildren(h('header', null, h('h2', { id: 'sg-t-precisa', text: 'Precisa de mim' }), h('span', { class: 'sub', text: total ? `${int(total)} ${plural(total, 'revendedor', 'revendedores')}` : '' })), corpoEl);
}

const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function pintarRev() {
  const d = S.d; if (!d) return;
  let lista = d.revendedores.slice();
  if (S.busca) {
    const q = norm(S.busca), dig = S.busca.replace(/\D/g, '');
    lista = lista.filter((r) => norm(r.nome).includes(q) || norm(r.usuario).includes(q) || (dig.length >= 3 && (r.whatsapp || '').includes(dig)));
  }
  const t = (iso) => Date.parse(iso || '') || 0;
  if (S.ordem === 'clientes') lista.sort((a, b) => b.clientes - a.clientes || b.testes - a.testes || t(b.ultimo_login) - t(a.ultimo_login));
  else if (S.ordem === 'recentes') lista.sort((a, b) => t(b.criado_em) - t(a.criado_em));
  else lista.sort((a, b) => (a.creditos ?? 1e9) - (b.creditos ?? 1e9) || b.clientes - a.clientes);
  contaRev.textContent = S.busca ? `${int(lista.length)} de ${int(d.revendedores.length)}` : `${int(d.revendedores.length)} no painel · ${int(d.revendedores.filter((r) => r.do_robo).length)} pelo robô`;
  if (!lista.length) { listaRev.replaceChildren(h('li', null, vazio('busca', 'Ninguém com esse nome', 'Tente o usuário do painel ou o número do WhatsApp.'))); return; }
  listaRev.replaceChildren(...lista.slice(0, 250).map((r) => {
    const parado = r.dias_sem_entrar != null && r.dias_sem_entrar >= 7, baixo = r.creditos != null && r.creditos < 10;
    return h('li', { class: 'sg-linha' + (r.status !== 'ACTIVE' ? ' inativo' : '') },
      h('div', { class: 'sg-quem' }, inicial(r.nome), h('div', null, h('b', null, r.nome || r.usuario, selo(r)), h('span', { text: String(r.usuario || '').includes('@') ? r.usuario : '@' + (r.usuario || '') }))),
      h('span', { class: 'sg-num' + (r.clientes ? ' forte' : ''), text: int(r.clientes) }),
      h('span', { class: 'sg-num', text: int(r.testes) }),
      h('span', { class: 'sg-num' + (baixo ? ' warn' : ''), text: int(r.creditos) }),
      h('span', { class: 'sg-quando' + (parado ? ' warn' : ''), text: haQuanto(r.ultimo_login) }),
      botaoZap(r.whatsapp, r.nome || r.usuario));
  }));
}

const MOV = { credito: ['moeda', 'ciano'], cliente: ['mais', 'ok'], renovou: ['girar', 'ok'], teste: ['teste', ''], telas: ['tv', ''], acerto: ['ok', 'ok'], outro: ['seta', ''] };
function pintarMov(d) {
  const hoje = d.eventos.filter((e) => ehHoje(e.em));
  const nomes = new Map(d.revendedores.map((r) => [String(r.usuario).toLowerCase(), r.nome || r.usuario]));
  const nome = (u) => nomes.get(String(u || '').toLowerCase()) || u || '';
  /* repetições seguidas (mesmo tipo e mesmo revendedor) viram uma linha só, com a contagem */
  const lista = [];
  for (const e of (hoje.length >= 6 ? hoje : d.eventos)) {
    const ult = lista[lista.length - 1];
    if (ult && ult.tipo === e.tipo && ult.quem === e.quem && ult.para === e.para) { ult.vezes++; continue; }
    lista.push({ ...e, vezes: 1 });
    if (lista.length >= 40) break;
  }
  const corpoEl = h('div', { class: 'corpo', tabindex: '0', role: 'region', 'aria-label': 'Movimento do painel' });
  if (!lista.length) corpoEl.append(vazio('sol', 'Sem movimento ainda', 'Recargas, clientes novos e testes aparecem aqui.'));
  else corpoEl.append(h('ol', { class: 'sg-mov-l' }, ...lista.map((e) => {
    const [i, cls] = MOV[e.tipo] || MOV.outro;
    return h('li', { class: 'sg-ev ' + cls }, h('span', { class: 'sg-ev-i' }, ic(i)),
      h('div', { class: 'sg-ev-t' }, h('b', null, e.titulo, e.vezes > 1 ? h('span', { class: 'sg-vezes', text: `×${e.vezes}` }) : null), h('span', { text: e.para ? `${nome(e.quem)} → ${nome(e.para)}` : nome(e.quem) })),
      h('time', { datetime: e.em, text: ehHoje(e.em) ? hora(e.em) : new Date(e.em).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) }));
  })));
  cMov.replaceChildren(h('header', null, h('h2', { id: 'sg-t-mov', text: hoje.length >= 6 ? 'Movimento de hoje' : 'Último movimento' }), h('span', { class: 'sub', text: `${int(hoje.length)} hoje` })), corpoEl);
}

function pintarEstado() {
  const d = S.d;
  btnAtualizar.disabled = S.lendo; btnAtualizar.classList.toggle('lendo', S.lendo);
  btnAtualizar.querySelector('span').textContent = S.lendo ? 'Lendo o Sigma…' : 'Atualizar';
  sub.textContent = d ? `painel.capyplay.site · lido ${haQuanto(d.lido_em)}, às ${hora(d.lido_em)}` : 'painel.capyplay.site';
  const e = S.erro;
  if (e && !S.lendo) {
    avisoEl.hidden = false;
    avisoEl.lastElementChild.textContent = e.motivo === 'login'
      ? 'O Sigma pediu login de novo. No PC, rode "node teste-gratis.js --login" na pasta do robô, entre no painel e feche a janela.'
      : e.motivo === 'ocupado' ? 'Outra leitura do Sigma está rodando agora. Tento de novo em instantes.'
      : 'Não consegui ler o Sigma agora' + (d ? '; mostrando a última leitura.' : '.');
  } else avisoEl.hidden = true;
}

function esqueleto() {
  cKpis.replaceChildren(...[0, 1, 2, 3, 4].map(() => h('div', { class: 'sg-kpi sg-sk' }, h('span', { class: 'sk-l' }), h('span', { class: 'sk-l g' }))));
  const sk = (t, id) => [h('header', null, h('h2', { id, text: t })), h('div', { class: 'corpo fixo' }, vazio('relogio', 'Lendo o Sigma…', 'A primeira leitura leva uns 20 segundos.'))];
  cPrecisa.replaceChildren(...sk('Precisa de mim', 'sg-t-precisa'));
  cMov.replaceChildren(...sk('Movimento de hoje', 'sg-t-mov'));
  listaRev.replaceChildren();
}

function pintar() {
  pintarEstado();
  const d = S.d; if (!d) { esqueleto(); return; }
  const sig = d.lido_em; if (sig === S.sig) return; S.sig = sig;
  pintarKpis(d); pintarPrecisa(d); pintarRev(); pintarMov(d);
}

/* ---------- Dados ---------- */
async function carregar() {
  try {
    const r = await fetch(BASE + '/api/sigma', { cache: 'no-store' });
    const j = await r.json();
    S.d = j.dados || S.d; S.lendo = !!j.lendo; S.erro = j.erro || null;
  } catch { S.erro = { motivo: 'rede' }; }
  pintar(); agendar();
}
function agendar() { clearTimeout(S.timer); if (S.vis) S.timer = setTimeout(carregar, S.lendo ? 4000 : 60000); }
btnAtualizar.addEventListener('click', async () => {
  S.lendo = true; pintarEstado();
  try { const r = await fetch(BASE + '/api/sigma/atualizar', { method: 'POST' }); const j = await r.json(); S.lendo = !!j.lendo; S.erro = j.erro || null; } catch {}
  pintarEstado(); agendar();
});
setInterval(() => { if (S.vis && S.d) sub.textContent = `painel.capyplay.site · lido ${haQuanto(S.d.lido_em)}, às ${hora(S.d.lido_em)}`; }, 30000);

function conferirVista() {
  const vis = appEl.dataset.vista === 'sigma';
  if (vis === S.vis) return; S.vis = vis;
  if (vis) carregar(); else clearTimeout(S.timer);
}
new MutationObserver(conferirVista).observe(appEl, { attributes: true, attributeFilter: ['data-vista'] });
esqueleto(); conferirVista();
})();
