/* Relatórios de atendimento da revenda. JS puro, sem dependências, nada de innerHTML com dado de fora.
   Fontes: GET /api/resumo?dias=1|7, GET /api/revendedores, POST /api/aprender.
   ?mock=1 usa mock/resumo*.json; ?mock=vazio mostra todos os estados vazios.
   Mocks da nuvem: ?mock=nuvem (comandos enfileirados), ?mock=velho (PC sem enviar dados), ?mock=sessao (401).
   ?aba=follow|paineis|conversas|mapa|leitura|funil|jornada abre a aba do celular; ?vista=mapa|followups|funil|jornada abre a vista no PC (Follow-ups em followups.js; Funil e Jornada em funil.js e jornada.js).
   Celular (até 820 px): uma seção por vez com barra de abas; no PC nada muda. */
(() => {
'use strict';

const params = new URLSearchParams(location.search);
const MOCK = params.get('mock');
const BASE = location.protocol === 'file:' ? 'http://127.0.0.1:8811' : '';
const REDUZ = matchMedia('(prefers-reduced-motion: reduce)');
const ATUALIZA_MS = 20000;
const $ = (s, r = document) => r.querySelector(s);

/* ---------- Pequenos utilitários ---------- */
function h(tag, props, ...filhos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const f of filhos.flat()) { if (f == null || f === false) continue; el.append(f.nodeType ? f : document.createTextNode(String(f))); }
  return el;
}
const NS = 'http://www.w3.org/2000/svg';
const ICONES = {
  copiar: '<rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15"/>',
  ok: '<path d="M5 12.5 10 17.5 19 7"/>',
  alerta: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5"/><path d="M12 16.5h.01"/>',
  ideia: '<path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1.1 1.2 1.1 2.2h5c0-1 .5-1.7 1.1-2.2A6 6 0 0 0 12 3Z"/>',
  regra: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5Z"/><path d="M4 5.5v16"/>',
  caixa: '<path d="m4 13 2-7h12l2 7v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z"/><path d="M4 13h4l1 2h6l1-2h4"/>',
  gira: '<path d="M12 3a9 9 0 1 0 9 9"/>',
  relogio: '<path d="M12 7v5l3 2"/><circle cx="12" cy="12" r="9"/>',
  atualizar: '<path d="M21 12a8 8 0 0 1-13.6 5.7L4 15"/><path d="M3 12a8 8 0 0 1 13.6-5.7L20 9"/><path d="M4 20v-5h5M20 4v5h-5"/>',
  telefone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z"/>',
  conversa: '<path d="M20 12a8 8 0 0 1-11.5 7.2L4 20l1-4.2A8 8 0 1 1 20 12Z"/>',
};
function ic(nome) {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '1.8'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true'); s.innerHTML = ICONES[nome] || '';
  return s;
}
const num = v => (v == null || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
const int = v => { const n = num(v); return n == null ? '—' : Math.round(n).toLocaleString('pt-BR'); };
/* Tira caracteres de uso privado (ex.: a maçã que alguns contatos põem no nome), que aparecem como quadradinho. */
const txt = v => (v == null ? '' : String(v)).replace(/[\p{Co}\u0000-\u0008\u000B\u000C\u000E-\u001F]/gu, '').trim();
const lista = v => (Array.isArray(v) ? v : []);
/* Taxa pode vir como fração (0 a 1) ou como porcentagem (0 a 100). */
function pct(v) { const n = num(v); if (n == null) return null; return Math.max(0, Math.round(n <= 1 ? n * 100 : n)); }
function minLabel(m) {
  m = num(m); if (m == null) return '';
  if (m < 60) return `${Math.round(m)} min`;
  const hh = Math.floor(m / 60), mm = Math.round(m % 60);
  return mm ? `${hh} h ${mm} min` : `${hh} h`;
}
function data(v) {
  if (!v) return null;
  let d = new Date(v);
  if (isNaN(d)) { const m = /^(\d{2})\/(\d{2})\/(\d{4})[ ,]+(\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(v)); if (m) d = new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +(m[6] || 0)); }
  return isNaN(d) ? null : d;
}
const hhmm = d => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
function quando(v) {
  const d = data(v); if (!d) return '';
  const hoje = new Date(), ontem = new Date(Date.now() - 864e5);
  const mesmo = (a, b) => a.toDateString() === b.toDateString();
  if (mesmo(d, hoje)) return hhmm(d);
  if (mesmo(d, ontem)) return `ontem ${hhmm(d)}`;
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${hhmm(d)}`;
}
function quandoExt(d) {
  const q = quando(d); if (!q) return '';
  if (q.startsWith('ontem ')) return 'ontem às ' + q.slice(6);
  if (q.length === 5) return 'às ' + q;
  return 'em ' + q.replace(' ', ' às ');
}
function atras(v) {
  const d = data(v); if (!d) return '';
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'há pouco';
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  return `há ${Math.floor(s / 86400)} d`;
}
function telefone(v) {
  const t = txt(v), d = t.replace(/\D/g, '');
  let m = /^55(\d{2})(9?\d{4})(\d{4})$/.exec(d); if (m) return `+55 (${m[1]}) ${m[2]}-${m[3]}`;
  m = /^(\d{2})(9?\d{4})(\d{4})$/.exec(d); if (m) return `(${m[1]}) ${m[2]}-${m[3]}`;
  return t;
}
const digitos = v => String(v == null ? '' : v).replace(/\D/g, '');
/* Número com DDI para ligar e abrir no WhatsApp. Sem 55 na frente, assume Brasil. */
function numeroLink(v) { const d = digitos(v); if (d.length < 10) return ''; return d.length <= 11 ? '55' + d : d; }
function linkTel(v, cls) {
  const t = telefone(v);
  return h('span', { class: cls, text: t });   /* ligar e abrir no WhatsApp ficam nos atalhos (acoesContato), com alvo de 44 px */
}
/* Linha de atalhos (só aparece no celular): ligar, abrir no WhatsApp e, se houver, uma ação extra. */
function acoesContato(v, extra) {
  const n = numeroLink(v); if (!n) return null;
  return h('div', { class: 'acoes' },
    h('a', { class: 'chip', href: 'tel:+' + n }, ic('telefone'), 'Ligar'),
    h('a', { class: 'chip', href: 'https://wa.me/' + n, target: '_blank', rel: 'noopener noreferrer' }, ic('conversa'), 'WhatsApp'), extra);
}
const inicial = n => (txt(n).replace(/[^\p{L}\p{N}]/gu, '')[0] || '?').toUpperCase();
const plural = (n, um, varios) => `${int(n)} ${num(n) === 1 ? um : varios}`;
const assinatura = o => { try { return JSON.stringify(o); } catch { return String(Math.random()); } };

/* ---------- Estado ---------- */
let dias = 1;
try { const salvo = localStorage.getItem('relatorios.dias'); if (salvo === '7') dias = 7; } catch { /* sem armazenamento */ }
if (params.get('dias') === '7') dias = 7; else if (params.get('dias') === '1') dias = 1;
const S = { feito: false, periodo: null, sig: {}, atual: null, revs: null, rede: true, lendo: false, sessao: false, pend: { n: null, itens: [] }, ctaVisivel: false, folha: false, ocupado: false };
let aba = 'resumo';
const MOVEL = matchMedia('(max-width: 820px), (max-height: 500px) and (pointer: coarse)');
let mockLido = null, mockPolls = 0;

/* ---------- Rede ---------- */
async function pegar(caminho, { metodo = 'GET', limite = 15000, sinal } = {}) {
  const ctl = new AbortController();
  const corta = setTimeout(() => ctl.abort(new DOMException('tempo esgotado', 'TimeoutError')), limite);
  if (sinal) sinal.addEventListener('abort', () => ctl.abort(sinal.reason), { once: true });
  try {
    let url = BASE + caminho;
    if (MOCK) {
      const PEND = { total: 3, itens: [{ nome: 'Marcos Vieira', desde_min: 42 }, { nome: 'Patrícia Lopes', desde_min: 17 }, { nome: '5511970123456', desde_min: 9 }] };
      const NOMES = PEND.itens.map(i => i.nome);
      if (MOCK === 'sessao' && caminho.startsWith('/api/')) throw Object.assign(new Error('HTTP 401'), { status: 401 });
      if (caminho.startsWith('/api/resumo')) {
        url = MOCK === 'vazio' ? 'mock/resumo-vazio.json' : (dias === 7 ? 'mock/resumo-7.json' : 'mock/resumo.json');
        if (MOCK === 'velho') { const r0 = await (await fetch(url, { cache: 'no-store' })).json(); return { ...r0, desatualizado: true, snapshot_em: new Date(Date.now() - 14 * 60000).toISOString() }; }
      }
      else if (caminho.startsWith('/api/revendedores')) url = MOCK === 'vazio' ? 'mock/revendedores-vazio.json' : 'mock/revendedores.json';
      else if (caminho.startsWith('/api/grafo')) url = 'mock/grafo.json';
      else if (caminho.startsWith('/api/pendentes')) return MOCK === 'vazio' ? { total: 0, itens: [] } : PEND;
      else if (caminho.startsWith('/api/comando')) { mockPolls++; return mockPolls < 3 ? { estado: 'pendente' } : (caminho.includes('aprender') ? { estado: 'feito', ok: true } : { estado: 'feito', encontrados: 3, nomes: NOMES }); }
      else if (caminho.startsWith('/api/reanalisar')) { await new Promise(r => setTimeout(r, 1200)); mockPolls = 0; return MOCK === 'nuvem' ? { ok: true, enfileirado: true } : { ok: true, encontrados: 3, nomes: NOMES }; }
      else if (caminho.startsWith('/api/aprender')) { await new Promise(r => setTimeout(r, 1800)); mockLido = new Date().toISOString(); mockPolls = 0; return MOCK === 'nuvem' ? { ok: true, enfileirado: true } : { ok: true }; }
    }
    const r = await fetch(url, { method: MOCK ? 'GET' : metodo, signal: ctl.signal, cache: 'no-store', headers: { Accept: 'application/json' } });
    const tipo = r.headers.get('content-type') || '';
    /* Sessão vencida: o Worker responde 401 ou manda a página de login (HTML) no lugar do JSON. */
    if (r.status === 401 || (r.ok && /text\/html/i.test(tipo))) throw Object.assign(new Error('HTTP 401'), { status: 401 });
    if (!r.ok) throw Object.assign(new Error('HTTP ' + r.status), { status: r.status });
    return await r.json();
  } finally { clearTimeout(corta); }
}

/* ---------- Números que contam ---------- */
function mostrarNumero(el, texto, unidade) {
  el.replaceChildren(texto, unidade ? h('small', { text: unidade }) : '');
}
function contar(el, alvo, fmt) {
  cancelAnimationFrame(el._raf);
  const final = () => { const [t, u] = fmt(alvo); mostrarNumero(el, t, u); el._v = alvo; };
  if (alvo == null) { el._v = null; mostrarNumero(el, '—', ''); return; }
  const de = el._v == null ? 0 : el._v;
  if (REDUZ.matches || de === alvo || document.hidden) return final();
  const t0 = performance.now(), dur = 700;
  const passo = agora => {
    const t = Math.min(1, (agora - t0) / dur), e = 1 - Math.pow(1 - t, 3);
    if (t >= 1) return final();
    const [tx, u] = fmt(de + (alvo - de) * e); mostrarNumero(el, tx, u); el._v = de + (alvo - de) * e;
    el._raf = requestAnimationFrame(passo);
  };
  el._raf = requestAnimationFrame(passo);
}
const fmtInt = v => [Math.round(v).toLocaleString('pt-BR'), ''];
const fmtPct = v => [String(Math.round(v)), '%'];
function fmtTempo(v) {
  v = Math.round(v);
  if (v < 60) return [String(v), ' s'];
  return [`${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`, ' min'];
}

/* ---------- Topo: estado do robô ---------- */
function pintarEstado(saude) {
  const ponto = $('#ponto'), t = $('#estado-txt');
  const evento = saude && saude.ultimo_evento ? ` · último evento ${atras(saude.ultimo_evento)}` : '';
  const det = () => (evento ? h('span', { class: 'det', text: evento }) : '');
  if (!saude || saude.robo_ligado == null) { ponto.className = 'ponto'; t.textContent = 'Estado do robô indisponível'; return; }
  if (saude.robo_ligado) { ponto.className = 'ponto ligado'; t.replaceChildren('Robô ligado', det()); }
  else { ponto.className = 'ponto desligado'; t.replaceChildren('Robô desligado', det()); }
}
function setRede(ok) {
  S.rede = ok; $('#aviso-rede').hidden = ok; pintarFaixa();
}

/* ---------- Números grandes ---------- */
function pintarNumeros(d) {
  const k = d.kpis || {}, ativas = lista(d.conversas_ativas), paineis = lista(d.paineis);
  const conv = num(k.conversas_novas), pn = num(k.paineis_fechados), esperando = ativas.filter(c => c && c.precisa_do_senhor).length;
  const envi = num(k.followups_enviados), resp = num(k.followups_respondidos);
  let taxa = pct(k.taxa_resposta_followup); if (taxa == null && envi > 0 && resp != null) taxa = Math.round(resp / envi * 100);
  const por = o => paineis.filter(p => p && p.origem === o).length;
  const set = (id, valor, fmt, rodape, extra) => {
    const art = $(id); contar($('.valor', art), valor, fmt);
    const r = $('[data-r]', art); r.textContent = rodape; r.title = rodape;
    if (extra) art.classList.toggle(extra[0], extra[1]);
  };
  let rPn = pn == null ? '' : 'Ainda nenhum neste período';
  if (pn > 0) {
    const partes = []; const r = por('robo'), s = por('senhor'), hi = por('historico');
    if (paineis.length) { if (r) partes.push(`${r} pelo robô`); if (s) partes.push(`${s} pelo senhor`); if (hi) partes.push(`${hi} do histórico`); }
    rPn = conv > 0 ? `${Math.round(pn / conv * 100)}% das conversas novas` : 'no período';
  }
  set('#k-paineis', pn, fmtInt, rPn);
  const org = $('#origens'), cont = { robo: por('robo'), senhor: por('senhor'), historico: por('historico') };
  org.hidden = !paineis.length;
  if (paineis.length) org.replaceChildren(...[['robo', 'Pelo robô'], ['senhor', 'Pelo senhor'], ['historico', 'Do histórico']].map(([c, r]) => h('div', { class: 'origem' + (cont[c] ? ' tem' : '') }, h('span', { text: r }), h('b', { text: String(cont[c]) }))));
  set('#k-conversas', conv, fmtInt, k.mensagens_recebidas != null ? `${int(k.mensagens_recebidas)} mensagens recebidas` : '');
  set('#k-testes', num(k.testes_gerados), fmtInt, num(k.testes_gerados) > 0 && conv > 0 ? `${Math.round(num(k.testes_gerados) / conv * 100)}% das conversas` : (num(k.testes_gerados) === 0 ? 'Nenhum ainda' : ''));
  // Número grande = quem está esperando o senhor AGORA (antes mostrava o total de avisos do dia, que não diminui nunca).
  const passados = num(k.passados_ao_senhor) || 0, esperandoK = k.esperando_o_senhor != null ? num(k.esperando_o_senhor) : esperando;
  set('#k-senhor', esperandoK, fmtInt, passados ? `${passados} passada${passados === 1 ? '' : 's'} no período · ${Math.max(0, passados - esperandoK)} já atendida${passados - esperandoK === 1 ? '' : 's'}` : 'Ninguém esperando agora', ['alerta', esperandoK > 0]);
  set('#k-follow', envi, fmtInt, envi === 0 ? 'Nenhum ainda' : (resp != null ? `${int(resp)} responderam` : ''));
  set('#k-taxa', taxa, fmtPct, envi > 0 && resp != null ? `${int(resp)} de ${int(envi)} responderam` : 'Sem follow-ups para medir');
  set('#k-tempo', num(k.tempo_medio_primeira_resposta_s), fmtTempo, k.respostas_robo != null ? `${int(k.respostas_robo)} respostas do robô` : '');
}

/* ---------- Follow-ups: a escada ---------- */
const ESCADA_PADRAO = [{ n: 1, minutos: 7 }, { n: 2, minutos: 20 }, { n: 3, minutos: 60 }, { n: 4, minutos: 180 }];
function montarEscada() {
  const box = $('#escada'); box.replaceChildren();
  ESCADA_PADRAO.forEach((e, i) => {
    box.append(h('div', { class: 'deg', role: 'listitem', 'data-i': i },
      h('div', { class: 'deg-topo' }, h('i'), h('span', { 'data-t': '' })),
      h('div', { class: 'deg-taxa', 'data-taxa': '' }),
      h('div', { class: 'deg-barra', 'aria-hidden': 'true' }, h('i', { class: 'env' }), h('i', { class: 'resp' })),
      h('div', { class: 'deg-num', 'data-num': '' }),
      h('div', { class: 'deg-pn', 'data-pn': '' })));
  });
}
function pintarEscada(f) {
  const etapas = lista(f && f.por_etapa);
  const dados = ESCADA_PADRAO.map((p, i) => {
    const achou = etapas.find(e => e && num(e.n) === p.n) || etapas[i] || {};
    return { n: p.n, minutos: num(achou.minutos) ?? p.minutos, env: num(achou.enviados) ?? 0, resp: num(achou.respondidos) ?? 0, taxa: achou.taxa, pn: num(achou.paineis_depois) ?? 0 };
  });
  const max = Math.max(1, ...dados.map(e => e.env));
  const cols = $('#escada').children;
  dados.forEach((e, i) => {
    const c = cols[i];
    $('[data-t]', c).textContent = `${e.n}º · ${minLabel(e.minutos)}`;
    const t = pct(e.taxa) ?? (e.env > 0 ? Math.round(e.resp / e.env * 100) : null);
    const taxa = $('[data-taxa]', c);
    taxa.replaceChildren(t == null ? '—' : String(t), t == null ? '' : h('small', { text: '%' }));
    $('[data-num]', c).replaceChildren(...(e.env === 0 ? [h('span', { class: 'sem', text: 'Nenhum enviado' })] : [h('div', null, h('b', { text: int(e.env) }), ' enviados'), h('div', null, h('b', { text: int(e.resp) }), ' responderam')]));
    const pn = $('[data-pn]', c);
    pn.className = 'deg-pn' + (e.pn > 0 ? ' tem' : '');
    pn.textContent = e.env === 0 ? '' : (e.pn > 0 ? `${plural(e.pn, 'painel', 'painéis')} depois` : 'Nenhum painel depois');
    c.setAttribute('aria-label', `${e.n}º follow-up, ${minLabel(e.minutos)}: ${e.env} enviados, ${e.resp} responderam`);
    const env = $('.env', c), resp = $('.resp', c);
    requestAnimationFrame(() => { env.style.transform = `scaleY(${e.env / max})`; resp.style.transform = `scaleY(${e.resp / max})`; });
  });
  const totEnv = dados.reduce((s, e) => s + e.env, 0), totResp = dados.reduce((s, e) => s + e.resp, 0);
  $('#c-follow').classList.toggle('sem-dados', totEnv === 0);
  $('#sub-follow').textContent = totEnv ? `${int(totEnv)} enviados · ${Math.round(totResp / totEnv * 100)}% responderam` : '';
}

/* Lista com reconciliação simples: só anima linha nova (ou tudo, ao trocar de período). */
function preencher(ul, itens, chave, montar, vazio, animar) {
  const corpo = ul.closest('.corpo'), topo = corpo ? corpo.scrollTop : 0;
  if (!itens.length) {
    ul.replaceChildren(h('li', null, h('div', { class: 'vazio' }, ic('caixa'), h('span', { text: vazio }))));
    ul._chaves = null; return;
  }
  const velhas = ul._chaves || new Set(), novas = new Set(), frag = document.createDocumentFragment();
  itens.forEach((it, i) => {
    const k = chave(it, i); novas.add(k);
    const li = montar(it);
    if (animar || (ul._chaves && !velhas.has(k))) { li.classList.add('entra'); li.style.setProperty('--i', Math.min(i, 6)); }
    frag.append(li);
  });
  ul.replaceChildren(frag); ul._chaves = novas;
  if (corpo) corpo.scrollTop = topo;
}

function pintarFollowups(f, etapas, animar) {
  const rec = lista(f && f.recentes).filter(Boolean).slice(0, 40);
  const mins = Object.fromEntries(ESCADA_PADRAO.map(p => [p.n, p.minutos]));
  lista(f && f.por_etapa).forEach(e => { if (e && num(e.n) != null && num(e.minutos) != null) mins[e.n] = num(e.minutos); });
  preencher($('#lista-follow'), rec, (r, i) => `${r.quando}|${r.nome}|${r.n}|${i}`, r => {
    const quem = txt(r.nome) || 'Sem nome';
    let status;
    if (r.respondeu) {
      const m = num(r.minutos_ate_resposta);
      status = h('span', { class: 'resp-ok' }, m == null ? 'Respondeu' : (m < 1 ? 'Respondeu em menos de 1 min' : `Respondeu em ${minLabel(m)}`));
    } else if (r.status === 'atendido_pelo_senhor') status = h('span', { class: 'resp-ok', text: 'Atendido pelo senhor' });
    else if (r.status === 'encerrada') status = h('span', { class: 'resp-ok', text: 'Conversa encerrada' });
    else status = h('span', { class: 'resp-no', text: 'Sem resposta' });
    const n = num(r.n);
    return h('li', { class: 'linha' },
      h('div', { class: 'avatar', 'aria-hidden': 'true', text: inicial(quem) }),
      h('div', { class: 'l1' }, h('span', { class: 'nome', text: quem }),
        n != null ? h('span', { class: 'pilula-t', text: `${n}º · ${minLabel(mins[n] ?? '')}`.replace(/ · $/, '') }) : null,
        h('span', { class: 'fim', text: quando(r.quando) })),
      h('div', { class: 'l2' }, h('span', { class: 'corta', title: txt(r.texto), text: txt(r.texto) || 'Mensagem sem texto' }), status));
  }, 'Nenhum follow-up enviado neste período. Quando o robô chamar alguém de volta, aparece aqui.', animar);
}

/* ---------- Funil e horas ---------- */
function pintarFunil(funil) {
  const box = $('#funil'), etapas = lista(funil).filter(Boolean);
  const total = etapas.reduce((s, e) => s + (num(e.qtd) || 0), 0);
  if (!etapas.length || total === 0) {
    if (box._modo !== 'vazio') box.replaceChildren(h('div', { class: 'vazio' }, ic('caixa'), h('span', { text: 'Sem contatos neste período. O funil aparece quando chegar a primeira conversa.' })));
    box._modo = 'vazio'; $('#sub-funil').textContent = ''; return;
  }
  const chave = etapas.map(e => e.etapa).join('|');
  if (box._modo !== chave) {
    box._modo = chave; box.replaceChildren();
    etapas.forEach((e, i) => box.append(h('div', { class: 'passo' },
      h('span', { class: 'rot', 'data-rot': '' }),
      h('div', { class: 'trilho', 'aria-hidden': 'true' }, h('i', { style: `opacity:${(.4 + .6 * (i + 1) / etapas.length).toFixed(2)}` })),
      h('span', { class: 'qtd', 'data-qtd': '' }))));
  }
  const primeiro = num(etapas[0].qtd) || 0, max = Math.max(1, ...etapas.map(e => num(e.qtd) || 0));
  [...box.children].forEach((row, i) => {
    const e = etapas[i], q = num(e.qtd) || 0;
    $('[data-rot]', row).textContent = txt(e.etapa);
    const alvo = $('[data-qtd]', row);
    alvo.replaceChildren(int(q), i > 0 && primeiro > 0 ? h('small', { text: `${Math.round(q / primeiro * 100)}%` }) : '');
    row.setAttribute('aria-label', `${txt(e.etapa)}: ${q}`);
    const barra = $('i', row); requestAnimationFrame(() => { barra.style.transform = `scaleX(${q / max})`; });
  });
  const ultimo = etapas[etapas.length - 1];
  $('#sub-funil').textContent = primeiro ? `${int(ultimo.qtd)} de ${int(primeiro)} criaram o painel` : '';
}
function pintarHoras(horas) {
  const box = $('#horas'), hs = lista(horas).filter(Boolean);
  const pico = Math.max(0, ...hs.map(x => Math.max(num(x.mensagens) || 0, num(x.respostas) || 0)));
  if (!hs.length || pico === 0) {
    if (box._modo !== 'vazio') box.replaceChildren(h('div', { class: 'vazio' }, ic('caixa'), h('span', { text: 'Sem mensagens neste período.' })));
    box._modo = 'vazio'; return;
  }
  const chave = hs.map(x => x.hora).join('|');
  if (box._modo !== chave) {
    box._modo = chave; box.replaceChildren();
    const passo = Math.ceil(hs.length / 8);
    box.append(h('div', { class: 'horas-grafico', role: 'img', 'data-g': '' }, hs.map(() => h('div', { class: 'hora' }, h('i', { class: 'm' }), h('i', { class: 'r' })))),
      h('div', { class: 'horas-rotulos', 'aria-hidden': 'true' }, hs.map((x, i) => h('span', { text: i % passo === 0 ? txt(x.hora) : '' }))),
      h('div', { class: 'escada-legenda', 'aria-hidden': 'true' }, h('span', null, h('i'), 'Recebidas'), h('span', null, h('i', { class: 'c' }), 'Respostas do robô')));
  }
  const g = $('[data-g]', box), cols = g.children;
  hs.forEach((x, i) => {
    const m = num(x.mensagens) || 0, r = num(x.respostas) || 0;
    cols[i].title = `${txt(x.hora)}: ${m} recebidas, ${r} respostas`;
    const bm = cols[i].children[0], br = cols[i].children[1];
    requestAnimationFrame(() => { bm.style.transform = `scaleY(${m / pico})`; br.style.transform = `scaleY(${r / pico})`; });
  });
  const topo = hs.reduce((a, b) => ((num(b.mensagens) || 0) > (num(a.mensagens) || 0) ? b : a));
  let rot = $('.pico', box); if (!rot) { rot = h('span', { class: 'pico' }); $('.horas-grafico', box).append(rot); }
  rot.textContent = `${int(topo.mensagens)} às ${txt(topo.hora)}`;
  g.setAttribute('aria-label', `Mensagens por hora. Maior movimento às ${txt(topo.hora)}, com ${int(topo.mensagens)} mensagens.`);
}

/* ---------- Revendedores ---------- */
function normalizarRevs(bruto) {
  let l = bruto;
  if (l && !Array.isArray(l)) l = Array.isArray(l.revendedores) ? l.revendedores : (typeof l === 'object' ? Object.values(l) : []);
  return lista(l).filter(x => x && typeof x === 'object').map(x => ({
    nome: txt(x.nome), telefone: txt(x.telefone), usuario_painel: txt(x.usuario_painel || x.usuario), painel_id: txt(x.painel_id || x.id) || null, painel_numero: x.painel_numero, quando: x.criado_em || x.quando,
  }));
}
/* O número do painel é o painel_numero (ex.: 140). O painel_id é um código interno: só vale como número se vier só com dígitos. */
function numeroPainel(o) {
  if (!o) return '';
  const n = num(o.painel_numero); if (n != null) return String(Math.round(n));
  const id = txt(o.painel_id); return /^[0-9]+$/.test(id) ? id : '';
}
const ORIGEM = { robo: ['Pelo robô', ''], senhor: ['Pelo senhor', 'neutra'], historico: ['Do histórico', 'neutra'] };
function copiarTexto(t, btn, rotulo = 'Copiar') {
  const pronto = () => { btn.classList.add('feito'); btn.replaceChildren(ic('ok'), 'Copiado'); setTimeout(() => { btn.classList.remove('feito'); btn.replaceChildren(ic('copiar'), rotulo); }, 1400); };
  const antigo = () => { const a = h('textarea', { style: 'position:fixed;opacity:0' }); a.value = t; document.body.append(a); a.select(); try { document.execCommand('copy'); pronto(); } catch { aviso('Não consegui copiar. Selecione o usuário e copie na mão.', true); } a.remove(); };
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(t).then(pronto, antigo); else antigo();
}
function pintarRevendedores(d, revs, animar) {
  const todos = normalizarRevs(revs);
  const itens = lista(d.paineis).filter(Boolean).map(p => {
    const extra = todos.find(r => r.telefone && r.telefone === txt(p.telefone)) || {};
    return { quando: p.quando, nome: txt(p.nome) || extra.nome, telefone: txt(p.telefone) || extra.telefone, usuario: txt(p.usuario_painel) || extra.usuario_painel, id: numeroPainel(p) || numeroPainel(extra) || '', origem: p.origem };
  }).sort((a, b) => (data(b.quando) || 0) - (data(a.quando) || 0));
  preencher($('#lista-rev'), itens, (p, i) => `${p.quando}|${p.telefone}|${i}`, p => {
    const quem = p.nome || 'Sem nome', [rotulo, tom] = ORIGEM[p.origem] || ['', 'neutra'];
    const copia = p.usuario ? h('button', { type: 'button', class: 'copiar', 'aria-label': `Copiar usuário de ${quem}`, onclick: ev => copiarTexto(p.usuario, ev.currentTarget) }, ic('copiar'), 'Copiar') : null;
    return h('li', { class: 'linha' },
      h('div', { class: 'avatar', 'aria-hidden': 'true', text: inicial(quem) }),
      h('div', { class: 'l1' }, h('span', { class: 'nome', text: quem }), linkTel(p.telefone, 'tel'),
        h('span', { class: 'fim' }, rotulo ? h('span', { class: 'pilula-t' + (tom ? ' ' + tom : ''), text: rotulo }) : null, quando(p.quando))),
      h('div', { class: 'l2' },
        h('span', { class: 'linha-usuario' }, 'Usuário ', p.usuario ? h('b', { class: 'usuario', text: p.usuario }) : h('span', { class: 'neutro', text: 'a conferir' })), copia,
        h('span', null, 'Painel ', p.id ? h('b', { text: 'nº ' + p.id }) : h('span', { class: 'a-conferir', text: 'número a conferir' }))),
      acoesContato(p.telefone, p.usuario ? h('button', { type: 'button', class: 'chip', 'aria-label': `Copiar usuário de ${quem}`, onclick: ev => copiarTexto(p.usuario, ev.currentTarget, 'Copiar') }, ic('copiar'), 'Copiar') : null));
  }, 'Nenhum painel fechado neste período. Quando o robô fechar um, o revendedor entra aqui com nome e número.', animar);
  const noPeriodo = itens.length;
  $('#sub-rev').textContent = todos.length ? `${noPeriodo} no período · ${todos.length} no total` : (noPeriodo ? `${noPeriodo} no período` : '');
}

/* ---------- Conversas ativas ---------- */
function pintarConversas(d, animar) {
  const agora = Date.now();
  const itens = lista(d.conversas_ativas).filter(Boolean).slice().sort((a, b) => (!!b.precisa_do_senhor - !!a.precisa_do_senhor) || ((data(b.ultimo_contato) || 0) - (data(a.ultimo_contato) || 0)));
  preencher($('#lista-conv'), itens, (c, i) => `${c.telefone}|${i}`, c => {
    const quem = txt(c.nome) || 'Sem nome', f = num(c.followups_enviados) || 0, quieto = data(c.quieto_ate);
    const partes = [];
    if (c.ultimo_contato) partes.push(`último contato ${atras(c.ultimo_contato)}`);
    partes.push(f === 0 ? 'nenhum follow-up' : plural(f, 'follow-up', 'follow-ups'));
    if (quieto && quieto.getTime() > agora) partes.push(`robô quieto até ${hhmm(quieto)}`);
    return h('li', { class: 'linha' },
      h('div', { class: 'avatar', 'aria-hidden': 'true', text: inicial(quem) }),
      h('div', { class: 'l1' }, h('span', { class: 'nome', text: quem }), linkTel(c.telefone, 'tel'),
        h('span', { class: 'fim' }, c.precisa_do_senhor ? h('span', { class: 'pilula-t aviso', text: 'Precisa do senhor' }) : null, txt(c.etapa) ? h('span', { class: 'pilula-t neutra', text: txt(c.etapa) }) : null)),
      h('div', { class: 'l2' }, h('span', { class: 'corta', text: partes.join(' · ') })),
      c.precisa_do_senhor ? acoesContato(c.telefone) : null);
  }, 'Ninguém no meio de um atendimento agora. Quando chegar alguém, a conversa aparece aqui.', animar);
  const espera = itens.filter(c => c.precisa_do_senhor).length;
  const selo = $('#selo-conv'); selo.hidden = !espera; selo.textContent = String(espera);
  const mc = $('#ver-mais-conv'); mc.textContent = $('#c-conv').classList.contains('expandido') ? 'Ver menos' : `Ver todas (${itens.length})`;
  $('#sub-conv').textContent = itens.length ? `${itens.length} em andamento${espera ? ` · ${espera} esperando o senhor` : ''}` : '';
}

/* ---------- Leitura das últimas 2 horas ---------- */
const textoItem = x => (typeof x === 'string' ? x.trim() : (x && typeof x === 'object' ? txt(x.texto || x.sugestao || x.regra || x.descricao || x.titulo) : ''));
const MAX_ITENS = 3;
S.abertos = new Set();
/* Lista que mostra só os 3 primeiros e abre o resto num toque. O estado aberto sobrevive à atualização de 20 s. */
function listaCortavel(chave, itens) {
  const ul = h('ul', { class: 'cortavel' + (S.abertos.has(chave) ? ' aberto' : '') }, itens.map(t => h('li', { text: t })));
  if (itens.length <= MAX_ITENS) return [ul];
  const rotulo = () => (ul.classList.contains('aberto') ? 'Ver menos' : `Ver todas (${itens.length})`);
  const btn = h('button', { type: 'button', class: 'ver-mais pequeno', 'aria-expanded': String(S.abertos.has(chave)), text: rotulo() });
  btn.addEventListener('click', () => {
    const on = ul.classList.toggle('aberto'); on ? S.abertos.add(chave) : S.abertos.delete(chave);
    btn.setAttribute('aria-expanded', String(on)); btn.textContent = rotulo();
  });
  return [ul, btn];
}
function grupo(cls, icone, titulo, itens, vazio) {
  return h('section', { class: 'grupo ' + cls }, h('h3', null, ic(icone), titulo),
    itens.length ? listaCortavel(cls, itens) : h('p', { class: 'nada', text: vazio }));
}
function pintarLeitura(l, animar) {
  const corpo = $('#c-leitura'), sub = $('#sub-leitura');
  const r = l && typeof l === 'object' ? l : {};
  const ok = lista(r.funcionou).map(textoItem).filter(Boolean), mal = lista(r.deu_errado).map(textoItem).filter(Boolean);
  const regras = lista(r.regras_novas).map(textoItem).filter(Boolean), sug = lista(r.sugestoes_para_o_senhor).map(textoItem).filter(Boolean);
  const resumo = txt(r.resumo);
  const topo = corpo.scrollTop;
  if (!resumo && !ok.length && !mal.length && !regras.length && !sug.length) {
    corpo.replaceChildren(h('div', { class: 'vazio' }, ic('regra'), h('span', { text: 'Ainda não houve leitura. Toque em “Ler as últimas 2 horas agora” e o robô revisa as conversas e anota o que aprendeu.' })));
    sub.textContent = ''; return;
  }
  const sm = $('#selo-mapa'); sm.hidden = !sug.length; sm.textContent = String(sug.length);
  const filhos = [h('p', { class: 'leitura-resumo', text: resumo || 'Sem resumo desta leitura.' })];
  if (sug.length) filhos.push(h('section', { class: 'sugestoes', 'aria-label': 'Sugestões para o senhor decidir' }, h('h3', null, ic('ideia'), 'Para o senhor decidir', h('span', { class: 'conta', text: String(sug.length) })), listaCortavel('sug', sug)));
  filhos.push(grupo('g-ok', 'ok', 'O que funcionou', ok, 'Nada destacado nesta leitura.'));
  filhos.push(grupo('g-erro', 'alerta', 'O que deu errado', mal, 'Nenhum erro percebido.'));
  filhos.push(grupo('g-regra', 'regra', 'Regras novas aprendidas', regras, 'Nenhuma regra nova desta vez.'));
  const frag = h('div', { class: animar ? 'entra' : '' }, filhos);
  corpo.replaceChildren(frag); corpo.scrollTop = topo;
  const d = data(r.gerado_em); sub.textContent = d ? `lida ${quandoExt(d)}` : '';
}

/* ---------- Rodapé ---------- */
function pintarPe(d) {
  const s = d.saude || {}, pe = $('#pe'), itens = [];
  const g = data(d.gerado_em); itens.push(`Atualizado às ${(g || new Date()).toLocaleTimeString('pt-BR')}`);
  const ev = s.ultimo_evento ? `Último evento ${atras(s.ultimo_evento)}` : '';
  if (num(s.repeticoes_bloqueadas) != null) itens.push(num(s.repeticoes_bloqueadas) === 0 ? 'Nenhuma mensagem repetida' : plural(s.repeticoes_bloqueadas, 'mensagem repetida barrada', 'mensagens repetidas barradas'));
  if (num(s.erros) != null) itens.push(num(s.erros) === 0 ? 'Sem erros' : plural(s.erros, 'erro no robô', 'erros no robô'));
  if (num(s.processos_bot) != null) itens.push(num(s.processos_bot) === 0 ? 'Robô parado' : (num(s.processos_bot) === 1 ? '1 robô em execução' : `${int(s.processos_bot)} robôs em execução`));
  const p = d.periodo && data(d.periodo.inicio) ? `Período desde ${quando(d.periodo.inicio)}` : '';
  if (p) itens.push(p);
  pe.replaceChildren(...(ev ? [h('span', { class: 'so-celular', text: ev })] : []), ...itens.map(t => h('span', { text: t })));
}

/* ---------- Dica de rolagem: esmaece a borda só quando há conteúdo escondido embaixo ---------- */
function marcarRolagem() {
  document.querySelectorAll('.corpo').forEach(c => c.classList.toggle('mais-abaixo', c.scrollTop + c.clientHeight < c.scrollHeight - 3));
}
document.querySelectorAll('.corpo').forEach(c => c.addEventListener('scroll', marcarRolagem, { passive: true }));
addEventListener('resize', marcarRolagem);

/* ---------- Orquestração ---------- */
function so(chave, valor, fn) {
  const s = assinatura([dias, valor]);
  if (S.sig[chave] === s) return;
  S.sig[chave] = s; fn();
}
function renderizar(d, revs) {
  const animar = !S.feito || S.periodo !== dias;
  if (animar) S.sig = {};
  S.periodo = dias;
  if (MOCK && mockLido && d.ultimas_2h) d.ultimas_2h = { ...d.ultimas_2h, gerado_em: mockLido };
  pintarEstado(d.saude);
  pintarFaixa(); if (S.pend.pronto) pintarPendentesMovel();
  so('kpis', [d.kpis, d.conversas_ativas, d.paineis], () => pintarNumeros(d));
  so('esc', d.followups, () => pintarEscada(d.followups));
  so('fol', d.followups, () => pintarFollowups(d.followups, null, animar));
  so('funil', d.funil, () => pintarFunil(d.funil));
  so('horas', d.horas, () => pintarHoras(d.horas));
  so('rev', [d.paineis, revs], () => pintarRevendedores(d, revs, animar));
  so('conv', d.conversas_ativas, () => pintarConversas(d, animar));
  so('lei', d.ultimas_2h, () => pintarLeitura(d.ultimas_2h, animar));
  pintarPe(d);
  marcarRolagem();
  if (!S.feito) { S.feito = true; $('#app').setAttribute('aria-busy', 'false'); }
}

let ctlAtual = null, busca = 0;
async function atualizar() {
  if (S.sessao) return;
  if (ctlAtual) ctlAtual.abort(new DOMException('substituída', 'AbortError'));
  const ctl = new AbortController(); ctlAtual = ctl; const minha = ++busca;
  try {
    const [r, revs] = await Promise.all([
      pegar(`/api/resumo?dias=${dias}`, { sinal: ctl.signal }),
      pegar('/api/revendedores', { sinal: ctl.signal }).catch(() => (S.revs)),
    ]);
    if (minha !== busca) return;
    if (!r || typeof r !== 'object') throw new Error('resposta vazia');
    S.atual = r; S.revs = revs; setRede(true); renderizar(r, revs);
  } catch (e) {
    if (minha !== busca || (e && e.name === 'AbortError' && minha !== busca)) return;
    if (e && e.status === 401) { S.sessao = true; pintarFaixa(); if (!S.feito) renderizar({ saude: null, kpis: {} }, null); return; }
    setRede(false);
    if (!S.feito) { renderizar({ saude: null, kpis: {} }, null); }
  }
}

/* ---------- Avisos ---------- */
let toastEl = null, toastT = 0;
function aviso(msg, erro) {
  clearTimeout(toastT); if (toastEl) toastEl.remove();
  toastEl = h('div', { class: 'toast' + (erro ? ' erro' : ''), role: 'status', text: msg });
  document.body.append(toastEl);
  const el = toastEl;
  toastT = setTimeout(() => { el.classList.add('sai'); setTimeout(() => el.remove(), 130); }, erro ? 6000 : 4200);
}

/* ---------- Comandos ao robô: reanalisar e aprender ----------
   No PC local a resposta do POST já traz o resultado ({ok, encontrados, nomes}).
   Na nuvem ela traz {ok, enfileirado:true} e o fim chega por GET /api/comando?tipo=... → {estado:'pendente'|'feito', ...}. */
const dormir = ms => new Promise(r => setTimeout(r, ms));
async function esperarComando(tipo) {
  const fim = Date.now() + (tipo === 'aprender' ? 180000 : 60000);
  while (Date.now() < fim) {
    await dormir(2000);
    let c = null;
    try { c = await pegar(`/api/comando?tipo=${tipo}`, { limite: 8000 }); } catch (e) { if (e && e.status === 401) throw e; }
    if (c && c.estado === 'feito') {
      if (c.ok === false) throw new Error(txt(c.motivo || c.erro) || 'falhou');
      return c;
    }
  }
  return { demorou: true };
}
async function executar(tipo, fase) {
  const r = await pegar(`/api/${tipo}`, { metodo: 'POST', limite: tipo === 'aprender' ? 240000 : 90000 });
  if (r && r.ok === false) throw new Error(txt(r.motivo || r.erro) || 'falhou');
  if (r && r.enfileirado && r.encontrados == null) { if (fase) fase('esperando'); return await esperarComando(tipo); }
  return r || {};
}
const nomeBonito = n => { const t = txt(n); return /^\d{8,}$/.test(t) ? telefone(t) : (t || 'Sem nome'); };
function msgReanalisar(r) {
  if (r.demorou) return 'O pedido foi enviado, mas o robô ainda não confirmou. Se o PC estiver ligado, ele responde em instantes.';
  const n = Number(r.encontrados) || 0;
  return n ? `O robô encontrou ${n} ${n === 1 ? 'conversa' : 'conversas'} e já está respondendo.` : 'Nenhuma conversa esperando resposta agora.';
}
const MSG_FALHA = 'Não consegui falar com o robô agora. Confira se o PC está ligado e tente de novo.';
function sessaoVenceu(e) { if (e && e.status === 401) { S.sessao = true; pintarFaixa(); return true; } return false; }

/* ---------- Botão (PC): ler as últimas 2 horas ---------- */
async function aprender() {
  if (S.lendo) return; S.lendo = true;
  const btn = $('#aprender'), t = $('#aprender-txt'), card = $('.b-leitura');
  btn.disabled = true; btn.setAttribute('aria-busy', 'true');
  const sp = ic('gira'); sp.classList.add('gira'); btn.replaceChildren(sp, t);
  t.textContent = 'Lendo as conversas…';
  const ov = h('div', { class: 'lendo', role: 'status' }, ic('gira'), h('span', { text: 'Lendo as últimas 2 horas…' }));
  card.append(ov);
  try {
    const r = await executar('aprender');
    if (r.demorou) { aviso('O pedido foi enviado. A leitura aparece aqui quando o robô terminar.'); }
    else { await atualizar(); aviso('Leitura pronta. O robô já aprendeu com as últimas 2 horas.'); }
  } catch (e) {
    if (!sessaoVenceu(e)) aviso('Não consegui fazer a leitura agora. Tente de novo em instantes.', true);
  } finally {
    ov.remove(); S.lendo = false; btn.disabled = false; btn.removeAttribute('aria-busy');
    btn.replaceChildren(ic('relogio'), t); t.textContent = 'Ler as últimas 2 horas agora';
  }
}

/* ---------- Pendentes: contador e botão (PC) ---------- */
const textoPend = n => (n ? `Rodar releitura (${n})` : 'Rodar releitura');   /* 08/11: o botão do topo abre a releitura (releitura.js) */
async function contarPendentes() {
  if (S.reanalisando || S.sessao) return;
  try {
    const r = await pegar('/api/pendentes');
    const n = Number(r && r.total) || 0, itens = lista(r && r.itens).filter(Boolean);
    S.pend = { n, itens, pronto: true };
    const t = $('#pendentes-txt'), b = $('#pendentes');
    t.textContent = textoPend(n);
    b.title = n ? itens.map(i => `${nomeBonito(i.nome)} · há ${i.desde_min} min`).join('\n') : 'Nenhuma conversa esperando resposta agora';
    b.classList.toggle('com-pendentes', n > 0);
  } catch (e) {
    if (sessaoVenceu(e)) return;
    if (!S.pend.pronto) S.pend = { n: null, itens: [], pronto: true };   /* sem contador: o botão continua à mão */
  }
  pintarPendentesMovel();
}
async function reanalisar() {
  if (S.reanalisando) return; S.reanalisando = true;
  const btn = $('#pendentes'), t = $('#pendentes-txt');
  btn.disabled = true; btn.setAttribute('aria-busy', 'true');
  const sp = ic('gira'); sp.classList.add('gira'); btn.replaceChildren(sp, t);
  t.textContent = 'Reanalisando…';
  try {
    aviso(msgReanalisar(await executar('reanalisar')));
  } catch (e) {
    if (!sessaoVenceu(e)) aviso(MSG_FALHA, true);
  } finally {
    S.reanalisando = false; btn.disabled = false; btn.removeAttribute('aria-busy');
    btn.replaceChildren(ic('atualizar'), t); t.textContent = textoPend(S.pend.n);
    setTimeout(contarPendentes, 8000); atualizar();
  }
}
$('#pendentes').addEventListener('click', () => (window.abrirReleitura && !MOCK ? window.abrirReleitura(reanalisar) : reanalisar()));
contarPendentes(); setInterval(() => { if (!document.hidden) contarPendentes(); }, ATUALIZA_MS);

/* ---------- Celular: bloco "responder pendentes" no Resumo e botão flutuante ---------- */
function pintarPendentesMovel() {
  const cta = $('#m-cta'), { n, itens, pronto } = S.pend;
  if (pronto) {
    cta.hidden = false; cta.classList.toggle('zero', n === 0);
    const t = $('#m-cta-t'), p = $('#m-cta-p');
    const desligado = !!(S.atual && S.atual.saude && S.atual.saude.robo_ligado === false);
    cta.classList.toggle('aviso', n === 0 && desligado);
    if (n === 0) { t.textContent = 'Nenhuma conversa esperando resposta'; p.textContent = desligado ? 'O robô está desligado agora.' : 'O robô está em dia.'; }
    else if (n == null) { t.textContent = 'Conversas sem resposta'; p.textContent = 'Peça ao robô para conferir e responder agora.'; }
    else {
      t.textContent = n === 1 ? '1 conversa sem resposta' : `${n} conversas sem resposta`;
      const maior = Math.max(0, ...itens.map(i => Number(i.desde_min) || 0));
      p.textContent = maior ? `A mais antiga espera há ${minLabel(maior)}.` : 'O robô ainda não respondeu.';
    }
    $('#m-pendentes-txt').textContent = textoPend(n); $('#fab-txt').textContent = textoPend(n);
    const fn = $('#fab-n'); fn.textContent = n ? String(n) : ''; fn.hidden = !n;
  }
  atualizarFab();
}
function atualizarFab() {
  const fab = $('#fab'), { n, pronto } = S.pend;
  const ver = MOVEL.matches && pronto && n !== 0 && !S.sessao && !S.folha && !S.fabEsconde && !(aba === 'resumo' && S.ctaVisivel) && !(aba === 'mapa' && appEl.dataset.sub === 'mapa');
  fab.classList.toggle('vis', ver); fab.setAttribute('aria-hidden', String(!ver)); fab.tabIndex = ver ? 0 : -1;
}
if ('IntersectionObserver' in window) {
  new IntersectionObserver(([e]) => { S.ctaVisivel = e.isIntersecting; atualizarFab(); }, { rootMargin: '-84px 0px -84px 0px' }).observe($('#m-cta'));
}

let yAntes = 0;
addEventListener('scroll', () => {
  const y = scrollY, d = y - yAntes;
  if (Math.abs(d) < 8) return;
  yAntes = y; const esconde = d > 0 && y > 80;
  if (esconde !== !!S.fabEsconde) { S.fabEsconde = esconde; atualizarFab(); }
}, { passive: true });

/* ---------- Faixa de aviso (sessão vencida, PC sem enviar dados, sem rede no celular) ---------- */
let faixaChave = '';
function pintarFaixa() {
  const f = $('#faixa'); let chave = '', no = null;
  if (S.sessao) chave = 'sessao';   /* a tela inteira vira o bloco "Sessão expirada" (#bloco-sessao) */
  else if (!S.rede && MOVEL.matches) { chave = 'rede'; no = h('div', { class: 'faixa-in' }, ic('alerta'), h('span', { text: 'Sem conexão com o servidor. Tentando de novo.' })); }
  else if (S.atual && S.atual.desatualizado) {
    const d = data(S.atual.snapshot_em), m = d ? Math.max(1, Math.round((Date.now() - d.getTime()) / 60000)) : null;
    chave = 'velho' + m;
    no = h('div', { class: 'faixa-in' }, ic('alerta'), h('span', { text: m ? `O PC do senhor não enviou dados há ${minLabel(m)}.` : 'O PC do senhor não enviou dados recentemente.' }));
  }
  if (chave === faixaChave) return;
  faixaChave = chave; document.getElementById('app').classList.toggle('sem-sessao', S.sessao); $('#bloco-sessao').hidden = !S.sessao; atualizarFab(); f.hidden = !no;
  if (no) f.replaceChildren(no); else f.replaceChildren();
}

/* ---------- Folha inferior (confirmação, progresso e resultado) ---------- */
const folhaEl = $('#folha'), scrimEl = $('#scrim'), folhaCorpo = $('#folha-corpo');
let gatilho = null, fechaT = 0;
const travar = on => ['#app', '#abas', '#fab'].forEach(s => { const el = $(s); if (el) el.inert = on; });
function abrirFolha(g) {
  clearTimeout(fechaT); gatilho = g || document.activeElement;
  folhaEl.hidden = scrimEl.hidden = false; S.folha = true; travar(true);
  requestAnimationFrame(() => requestAnimationFrame(() => { folhaEl.classList.add('on'); scrimEl.classList.add('on'); }));
  atualizarFab();
}
function fecharFolha(forcar) {
  if (!S.folha || (S.ocupado && !forcar)) return;
  S.folha = false; folhaEl.classList.remove('on'); scrimEl.classList.remove('on'); travar(false);
  fechaT = setTimeout(() => { folhaEl.hidden = scrimEl.hidden = true; folhaEl.style.transform = ''; }, 230);
  if (gatilho && gatilho.focus) gatilho.focus({ preventScroll: true });
  atualizarFab();
}
function vista(...nos) {
  const v = h('div', { class: 'vista entra' }, nos.filter(Boolean));
  folhaCorpo.replaceChildren(v);
  const primeiro = v.querySelector('button'); if (primeiro) primeiro.focus({ preventScroll: true });
}
const botoes = (ok, aoOk, cancelar = 'Cancelar') => h('div', { class: 'folha-botoes' },
  ok ? h('button', { type: 'button', class: 'btn principal grande', onclick: aoOk, text: ok }) : null,
  h('button', { type: 'button', class: 'btn grande', onclick: () => fecharFolha(), text: cancelar }));
function vistaConfirmar(titulo, texto, itens, ok, aoOk) {
  vista(h('h2', { id: 'folha-t', text: titulo }), h('p', { class: 'folha-p', text: texto }),
    itens && itens.length ? h('ul', { class: 'folha-lista' }, itens.map(t => h('li', { text: t }))) : null, botoes(ok, aoOk));
}
function vistaProgresso(titulo, texto) {
  const sp = ic('gira'); sp.classList.add('gira');
  vista(h('div', { class: 'folha-prog', role: 'status' }, h('div', { class: 'selo-g' }, sp), h('h2', { id: 'folha-t', text: titulo }), h('p', { class: 'folha-p', text: texto })),
    h('div', { class: 'folha-botoes' }, h('button', { type: 'button', class: 'btn grande', onclick: () => fecharFolha(true), text: 'Fechar' }), h('p', { class: 'folha-nota', text: 'Pode fechar, o pedido continua.' })));
}
function vistaResultado(ok, titulo, texto, itens) {
  if (!S.folha) { aviso(texto, !ok); return; }
  vista(h('div', { class: 'folha-prog ' + (ok ? 'ok' : 'erro'), role: 'status' }, h('div', { class: 'selo-g' }, ic(ok ? 'ok' : 'alerta')), h('h2', { id: 'folha-t', text: titulo }), h('p', { class: 'folha-p', text: texto })),
    itens && itens.length ? h('ul', { class: 'folha-lista' }, itens.map(t => h('li', { text: t }))) : null,
    h('div', { class: 'folha-botoes' }, h('button', { type: 'button', class: 'btn principal grande', onclick: () => fecharFolha(), text: 'Fechar' })));
}
function listaNomes(nomes) {
  const l = lista(nomes).map(nomeBonito); if (!l.length) return null;
  return l.length > 4 ? [...l.slice(0, 4), `e mais ${l.length - 4}`] : l;
}

function confirmarPendentes(g) {
  if (S.ocupado) { aviso('O robô ainda está cuidando do pedido anterior.'); return; }
  const { n, itens } = S.pend;
  const nomes = itens.slice(0, 4).map(i => `${nomeBonito(i.nome)} · espera há ${minLabel(i.desde_min)}`);
  if (itens.length > 4) nomes.push(`e mais ${itens.length - 4}`);
  abrirFolha(g);
  vistaConfirmar(n ? `Responder ${n} ${n === 1 ? 'conversa' : 'conversas'} agora?` : 'Responder as conversas pendentes agora?',
    'O robô responde uma de cada vez, começando pela mais antiga.', nomes, 'Responder', fluxoPendentes);
}
async function fluxoPendentes() {
  S.ocupado = true; S.reanalisando = true; atualizarFab();
  vistaProgresso('Pedindo ao robô…', 'Ele confere as conversas sem resposta.');
  try {
    const r = await executar('reanalisar', f => vistaProgresso('Esperando o robô…', 'O pedido já saiu. Assim que o PC pegar, o robô começa.'));
    S.ocupado = false;
    const n = Number(r.encontrados) || 0;
    if (r.demorou) vistaResultado(true, 'Pedido enviado', msgReanalisar(r));
    else if (n) vistaResultado(true, 'Respondendo agora', msgReanalisar(r), listaNomes(r.nomes));
    else vistaResultado(true, 'Tudo em dia', msgReanalisar(r));
  } catch (e) {
    S.ocupado = false;
    if (sessaoVenceu(e)) { fecharFolha(true); } else vistaResultado(false, 'Não deu certo', MSG_FALHA);
  } finally {
    S.reanalisando = false; setTimeout(contarPendentes, 8000); contarPendentes(); atualizar();
  }
}

function confirmarLeitura(g) {
  if (S.ocupado || S.lendo) { aviso('O robô ainda está cuidando do pedido anterior.'); return; }
  abrirFolha(g);
  vistaConfirmar('Ler as últimas 2 horas agora?', 'O robô relê as conversas recentes e anota o que aprendeu. Leva cerca de um minuto.', null, 'Ler agora', fluxoLeitura);
}
async function fluxoLeitura() {
  S.ocupado = true; S.lendo = true;
  vistaProgresso('Lendo as conversas…', 'Pode fechar o celular, a leitura continua no PC.');
  try {
    const r = await executar('aprender', f => vistaProgresso('Esperando o robô…', 'O pedido já saiu. A leitura começa quando o PC pegar.'));
    S.ocupado = false;
    if (r.demorou) vistaResultado(true, 'Pedido enviado', 'A leitura aparece aqui quando o robô terminar.');
    else { await atualizar(); vistaResultado(true, 'Leitura pronta', 'O robô já aprendeu com as últimas 2 horas.'); }
  } catch (e) {
    S.ocupado = false;
    if (sessaoVenceu(e)) { fecharFolha(true); } else vistaResultado(false, 'Não deu certo', 'Não consegui fazer a leitura agora. Tente de novo em instantes.');
  } finally { S.lendo = false; }
}
['#m-pendentes', '#fab'].forEach(s => $(s).addEventListener('click', ev => confirmarPendentes(ev.currentTarget)));
$('#m-aprender').addEventListener('click', ev => confirmarLeitura(ev.currentTarget));
scrimEl.addEventListener('click', () => fecharFolha());
document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && S.folha) fecharFolha(); });
/* arrastar para baixo fecha a folha */
(() => {
  let y0 = null, dy = 0;
  folhaEl.addEventListener('touchstart', e => { y0 = S.ocupado ? null : e.touches[0].clientY; dy = 0; }, { passive: true });
  folhaEl.addEventListener('touchmove', e => { if (y0 == null) return; dy = Math.max(0, e.touches[0].clientY - y0); folhaEl.style.transition = 'none'; folhaEl.style.transform = `translateY(${dy}px)`; }, { passive: true });
  folhaEl.addEventListener('touchend', () => { if (y0 == null) return; folhaEl.style.transition = ''; folhaEl.style.transform = ''; if (dy > 90) fecharFolha(); y0 = null; });
})();

/* ---------- Seletor de período ---------- */
function pintarSeletor() {
  const sel = $('#seletor'); sel.dataset.pos = dias === 7 ? '1' : '0';
  sel.querySelectorAll('button').forEach(b => { const on = Number(b.dataset.dias) === dias; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; });
}
function trocarPeriodo(novo, foco) {
  if (novo === dias) return;
  dias = novo; try { localStorage.setItem('relatorios.dias', String(dias)); } catch { /* ok */ }
  pintarSeletor(); if (foco) $(`#seletor button[data-dias="${dias}"]`).focus();
  atualizar();
}
$('#seletor').addEventListener('click', ev => { const b = ev.target.closest('button[data-dias]'); if (b) trocarPeriodo(Number(b.dataset.dias)); });
$('#seletor').addEventListener('keydown', ev => {
  if (['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(ev.key)) { ev.preventDefault(); trocarPeriodo(dias === 1 ? 7 : 1, true); }
});
$('#aprender').addEventListener('click', aprender);
$('#ver-mais-conv').addEventListener('click', ev => { const c = $('#c-conv'), on = c.classList.toggle('expandido'); ev.currentTarget.textContent = on ? 'Ver menos' : `Ver todas (${$('#lista-conv').children.length})`; });
$('#ver-mais').addEventListener('click', ev => { const c = $('#c-follow'); const aberto = c.classList.toggle('expandido'); ev.currentTarget.textContent = aberto ? 'Ver menos' : 'Ver mais'; });

/* ---------- Mapa (carrega mapa.css e mapa.js só na primeira vez que abre) ---------- */
let mapaEstado = 'nada';   /* nada | carregando | pronto */
function avisoMapa(msg) {
  $('#mapa').replaceChildren(h('div', { class: 'vazio' }, ic('caixa'), h('span', { text: msg })));
}
function garantirMapa() {
  const box = $('#mapa');
  if (mapaEstado === 'carregando') return;
  if (mapaEstado === 'pronto') { requestAnimationFrame(() => window.dispatchEvent(new Event('resize'))); return; }
  mapaEstado = 'carregando'; avisoMapa('Abrindo o mapa…');
  const montar = () => {
    if (typeof window.montarMapa !== 'function') { mapaEstado = 'nada'; avisoMapa('O mapa está sendo montado.'); return; }
    box.replaceChildren();
    try { window.montarMapa(box, { buscar: c => pegar(c) }); mapaEstado = 'pronto'; }
    catch { mapaEstado = 'nada'; avisoMapa('O mapa está sendo montado.'); }
  };
  if (typeof window.montarMapa === 'function') return montar();
  if (!document.querySelector('link[data-mapa]')) document.head.append(h('link', { rel: 'stylesheet', href: 'mapa.css', 'data-mapa': '' }));
  document.querySelector('script[data-mapa]')?.remove();
  const sc = h('script', { src: 'mapa.js', 'data-mapa': '' });
  sc.addEventListener('load', montar);
  sc.addEventListener('error', () => { mapaEstado = 'nada'; avisoMapa('O mapa está sendo montado.'); });
  document.head.append(sc);
}

/* ---------- Abas do celular e vista do PC ---------- */
const appEl = $('#app'), ABAS = ['resumo', 'follow', 'paineis', 'conversas', 'mapa', 'funil'];   /* aba Funil: telas Funil e Jornada (funil.js, jornada.js) */
function mapaVisivel() { return MOVEL.matches ? (aba === 'mapa' && appEl.dataset.sub === 'mapa') : appEl.dataset.vista === 'mapa'; }
function irParaAba(nova, { inicial } = {}) {
  if (!ABAS.includes(nova)) return;
  const antes = ABAS.indexOf(aba), depois = ABAS.indexOf(nova);
  if (antes === depois) { if (!inicial) scrollTo({ top: 0, behavior: REDUZ.matches ? 'auto' : 'smooth' }); return; }
  aba = nova; appEl.dataset.aba = nova;
  $('.abas-in').style.setProperty('--i', depois);
  document.querySelectorAll('.aba').forEach(b => { if (b.dataset.abaIr === nova) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  scrollTo(0, 0);
  if (!inicial && MOVEL.matches && !REDUZ.matches) {
    const cls = depois > antes ? 'desliza-d' : 'desliza-e';
    appEl.querySelectorAll(`[data-aba="${nova}"]`).forEach(el => {
      el.classList.remove('desliza-d', 'desliza-e'); void el.offsetWidth; el.classList.add(cls);
      el.addEventListener('animationend', () => el.classList.remove(cls), { once: true });
    });
  }
  S.fabEsconde = false; atualizarFab(); if (mapaVisivel()) garantirMapa();
}
document.querySelectorAll('.aba').forEach(b => b.addEventListener('click', () => irParaAba(b.dataset.abaIr)));

function irParaSub(nova) {
  appEl.dataset.sub = nova; atualizarFab();
  const sel = $('#seletor-mapa'); sel.dataset.pos = nova === 'leitura' ? '1' : '0';
  sel.querySelectorAll('button').forEach(b => { const on = b.dataset.sub === nova; b.setAttribute('aria-checked', String(on)); });
  if (mapaVisivel()) garantirMapa();
}
$('#seletor-mapa').addEventListener('click', ev => { const b = ev.target.closest('button[data-sub]'); if (b) irParaSub(b.dataset.sub); });

/* PC: alternar entre o painel e o mapa, sem rolar a página */
const VISTAS = ['escritorio', 'painel', 'followups', 'mapa', 'funil', 'jornada', 'trafego', 'campanha', 'sigma'];
/* Na nuvem (jarviz.copythief.men) o Sigma não existe: os dados dele ficam só no PC. Some o botão e a lista fica com oito. */
if (!/^(127\.0\.0\.1|localhost)$/.test(location.hostname) && location.protocol !== 'file:') {
  VISTAS.splice(VISTAS.indexOf('sigma'), 1);
  const bS = document.querySelector('#vista button[data-vista="sigma"]'); if (bS) bS.remove();
  document.getElementById('vista')?.classList.remove('nove');
}   /* Campanha: contador e projeção (campanha.js, 10/11/2026) */   /* Sigma: painel.capyplay.site numa tela (sigma.js, 09/11/2026) */   /* Escritório do Jarvis = tela inicial (escritorio.js) */
function irParaVista(nova) {
  if (MOVEL.matches) { delete appEl.dataset.vista; return; }
  if (!VISTAS.includes(nova)) nova = 'escritorio';
  appEl.dataset.vista = nova;
  const sel = $('#vista'); sel.dataset.pos = String(VISTAS.indexOf(nova));
  sel.querySelectorAll('button').forEach(b => { const on = b.dataset.vista === nova; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; });
  if (nova === 'mapa') garantirMapa();
}
$('#vista').addEventListener('click', ev => { const b = ev.target.closest('button[data-vista]'); if (b) irParaVista(b.dataset.vista); });
$('#vista').addEventListener('keydown', ev => {
  if (['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(ev.key)) {
    ev.preventDefault();
    const passo = ev.key === 'ArrowRight' || ev.key === 'ArrowDown' ? 1 : -1, i = VISTAS.indexOf(appEl.dataset.vista || 'escritorio');
    irParaVista(VISTAS[(i + passo + VISTAS.length) % VISTAS.length]); $(`#vista button[aria-checked="true"]`).focus();
  }
});
MOVEL.addEventListener('change', () => { if (MOVEL.matches) delete appEl.dataset.vista; else irParaVista('escritorio'); pintarFaixa(); atualizarFab(); });

/* ---------- Puxar para atualizar (só no app instalado na tela de início) ---------- */
(() => {
  const instalado = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true || params.get('ptr') === '1';
  if (!instalado) return;
  const ptr = $('#ptr'); let y0 = null, dy = 0, busy = false;
  const desenha = (p, y) => { ptr.style.opacity = String(p); ptr.style.transform = `translate(-50%, ${y}px)`; ptr.firstElementChild.style.transform = `rotate(${p * 270}deg)`; };
  addEventListener('touchstart', e => { y0 = (!MOVEL.matches || S.folha || busy || scrollY > 0 || e.touches.length !== 1) ? null : e.touches[0].clientY; dy = 0; }, { passive: true });
  addEventListener('touchmove', e => { if (y0 == null) return; dy = Math.max(0, e.touches[0].clientY - y0); if (dy > 6) desenha(Math.min(1, dy / 80), Math.min(dy, 120) * .45); }, { passive: true });
  addEventListener('touchend', async () => {
    if (y0 == null) return; const puxou = dy > 80; y0 = null;
    if (!puxou) { ptr.style.opacity = '0'; ptr.style.transform = 'translate(-50%, 0)'; return; }
    busy = true; ptr.classList.add('gira'); desenha(1, 46);
    try { await Promise.all([atualizar(), contarPendentes(), dormir(500)]); } finally { busy = false; ptr.classList.remove('gira'); ptr.style.opacity = '0'; ptr.style.transform = 'translate(-50%, 0)'; }
  });
})();

/* ---------- Início ---------- */
montarEscada(); pintarSeletor();
{
  const pedido = (params.get('aba') || location.hash.slice(1) || '').toLowerCase();
  if (pedido === 'leitura') { irParaSub('leitura'); irParaAba('mapa', { inicial: true }); }
  else if (pedido === 'jornada') { appEl.dataset.fj = 'jornada'; irParaAba('funil', { inicial: true }); }
  else if (pedido === 'trafego') { appEl.dataset.fj = 'trafego'; irParaAba('funil', { inicial: true }); }
  else if (pedido === 'campanha') { appEl.dataset.fj = 'campanha'; irParaAba('funil', { inicial: true }); }
  else if (ABAS.includes(pedido)) { irParaAba(pedido, { inicial: true }); }
  if (MOVEL.matches) delete appEl.dataset.vista;   /* celular: o HTML nasce com a vista Escritório, que é só do PC (08/11/2026) */
  else irParaVista(['painel', 'mapa', 'followups', 'funil', 'jornada', 'trafego', 'campanha', 'sigma'].includes(params.get('vista')) ? params.get('vista') : 'escritorio');
}
window.relatorios = { aviso, dias: () => dias };   /* gancho para a área Follow-ups (followups.js) */
atualizar();
setInterval(() => { if (!document.hidden) atualizar(); }, ATUALIZA_MS);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { atualizar(); contarPendentes(); } });
})();
