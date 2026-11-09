/* Área Follow-ups do Atendimento da revenda. JS puro, sem dependências, nada de innerHTML com dado de fora.
   Fonte: GET /api/followups?dias=1|7. Ações: POST /api/backlog/mapear | pausar | retomar.
   ?mock=1 usa mock/followups*.json (sem POST de verdade); ?mock=grande (lista longa), ?mock=vazio, ?mock=404 (rota ainda não existe).
   PC: vista "Follow-ups" do seletor do topo. Celular: aba "Follow-ups". Telefone sempre mascarado; senha nunca aparece. */
(() => {
'use strict';

const raiz = document.getElementById('fu');
const appEl = document.getElementById('app');
if (!raiz || !appEl) return;

const params = new URLSearchParams(location.search);
const MOCK = params.get('mock');
const BASE = location.protocol === 'file:' ? 'http://127.0.0.1:8811' : '';
const REDUZ = matchMedia('(prefers-reduced-motion: reduce)');
const MOVEL = matchMedia('(max-width: 820px), (max-height: 500px) and (pointer: coarse)');
const ATUALIZA_MS = 20000;
const POR_PAGINA = 60;
const $ = (s, r = raiz) => r.querySelector(s);
const dormir = ms => new Promise(r => setTimeout(r, ms));

/* ---------- Utilitários ---------- */
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
  check: '<path d="M5 12.5 10 17.5 19 7"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  baixo: '<path d="M12 5v13"/><path d="m6.5 12.5 5.5 5.5 5.5-5.5"/>',
  busca: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  pausa: '<rect x="6.5" y="5" width="3.8" height="14" rx="1.2"/><rect x="13.7" y="5" width="3.8" height="14" rx="1.2"/>',
  play: '<path d="M8 5.5v13l10.5-6.5Z"/>',
  atualizar: '<path d="M21 12a8 8 0 0 1-13.6 5.7L4 15"/><path d="M3 12a8 8 0 0 1 13.6-5.7L20 9"/><path d="M4 20v-5h5M20 4v5h-5"/>',
  gira: '<path d="M12 3a9 9 0 1 0 9 9"/>',
  alerta: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5"/><path d="M12 16.5h.01"/>',
  caixa: '<path d="m4 13 2-7h12l2 7v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z"/><path d="M4 13h4l1 2h6l1-2h4"/>',
  historico: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5"/><path d="M3.5 3.5v5h5"/><path d="M12 7.5V12l3 2"/>',
  relogio: '<path d="M12 7v5l3 2"/><circle cx="12" cy="12" r="9"/>',
};
function ic(nome) {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '1.8'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true'); s.innerHTML = ICONES[nome] || '';
  return s;
}
const num = v => (v == null || v === '' || typeof v === 'boolean' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
const int = v => { const n = num(v); return n == null ? '—' : Math.round(n).toLocaleString('pt-BR'); };
const lista = v => (Array.isArray(v) ? v : []);
const txt = v => (v == null ? '' : String(v)).replace(/[\p{Co}\u0000-\u0008\u000B\u000C\u000E-\u001F]/gu, '').trim();
/* Mensagem de follow-up pode citar acesso do painel: a senha nunca vai para a tela. */
const seguro = t => txt(t).replace(/\b(senha|password|pwd)\b[^\n.,;!?]{0,40}/gi, '$1 ••••').replace(/\+?\d[\d\s().-]{8,}\d/g, m => masc(m));
/* Telefone: só os 4 últimos dígitos, venha como vier. */
function masc(v) {
  const d = String(v == null ? '' : v).replace(/\D/g, '');
  return d.length >= 2 ? `•••• ${d.slice(-4)}` : '';
}
function nomeSeguro(nome, tel) {
  const t = txt(nome);
  if (t.replace(/\D/g, '').length >= 8) return `Contato ${masc(t) || masc(tel)}`.trim();
  return t || 'Sem nome';
}
const inicial = n => (txt(n).replace(/[^\p{L}\p{N}]/gu, '')[0] || '?').toUpperCase();
const semAcento = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const plural = (n, um, varios) => `${int(n)} ${num(n) === 1 ? um : varios}`;
const pct = (a, b) => { a = num(a); b = num(b); return a == null || b == null || b <= 0 ? null : Math.round(Math.min(1, a / b) * 100); };
const rotuloCat = c => { const t = txt(c).replace(/_/g, ' '); return t ? t[0].toUpperCase() + t.slice(1) : 'Sem categoria'; };

function data(v) { if (v == null || v === '') return null; const d = new Date(v); return isNaN(d) ? null : d; }
const hhmm = d => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const mesmo = (a, b) => a.toDateString() === b.toDateString();
function diaRel(d) {
  const ag = new Date(); if (mesmo(d, ag)) return 'hoje';
  const o = new Date(ag); o.setDate(o.getDate() - 1); if (mesmo(d, o)) return 'ontem';
  const a = new Date(ag); a.setDate(a.getDate() + 1); if (mesmo(d, a)) return 'amanhã';
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}
const quandoRel = d => (d ? `${diaRel(d)} ${hhmm(d)}` : '');
function proxLabel(d) {
  if (!d) return '';
  const m = Math.round((d.getTime() - Date.now()) / 60000);
  if (m <= 0) return 'agora';
  if (m < 60) return `em ${m} min`;
  return `${diaRel(d)} às ${hhmm(d)}`;
}
function atras(d) {
  if (!d) return '';
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 3600) return s < 60 ? 'há pouco' : `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  return `há ${Math.floor(s / 86400)} d`;
}
function minLabel(m) {
  m = num(m); if (m == null) return '';
  if (m < 1) return 'menos de 1 min';
  if (m < 60) return `${Math.round(m)} min`;
  const hh = Math.floor(m / 60), mm = Math.round(m % 60);
  return mm ? `${hh} h ${mm} min` : `${hh} h`;
}
const dias = () => (window.relatorios && window.relatorios.dias ? window.relatorios.dias() : 1);
const aviso = (msg, erro) => { if (window.relatorios && window.relatorios.aviso) window.relatorios.aviso(msg, erro); };

/* ---------- Números que contam (só aqui e na trilha: o resto fica quieto) ---------- */
function contar(el, alvo, fmt = v => Math.round(v).toLocaleString('pt-BR')) {
  cancelAnimationFrame(el._raf);
  if (alvo == null) { el._v = null; el.textContent = '—'; return; }
  const de = el._v == null ? 0 : el._v;
  const fim = () => { el.textContent = fmt(alvo); el._v = alvo; };
  if (REDUZ.matches || de === alvo || document.hidden) return fim();
  const t0 = performance.now(), dur = 700;
  const passo = agora => {
    const t = Math.min(1, (agora - t0) / dur), e = 1 - Math.pow(1 - t, 3);
    if (t >= 1) return fim();
    const v = de + (alvo - de) * e; el.textContent = fmt(v); el._v = v;
    el._raf = requestAnimationFrame(passo);
  };
  el._raf = requestAnimationFrame(passo);
}

/* ---------- Rede ---------- */
async function pegar(caminho, { metodo = 'GET', limite = 15000 } = {}) {
  const ctl = new AbortController();
  const corta = setTimeout(() => ctl.abort(new DOMException('tempo esgotado', 'TimeoutError')), limite);
  try {
    const r = await fetch(BASE + caminho, { method: metodo, signal: ctl.signal, cache: 'no-store', headers: { Accept: 'application/json' } });
    const tipo = r.headers.get('content-type') || '';
    if (r.status === 401 || (r.ok && /text\/html/i.test(tipo))) throw Object.assign(new Error('HTTP 401'), { status: 401 });
    if (!r.ok) throw Object.assign(new Error('HTTP ' + r.status), { status: r.status });
    return await r.json();
  } finally { clearTimeout(corta); }
}

/* Mock: datas vêm relativas ao gerado_em do arquivo e são deslocadas para agora; POST só muda a cópia local. */
const CHAVES_DATA = new Set(['gerado_em', 'quando', 'ultimo_contato', 'em', 'proximo_envio_em']);
function rebase(o, desloc) {
  if (Array.isArray(o)) return o.map(x => rebase(x, desloc));
  if (o && typeof o === 'object') {
    const r = {};
    for (const [k, v] of Object.entries(o)) r[k] = CHAVES_DATA.has(k) && typeof v === 'string' && !isNaN(Date.parse(v)) ? new Date(Date.parse(v) + desloc).toISOString() : rebase(v, desloc);
    return r;
  }
  return o;
}
const mockCache = {};
async function mockLer() {
  if (MOCK === '404') throw Object.assign(new Error('HTTP 404'), { status: 404 });
  if (MOCK === 'sessao') throw Object.assign(new Error('HTTP 401'), { status: 401 });
  if (MOCK === 'vazio') return { gerado_em: new Date().toISOString(), resumo: {}, degraus: [], clientes: [], por_categoria: [] };
  const arq = MOCK === 'grande' ? 'mock/followups-grande.json' : (dias() === 7 ? 'mock/followups-7.json' : 'mock/followups.json');
  if (!mockCache[arq]) {
    const bruto = await (await fetch(arq, { cache: 'no-store' })).json();
    mockCache[arq] = rebase(bruto, Date.now() - (Date.parse(bruto.gerado_em) || Date.now()));
  }
  return structuredClone(mockCache[arq]);
}
async function mockPost(tipo) {
  await dormir(tipo === 'mapear' ? 1400 : 700);
  Object.values(mockCache).forEach(d => {
    if (!d.resumo) return;
    if (tipo === 'pausar') { d.resumo.pausado = true; d.resumo.proximo_envio_em = null; }
    if (tipo === 'retomar') { d.resumo.pausado = false; d.resumo.proximo_envio_em = new Date(Date.now() + 4 * 60000).toISOString(); }
  });
  return { ok: true };
}
const buscarDados = () => (MOCK ? mockLer() : pegar(`/api/followups?dias=${dias()}`));
const postar = tipo => (MOCK ? mockPost(tipo) : pegar(`/api/backlog/${tipo}`, { metodo: 'POST', limite: 90000 }));

/* ---------- Normalização: tudo vazio/null vira valor seguro ---------- */
const STATUS = { aguardando: 'Aguardando', respondeu: 'Respondeu', fechou_painel: 'Fechou painel', sem_resposta: 'Sem resposta', nao_incomodar: 'Não incomodar', na_fila: 'Na fila' };
const RANK = { respondeu: 0, aguardando: 1, na_fila: 2, fechou_painel: 3, sem_resposta: 4, nao_incomodar: 5 };
const MIN_PADRAO = [7, 20, 60, 180];
function normalizar(bruto) {
  const r = bruto && typeof bruto === 'object' ? bruto : {};
  const R = r.resumo && typeof r.resumo === 'object' ? r.resumo : {};
  const g = k => num(R[k]);
  const resumo = {
    em_fila: g('em_fila'), enviados: g('enviados'), respondidos: g('respondidos'), taxa: g('taxa'), paineis_depois: g('paineis_depois'),
    total: g('backlog_total'), mapeadas: g('backlog_mapeados'), renomeadas: g('backlog_renomeados'), na_fila: g('backlog_na_fila'),
    enviadas: g('backlog_enviados'), responderam: g('backlog_respondeu'), fecharam: g('backlog_fechou_painel'), descartadas: g('backlog_descartados'),
    pausado: R.pausado === true, proximo: data(R.proximo_envio_em), hoje: g('enviados_hoje') ?? 0, teto: g('teto_dia'),
  };
  const degraus = MIN_PADRAO.map((m, i) => {
    const d = lista(r.degraus).find(x => x && num(x.n) === i + 1) || {};
    const env = num(d.enviados) ?? 0, resp = Math.min(env, num(d.respondidos) ?? 0);
    return { n: i + 1, minutos: num(d.minutos) ?? m, env, resp, pn: num(d.paineis_depois) ?? 0 };
  });
  const clientes = lista(r.clientes).filter(c => c && typeof c === 'object').map((c, i) => {
    const tel = masc(c.telefone_mascarado);
    const fus = lista(c.followups).filter(f => f && num(f.n) != null).map(f => ({
      n: num(f.n), quando: data(f.quando), texto: seguro(f.texto), respondeu: f.respondeu === true, min: num(f.minutos_ate_resposta),
    })).sort((a, b) => a.n - b.n);
    const p = c.proximo && typeof c.proximo === 'object' && num(c.proximo.n) != null ? { n: num(c.proximo.n), em: data(c.proximo.em) } : null;
    const nome = nomeSeguro(c.nome, c.telefone_mascarado);
    const origem = c.origem === 'backlog' ? 'backlog' : 'ao_vivo';
    return {
      chave: `${origem}|${nome}|${tel}|${i}`, nome, tel, origem, categoria: txt(c.categoria), etapa: txt(c.etapa), ultimo: data(c.ultimo_contato),
      fus, proximo: p, status: STATUS[c.status] ? c.status : 'aguardando',
    };
  });
  const por_categoria = lista(r.por_categoria).filter(x => x && num(x.qtd) > 0).map(x => ({ categoria: txt(x.categoria), qtd: num(x.qtd) })).sort((a, b) => b.qtd - a.qtd);
  return { gerado: data(r.gerado_em), resumo, degraus, clientes, por_categoria };
}

/* ---------- Estado ---------- */
const S = { d: null, erro: null, filtro: 'todos', busca: '', cat: null, limite: POR_PAGINA, abertos: new Set(), ocupado: null, sig: {}, vis: false };
const FILTROS = [
  ['todos', 'Todos', () => true],
  ['ao_vivo', 'Ao vivo', c => c.origem === 'ao_vivo'],
  ['atrasado', 'Atrasado', c => c.origem === 'backlog'],
  ['aguardando', 'Aguardando', c => c.status === 'aguardando' || c.status === 'na_fila'],
  ['responderam', 'Responderam', c => c.status === 'respondeu' || c.status === 'fechou_painel'],
  ['fecharam', 'Fecharam painel', c => c.status === 'fechou_painel'],
  ['nao_incomodar', 'Não incomodar', c => c.status === 'nao_incomodar'],
];
const FRIAS = new Set(['esfriou', 'sem_interesse', 'suporte', 'equipe_ou_parceiro', 'irrelevante']);
const NOMES_CAT = {
  painel_criado: 'Painel criado', testando: 'Testando', interessado_sem_painel: 'Interessado, sem painel', duvida_aberta: 'Dúvida em aberto',
  sem_resposta_nossa: 'Ficou sem nossa resposta', esfriou: 'Esfriou', sem_interesse: 'Sem interesse', suporte: 'Suporte', equipe_ou_parceiro: 'Equipe ou parceiro', irrelevante: 'Irrelevante',
};
const nomeCat = c => NOMES_CAT[c] || rotuloCat(c);

/* ---------- Estrutura (montada uma vez) ---------- */
const ETAPAS = [['mapeadas', 'Mapeadas'], ['renomeadas', 'Renomeadas'], ['na_fila', 'Na fila'], ['enviadas', 'Enviadas'], ['responderam', 'Responderam'], ['fecharam', 'Fecharam painel']];
const R_ANEL = 42, C_ANEL = 2 * Math.PI * R_ANEL;

function montarEstrutura() {
  const trilha = h('ol', { class: 'fu-trilha', id: 'fu-trilha' }, ETAPAS.map(([k, rot], n) => h('li', { class: 'fu-et', 'data-k': k, style: `--n:${n}` },
    h('span', { class: 'fu-et-no', 'aria-hidden': 'true' }, ['mapeadas', 'renomeadas', 'fecharam'].includes(k) ? ic('check') : h('i', { class: 'fu-ponto' })),
    h('span', { class: 'fu-et-rot', text: rot }),
    h('b', { class: 'fu-et-val', 'data-conta': '', text: '—' }),
    h('span', { class: 'fu-et-sub' }),
    h('span', { class: 'fu-bar', 'aria-hidden': 'true' }, h('i')))));

  const anel = h('div', { class: 'fu-anel', role: 'img', id: 'fu-anel' });
  const sv = document.createElementNS(NS, 'svg'); sv.setAttribute('viewBox', '0 0 100 100'); sv.setAttribute('aria-hidden', 'true');
  sv.innerHTML = `<defs><linearGradient id="fu-grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7aedff"/><stop offset="1" stop-color="#00c7ff"/></linearGradient></defs>
    <circle class="trk" cx="50" cy="50" r="${R_ANEL}" fill="none" stroke-width="8"/><circle class="pr" cx="50" cy="50" r="${R_ANEL}" fill="none" stroke-width="8" stroke-linecap="round" stroke-dasharray="${C_ANEL.toFixed(2)}" stroke-dashoffset="${C_ANEL.toFixed(2)}"/>`;
  anel.append(sv, h('div', { class: 'fu-anel-c' }, h('b', { 'data-conta': '', id: 'fu-hoje', text: '0' }), h('span', { id: 'fu-teto', text: 'de —' })));

  const faixa = h('section', { class: 'cartao fu-faixa', 'aria-labelledby': 'fu-t-faixa' },
    h('header', null, h('h2', { id: 'fu-t-faixa', text: 'Atrasado da semana passada' }), h('span', { class: 'sub', id: 'fu-faixa-sub' }), h('span', { class: 'pilula-t fu-estado', id: 'fu-estado' }, h('i'), h('span'))),
    h('div', { class: 'fu-faixa-corpo' },
      h('div', { class: 'fu-faixa-meio' }, trilha, h('p', { class: 'fu-faixa-msg', id: 'fu-faixa-msg', hidden: true })),
      h('div', { class: 'fu-ctl' },
        anel,
        h('div', { class: 'fu-prox' }, h('span', { class: 'fu-prox-r', text: 'Próximo envio' }), h('b', { id: 'fu-prox-v', text: '—' }), h('span', { class: 'fu-prox-d', id: 'fu-prox-d' })),
        h('div', { class: 'fu-botoes' },
          h('button', { type: 'button', class: 'btn', id: 'fu-mapear' }, ic('atualizar'), h('span', { text: 'Mapear de novo' })),
          h('button', { type: 'button', class: 'btn', id: 'fu-pausa' }, ic('pausa'), h('span', { text: 'Pausar envios' }))))));

  /* degraus */
  const escada = h('ol', { class: 'fu-escada', id: 'fu-escada' });
  MIN_PADRAO.forEach((m, i) => {
    escada.append(h('li', { class: 'fu-deg', 'data-i': i },
      h('span', { class: 'fu-deg-no', 'aria-hidden': 'true', text: `${i + 1}º` }),
      h('div', { class: 'fu-deg-c' },
        h('div', { class: 'fu-deg-t' }, h('span', { class: 'fu-deg-q' }), h('span', { class: 'fu-deg-n' })),
        h('div', { class: 'fu-barra', 'aria-hidden': 'true' }, h('i', { class: 'env' }), h('i', { class: 'resp' })),
        h('div', { class: 'fu-deg-d' }))));
    if (i < MIN_PADRAO.length - 1) escada.append(h('li', { class: 'fu-lig', 'aria-hidden': 'true' }, ic('baixo'), h('span')));
  });
  const backlog = h('div', { class: 'fu-deg fu-bk', id: 'fu-bk' },
    h('span', { class: 'fu-deg-no', 'aria-hidden': 'true' }, ic('historico')),
    h('div', { class: 'fu-deg-c' },
      h('div', { class: 'fu-deg-t' }, h('span', { class: 'fu-deg-q', text: 'Atrasado (backlog)' }), h('span', { class: 'fu-deg-n' })),
      h('div', { class: 'fu-barra', 'aria-hidden': 'true' }, h('i', { class: 'env' }), h('i', { class: 'resp' })),
      h('div', { class: 'fu-deg-d' })));
  const degraus = h('section', { class: 'cartao fu-degraus', 'aria-labelledby': 'fu-t-deg' },
    h('header', null, h('h2', { id: 'fu-t-deg', text: 'Escada de follow-ups' }), h('span', { class: 'sub', id: 'fu-deg-sub' })),
    h('div', { class: 'corpo', tabindex: '0', role: 'region', 'aria-label': 'Escada de follow-ups' }, escada, backlog));

  const cats = h('section', { class: 'cartao fu-cats-card', 'aria-labelledby': 'fu-t-cat' },
    h('header', null, h('h2', { id: 'fu-t-cat', text: 'Categorias do atrasado' }), h('span', { class: 'sub', id: 'fu-cat-sub' })),
    h('div', { class: 'corpo', tabindex: '0', role: 'region', 'aria-label': 'Categorias do atrasado' }, h('ul', { class: 'fu-cats', id: 'fu-cats' })));

  /* clientes */
  const filtros = h('div', { class: 'fu-filtros', id: 'fu-filtros', role: 'radiogroup', 'aria-label': 'Filtrar conversas' },
    h('span', { class: 'pilula-f', 'aria-hidden': 'true' }),
    FILTROS.map(([k, rot]) => h('button', { type: 'button', role: 'radio', 'aria-checked': k === 'todos' ? 'true' : 'false', 'data-f': k, tabindex: k === 'todos' ? '0' : '-1' }, rot, h('span', { class: 'n' }))));
  const busca = h('label', { class: 'fu-busca' }, ic('busca'), h('span', { class: 'so-leitor', text: 'Buscar por nome' }),
    h('input', { type: 'search', id: 'fu-busca', placeholder: 'Buscar por nome', autocomplete: 'off', enterkeyhint: 'search', maxlength: '60' }));
  const clientes = h('section', { class: 'cartao fu-clientes', 'aria-labelledby': 'fu-t-cli' },
    h('header', null, h('h2', { id: 'fu-t-cli', text: 'Linha do tempo por cliente' }), h('span', { class: 'sub', id: 'fu-cli-sub', 'aria-live': 'polite' })),
    h('div', { class: 'fu-ferramentas' }, filtros, busca, h('span', { class: 'fu-cat-chip', id: 'fu-cat-chip', hidden: true })),
    h('ul', { class: 'fu-legenda', 'aria-label': 'Como ler as bolinhas' }, [['resp', 'respondeu'], ['env', 'enviado'], ['prox', 'próximo'], ['vazio', 'ainda não']].map(([k, t]) => h('li', null, h('span', { class: 'fu-pt', 'data-s': k, 'aria-hidden': 'true' }), t))),
    h('div', { class: 'corpo', id: 'fu-corpo', tabindex: '0', role: 'region', 'aria-label': 'Clientes e follow-ups' },
      h('ul', { class: 'fu-lista', id: 'fu-lista' }, [1, 2, 3].map(() => h('li', { class: 'fu-cli fu-sk' }, h('span', { class: 'sk', style: 'width:55%' }), h('span', { class: 'sk', style: 'width:85%' }), h('span', { class: 'sk', style: 'width:40%' })))),
      h('button', { type: 'button', class: 'ver-mais fu-mais', id: 'fu-mais', hidden: true })));

  const geral = h('div', { class: 'fu-geral', id: 'fu-geral', role: 'status', hidden: true }, ic('caixa'), h('p', { id: 'fu-geral-t' }), h('span', { id: 'fu-geral-d' }));
  const faixaAviso = h('div', { class: 'fu-aviso', id: 'fu-aviso', role: 'status', hidden: true }, ic('alerta'), h('span', { text: 'Sem conexão com o servidor. Mostrando o último que chegou.' }));

  raiz.replaceChildren(faixaAviso, geral, h('div', { class: 'fu-conteudo', id: 'fu-conteudo' }, faixa, h('div', { class: 'fu-grade' }, h('div', { class: 'fu-esq' }, degraus, cats), clientes)));
}
montarEstrutura();

/* ---------- Faixa de andamento ---------- */
function pintarFaixa(d) {
  const R = d.resumo;
  const semDados = R.total == null && R.mapeadas == null;
  const vazio = !semDados && (R.total === 0 || (R.mapeadas === 0 && R.total == null));
  const faixa = $('.fu-faixa');
  faixa.classList.toggle('sem-dados', semDados || vazio);
  const msg = $('#fu-faixa-msg');
  msg.hidden = !(semDados || vazio);
  msg.textContent = semDados ? 'Os dados do atrasado ainda estão sendo preparados.' : 'Nenhuma conversa atrasada mapeada ainda. Toque em “Mapear de novo” para o robô ler as conversas da semana passada.';

  const total = Math.max(1, R.total ?? 0, R.mapeadas ?? 0);
  /* cada barra usa a mesma base do texto ao lado: o que ela diz e o que o texto diz batem */
  const bases = [total, R.mapeadas, R.renomeadas, R.renomeadas, R.enviadas, R.responderam].map(b => Math.max(1, b ?? 0));
  const vals = ETAPAS.map(([k]) => R[k]);
  let frente = -1; vals.forEach((v, i) => { if ((v ?? 0) > 0) frente = i; });
  const subs = {
    mapeadas: R.descartadas > 0 ? `${int(R.descartadas)} descartadas` : 'conversas lidas',
    renomeadas: 'contatos ajustados',
    na_fila: 'esperando a vez',
    enviadas: R.enviadas > 0 ? `${int(R.hoje)} hoje` : 'nenhuma ainda',
    responderam: pct(R.responderam, R.enviadas) != null && R.responderam > 0 ? `${pct(R.responderam, R.enviadas)}% das enviadas` : 'ninguém ainda',
    fecharam: pct(R.fecharam, R.responderam) != null && R.fecharam > 0 ? `${pct(R.fecharam, R.responderam)}% de quem respondeu` : 'ainda nenhum',
  };
  [...$('#fu-trilha').children].forEach((li, i) => {
    const k = ETAPAS[i][0], v = vals[i];
    li.classList.toggle('on', (v ?? 0) > 0);
    li.classList.toggle('fim', i === frente);
    li.classList.toggle('liga', (vals[i + 1] ?? 0) > 0 && (v ?? 0) > 0);
    contar($('.fu-et-val', li), v);
    $('.fu-et-sub', li).textContent = semDados ? '' : subs[k];
    $('.fu-bar', li).style.setProperty('--v', String(Math.min(1, (v ?? 0) / bases[i])));
    li.setAttribute('aria-label', `${ETAPAS[i][1]}: ${v == null ? 'sem dado' : int(v)}`);
  });
  const sub = [];
  if (R.total != null) sub.push(plural(R.total, 'conversa', 'conversas') + ' no mapa');
  if (d.gerado) sub.push(`atualizado às ${hhmm(d.gerado)}`);
  $('#fu-faixa-sub').textContent = sub.join(' · ');

  /* estado */
  const est = $('#fu-estado'), t = $('span', est);
  const rodando = !R.pausado && (R.na_fila ?? 0) > 0;
  est.className = 'pilula-t fu-estado ' + (R.pausado ? 'aviso' : (rodando ? 'rodando' : 'neutra'));
  t.textContent = R.pausado ? 'Envios pausados' : (rodando ? 'Enviando aos poucos' : 'Fila vazia');

  /* anel e próximo envio */
  contar($('#fu-hoje'), R.hoje);
  const teto = R.teto ?? 0;
  $('#fu-teto').textContent = teto > 0 ? `de ${int(teto)}` : 'hoje';
  const off = C_ANEL * (1 - (teto > 0 ? Math.min(1, R.hoje / teto) : 0));
  $('#fu-anel .pr').style.setProperty('--off', off.toFixed(2));
  $('#fu-anel').setAttribute('aria-label', teto > 0 ? `${int(R.hoje)} envios hoje, de no máximo ${int(teto)}` : `${int(R.hoje)} envios hoje`);
  $('#fu-prox-v').textContent = R.pausado ? 'Pausado' : (R.proximo ? proxLabel(R.proximo) : 'Sem envio programado');
  $('#fu-prox-d').textContent = R.pausado ? 'Retome para voltar a enviar.' : (!R.proximo && !rodando ? 'Ninguém na fila agora.' : '');

  const bp = $('#fu-pausa');
  if (S.ocupado !== 'pausar' && S.ocupado !== 'retomar') {
    bp.classList.toggle('principal', R.pausado);
    bp.replaceChildren(ic(R.pausado ? 'play' : 'pausa'), h('span', { text: R.pausado ? 'Retomar envios' : 'Pausar envios' }));
  }
}

/* ---------- Escada de degraus ---------- */
function pintarDegraus(d) {
  const max = Math.max(1, ...d.degraus.map(x => x.env));
  const linhas = [...$('#fu-escada').children].filter(li => li.classList.contains('fu-deg'));
  const ligs = [...$('#fu-escada').children].filter(li => li.classList.contains('fu-lig'));
  d.degraus.forEach((g, i) => {
    const li = linhas[i], sem = Math.max(0, g.env - g.resp), tx = pct(g.resp, g.env);
    li.classList.toggle('on', g.env > 0);
    $('.fu-deg-q', li).textContent = `${minLabel(g.minutos)} depois`;
    $('.fu-deg-n', li).replaceChildren(h('b', { text: int(g.env) }), g.env === 1 ? ' recebeu' : ' receberam');
    $('.env', li).style.setProperty('--e', String(g.env / max));
    $('.resp', li).style.setProperty('--r', String(g.resp / max));
    $('.fu-deg-d', li).replaceChildren(...[
      g.env === 0 ? h('span', { class: 'mudo', text: 'Ninguém neste degrau no período' }) : h('span', null, h('b', { text: int(g.resp) }), g.resp === 1 ? ' respondeu' : ' responderam', tx != null ? ` (${tx}%)` : ''),
      g.env > 0 ? h('span', { class: 'pn' + (g.pn > 0 ? ' tem' : '') }, g.pn > 0 ? [h('b', { text: int(g.pn) }), g.pn === 1 ? ' fechou painel depois' : ' fecharam painel depois'] : 'Nenhum painel depois') : null].filter(Boolean));
    li.setAttribute('aria-label', `${i + 1}º follow-up, ${minLabel(g.minutos)}: ${g.env} entraram, ${g.resp} responderam, ${g.pn} fecharam painel depois, ${sem} sem resposta`);
    if (ligs[i]) { const s = $('span', ligs[i]); s.textContent = g.env > 0 ? `${int(sem)} sem resposta` : 'sem movimento'; ligs[i].classList.toggle('vazia', g.env === 0); }
  });
  const nada = d.degraus.every(g => g.env === 0);
  $('#fu-escada').classList.toggle('calma', nada);
  if (nada) linhas.forEach((li, i) => { $('.fu-deg-d', li).replaceChildren(...(i === 0 ? [h('span', { class: 'mudo', text: 'Nenhum follow-up enviado neste período.' })] : [])); });
  const R = d.resumo, bk = $('#fu-bk'), env = R.enviadas ?? 0, resp = Math.min(env, R.responderam ?? 0);
  bk.classList.toggle('on', env > 0);
  $('.fu-deg-n', bk).replaceChildren(h('b', { text: int(env) }), env === 1 ? ' enviado' : ' enviados');
  $('.env', bk).style.setProperty('--e', env > 0 ? '1' : '0');
  $('.resp', bk).style.setProperty('--r', env > 0 ? String(resp / env) : '0');
  const txb = pct(resp, env);
  $('.fu-deg-d', bk).replaceChildren(...[
    env === 0 ? h('span', { class: 'mudo', text: R.total == null ? 'Os dados do atrasado ainda estão sendo preparados.' : 'Nenhum envio do atrasado ainda' }) : h('span', null, h('b', { text: int(resp) }), resp === 1 ? ' respondeu' : ' responderam', txb != null ? ` (${txb}%)` : ''),
    env > 0 ? h('span', { class: 'pn' + (R.fecharam > 0 ? ' tem' : '') }, R.fecharam > 0 ? [h('b', { text: int(R.fecharam) }), R.fecharam === 1 ? ' fechou painel' : ' fecharam painel'] : 'Nenhum painel ainda') : null].filter(Boolean));
  const tot = d.degraus.reduce((s, x) => s + x.env, 0), totR = d.degraus.reduce((s, x) => s + x.resp, 0);
  $('#fu-deg-sub').textContent = tot ? `ao vivo · ${int(tot)} mensagens enviadas · ${pct(totR, tot)}% responderam` : (R.em_fila ? `${int(R.em_fila)} na fila` : '');
}

/* ---------- Categorias ---------- */
function pintarCats(d) {
  const ul = $('#fu-cats'), cats = d.por_categoria, max = Math.max(1, ...cats.map(c => c.qtd)), tot = cats.reduce((s, c) => s + c.qtd, 0);
  $('#fu-cat-sub').textContent = tot ? `${int(tot)} no mapa` : '';
  if (!cats.length) { ul.replaceChildren(h('li', null, h('div', { class: 'vazio' }, ic('caixa'), h('span', { text: 'O mapa ainda não separou as conversas por categoria.' })))); return; }
  ul.replaceChildren(...cats.map(c => h('li', null, h('button', { type: 'button', class: 'fu-cat' + (FRIAS.has(c.categoria) ? ' frio' : ''), 'aria-pressed': String(S.cat === c.categoria), 'data-c': c.categoria, title: `Mostrar só ${nomeCat(c.categoria).toLowerCase()}` },
    h('span', { class: 'fu-cat-r', text: nomeCat(c.categoria) }), h('span', { class: 'fu-cat-b', 'aria-hidden': 'true' }, h('i', { style: `--v:${(c.qtd / max).toFixed(3)}` })), h('b', { class: 'fu-cat-q', text: int(c.qtd) })))));
}

/* ---------- Clientes ---------- */
function resumoCli(c) {
  const ult = c.fus[c.fus.length - 1], a = [], b = [];
  if (ult) {
    a.push(`${ult.n}º enviado ${quandoRel(ult.quando)}`.trim(), ' · ');
    if (ult.respondeu) a.push(h('span', { class: 'resp' }, ult.min != null ? `respondeu em ${minLabel(ult.min)}` : 'respondeu'));
    else a.push(h('span', { class: 'mudo', text: c.status === 'sem_resposta' ? 'sem resposta' : 'esperando resposta' }));
  } else a.push(c.status === 'na_fila' ? 'Ainda não recebeu follow-up' : 'Nenhum follow-up enviado');
  if (c.proximo) b.push(h('span', { class: 'prox' }, `Próximo: ${c.proximo.n}º ${proxLabel(c.proximo.em)}`.trim()));
  else if (c.status === 'nao_incomodar') b.push(h('span', { class: 'mudo', text: 'O robô não chama mais este contato' }));
  return [h('span', { class: 'fu-res' }, a), b.length ? h('span', { class: 'fu-res' }, b) : null];
}
function trilhaBolinhas(c, ai) {
  const maxN = Math.max(0, ...c.fus.map(f => f.n), c.proximo ? c.proximo.n : 0);
  const n = c.origem === 'ao_vivo' ? Math.max(4, maxN) : Math.max(1, maxN);
  const caixa = h('div', { class: 'fu-pts', role: 'img' });
  const partes = [];
  for (let i = 1; i <= n; i++) {
    const f = c.fus.find(x => x.n === i), ehProx = c.proximo && c.proximo.n === i && !f;
    let s = 'vazio', dica = `${i}º · ainda não previsto`;
    if (f) {
      s = f.respondeu ? (c.status === 'fechou_painel' && i === Math.max(...c.fus.filter(x => x.respondeu).map(x => x.n)) ? 'fecha' : 'resp') : 'env';
      dica = `${i}º · ${quandoRel(f.quando)} · ${f.respondeu ? (f.min != null ? `respondeu em ${minLabel(f.min)}` : 'respondeu') : 'sem resposta'}`;
    } else if (ehProx) { s = 'prox'; dica = `${i}º · ${proxLabel(c.proximo.em)}`; }
    if (i > 1) partes.push(h('i', { class: 'fu-ln' + (f ? ' on' : '') }));
    partes.push(h('span', { class: 'fu-pt', 'data-s': s, title: dica.trim(), style: ai ? `--p:${i - 1}` : null, text: String(i) }));
  }
  caixa.setAttribute('aria-label', `Follow-ups: ${c.fus.length} enviados${c.proximo ? `, próximo ${c.proximo.n}º ${proxLabel(c.proximo.em)}` : ''}`);
  caixa.append(...partes);
  return caixa;
}
function detalheCli(c) {
  const itens = c.fus.length ? c.fus.map(f => h('li', { class: 'fu-fl' + (f.respondeu ? ' resp' : '') },
    h('div', { class: 'fu-fl-t' }, h('b', { text: `${f.n}º` }), ` · ${quandoRel(f.quando)} · `, f.respondeu ? h('span', { class: 'resp', text: f.min != null ? `respondeu em ${minLabel(f.min)}` : 'respondeu' }) : h('span', { class: 'mudo', text: 'sem resposta' })),
    f.texto ? h('p', { text: f.texto }) : null)) : [h('li', { class: 'fu-fl vazio-fl', text: 'Nenhum follow-up enviado ainda.' })];
  return h('div', { class: 'fu-det', 'aria-hidden': String(!S.abertos.has(c.chave)) }, h('div', null, h('ol', { class: 'fu-fls' }, itens)));
}
function cartaoCli(c, i, animar) {
  const aberto = S.abertos.has(c.chave);
  const st = h('span', { class: 'pilula-t ' + ({ respondeu: 'resp', fechou_painel: 'ok', nao_incomodar: 'aviso' }[c.status] || 'neutra'), text: STATUS[c.status] });
  const li = h('li', { class: 'fu-cli' + (aberto ? ' aberto' : '') + (animar && i < 14 ? ' entra' : ''), 'data-st': c.status, 'data-k': c.chave, style: `--i:${Math.min(i, 8)}` },
    h('div', { class: 'fu-cli-l1' },
      h('div', { class: 'avatar', 'aria-hidden': 'true', text: inicial(c.nome) }),
      h('div', { class: 'fu-cli-id' }, h('span', { class: 'nome', text: c.nome }), h('span', { class: 'tel', text: [c.tel, c.origem === 'backlog' ? 'atrasado' : 'ao vivo'].filter(Boolean).join(' · ') })),
      st, h('span', { class: 'fu-chev', 'aria-hidden': 'true' }, ic('chevron'))),
    h('div', { class: 'fu-cli-l2' },
      h('span', { class: 'pilula-t neutra', text: c.categoria ? nomeCat(c.categoria) : 'Sem categoria' }),
      c.etapa && semAcento(c.etapa) !== semAcento(c.categoria ? nomeCat(c.categoria) : '') ? h('span', { class: 'pilula-t neutra', text: c.etapa }) : null,
      c.ultimo ? h('span', { class: 'fu-ult', text: `último contato ${atras(c.ultimo)}` }) : null),
    h('div', { class: 'fu-cli-l3' }, trilhaBolinhas(c, animar && i < 14), h('div', { class: 'fu-res-box' }, resumoCli(c))),
    detalheCli(c),
    h('button', { type: 'button', class: 'fu-cli-bt', 'aria-expanded': String(aberto), 'aria-label': `${c.nome}: ${aberto ? 'esconder' : 'ver'} os follow-ups`, onclick: ev => alternar(c.chave, li, ev.currentTarget) }));
  return li;
}
function alternar(chave, li, bt) {
  const on = !S.abertos.has(chave);
  on ? S.abertos.add(chave) : S.abertos.delete(chave);
  li.classList.toggle('aberto', on); bt.setAttribute('aria-expanded', String(on));
  const det = $('.fu-det', li); if (det) det.setAttribute('aria-hidden', String(!on));
  const nome = $('.nome', li).textContent; bt.setAttribute('aria-label', `${nome}: ${on ? 'esconder' : 'ver'} os follow-ups`);
}
function filtrar(d, ignorar) {
  const q = semAcento(S.busca.trim());
  const f = FILTROS.find(x => x[0] === S.filtro) || FILTROS[0];
  return d.clientes.filter(c => (ignorar === 'filtro' || f[2](c)) && (!S.cat || c.categoria === S.cat) && (!q || semAcento(c.nome).includes(q) || semAcento(c.etapa).includes(q)));
}
function ordenar(l) {
  return l.slice().sort((a, b) => (RANK[a.status] - RANK[b.status]) || ((a.proximo && a.proximo.em ? a.proximo.em : 8e15) - (b.proximo && b.proximo.em ? b.proximo.em : 8e15)) || ((b.ultimo || 0) - (a.ultimo || 0)));
}
function pintarClientes(d, animar) {
  const ul = $('#fu-lista'), corpo = $('#fu-corpo'), topo = corpo.scrollTop;
  const foco = document.activeElement && document.activeElement.closest && document.activeElement.closest('.fu-cli') ? document.activeElement.closest('.fu-cli').dataset.k : null;
  /* contagem em cada pílula, com os outros filtros aplicados */
  FILTROS.forEach(([k, , fn]) => {
    const n = filtrarContagem(d, fn);
    const b = $(`#fu-filtros [data-f="${k}"] .n`); if (b) b.textContent = int(n);
  });
  const todos = ordenar(filtrar(d)), mostrar = todos.slice(0, S.limite);
  $('#fu-cli-sub').textContent = d.clientes.length ? (todos.length === d.clientes.length ? plural(todos.length, 'conversa', 'conversas') : `${int(todos.length)} de ${int(d.clientes.length)}`) : '';
  if (!todos.length) {
    let t = 'Ainda não há conversas de follow-up para mostrar. Elas aparecem aqui quando o robô chamar alguém de volta.';
    if (d.clientes.length) t = S.busca.trim() ? `Ninguém com “${S.busca.trim()}” neste filtro.` : 'Nenhuma conversa neste filtro agora.';
    ul.replaceChildren(h('li', { class: 'fu-vazio-li' }, h('div', { class: 'vazio' }, ic('caixa'), h('span', { text: t }))));
  } else ul.replaceChildren(...mostrar.map((c, i) => cartaoCli(c, i, animar)));
  const mais = $('#fu-mais'), resta = todos.length - mostrar.length;
  mais.hidden = resta <= 0; mais.textContent = `Mostrar mais (${int(resta)})`;
  corpo.scrollTop = topo; marcarRolagem();
  if (foco) { const el = [...ul.querySelectorAll('.fu-cli')].find(x => x.dataset.k === foco); if (el) { const b = $('.fu-cli-bt', el); if (b) b.focus({ preventScroll: true }); } }
  posPilula();
}
function filtrarContagem(d, fn) {
  const q = semAcento(S.busca.trim());
  return d.clientes.filter(c => fn(c) && (!S.cat || c.categoria === S.cat) && (!q || semAcento(c.nome).includes(q) || semAcento(c.etapa).includes(q))).length;
}
function marcarRolagem() {
  document.querySelectorAll('#fu .corpo').forEach(c => c.classList.toggle('mais-abaixo', c.scrollTop + c.clientHeight < c.scrollHeight - 3));
}
document.querySelectorAll('#fu .corpo').forEach(c => c.addEventListener('scroll', marcarRolagem, { passive: true }));
addEventListener('resize', () => { marcarRolagem(); posPilula(); });

/* Pílula que anda entre os filtros */
function posPilula() {
  const box = $('#fu-filtros'), p = $('.pilula-f', box), b = $('[aria-checked="true"]', box);
  if (!b || !b.offsetWidth) return;
  if (box.scrollWidth > box.clientWidth + 1) { const alvo = b.offsetLeft - (box.clientWidth - b.offsetWidth) / 2; box.scrollTo({ left: Math.max(0, alvo), behavior: REDUZ.matches || !p.classList.contains('pronto') ? 'auto' : 'smooth' }); }
  p.style.width = b.offsetWidth + 'px'; p.style.height = b.offsetHeight + 'px'; p.style.transform = `translate(${b.offsetLeft}px, ${b.offsetTop}px)`;
  if (!p.classList.contains('pronto')) requestAnimationFrame(() => p.classList.add('pronto'));
}
const fimFiltros = () => { const f = $('#fu-filtros'); f.classList.toggle('fim', f.scrollLeft + f.clientWidth >= f.scrollWidth - 2); };
$('#fu-filtros').addEventListener('scroll', fimFiltros, { passive: true });
if ('ResizeObserver' in window) new ResizeObserver(() => { posPilula(); fimFiltros(); }).observe($('#fu-filtros'));
if (document.fonts && document.fonts.ready) document.fonts.ready.then(posPilula);

function chipCategoria() {
  const el = $('#fu-cat-chip');
  el.hidden = !S.cat;
  if (S.cat) el.replaceChildren(h('span', { text: nomeCat(S.cat) }), h('button', { type: 'button', 'aria-label': 'Tirar o filtro de categoria', onclick: () => escolherCat(null) }, ic('x')));
}
function escolherCat(c) {
  S.cat = S.cat === c ? null : c; S.limite = POR_PAGINA;
  document.querySelectorAll('#fu-cats .fu-cat').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.c === S.cat)));
  chipCategoria(); if (S.d) pintarClientes(S.d, false);
}
$('#fu-cats').addEventListener('click', ev => { const b = ev.target.closest('.fu-cat'); if (b) escolherCat(b.dataset.c); });
function escolherFiltro(k, foco) {
  S.filtro = k; S.limite = POR_PAGINA;
  document.querySelectorAll('#fu-filtros [data-f]').forEach(b => { const on = b.dataset.f === k; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; if (on && foco) b.focus(); });
  posPilula(); if (S.d) pintarClientes(S.d, false);
}
$('#fu-filtros').addEventListener('click', ev => { const b = ev.target.closest('[data-f]'); if (b) escolherFiltro(b.dataset.f); });
$('#fu-filtros').addEventListener('keydown', ev => {
  const ks = FILTROS.map(f => f[0]), i = ks.indexOf(S.filtro);
  if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') { ev.preventDefault(); escolherFiltro(ks[(i + 1) % ks.length], true); }
  if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') { ev.preventDefault(); escolherFiltro(ks[(i - 1 + ks.length) % ks.length], true); }
});
let buscaT = 0;
$('#fu-busca').addEventListener('input', ev => {
  clearTimeout(buscaT);
  buscaT = setTimeout(() => { S.busca = ev.target.value || ''; S.limite = POR_PAGINA; if (S.d) pintarClientes(S.d, false); }, 220);
});
$('#fu-mais').addEventListener('click', () => { S.limite += POR_PAGINA; if (S.d) pintarClientes(S.d, false); });

/* ---------- Folha de confirmação (PC: janela que abre do botão; celular: sobe de baixo) ---------- */
const folhaEl = h('div', { class: 'fu-folha', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'fu-folha-t', hidden: true });
const scrimEl = h('div', { class: 'fu-scrim', hidden: true });
document.body.append(scrimEl, folhaEl);
let gatilho = null, fechaT = 0, folhaAberta = false;
const travar = on => ['#app', '#abas', '#fab'].forEach(s => { const el = document.querySelector(s); if (el) el.inert = on; });
function abrirFolha(origem, ...nos) {
  clearTimeout(fechaT); gatilho = origem || document.activeElement;
  folhaEl.replaceChildren(h('div', { class: 'fu-alca', 'aria-hidden': 'true' }), ...nos);
  folhaEl.hidden = scrimEl.hidden = false; folhaAberta = true; travar(true);
  folhaEl.classList.remove('ancorada'); folhaEl.style.left = folhaEl.style.top = folhaEl.style.transformOrigin = '';
  if (origem && origem.getBoundingClientRect && !MOVEL.matches) {
    /* PC: a janela nasce logo abaixo do botão clicado, alinhada à direita dele */
    const o = origem.getBoundingClientRect(), w = folhaEl.offsetWidth;
    folhaEl.classList.add('ancorada');
    const esq = Math.max(12, Math.min(innerWidth - w - 12, o.right - w));
    folhaEl.style.left = `${Math.round(esq)}px`; folhaEl.style.top = `${Math.round(o.bottom + 8)}px`;
    folhaEl.style.transformOrigin = `${Math.round(o.left + o.width / 2 - esq)}px 0`;
  }
  requestAnimationFrame(() => requestAnimationFrame(() => { folhaEl.classList.add('on'); scrimEl.classList.add('on'); }));
  const p = folhaEl.querySelector('button'); if (p) p.focus({ preventScroll: true });
}
function fecharFolha() {
  if (!folhaAberta) return;
  folhaAberta = false; folhaEl.classList.remove('on'); scrimEl.classList.remove('on'); travar(false);
  fechaT = setTimeout(() => { folhaEl.hidden = scrimEl.hidden = true; }, MOVEL.matches ? 230 : 120);
  if (gatilho && gatilho.focus) gatilho.focus({ preventScroll: true });
}
scrimEl.addEventListener('click', fecharFolha);
document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && folhaAberta) fecharFolha(); });

function confirmarRetomar(origem) {
  const R = S.d ? S.d.resumo : {}, n = R.na_fila ?? 0, teto = R.teto || 120;
  const texto = n > 0
    ? `${n === 1 ? 'É 1 na fila' : `São ${int(n)} na fila`}, no máximo ${int(teto)} por dia, entre 9h e 20h.`
    : `Não há ninguém na fila agora. Os envios começam quando alguém entrar, no máximo ${int(teto)} por dia, entre 9h e 20h.`;
  abrirFolha(origem,
    h('h2', { id: 'fu-folha-t', text: 'Liberar os envios do atrasado?' }),
    h('p', { class: 'fu-folha-p', text: texto }),
    h('div', { class: 'fu-folha-botoes' },
      h('button', { type: 'button', class: 'btn principal', onclick: () => { fecharFolha(); executar('retomar', $('#fu-pausa')); }, text: 'Liberar envios' }),
      h('button', { type: 'button', class: 'btn', onclick: fecharFolha, text: 'Agora não' })));
}

/* ---------- Ações ---------- */
const MSG_FALHA = 'Não consegui falar com o robô agora. Confira se o PC está ligado e tente de novo.';
function ocupar(btn, texto, on, icone, original) {
  btn.disabled = on; if (on) btn.setAttribute('aria-busy', 'true'); else btn.removeAttribute('aria-busy');
  if (on) { const sp = ic('gira'); sp.classList.add('gira'); btn.replaceChildren(sp, h('span', { text: texto })); }
  else btn.replaceChildren(ic(icone), h('span', { text: original }));
}
async function executar(tipo, btn) {
  if (S.ocupado) { aviso('O robô ainda está cuidando do pedido anterior.'); return; }
  S.ocupado = tipo;
  const cfg = { mapear: ['Mapeando…', 'atualizar', 'Mapear de novo'], pausar: ['Pausando…', 'pausa', 'Pausar envios'], retomar: ['Liberando…', 'play', 'Retomar envios'] }[tipo];
  ocupar(btn, cfg[0], true);
  try {
    const r = await postar(tipo);
    if (r && r.ok === false) throw new Error(txt(r.motivo || r.erro) || 'falhou');
    if (r && r.enfileirado) aviso('Pedido enviado. O robô aplica assim que o PC pegar.');
    else aviso({ mapear: 'O robô começou a mapear de novo. Os números vão aparecendo aqui.', pausar: 'Envios do atrasado pausados.', retomar: 'Envios do atrasado liberados.' }[tipo]);
  } catch (e) {
    if (e && e.status === 401) { /* a tela principal mostra a sessão expirada */ }
    else if (e && (e.status === 404 || e.status === 501)) aviso('Essa ação ainda está sendo preparada no robô.', true);
    else aviso(MSG_FALHA, true);
  } finally {
    S.ocupado = null; ocupar(btn, '', false, cfg[1], cfg[2]);
    await carregar(true);
    if (tipo === 'mapear') setTimeout(() => carregar(), 8000);
  }
}
$('#fu-mapear').addEventListener('click', ev => executar('mapear', ev.currentTarget));
$('#fu-pausa').addEventListener('click', ev => {
  if (S.ocupado) return;
  if (S.d && S.d.resumo.pausado) confirmarRetomar(ev.currentTarget); else executar('pausar', ev.currentTarget);
});

/* ---------- Orquestração ---------- */
function assinatura(o) { try { return JSON.stringify(o); } catch { return String(Math.random()); } }
function so(chave, valor, fn) { const s = assinatura(valor); if (S.sig[chave] === s) return; S.sig[chave] = s; fn(); }
function mostrarGeral(titulo, detalhe) {
  $('#fu-geral').hidden = false; $('#fu-conteudo').hidden = true;
  $('#fu-geral-t').textContent = titulo; $('#fu-geral-d').textContent = detalhe || '';
}
function aplicar(d, animar) {
  $('#fu-geral').hidden = true; $('#fu-conteudo').hidden = false;
  const minuto = Math.floor(Date.now() / 60000);
  so('faixa', [d.resumo, d.gerado, minuto], () => pintarFaixa(d));
  so('deg', [d.degraus, d.resumo.enviadas, d.resumo.responderam, d.resumo.fecharam, d.resumo.total], () => pintarDegraus(d));
  so('cats', [d.por_categoria, S.cat], () => pintarCats(d));
  so('cli', [d.clientes, S.filtro, S.busca, S.cat, S.limite, minuto], () => pintarClientes(d, animar));
  chipCategoria();
  marcarRolagem();
}
let busca = 0, primeira = true;
async function carregar(forcar) {
  if (!ver() && !forcar) return;
  const minha = ++busca;
  try {
    const bruto = await buscarDados();
    if (minha !== busca) return;
    S.erro = null; $('#fu-aviso').hidden = true;
    S.d = normalizar(bruto);
    aplicar(S.d, primeira); primeira = false;
  } catch (e) {
    if (minha !== busca) return;
    if (e && e.status === 401) return;
    if (e && (e.status === 404 || e.status === 501)) { S.erro = 'prep'; S.d = null; S.sig = {}; mostrarGeral('Os follow-ups ainda estão sendo preparados.', 'Quando o robô terminar o mapa, tudo aparece aqui.'); return; }
    S.erro = 'rede';
    if (S.d) $('#fu-aviso').hidden = false; else mostrarGeral('Não consegui carregar os follow-ups agora.', 'Tentando de novo em instantes.');
  }
}

/* Visibilidade: a área só busca dados quando está na tela */
function ver() { return MOVEL.matches ? appEl.dataset.aba === 'follow' : appEl.dataset.vista === 'followups'; }
function replay() {
  raiz.classList.remove('fu-ok'); void raiz.offsetWidth;
  raiz.querySelectorAll('[data-conta]').forEach(el => { el._v = null; });
  requestAnimationFrame(() => { raiz.classList.add('fu-ok'); posPilula(); marcarRolagem(); });
}
function checar() {
  const v = ver();
  if (v && !S.vis) { S.vis = true; replay(); S.sig = {}; if (S.d) aplicar(S.d, true); carregar(); }
  else if (!v) S.vis = false;
}
new MutationObserver(checar).observe(appEl, { attributes: true, attributeFilter: ['data-vista', 'data-aba'] });
MOVEL.addEventListener('change', checar);
const seletor = document.getElementById('seletor');
if (seletor) ['click', 'keydown'].forEach(ev => seletor.addEventListener(ev, () => setTimeout(() => { if (ver()) { S.sig = {}; carregar(); } }, 0)));
setInterval(() => { if (!document.hidden && ver()) carregar(); }, ATUALIZA_MS);
document.addEventListener('visibilitychange', () => { if (!document.hidden && ver()) carregar(); });
checar();
})();
