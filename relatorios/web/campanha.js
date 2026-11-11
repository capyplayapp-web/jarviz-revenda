/* Vista Campanha (10/11/2026, pedido do senhor): contador desde o início da campanha (06/11) e projeção de painéis até o fim do ciclo.
   Fonte: GET /api/campanha (campanha-lib.mjs); POST /api/campanha {meta}. Autônoma, prefixo cp-. Só no PC (vista "Campanha").
   Regra de honestidade: a projeção sempre aparece com a faixa e com quantos dias de dado a sustentam. */
(() => {
'use strict';
const raiz = document.getElementById('cp'), appEl = document.getElementById('app');
if (!raiz || !appEl) return;
const REDUZ = matchMedia('(prefers-reduced-motion: reduce)');
const MOVEL = matchMedia('(max-width: 820px), (max-height: 500px) and (pointer: coarse)');
const ATUALIZA_MS = 60000;
const BASE = location.protocol === 'file:' ? 'http://127.0.0.1:8811' : '';

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
function s(tag, attrs, ...filhos) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) el.setAttribute(k, v);
  for (const f of filhos) if (f != null) el.append(f.nodeType ? f : document.createTextNode(String(f)));
  return el;
}
const ICONES = {
  calendario: 'M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1ZM4 10h16M8 3v4M16 3v4',
  ok: 'M5 12.5 10 17.5 19 7', sol: 'M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  ritmo: 'M3 12h4l3-7 4 14 3-7h4', venda: 'M4 16l5-5 4 4 7-7M15 8h5v5', alvo: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM12 12h.01',
  usuarios: 'M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19M10 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM20 19v-1.5a3.5 3.5 0 0 0-2.5-3.35M15.5 5.2a3 3 0 0 1 0 5.6',
  alerta: 'M12 8v5M12 16.5v.01M10.3 4.2 2.8 17.2A2 2 0 0 0 4.5 20h15a2 2 0 0 0 1.7-2.8L13.7 4.2a2 2 0 0 0-3.4 0Z', lapis: 'M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4',
};
function ic(nome) {
  const el = s('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
  el.append(s('path', { d: ICONES[nome] || ICONES.alvo })); return el;
}
const int = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString('pt-BR') : '—');
const dec = (n) => (Number.isFinite(n) ? n.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : '—');
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');
const plural = (n, a, b) => (n === 1 ? a : b);
const dm = (k) => { const [, m, d] = String(k).slice(0, 10).split('-'); return `${d}/${m}`; };
const semana = (k) => { const [a, m, d] = k.split('-').map(Number); return new Date(a, m - 1, d).toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', ''); };

/* ---------- Estado ---------- */
const S = { d: null, sig: '', vis: false, carregando: false, editando: false, salvando: false };

/* ---------- Esqueleto fixo ---------- */
const sub = h('p', { class: 'cp-sub', text: 'Do início da campanha ao fim do ciclo' });
const btnMeta = h('button', { type: 'button', class: 'btn', onclick: () => abrirMeta() }, ic('alvo'), h('span', { text: 'Definir meta' }));
const avisoEl = h('div', { class: 'cp-aviso', role: 'status', hidden: true }, ic('alerta'), h('span'));
const cContador = h('section', { class: 'cp-cont', 'aria-label': 'Contador da campanha' });
const cProj = h('section', { class: 'cp-proj', 'aria-label': 'Projeção de painéis' });
const cKpis = h('div', { class: 'cp-kpis' });
const cCurva = h('article', { class: 'cartao cp-card cp-curva' });
const cCen = h('article', { class: 'cartao cp-card cp-cen' });
const cDia = h('article', { class: 'cartao cp-card cp-dia' });
const cAntes = h('article', { class: 'cartao cp-card cp-antes' });
const cMeta = h('article', { class: 'cartao cp-card cp-meta' });
const cLimites = h('footer', { class: 'cp-limites' });
raiz.append(
  h('header', { class: 'cp-topo' }, h('div', { class: 'cp-titulo' }, h('h2', { text: 'Campanha' }), sub), h('div', { class: 'cp-acoes' }, btnMeta)),
  avisoEl,
  h('div', { class: 'cp-hero' }, cContador, cProj),
  cKpis,
  h('div', { class: 'cp-grade' }, cCurva, cCen, cDia, cAntes, cMeta),
  cLimites);

/* ---------- Peças ---------- */
function cabecalho(card, titulo, subt) { card.replaceChildren(h('header', null, h('h2', { text: titulo }), subt ? h('span', { class: 'sub', text: subt }) : null)); }
function corpo(card, ...filhos) { const c = h('div', { class: 'corpo fixo' }, ...filhos); card.append(c); return c; }
function kpi(i, icone, rotulo, valor, unidade, nota, cls) {
  return h('div', { class: 'cp-kpi ' + (cls || ''), style: `--i:${i}` },
    h('span', { class: 'cp-kpi-r' }, ic(icone), rotulo),
    h('span', { class: 'cp-kpi-v' }, h('b', { text: valor }), unidade ? h('small', { text: unidade }) : null),
    h('span', { class: 'cp-kpi-n', text: nota }));
}

/* ---------- Contador: dia N de 30, uma célula por dia ---------- */
function pintarContador(d) {
  const c = d.contador, cfg = d.config;
  const porDia = new Map(d.dias.map((x) => [x.dia, x]));
  const maxP = Math.max(1, ...d.dias.map((x) => x.paineis));
  const celulas = d.curva.map((x, i) => {
    const dd = porDia.get(x.dia), passado = dd && !dd.hoje, hoje = dd && dd.hoje;
    const cls = 'cp-cel' + (passado ? ' feito' : '') + (hoje ? ' hoje' : '') + (!dd ? ' falta' : '') + (x.dia === cfg.marco ? ' marco' : '');
    const t = dd ? `${dm(x.dia)} (${semana(x.dia)}), dia ${i + 1}: ${dd.paineis} ${plural(dd.paineis, 'painel', 'painéis')}${hoje ? ' até agora' : ''}` : `${dm(x.dia)}, dia ${i + 1}: ainda não chegou`;
    return h('li', { class: cls, title: t, style: `--i:${i};--a:${dd ? Math.max(.16, dd.paineis / maxP) : 0}` }, h('i'));
  });
  const marcoI = cfg.marco ? d.curva.findIndex((x) => x.dia === cfg.marco) : -1;
  cContador.replaceChildren(
    h('div', { class: 'cp-cont-t' },
      h('span', { class: 'cp-rot' }, ic('calendario'), cfg.nome || 'Campanha'),
      h('p', { class: 'cp-dia-n' }, h('span', { text: 'Dia' }), h('b', { text: int(c.dia) }), h('span', { text: `de ${int(c.total_dias)}` })),
      h('span', { class: 'cp-cont-n', text: c.restam ? `${int(c.restam)} ${plural(c.restam, 'dia restante', 'dias restantes')} depois de hoje · ciclo fecha em ${dm(cfg.fim)}` : `último dia do ciclo (${dm(cfg.fim)})` })),
    h('div', { class: 'cp-fita-w' },
      h('ol', { class: 'cp-fita', role: 'img', 'aria-label': `Dia ${c.dia} de ${c.total_dias} da campanha` }, ...celulas),
      h('div', { class: 'cp-fita-r', 'aria-hidden': 'true' },
        h('span', { text: dm(cfg.inicio) }),
        marcoI > 0 ? h('span', { class: 'm', style: `--x:${(marcoI + .5) / d.curva.length}` }, dm(cfg.marco), h('em', { text: ' fim do mês' })) : null,
        h('span', { class: 'f', text: dm(cfg.fim) }))));
}

/* ---------- Projeção ---------- */
function pintarProj(d) {
  const p = d.projecao, m = d.projecao_marco, cfg = d.config;
  if (p.provavel == null) {
    cProj.replaceChildren(h('span', { class: 'cp-rot' }, ic('ritmo'), 'Projeção'), h('p', { class: 'cp-proj-vazio', text: 'A projeção aparece depois do primeiro dia completo de campanha.' }));
    return;
  }
  cProj.replaceChildren(
    h('span', { class: 'cp-rot' }, ic('ritmo'), `Provável até ${dm(cfg.fim)}`),
    h('p', { class: 'cp-proj-v' }, h('b', { text: int(p.provavel) }), h('span', { text: 'painéis' })),
    h('p', { class: 'cp-proj-f' }, `entre ${int(p.faixa[0])} e ${int(p.faixa[1])}`, h('small', { text: ' · faixa de 80%' })),
    m && m.provavel != null ? h('p', { class: 'cp-proj-m' }, h('span', { text: `Até ${dm(m.data)} (fim do mês)` }), h('b', { text: int(m.provavel) }), h('small', { text: `${int(m.faixa[0])} a ${int(m.faixa[1])}` })) : null);
}

/* ---------- Curva acumulada (real + projeção com faixa + meta) ---------- */
let roCurva = null;
function pintarCurva(d) {
  cabecalho(cCurva, 'Painéis acumulados', d.projecao.faixa ? `faixa ${int(d.projecao.faixa[0])} a ${int(d.projecao.faixa[1])} até ${dm(d.config.fim)}` : '');
  const area = h('div', { class: 'cp-graf' });
  const leg = h('p', { class: 'cp-leg' }, h('span', { class: 'r', text: 'Fechados' }), h('span', { class: 'p', text: 'Projeção provável' }), h('span', { class: 'f', text: 'Faixa de 80%' }), d.meta ? h('span', { class: 'mt', text: `Meta ${int(d.meta.alvo)}` }) : null);
  corpo(cCurva, area, leg);
  const desenhar = () => desenharCurva(area, d);
  if (roCurva) roCurva.disconnect();
  roCurva = new ResizeObserver(() => desenhar()); roCurva.observe(area);
}
function desenharCurva(area, d) {
  const W = area.clientWidth, H = area.clientHeight; if (W < 50 || H < 50) return;
  const pad = { l: 52, r: 16, t: 16, b: 28 };
  const c = d.curva, n = c.length;
  const topo = Math.max(10, ...c.map((x) => Math.max(x.real || 0, x.hi || 0, x.proj || 0)), d.meta ? d.meta.alvo : 0);
  const passo = topo <= 50 ? 10 : topo <= 200 ? 50 : topo <= 600 ? 100 : topo <= 1500 ? 250 : 500;
  const yMax = Math.ceil(topo / passo) * passo;
  const X = (i) => pad.l + (i / Math.max(1, n - 1)) * (W - pad.l - pad.r);
  const Y = (v) => pad.t + (1 - v / yMax) * (H - pad.t - pad.b);
  const svg = s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Painéis acumulados: ${d.total} até agora; projeção provável ${d.projecao.provavel ?? '—'} até ${dm(d.config.fim)}` });

  // grade horizontal
  for (let v = 0; v <= yMax; v += passo) {
    svg.append(s('line', { x1: pad.l, x2: W - pad.r, y1: Y(v), y2: Y(v), class: 'cp-g' }));
    svg.append(s('text', { x: pad.l - 8, y: Y(v) + 4, 'text-anchor': 'end', class: 'cp-ax' }, int(v)));
  }
  // marcas de dia: início, cada 7 dias, marco e fim
  const marcoI = c.findIndex((x) => x.dia === d.config.marco);
  c.forEach((x, i) => {
    const largo = W >= 560, perto = Math.abs(X(n - 1) - X(marcoI)) < 64;   /* tela estreita: só início, fim do mês e fim; datas que encostam somem */
    const mostra = i === 0 || i === n - 1 || (i === marcoI && !(perto && !largo)) || (largo && i % 7 === 0 && Math.abs(i - marcoI) > 2 && n - 1 - i > 2);
    if (!mostra) return;
    svg.append(s('text', { x: X(i), y: H - 6, 'text-anchor': i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle', class: 'cp-ax' + (i === marcoI ? ' m' : '') }, dm(x.dia)));
  });
  if (marcoI > 0) svg.append(s('line', { x1: X(marcoI), x2: X(marcoI), y1: pad.t, y2: H - pad.b, class: 'cp-marco' }));
  // meta
  if (d.meta) {
    svg.append(s('line', { x1: pad.l, x2: W - pad.r, y1: Y(d.meta.alvo), y2: Y(d.meta.alvo), class: 'cp-meta-l' }));
    svg.append(s('text', { x: pad.l + 8, y: Y(d.meta.alvo) - 7, 'text-anchor': 'start', class: 'cp-meta-t' }, `meta ${int(d.meta.alvo)}`));
  }
  // faixa
  const ultReal = c.reduce((a, x, i) => (x.real != null ? i : a), -1);
  const fx = c.map((x, i) => ({ i, lo: x.lo, hi: x.hi })).filter((x) => x.lo != null && x.i > ultReal);
  if (fx.length && ultReal >= 0) {
    const base = { i: ultReal, v: c[ultReal].real };
    const topoF = [`${X(base.i)},${Y(base.v)}`, ...fx.map((x) => `${X(x.i)},${Y(x.hi)}`)];
    const baixoF = fx.slice().reverse().map((x) => `${X(x.i)},${Y(x.lo)}`);
    svg.append(s('polygon', { points: [...topoF, ...baixoF].join(' '), class: 'cp-faixa' }));
  }
  // projeção (tracejada) a partir do último ponto real
  const pp = c.map((x, i) => ({ i, v: x.proj })).filter((x) => x.v != null && x.i > ultReal);
  if (pp.length && ultReal >= 0) {
    const pts = [{ i: ultReal, v: c[ultReal].real }, ...pp];
    svg.append(s('polyline', { points: pts.map((x) => `${X(x.i)},${Y(x.v)}`).join(' '), class: 'cp-proj-l' }));
    const fim = pts[pts.length - 1];
    svg.append(s('circle', { cx: X(fim.i), cy: Y(fim.v), r: 4, class: 'cp-proj-p' }));
    svg.append(s('text', { x: X(fim.i) - 8, y: Y(fim.v) - 10, 'text-anchor': 'end', class: 'cp-proj-t' }, `≈ ${int(fim.v)}`));
  }
  // real (área + linha)
  const rr = c.map((x, i) => ({ i, v: x.real })).filter((x) => x.v != null);
  if (rr.length) {
    const linha = rr.map((x) => `${X(x.i)},${Y(x.v)}`).join(' ');
    svg.append(s('polygon', { points: `${X(rr[0].i)},${Y(0)} ${linha} ${X(rr[rr.length - 1].i)},${Y(0)}`, class: 'cp-real-a' }));
    const pl = s('polyline', { points: linha, class: 'cp-real-l' }); svg.append(pl);
    rr.forEach((x) => svg.append(s('circle', { cx: X(x.i), cy: Y(x.v), r: c[x.i].hoje ? 5 : 3.2, class: 'cp-real-p' + (c[x.i].hoje ? ' hoje' : '') })));
    const u = rr[rr.length - 1];
    svg.append(s('text', { x: X(u.i) + (u.i < 2 ? 8 : -8), y: Y(u.v) - 10, 'text-anchor': u.i < 2 ? 'start' : 'end', class: 'cp-real-t' }, int(u.v)));
  }
  area.replaceChildren(svg);
}

/* ---------- Cenários ---------- */
function pintarCenarios(d) {
  const p = d.projecao, m = d.projecao_marco, r = d.ritmo;
  cabecalho(cCen, 'Cenários', `${int(r.dias_completos)} ${plural(r.dias_completos, 'dia completo', 'dias completos')} de dado`);
  if (p.provavel == null) { corpo(cCen, h('p', { class: 'cp-vazio', text: 'Os cenários aparecem depois do primeiro dia completo.' })); return; }
  const linhas = [
    ['campanha', 'Ritmo da campanha inteira', r.campanha, 'conservador'],
    ['provavel', 'Ritmo recente (com peso)', r.ponderado, 'provável'],
    ['recente', 'Média dos últimos 3 dias', r.ultimos3, ''],
    ['melhor_dia', 'Melhor dia todo dia', r.melhor_dia, 'teto'],
  ];
  const valor = (proj, k) => (k === 'provavel' ? proj.provavel : proj.cenarios[k]);
  const maxV = Math.max(1, ...linhas.map(([k]) => valor(p, k) || 0));
  corpo(cCen,
    h('div', { class: 'cp-cen-cab', 'aria-hidden': 'true' }, h('span'), m ? h('span', { text: `até ${dm(m.data)}` }) : null, h('span', { text: `até ${dm(p.data)}` })),
    h('ul', { class: 'cp-cen-l' + (m ? '' : ' um') }, ...linhas.map(([k, t, rit, tag], i) => h('li', { class: k === 'provavel' ? 'prov' : '', style: `--i:${i}` },
      h('div', { class: 'cp-cen-t' }, h('b', { text: t }), h('span', { text: `${dec(rit)} por dia${tag ? ' · ' + tag : ''}` }),
        h('div', { class: 'cp-cen-b', 'aria-hidden': 'true' }, h('i', { style: `--w:${(valor(p, k) || 0) / maxV}` }))),
      m ? h('span', { class: 'cp-cen-v s', text: int(valor(m, k)) }) : null,
      h('span', { class: 'cp-cen-v', text: int(valor(p, k)) })))));
}

/* ---------- Por dia ---------- */
function pintarDias(d) {
  const q = d.qualidade;
  cabecalho(cDia, 'Painéis por dia', `${int(q.robo)} pelo robô · ${int(q.fora)} por fora`);
  const maxP = Math.max(1, ...d.dias.map((x) => Math.max(x.paineis, x.leads || 0)));
  const fino = d.dias.length > 12;
  const grupos = d.dias.map((x, i) => h('li', { class: 'cp-dia-g' + (x.hoje ? ' hoje' : ''), style: `--i:${i}`, title: `${dm(x.dia)}: ${x.paineis} ${plural(x.paineis, 'painel', 'painéis')} (${x.robo} robô, ${x.fora} fora)${x.leads != null ? ` · ${x.leads} leads` : ' · leads sem medição'}` },
    h('div', { class: 'cp-dia-b' },
      x.leads != null ? h('span', { class: 'cp-col l', style: `--h:${x.leads / maxP}` }, !fino ? h('b', { text: x.leads ? int(x.leads) : '' }) : null) : h('span', { class: 'cp-col nm' }),
      h('span', { class: 'cp-col p', style: `--h:${x.paineis / maxP}` },
        h('i', { class: 'robo', style: `--f:${x.paineis ? x.robo / x.paineis : 0}` }),
        !fino ? h('b', { text: x.paineis ? int(x.paineis) : '' }) : null)),
    h('span', { class: 'cp-dia-r', text: x.hoje ? 'hoje' : fino ? (i % 3 === 0 ? dm(x.dia) : '') : dm(x.dia) })));
  corpo(cDia, h('ul', { class: 'cp-dias' + (fino ? ' fino' : '') }, ...grupos),
    h('p', { class: 'cp-leg' }, h('span', { class: 'l', text: 'Leads novos' }), h('span', { class: 'rb', text: 'Painel pelo robô' }), h('span', { class: 'fo', text: 'Painel por fora' }), d.dias.some((x) => x.leads == null) ? h('span', { class: 'nm', text: 'Leads sem medição' }) : null));
}

/* ---------- Antes x durante ---------- */
function pintarAntes(d) {
  const c = d.comparacao, q = d.qualidade, t = d.total;
  cabecalho(cAntes, 'Antes x durante', '14 dias antes do início');
  const linha = (rot, a, b, fmt, ganho) => h('li', null,
    h('span', { class: 'cp-ad-r', text: rot }),
    h('span', { class: 'cp-ad-a', text: fmt(a) }),
    h('span', { class: 'cp-ad-s', 'aria-hidden': 'true', text: '→' }),
    h('b', { class: 'cp-ad-b' + (ganho ? ' sobe' : ''), text: fmt(b) }));
  corpo(cAntes,
    h('ul', { class: 'cp-ad' },
      linha('Painéis por dia', c.antes_por_dia, c.durante_por_dia, dec, (c.durante_por_dia || 0) > (c.antes_por_dia || 0))),
    h('div', { class: 'cp-q' },
      h('div', null, h('b', { text: int(q.venderam) }), h('span', { text: `já criaram cliente (${pct(q.venderam, t)})` })),
      h('div', null, h('b', { text: int(q.clientes) }), h('span', { text: `clientes criados nesses painéis` }))));
}

/* ---------- Meta ---------- */
function pintarMeta(d) {
  const mt = d.meta;
  btnMeta.querySelector('span').textContent = 'Mudar meta'; btnMeta.hidden = !mt || S.editando;
  cabecalho(cMeta, 'Meta do ciclo', mt ? `até ${dm(d.config.fim)}` : '');
  if (S.editando) { corpo(cMeta, formMeta(mt)); return; }
  if (S.metaPedida !== undefined && (mt ? mt.alvo : null) !== S.metaPedida) {   /* nuvem: pedido na fila, o PC ainda não gravou */
    btnMeta.hidden = true;
    corpo(cMeta, h('div', { class: 'cp-meta-vazia' }, ic('alvo'), h('b', { text: S.metaPedida == null ? 'Tirando a meta…' : `Meta ${int(S.metaPedida)} enviada` }), h('span', { text: 'Aguardando o PC do robô gravar. Leva alguns segundos.' })));
    return;
  }
  if (!mt) {
    corpo(cMeta, h('div', { class: 'cp-meta-vazia' }, ic('alvo'), h('b', { text: 'Sem meta definida' }),
      h('span', { text: `Com uma meta, a tela diz quantos painéis por dia faltam para chegar lá.` }),
      h('button', { type: 'button', class: 'btn principal', onclick: () => abrirMeta() }, h('span', { text: 'Definir meta' }))));
    return;
  }
  const feito = Math.min(1, d.total / mt.alvo);
  const txtChance = { no_ritmo: 'No ritmo atual, a meta sai.', possivel: 'Possível: a meta passa do provável, mas cabe na faixa. Precisa acelerar um pouco.', abaixo: 'Fora da faixa no ritmo atual: precisa acelerar bastante.' }[mt.chance] || '';
  corpo(cMeta,
    h('p', { class: 'cp-meta-v' }, h('b', { text: int(d.total) }), h('span', { text: `de ${int(mt.alvo)}` })),
    h('p', { class: 'cp-meta-c ' + (mt.chance || ''), text: txtChance }),
    h('div', { class: 'cp-meta-b', role: 'img', 'aria-label': `${Math.round(feito * 100)}% da meta` }, h('i', { style: `--w:${feito}` })),
    h('ul', { class: 'cp-meta-l' },
      h('li', null, h('span', { text: 'Faltam' }), h('b', { text: int(mt.faltam) })),
      h('li', { class: mt.por_dia != null && d.ritmo.ponderado != null && mt.por_dia > d.ritmo.ponderado ? 'acima' : '' }, h('span', { text: 'Precisa por dia' }), h('b', { text: mt.por_dia == null ? '—' : dec(mt.por_dia) })),
      h('li', null, h('span', { text: 'Ritmo provável' }), h('b', { text: dec(d.ritmo.ponderado) }))));
}
function formMeta(mt) {
  const inp = h('input', { type: 'number', inputmode: 'numeric', min: '1', max: '100000', step: '1', id: 'cp-meta-inp', value: mt ? String(mt.alvo) : (S.d?.projecao?.provavel ? String(Math.round(S.d.projecao.provavel / 10) * 10) : ''), 'aria-label': 'Meta de painéis até o fim do ciclo' });
  const erro = h('span', { class: 'cp-form-e', role: 'alert' });
  const salvar = async (valor) => {
    if (S.salvando) return; S.salvando = true; erro.textContent = '';
    try {
      const r = await fetch(BASE + '/api/campanha', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ meta: valor }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.erro || String(r.status));
      S.editando = false;
      if (j.enfileirado) {   /* nuvem: o pedido vai para a fila e o PC grava em até ~15 s; a tela relê sozinha */
        S.metaPedida = valor == null || valor === '' ? null : Math.round(Number(valor));
        pintarMeta(S.d); aviso('Meta enviada ao PC do robô. Ela aparece aqui em alguns segundos.', false);
        [15000, 35000, 70000].forEach((ms) => setTimeout(() => { S.sig = ''; carregar(); }, ms));
        setTimeout(() => { if (S.metaPedida !== undefined) { S.metaPedida = undefined; aviso('O PC do robô não confirmou a meta. Confira se ele está ligado e tente de novo.'); if (S.d) pintarMeta(S.d); } }, 90000);
      } else { S.d = j; S.sig = ''; pintar(j); }
    } catch (e) { erro.textContent = e.message === 'meta inválida' ? 'Digite um número inteiro maior que zero.' : 'Não consegui salvar agora. Tente de novo.'; }
    finally { S.salvando = false; }
  };
  const form = h('form', { class: 'cp-form', onsubmit: (ev) => { ev.preventDefault(); salvar(inp.value.trim()); } },
    h('label', { for: 'cp-meta-inp', text: `Quantos painéis até ${dm(S.d.config.fim)}?` }),
    h('div', { class: 'cp-form-l' }, inp, h('button', { type: 'submit', class: 'btn principal', text: 'Salvar' })),
    h('div', { class: 'cp-form-l' },
      h('button', { type: 'button', class: 'btn', text: 'Cancelar', onclick: () => { S.editando = false; pintarMeta(S.d); } }),
      mt ? h('button', { type: 'button', class: 'btn', text: 'Tirar meta', onclick: () => salvar(null) }) : null),
    erro);
  requestAnimationFrame(() => { inp.focus(); inp.select(); });
  return form;
}
function abrirMeta() { if (!S.d) return; S.editando = true; pintarMeta(S.d); }

/* ---------- Pintura geral ---------- */
function pintar(d) {
  const cfg = d.config;
  sub.textContent = `${dm(cfg.inicio)} a ${dm(cfg.fim)} · ciclo do acerto · projeção pelos painéis do Sigma`;
  pintarContador(d); pintarProj(d);
  const r = d.ritmo, frac = d.contador.fracao_hoje || 0;
  const esperadoAgora = r.ponderado != null ? r.ponderado * frac : null;
  cKpis.replaceChildren(
    kpi(0, 'ok', 'Na campanha', int(d.total), '', `desde ${dm(cfg.inicio)} · ${int(d.qualidade.robo)} pelo robô`, 'ok'),
    kpi(1, 'sol', 'Hoje', int(d.hoje), '', r.ponderado != null ? `o ritmo pede ~${int(r.ponderado)} no dia${esperadoAgora >= 1 ? ` (≈ ${int(esperadoAgora)} até agora)` : ''}` : 'primeiro dia', ''),
    kpi(2, 'ritmo', 'Ritmo provável', dec(r.ponderado), 'por dia', `média geral ${dec(r.campanha)} · melhor dia ${int(r.melhor_dia)}`, 'ciano'),
    kpi(3, 'venda', 'Já venderam', pct(d.qualidade.venderam, d.total), '', `${int(d.qualidade.venderam)} de ${int(d.total)} criaram cliente`),
    kpi(4, 'usuarios', 'Painéis a cada 100 leads', d.leads.por_100 == null ? '—' : dec(d.leads.por_100), '', d.leads.total ? `do robô · ${int(d.leads.total)} leads na campanha` : 'sem leads medidos'));
  pintarCurva(d); pintarCenarios(d); pintarDias(d); pintarAntes(d); pintarMeta(d);
  cLimites.replaceChildren(h('b', { text: 'Como ler' }), h('ul', null, ...d.limites.map((t) => h('li', { text: t }))));
}

function aviso(txt, alerta = true) { avisoEl.hidden = !txt; avisoEl.querySelector('span').textContent = txt || ''; avisoEl.classList.toggle('info', !alerta); }
/* Esqueleto com a mesma estrutura da tela pronta: quando os números chegam, nada muda de altura (CLS perto de zero). */
function esqueleto() {
  if (cKpis.childElementCount) return;
  cContador.replaceChildren(
    h('div', { class: 'cp-cont-t' }, h('span', { class: 'cp-rot' }, ic('calendario'), 'Campanha'),
      h('p', { class: 'cp-dia-n' }, h('span', { text: 'Dia' }), h('b', { text: '–' }), h('span', { text: 'de 30' })),
      h('span', { class: 'cp-cont-n', text: 'Contando os dias da campanha e o ritmo dos painéis…' })),
    h('div', { class: 'cp-fita-w' }, h('ol', { class: 'cp-fita', 'aria-hidden': 'true' }, ...Array.from({ length: 30 }, () => h('li', { class: 'cp-cel falta' }, h('i')))),
      h('div', { class: 'cp-fita-r', 'aria-hidden': 'true' }, h('span', { text: ' ' }))));
  cProj.replaceChildren(h('span', { class: 'cp-rot' }, ic('ritmo'), 'Provável até o fim do ciclo'),
    h('p', { class: 'cp-proj-v' }, h('b', { text: '–' }), h('span', { text: 'painéis' })),
    h('p', { class: 'cp-proj-f', text: 'calculando a faixa' }),
    h('p', { class: 'cp-proj-m' }, h('span', { text: 'Até o fim do mês' }), h('b', { text: '–' })));
  cKpis.replaceChildren(...[['ok', 'Na campanha'], ['sol', 'Hoje'], ['ritmo', 'Ritmo provável'], ['venda', 'Já venderam'], ['usuarios', 'Painéis a cada 100 leads']]
    .map(([ico, t], i) => kpi(i, ico, t, '–', '', 'carregando…', 'cp-sk-k')));
}
async function carregar() {
  if (S.carregando || S.editando) return; S.carregando = true;
  if (!S.d) esqueleto();
  try {
    const r = await fetch(BASE + '/api/campanha', { cache: 'no-store', credentials: 'same-origin' });
    if (r.status === 401) { location.href = '/login'; return; }
    if (r.status === 503) { aviso('A nuvem ainda não recebeu a campanha do PC. Assim que o robô enviar, ela aparece aqui.'); if (!S.d) cKpis.replaceChildren(); return; }
    if (!r.ok) throw new Error(String(r.status));
    const d = await r.json(); S.d = d;
    if (d.nuvem && d.desatualizado && d.idade_s != null) aviso(`O PC do robô não envia dados há ${Math.max(5, Math.round(d.idade_s / 60))} min. Os números podem estar atrasados.`);
    else if (d.sigma?.erro === 'login') aviso('O Sigma pediu login de novo: painéis criados fora do robô depois da última leitura não entram até refazer o login.');
    else if (S.metaPedida === undefined || d.config.meta === S.metaPedida) { S.metaPedida = undefined; aviso(''); }
    const sig = JSON.stringify({ ...d, gerado_em: 0, snapshot_em: 0, idade_s: 0, contador: { ...d.contador, fracao_hoje: Math.round((d.contador.fracao_hoje || 0) * 50) } });
    if (sig !== S.sig) { const primeira = !S.sig; S.sig = sig; pintar(d); if (primeira) replay(); }
  } catch {
    aviso(S.d ? 'Sem conexão com o robô agora. Mostrando a última leitura; tento de novo em um minuto.' : 'Não consegui carregar a campanha. Confira se o robô está ligado; tento de novo em um minuto.');
  } finally { S.carregando = false; raiz.removeAttribute('aria-busy'); }
}
function replay() { if (REDUZ.matches) { raiz.classList.add('cp-ok'); return; } raiz.classList.remove('cp-ok'); void raiz.offsetWidth; requestAnimationFrame(() => raiz.classList.add('cp-ok')); }

/* ---------- Visibilidade ---------- */
const ver = () => (MOVEL.matches ? appEl.dataset.aba === 'funil' && appEl.dataset.fj === 'campanha' : appEl.dataset.vista === 'campanha');
function checar() {
  const v = ver();
  if (v && !S.vis) { S.vis = true; S.sig = ''; carregar(); }
  else if (!v) S.vis = false;
}
new MutationObserver(checar).observe(appEl, { attributes: true, attributeFilter: ['data-vista', 'data-aba', 'data-fj'] });
MOVEL.addEventListener('change', checar);
setInterval(() => { if (!document.hidden && ver()) carregar(); }, ATUALIZA_MS);
document.addEventListener('visibilitychange', () => { if (!document.hidden && ver()) carregar(); });
checar();
})();
