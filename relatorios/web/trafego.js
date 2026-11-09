/* Aba Tráfego (09/11/2026): do lead que chegou até o painel fechado. Fonte: GET /api/trafego?dias=1|7|30 (trafego-lib.mjs).
   Autônoma: não depende do funil.js. Prefixo tf-. Só mostra o que o robô mediu; o que falta medir aparece escrito no rodapé da tela.
   Aparece: no PC, na vista "Tráfego"; no celular, na aba Funil (opção Tráfego) ou na aba própria data-aba="trafego" (versão da nuvem). */
(() => {
'use strict';
const raiz = document.getElementById('tf'), appEl = document.getElementById('app');
if (!raiz || !appEl) return;
const MOVEL = matchMedia('(max-width: 820px), (max-height: 500px) and (pointer: coarse)');
const REDUZ = matchMedia('(prefers-reduced-motion: reduce)');
const ATUALIZA_MS = 60000;

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
  funil: 'M4 5h16l-6 7.5V19l-4 1.5v-8Z', usuarios: 'M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19M10 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM20 19v-1.5a3.5 3.5 0 0 0-2.5-3.35M15.5 5.2a3 3 0 0 1 0 5.6',
  relogio: 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', alvo: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', ok: 'M5 12.5 10 17.5 19 7',
  alerta: 'M12 8v5M12 16.5v.01M10.3 4.2 2.8 17.2A2 2 0 0 0 4.5 20h15a2 2 0 0 0 1.7-2.8L13.7 4.2a2 2 0 0 0-3.4 0Z', fala: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3ZM5 11a7 7 0 0 0 14 0M12 18v3',
  chat: 'M20 12a8 8 0 0 1-11.5 7.2L4 20l1-4.2A8 8 0 1 1 20 12Z',
};
function ic(nome) {
  const s = document.createElementNS(NS, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '1.8'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(NS, 'path'); p.setAttribute('d', ICONES[nome] || ICONES.alvo); s.append(p); return s;
}
const int = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString('pt-BR') : '0');
const pct = (x) => (x == null || !Number.isFinite(x) ? '—' : `${Math.round(x * 100)}%`);
const dec = (n) => (n == null ? '—' : n.toLocaleString('pt-BR', { maximumFractionDigits: 1 }));
const plural = (n, a, b) => (n === 1 ? a : b);
function duracao(horas) {
  if (horas == null) return { v: '—', u: '' };
  if (horas < 1) return { v: String(Math.max(1, Math.round(horas * 60))), u: 'min' };
  if (horas < 48) return { v: dec(horas), u: 'h' };
  return { v: dec(horas / 24), u: 'dias' };
}
const diaCurto = (k) => { const [, m, d] = k.split('-'); return `${d}/${m}`; };
const diaSemana = (k) => { const [a, m, d] = k.split('-').map(Number); return new Date(a, m - 1, d).toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', ''); };
const quando = (iso) => { const d = new Date(iso); return Number.isFinite(+d) ? d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : ''; };

/* ---------- Estado ---------- */
const S = { dias: 7, d: null, sig: '', vis: false, erro: false, carregando: false };
try { const v = Number(localStorage.getItem('tf-dias')); if ([1, 7, 30].includes(v)) S.dias = v; } catch {}

/* ---------- Esqueleto fixo da tela ---------- */
const seg = h('div', { class: 'seletor tf-seg', role: 'radiogroup', 'aria-label': 'Período do tráfego', 'data-pos': '0' },
  h('span', { class: 'pilula', 'aria-hidden': 'true' }),
  ...[[1, 'Hoje'], [7, '7 dias'], [30, '30 dias']].map(([n, t]) => h('button', { type: 'button', role: 'radio', 'aria-checked': 'false', 'data-dias': String(n), tabindex: '-1', text: t })));
const sub = h('p', { class: 'tf-sub', text: 'Do anúncio ao painel fechado' });
const avisoEl = h('div', { class: 'tf-aviso', role: 'status', hidden: true }, ic('alerta'), h('span'));
const cKpis = h('div', { class: 'tf-kpis' });
const cFunil = h('article', { class: 'cartao tf-card tf-funil' });
const cDia = h('article', { class: 'cartao tf-card tf-dia' });
const cHora = h('article', { class: 'cartao tf-card tf-hora' });
const cOrigem = h('article', { class: 'cartao tf-card tf-origem' });
const cVoz = h('article', { class: 'cartao tf-card tf-voz' });
const cLimites = h('footer', { class: 'tf-limites' });
raiz.append(
  h('header', { class: 'tf-topo' }, h('div', { class: 'tf-titulo' }, h('h2', { text: 'Tráfego' }), sub), seg),
  avisoEl, cKpis, h('div', { class: 'tf-grade' }, cFunil, cDia, cHora, cOrigem, cVoz), cLimites);

function pintarSeg() {
  seg.dataset.pos = String([1, 7, 30].indexOf(S.dias));
  seg.querySelectorAll('button').forEach((b) => { const on = Number(b.dataset.dias) === S.dias; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; });
}
function mudarDias(n) {
  if (n === S.dias) return;
  S.dias = n; try { localStorage.setItem('tf-dias', String(n)); } catch {}
  pintarSeg(); S.sig = ''; carregar();
}
seg.addEventListener('click', (ev) => { const b = ev.target.closest('button[data-dias]'); if (b) mudarDias(Number(b.dataset.dias)); });
seg.addEventListener('keydown', (ev) => {
  if (!['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'].includes(ev.key)) return;
  ev.preventDefault(); const o = [1, 7, 30], i = o.indexOf(S.dias), p = ev.key === 'ArrowRight' || ev.key === 'ArrowDown' ? 1 : -1;
  mudarDias(o[(i + p + 3) % 3]); seg.querySelector('[aria-checked="true"]').focus();
});
pintarSeg();

/* ---------- Peças ---------- */
function cabecalho(card, titulo, subt) { card.replaceChildren(h('header', null, h('h2', { text: titulo }), subt ? h('span', { class: 'sub', text: subt }) : null)); }
function corpo(card, ...filhos) { const c = h('div', { class: 'corpo fixo' }, ...filhos); card.append(c); return c; }
function kpi(i, icone, rotulo, valor, unidade, nota, cls) {
  return h('div', { class: 'tf-kpi ' + (cls || ''), style: `--i:${i}` },
    h('span', { class: 'tf-kpi-r' }, ic(icone), rotulo),
    h('span', { class: 'tf-kpi-v' }, h('b', { text: valor }), unidade ? h('small', { text: unidade }) : null),
    h('span', { class: 'tf-kpi-n', text: nota }));
}
function vazio(icone, t, d) { return h('div', { class: 'tf-vazio' }, ic(icone), h('b', { text: t }), d ? h('span', { text: d }) : null); }

/* ---------- Pintura ---------- */
/* Percentual: uma função só (pct), sempre sobre a razão sem arredondar antes. Perda: só onde a conta fecha (quem não respondeu). */
function degrauNota(d, e, i) {
  if (!i) return 'entrada';
  const base = `${pct(e.qtd / d.funil[i - 1].qtd)} do degrau anterior`;
  if (i === 1) { const f = d.funil[0].qtd - e.qtd; return f > 0 ? `${base} · ${int(f)} ${plural(f, 'não respondeu', 'não responderam')}` : base; }
  const s = d.fecharam_sem_responder || 0;
  return s > 0 ? `${base} · ${int(s)} ${plural(s, 'fechou', 'fecharam')} sem responder ao robô` : base;
}
function pintar(d) {
  const n = d.leads, dur = duracao(d.tempo_ate_painel_h && (d.tempo_ate_painel_h.mediana ?? d.tempo_ate_painel_h.media));
  const desde = d.cobertura_desde ? quando(d.cobertura_desde) : '';
  sub.textContent = desde ? `Do anúncio ao painel fechado · medido pelo robô desde ${desde}` : 'Do anúncio ao painel fechado';

  cKpis.replaceChildren(
    kpi(0, 'usuarios', 'Leads que chegaram', int(n), '', S.dias === 1 ? 'hoje' : `nos últimos ${S.dias} dias`),
    kpi(1, 'ok', 'Painéis fechados', int(d.paineis_dos_leads), '', d.paineis_no_periodo > d.paineis_dos_leads ? `de leads novos · ${int(d.paineis_no_periodo)} no total` : 'de leads novos', 'ok'),
    kpi(2, 'alvo', 'Painéis a cada 100 leads', n ? dec(d.paineis_por_100_leads) : '—', '', n ? `${int(d.passou_ao_senhor)} ${plural(d.passou_ao_senhor, 'conversa passou', 'conversas passaram')} ao senhor` : 'ainda sem leads', 'ciano'),
    kpi(3, 'relogio', 'Do lead ao painel', dur.v, dur.u, d.tempo_ate_painel_h && d.tempo_ate_painel_h.amostra ? `tempo típico · ${int(d.tempo_ate_painel_h.amostra)} ${plural(d.tempo_ate_painel_h.amostra, 'painel', 'painéis')}` : 'ainda sem painel fechado'));

  /* Funil */
  cabecalho(cFunil, 'Do lead ao painel', n ? `${int(n)} ${plural(n, 'lead', 'leads')}` : '');
  if (!n) corpo(cFunil, vazio('funil', 'Nenhum lead neste período', 'Quando chegar a primeira conversa do anúncio, o funil aparece aqui.'));
  else {
    const cores = ['c0', 'c1', 'c2'];
    const degraus = d.funil.map((e, i) => h('li', { class: 'tf-deg ' + cores[i], style: `--i:${i}` },
      h('div', { class: 'tf-deg-t' }, h('span', { class: 'tf-deg-n', text: e.etapa }), h('span', { class: 'tf-deg-p', text: degrauNota(d, e, i) })),
      h('div', { class: 'tf-barra', role: 'img', 'aria-label': `${e.etapa}: ${e.qtd} de ${n}` }, h('i', { style: `--w:${Math.max(n ? e.qtd / n : 0, e.qtd ? 0.06 : 0)}` }), h('b', { text: int(e.qtd) })),
      null));
    const t = d.teste_gratis || { leads: 0, fecharam: 0 };
    corpo(cFunil, h('ol', { class: 'tf-degraus' }, ...degraus),
      h('p', { class: 'tf-nota' }, ic('chat'), h('span', { text: `Teste grátis é um desvio: ${int(t.leads)} ${plural(t.leads, 'lead pegou', 'leads pegaram')}${t.leads ? `, ${int(t.fecharam)} ${plural(t.fecharam, 'fechou', 'fecharam')} painel` : ''}. Muita gente fecha painel sem pedir teste.` })));
  }

  /* Chegada por dia */
  cabecalho(cDia, S.dias === 1 ? 'Hoje' : 'Chegada por dia', '');
  /* Dias antes do primeiro registro do robô: no 7 dias ficam cinza ("sem medição"); no 30 dias o eixo começa no primeiro dia medido. */
  let dias = d.por_dia;
  if (dias.length > 8) dias = dias.filter((x) => x.medido !== false);
  const semMed = dias.some((x) => x.medido === false);
  const maxD = Math.max(1, ...dias.map((x) => Math.max(x.leads || 0, x.paineis || 0)));
  const mostrarNum = dias.length <= 8, fino = dias.length > 14, ult = dias.length - 1;
  const rotulo = (x, i) => {
    if (!fino) return dias.length <= 8 ? (S.dias === 1 ? 'hoje' : diaSemana(x.dia)) : diaCurto(x.dia);
    return i === ult || (i % 7 === 0 && ult - i >= 4) ? diaCurto(x.dia) : '';   /* o penúltimo some quando colidiria com o último */
  };
  const grupos = dias.map((x, i) => {
    const nm = x.medido === false, r = rotulo(x, i);
    return h('li', { class: 'tf-dia-g' + (nm ? ' nm' : ''), style: `--i:${i}`, title: nm ? `${diaCurto(x.dia)}: sem medição (o robô ainda não registrava)` : `${diaCurto(x.dia)}: ${x.leads} leads, ${x.paineis} painéis` },
      h('div', { class: 'tf-dia-b' },
        h('span', { class: 'tf-col l', style: `--h:${nm ? 0 : x.leads / maxD}` }, mostrarNum && !nm ? h('b', { text: x.leads ? int(x.leads) : '' }) : null),
        h('span', { class: 'tf-col p', style: `--h:${nm ? 0 : x.paineis / maxD}` }, mostrarNum && !nm ? h('b', { text: x.paineis ? int(x.paineis) : '' }) : null)),
      h('span', { class: 'tf-dia-r' }, r ? h('em', { text: r }) : null));
  });
  corpo(cDia, h('ul', { class: 'tf-dias' + (fino ? ' fino' : '') }, ...grupos),
    h('p', { class: 'tf-leg' }, h('span', { class: 'l', text: 'Leads novos' }), h('span', { class: 'p', text: 'Painéis fechados no dia' }), semMed ? h('span', { class: 'n', text: 'Sem medição' }) : null));

  /* Horário */
  const pico = d.por_hora.reduce((a, b) => (b.leads > a.leads ? b : a), { hora: 0, leads: 0 }), maxH = Math.max(1, pico.leads);
  cabecalho(cHora, 'Horário de chegada', pico.leads ? `pico às ${pico.hora}h` : '');
  if (!n) corpo(cHora, vazio('relogio', 'Sem leads neste período'));
  else corpo(cHora, h('ul', { class: 'tf-horas', 'aria-label': 'Leads por hora do dia' }, ...d.por_hora.map((x) => h('li', { class: x.hora === pico.hora && x.leads ? 'tf-pico' : '', title: `${x.hora}h: ${x.leads} ${plural(x.leads, 'lead', 'leads')}`, style: `--h:${x.leads / maxH};--i:${x.hora}` }, h('i')))),
    h('div', { class: 'tf-horas-r', 'aria-hidden': 'true' }, ...[0, 6, 12, 18, 23].map((x) => h('span', { text: `${x}h` }))));

  /* Origem */
  cabecalho(cOrigem, 'Origem do lead', d.origem_medida.com ? `${int(d.origem_medida.com)} de ${int(n)} com origem` : '');
  if (!n) corpo(cOrigem, vazio('funil', 'Sem leads neste período'));
  else {
    const maxO = Math.max(1, ...d.por_origem.map((o) => o.leads));
    corpo(cOrigem, h('ul', { class: 'tf-orig' }, ...d.por_origem.map((o, i) => h('li', { class: o.origem === 'sem_registro' ? 'sem' : '', style: `--i:${i}` },
      h('div', { class: 'tf-orig-t' }, h('span', { text: o.rotulo }), h('b', { text: `${int(o.leads)} ${plural(o.leads, 'lead', 'leads')}` })),
      h('div', { class: 'tf-orig-b' }, h('i', { style: `--w:${o.leads / maxO}` })),
      h('span', { class: 'tf-orig-f', text: o.leads ? `${int(o.paineis)} ${plural(o.paineis, 'fechou', 'fecharam')} painel · ${pct(o.paineis / o.leads)}` : 'nenhum lead com essa origem ainda' })))),
    d.origem_medida.com === 0 ? h('p', { class: 'tf-nota' }, ic('alerta'), h('span', { text: 'O robô começou a gravar Facebook ou Instagram agora. Os próximos leads já chegam com origem.' })) : null);
  }

  /* Voz x texto */
  const av = d.audio_x_texto;
  cabecalho(cVoz, 'Voz x texto na 1ª resposta', '');
  const temAB = av.grupos.some((g) => g.leads > 0);
  if (!temAB) corpo(cVoz, vazio('fala', 'Ainda sem comparação', 'Sem leads deste período com o canal da 1ª resposta gravado.'));
  else corpo(cVoz, h('div', { class: 'tf-ab' }, ...av.grupos.map((g, i) => {
    const sem = !g.leads;
    return h('div', { class: 'tf-ab-g ' + g.canal + (sem ? ' sem' : ''), style: `--i:${i}` },
      h('span', { class: 'tf-ab-r' }, ic(g.canal === 'audio' ? 'fala' : 'chat'), g.canal === 'audio' ? 'Áudio' : 'Texto'),
      h('b', { class: 'tf-ab-v', text: sem ? '—' : pct(g.paineis / g.leads) }),
      h('span', { class: 'tf-ab-n', text: sem ? `sem leads por ${g.canal === 'audio' ? 'áudio' : 'texto'}` : `${int(g.paineis)} de ${int(g.leads)} fecharam painel` }),
      h('div', { class: 'tf-ab-bar', 'aria-hidden': 'true' }, h('i', { style: `--w:${sem ? 0 : g.paineis / g.leads}` })),
      h('span', { class: 'tf-ab-n', text: sem ? '' : `${pct(g.responderam / g.leads)} responderam (${int(g.responderam)} de ${int(g.leads)})` }),
      h('div', { class: 'tf-ab-bar r', 'aria-hidden': 'true' }, h('i', { style: `--w:${sem ? 0 : g.responderam / g.leads}` })));
  })),
    h('p', { class: 'tf-nota' }, ic(av.amostra_suficiente ? 'ok' : 'alerta'), h('span', { text: av.amostra_suficiente ? 'Amostra suficiente para comparar.' : `Poucos leads: o mínimo é ${av.minimo} de cada lado. Por enquanto é indício, não conclusão.` })));

  /* Limites: o que não foi medido */
  cLimites.replaceChildren(h('b', { text: 'O que este painel não mede' }), h('ul', null, ...d.limites.map((t) => h('li', { text: t }))));
}

function aviso(txt, aviso = true) { avisoEl.hidden = !txt; avisoEl.querySelector('span').textContent = txt || ''; avisoEl.classList.toggle('erro', aviso); }
function esqueleto() { if (cKpis.childElementCount) return; cKpis.replaceChildren(...[0, 1, 2, 3].map(() => h('div', { class: 'tf-kpi tf-sk' }, h('span', { class: 'sk-l' }), h('span', { class: 'sk-l g' })))); }
async function carregar() {
  if (S.carregando) return; S.carregando = true;
  if (!S.d) esqueleto();
  try {
    const r = await fetch('/api/trafego?dias=' + S.dias, { cache: 'no-store', credentials: 'same-origin' });
    if (r.status === 401) { location.href = '/login'; return; }
    if (r.status === 503) { const j = await r.json().catch(() => ({})); aviso('A nuvem ainda não recebeu os dados do PC. Assim que o robô enviar, o tráfego aparece aqui.'); if (!S.d) cKpis.replaceChildren(); S.erro = true; return; }
    if (!r.ok) throw new Error(String(r.status));
    const d = await r.json();
    S.erro = false; S.d = d;
    if (d.nuvem && d.desatualizado && d.idade_s != null) aviso(`O PC do robô não envia dados há ${Math.max(5, Math.round(d.idade_s / 60))} min. Os números podem estar atrasados.`);
    else aviso('');
    const sig = JSON.stringify([S.dias, { ...d, gerado_em: 0, snapshot_em: 0, idade_s: 0 }]);
    if (sig !== S.sig) { S.sig = sig; pintar(d); replay(); }
  } catch (e) {
    S.erro = true;
    aviso(S.d ? 'Sem conexão com o robô agora. Mostrando a última leitura; tento de novo em um minuto.' : 'Não consegui carregar o tráfego agora. Confira se o PC do robô está ligado. Tento de novo em um minuto.');
  } finally { S.carregando = false; raiz.removeAttribute('aria-busy'); }
}
function replay() { raiz.classList.remove('tf-ok'); void raiz.offsetWidth; requestAnimationFrame(() => raiz.classList.add('tf-ok')); }

/* ---------- Visibilidade ---------- */
function ver() {
  if (MOVEL.matches) return (appEl.dataset.aba === 'funil' && appEl.dataset.fj === 'trafego') || appEl.dataset.aba === 'trafego';
  return appEl.dataset.vista === 'trafego';
}
function checar() {
  const v = ver();
  if (v && !S.vis) { S.vis = true; S.sig = ''; carregar(); if (S.d) { pintar(S.d); replay(); } }
  else if (!v) S.vis = false;
}
new MutationObserver(checar).observe(appEl, { attributes: true, attributeFilter: ['data-vista', 'data-aba', 'data-fj'] });
MOVEL.addEventListener('change', checar);
setInterval(() => { if (!document.hidden && ver()) carregar(); }, ATUALIZA_MS);
document.addEventListener('visibilitychange', () => { if (!document.hidden && ver()) carregar(); });
checar();
})();
