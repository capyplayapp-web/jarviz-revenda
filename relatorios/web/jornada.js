/* Tela Jornada dos revendedores (08/11/2026). JS puro, nada de innerHTML com dado de fora. Usa as peças comuns de funil.js (window.funilKit).
   Fonte: GET /api/jornada. Ações: POST /api/jornada/pausar | retomar | tocar {ref, confirmar:true} (tocar sempre pede confirmação antes).
   PC: vista "Jornada" do seletor do topo. Celular: aba "Funil", lado "Jornada". Prefixo jr-. */
(() => {
'use strict';

const appEl = document.getElementById('app');
const raiz = document.getElementById('jr');
const K = window.funilKit;
if (!appEl || !raiz || !K) return;
const { h, ic, trocar, num, int, lista, txt, pctTxt, plural, masc, nomeSeguro, data, hhmm, diaRel, proxLabel, atras, quandoCurto, contar, pegar, msgErro, dialogo, ocupar, rolavel, vazio, assinatura, aviso, MOVEL, ATUALIZA_MS } = K;

const ST = { saudavel: 'ok', sem_uso: 'neutra', em_risco: 'erro', duvida_pagamento: 'aviso', passou_ao_senhor: 'ciano' };
const RESP = { vendeu: 'ok', tudo_certo: 'ok', sem_vendas: 'neutra', duvida_pagamento: 'aviso', problema: 'erro', outro: 'neutra' };
const FASE_COR = { inicio: 'inicio', meio: 'meio', fechamento: 'fechamento', acerto: 'acerto' };
const S = { d: null, sig: {}, vis: false, filtro: 'todos', ocupado: null, erro: null };

/* ---------- Esqueleto ---------- */
const avisoRede = h('div', { class: 'fk-aviso', role: 'status', hidden: true }, ic('alerta'), h('span'));
const geral = h('div', { class: 'fk-geral', hidden: true }, ic('caixa'), h('p', { class: 'fk-geral-t' }), h('span', { class: 'fk-geral-d' }));
const grade = h('div', { class: 'jr-grade' });

/* linha do tempo do mês */
const btPausa = h('button', { type: 'button', class: 'btn jr-pausa' }, ic('pausa'), h('span', { text: 'Pausar jornada' }));
const estadoJ = h('span', { class: 'pilula-t ok' });
const cMes = h('article', { class: 'cartao fk-card jr-mes', 'aria-labelledby': 'jr-mes-t' });
const mesSub = h('span', { class: 'sub' });
const trilho = h('div', { class: 'jr-trilho', role: 'img' });
const marcas = h('div', { class: 'jr-marcas', 'aria-hidden': 'true' });
const fases = h('ol', { class: 'jr-fases' });
cMes.append(h('header', null, h('h2', { id: 'jr-mes-t', text: 'O mês do revendedor' }), mesSub, estadoJ, btPausa),
  h('div', { class: 'jr-linha' }, trilho, marcas), fases);

/* indicadores */
const cInd = h('section', { class: 'jr-ind', 'aria-label': 'Indicadores da jornada' });
const IND = [
  ['pct_respondeu', 'Responderam', 'pct'], ['pct_vendeu', 'Venderam', 'pct'], ['em_risco', 'Em risco', 'n'],
  ['duvida_pagamento', 'Dúvida de pagamento', 'n'], ['toques_7_dias', 'Toques nos próximos 7 dias', 'n'],
];
const tiles = IND.map(([k, rot], i) => {
  const v = h('div', { class: 'jr-ind-v' }), r = h('div', { class: 'jr-ind-r' });
  const el = h('article', { class: 'jr-tile fk-card', 'data-k': k, style: `--i:${i + 1}` }, h('h3', { text: rot }), v, r);
  cInd.append(el); return { k, el, v, r };
});

/* lista de revendedores */
const filtros = h('div', { class: 'jr-filtros', role: 'radiogroup', 'aria-label': 'Filtrar revendedores' });
const cLista = h('article', { class: 'cartao fk-card jr-lista', 'aria-labelledby': 'jr-lista-t' });
const listaSub = h('span', { class: 'sub' });
const cab = h('div', { class: 'jr-cab', 'aria-hidden': 'true' }, ...['Revendedor', 'Uso do painel', 'Último toque', 'Próximo toque', 'O que ele respondeu', 'Situação', ''].map(t => h('span', { text: t })));
const ul = h('ul', { class: 'jr-revs' }, h('li', null, ...['60', '85', '70'].map(w => h('span', { class: 'sk', style: `width:${w}%` }))));
const corpo = rolavel(h('div', { class: 'corpo', tabindex: '0', role: 'region', 'aria-label': 'Revendedores' }, cab, ul));
cLista.append(h('header', null, h('h2', { id: 'jr-lista-t', text: 'Revendedores' }), listaSub, filtros), corpo);

[cMes, cInd, cLista].forEach((c, i) => c.style.setProperty('--i', i));
grade.append(cMes, cInd, cLista);
raiz.append(avisoRede, geral, grade);

/* ---------- Pintura ---------- */
function so(chave, valor, fn) { const s = assinatura(valor); if (S.sig[chave] === s) return; S.sig[chave] = s; fn(); }
const faseDoDia = dd => (dd === 5 ? 'acerto' : dd >= 25 || dd <= 4 ? 'fechamento' : dd >= 13 ? 'meio' : 'inicio');

function pintarMes(d) {
  const m = d.mes || {}, n = num(m.dias_no_mes) || 30, hoje = Math.min(n, Math.max(1, num(m.hoje) || new Date().getDate()));
  const fs = lista(m.fases), porChave = {}; fs.forEach(f => { porChave[f.chave] = f; });
  const atual = m.atual || faseDoDia(hoje);
  /* blocos contínuos de dias com a mesma fase (o fechamento dá a volta: 25 até o fim e 1 a 4) */
  const blocos = [];
  for (let dd = 1; dd <= n; dd++) { const f = faseDoDia(dd), b = blocos[blocos.length - 1]; if (b && b.f === f) b.ate = dd; else blocos.push({ f, de: dd, ate: dd }); }
  trocar(trilho, ...blocos.map((b, i) => h('span', { class: 'jr-seg ' + FASE_COR[b.f] + (b.f === atual ? ' atual' : ''), style: `flex-grow:${b.ate - b.de + 1};--n:${i}`, title: `${(porChave[b.f] || {}).rotulo || b.f}: dia ${b.de}${b.ate !== b.de ? ` a ${b.ate}` : ''}` },
    b.ate - b.de >= 3 ? h('span', { class: 'jr-seg-r', text: (porChave[b.f] || {}).rotulo || '' }) : null)),
    h('span', { class: 'jr-hoje' + (hoje <= 3 ? ' esq' : hoje >= n - 2 ? ' dir' : ''), style: `left:${((hoje - .5) / n * 100).toFixed(2)}%` }, h('b', { text: `hoje · dia ${hoje}` })));
  trilho.setAttribute('aria-label', `Hoje é dia ${hoje} de ${n}. Fase atual: ${(porChave[atual] || {}).rotulo || atual}.`);
  trocar(marcas, ...[1, 5, 13, 25, n].map(dd => h('span', { style: `left:${((dd - .5) / n * 100).toFixed(2)}%`, text: String(dd) })));
  const ordem = ['inicio', 'meio', 'fechamento', 'acerto'].map(k => porChave[k]).filter(Boolean);
  const faixa = f => (f.de === f.ate ? `dia ${f.de}` : f.de > f.ate ? `dia ${f.de} ao dia ${f.ate}` : `dia ${f.de} a ${f.ate}`);
  trocar(fases, ...ordem.map(f => h('li', { class: 'jr-fase ' + FASE_COR[f.chave] + (f.chave === atual ? ' atual' : '') },
    h('div', { class: 'jr-fase-t' }, h('i'), h('b', { text: txt(f.rotulo) }), f.chave === atual ? h('span', { class: 'pilula-t', text: 'agora' }) : h('span', { class: 'jr-fase-d', text: faixa(f) })),
    f.chave === atual ? h('span', { class: 'jr-fase-d', text: faixa(f) }) : null,
    h('p', { text: txt(f.texto) }))));
  mesSub.textContent = '';
  const pausada = !!d.pausada;
  estadoJ.className = 'pilula-t ' + (pausada ? 'aviso' : 'ok'); trocar(estadoJ, h('i', { class: 'fn-led' }), pausada ? 'Jornada pausada' : 'Jornada ligada');
  if (S.ocupado !== 'pausa') trocar(btPausa, ic(pausada ? 'play' : 'pausa'), h('span', { text: pausada ? 'Retomar jornada' : 'Pausar jornada' }));
  btPausa.classList.toggle('principal', pausada);
}

function pintarInd(d) {
  const x = d.indicadores || {};
  for (const t of tiles) {
    const v = num(x[t.k]);
    if (t.k.startsWith('pct')) contar(t.v, v == null ? null : Math.round(v * 100), z => `${Math.round(z)}%`);
    else contar(t.v, v);
    t.el.classList.toggle('quente', (t.k === 'em_risco' || t.k === 'duvida_pagamento') && v > 0);
    t.el.classList.toggle('sem-dado', v == null);
  }
  const tocados = num(x.tocados) || 0, resp = lista(d.revendedores).filter(r => r.resposta).length;
  tiles[0].r.textContent = tocados ? `de ${plural(tocados, 'revendedor tocado', 'revendedores tocados')}` : 'ninguém foi tocado ainda';
  tiles[1].r.textContent = resp ? `de ${plural(resp, 'que respondeu', 'que responderam')}` : 'sem respostas ainda';
  tiles[2].r.textContent = 'sem uso ou esfriando';
  tiles[3].r.textContent = num(x.passou_ao_senhor) ? `${plural(x.passou_ao_senhor, 'passou', 'passaram')} ao senhor` : 'nenhum com o senhor';
  tiles[4].r.textContent = `de ${plural(x.revendedores, 'revendedor', 'revendedores')}`;
}

const precisa = r => ['em_risco', 'sem_uso', 'duvida_pagamento', 'passou_ao_senhor'].includes(r.status);
const FILTROS = [['todos', 'Todos', () => true], ['atencao', 'Pedem atenção', precisa], ['bloqueados', 'Segurados', r => !!r.bloqueio], ['responderam', 'Responderam', r => !!r.resposta]];
function pintarFiltros(revs) {
  trocar(filtros, ...FILTROS.map(([k, rot, fn]) => {
    const n = revs.filter(fn).length, on = S.filtro === k;
    return h('button', { type: 'button', role: 'radio', 'aria-checked': String(on), tabindex: on ? '0' : '-1', 'data-f': k, class: 'jr-f' }, rot, h('b', { text: int(n) }));
  }));
}
function celula(rot, ...filhos) { return h('div', { class: 'jr-c' }, h('span', { class: 'jr-c-r', text: rot }), ...filhos); }
function linhaRev(r) {
  const nome = nomeSeguro(r.nome, r.telefone), st = ST[r.status] || 'neutra';
  const d = num(r.dias);
  const idade = d == null ? '' : d === 0 ? 'criou hoje' : d === 1 ? 'criou ontem' : `criou há ${d} dias`;
  const u = r.uso;
  const usados = u ? num(u.creditos_usados) : null, saldo = u ? num(u.saldo) : null;
  const usoEl = u && (usados != null || saldo != null)
    ? [h('span', { class: 'jr-uso' }, h('b', { text: int(usados ?? 0) }), ` ${num(usados) === 1 ? 'crédito usado' : 'créditos usados'}`),
      h('span', { class: 'jr-sub', text: [saldo != null ? `saldo ${int(saldo)}` : '', u.ultimo_login ? `entrou ${atras(u.ultimo_login)}` : ''].filter(Boolean).join(' · ') }),
      usados != null && saldo != null && usados + saldo > 0 ? h('span', { class: 'jr-uso-b', 'aria-hidden': 'true' }, h('i', { style: `width:${Math.min(100, usados / (usados + saldo) * 100).toFixed(1)}%` })) : null]
    : [h('span', { class: 'jr-sub', text: 'sem leitura de uso ainda' })];
  const ut = r.ultimo_toque;
  const utEl = ut ? [h('span', { class: 'jr-forte', text: txt(ut.rotulo) || 'Toque' }), h('span', { class: 'jr-sub' }, quandoCurto(ut.quando), ut.respondeu ? h('span', { class: 'jr-ok', text: ' · respondeu' }) : ut.respondeu === false ? ' · sem resposta' : '')]
    : [h('span', { class: 'jr-sub', text: 'nenhum toque ainda' })];
  const pr = r.proximo;
  const prEl = [
    pr ? h('span', { class: 'jr-forte', text: txt(pr.rotulo) || 'Próximo toque' }) : h('span', { class: 'jr-sub', text: 'nada marcado' }),
    pr ? h('span', { class: 'jr-sub', text: proxLabel(pr.quando) + (pr.fechamento ? ' · fechamento do mês' : '') }) : null];
  /* toque segurado: a situação vira "Segurado" (laranja) com o motivo, e o botão fica desligado */
  const bloq = txt(r.bloqueio);
  const rs = r.resposta;
  const rsEl = rs ? [h('span', { class: 'jr-resp-t' }, h('span', { class: 'pilula-t ' + (RESP[rs.classe] || 'neutra'), text: txt(rs.rotulo) || 'Respondeu' }), h('span', { class: 'jr-sub', text: quandoCurto(rs.quando) })),
    txt(rs.texto) ? h('q', { class: 'jr-q', text: txt(rs.texto) }) : null]
    : [h('span', { class: 'jr-sub', text: 'ainda não respondeu' })];
  const fila = !!r.tocar_agora && !bloq;
  const bt = h('button', { type: 'button', class: 'btn jr-tocar', 'data-ref': r.ref, disabled: fila || bloq ? true : null }, ic(fila ? 'relogio' : bloq ? 'pausa' : 'enviar'), h('span', { text: fila ? 'Na fila' : 'Tocar agora' }));
  if (bloq) { bt.title = `Segurado: ${bloq}`; bt.setAttribute('aria-label', `Tocar ${nome} agora, indisponível. Segurado: ${bloq}`); }
  else if (!fila) bt.setAttribute('aria-label', `Tocar ${nome} agora`);
  const stCls = bloq ? 'aviso' : st;
  return h('li', { class: 'jr-rev st-' + stCls + (ut ? '' : ' sem-ut') + (bloq ? ' segurado' : ''), 'data-ref': r.ref },
    h('div', { class: 'jr-quem' },
      h('span', { class: 'jr-num', 'aria-label': r.painel_numero != null ? `Painel número ${r.painel_numero}` : 'Painel sem número' }, h('small', { text: 'nº' }), h('b', { text: r.painel_numero != null ? String(r.painel_numero) : '?' })),
      h('div', { class: 'jr-quem-t' }, h('span', { class: 'nome', text: nome }), h('span', { class: 'jr-sub', text: [nome.endsWith(masc(r.telefone)) ? '' : masc(r.telefone), idade].filter(Boolean).join(' · ') }))),
    celula('Uso', ...usoEl), celula('Último toque', ...utEl), celula('Próximo toque', ...prEl), celula('Resposta', ...rsEl),
    h('div', { class: 'jr-st' },
      bloq ? h('span', { class: 'pilula-t aviso', title: `Situação: ${txt(r.status_rotulo) || 'sem status'}` }, h('i', { class: 'fn-led' }), 'Segurado')
        : h('span', { class: 'pilula-t ' + st }, h('i', { class: 'fn-led' }), txt(r.status_rotulo) || 'Sem status'),
      bloq ? h('span', { class: 'jr-bloq', text: bloq }) : null),
    h('div', { class: 'jr-acao', title: bloq ? `Segurado: ${bloq}` : null }, bt));
}
function pintarLista(d) {
  const revs = lista(d.revendedores);
  const x = d.indicadores || {};
  listaSub.textContent = `${plural(revs.length, 'revendedor', 'revendedores')} · ${plural(x.tocados || 0, 'tocado', 'tocados')}`;
  pintarFiltros(revs);
  const fn = (FILTROS.find(f => f[0] === S.filtro) || FILTROS[0])[2];
  const vis = revs.filter(fn);
  const foco = document.activeElement && document.activeElement.closest && document.activeElement.closest('.jr-rev') ? document.activeElement.closest('.jr-rev').dataset.ref : null;
  if (!revs.length) trocar(ul, h('li', null, vazio('caixa', 'Nenhum revendedor na jornada ainda. Quem fechar painel entra aqui no dia seguinte.')));
  else if (!vis.length) trocar(ul, h('li', null, vazio('ok', { atencao: 'Ninguém pedindo atenção agora.', bloqueados: 'Nenhum toque segurado.', responderam: 'Ninguém respondeu ainda.' }[S.filtro] || 'Nada aqui.')));
  else trocar(ul, ...vis.map(linhaRev));
  cab.hidden = !vis.length;
  if (foco) { const b = ul.querySelector(`.jr-rev[data-ref="${CSS.escape(foco)}"] .jr-tocar`); if (b) b.focus({ preventScroll: true }); }
  requestAnimationFrame(corpo._marca);
}

function aplicar(d) {
  geral.hidden = true; grade.hidden = false;
  const minuto = Math.floor(Date.now() / 60000);
  so('mes', [d.mes, d.pausada, S.ocupado], () => pintarMes(d));
  so('ind', [d.indicadores, lista(d.revendedores).filter(r => r.resposta).length], () => pintarInd(d));
  so('lista', [d.revendedores, S.filtro, minuto], () => pintarLista(d));
  const vel = data(d.vigia_em), velho = vel && Date.now() - vel.getTime() > 20 * 60000;
  avisoRede.hidden = !(S.erro || velho);
  avisoRede.querySelector('span').textContent = S.erro ? 'Sem conexão com o robô agora. Mostrando a última leitura; tento de novo em instantes.' : `O vigia da jornada não roda desde ${quandoCurto(vel)}. A lista pode estar atrasada.`;
}

/* ---------- Busca ---------- */
let busca = 0;
async function carregar(forcar) {
  if (!ver() && !forcar) return;
  const minha = ++busca;
  try {
    const d = await pegar('/api/jornada');
    if (minha !== busca) return;
    S.erro = null; S.d = d; aplicar(d);
  } catch (e) {
    if (minha !== busca) return;
    if (e && e.status === 401) return;
    S.erro = true;
    if (e && (e.status === 404 || e.status === 501)) { S.d = null; S.sig = {}; mostrarGeral('A jornada ainda está sendo preparada.', 'Quando o vigia do robô rodar, os revendedores aparecem aqui.'); return; }
    if (S.d) aplicar(S.d); else mostrarGeral('Não consegui carregar a jornada agora.', 'Confira se o PC do robô está ligado. Tento de novo em um minuto.');
  }
}
function mostrarGeral(t, dd) { grade.hidden = true; geral.hidden = false; geral.querySelector('.fk-geral-t').textContent = t; geral.querySelector('.fk-geral-d').textContent = dd; }

/* ---------- Ações ---------- */
filtros.addEventListener('click', ev => { const b = ev.target.closest('[data-f]'); if (!b || b.dataset.f === S.filtro) return; S.filtro = b.dataset.f; if (S.d) so('lista', [S.d.revendedores, S.filtro, Math.floor(Date.now() / 60000)], () => pintarLista(S.d)); filtros.querySelector('[aria-checked="true"]')?.focus(); });
filtros.addEventListener('keydown', ev => {
  if (!['ArrowRight', 'ArrowLeft'].includes(ev.key)) return;
  ev.preventDefault();
  const i = FILTROS.findIndex(f => f[0] === S.filtro), j = (i + (ev.key === 'ArrowRight' ? 1 : -1) + FILTROS.length) % FILTROS.length;
  S.filtro = FILTROS[j][0]; if (S.d) pintarLista(S.d); filtros.querySelector('[aria-checked="true"]')?.focus();
});

async function jornada(acao) {
  S.ocupado = 'pausa'; ocupar(btPausa, true, acao === 'pausar' ? 'Pausando…' : 'Retomando…');
  try {
    const r = await pegar('/api/jornada/' + acao, { metodo: 'POST' });
    if (r && r.ok === false) throw new Error(txt(r.motivo || r.erro) || 'falhou');
    aviso(r && r.enfileirado ? 'Pedido enviado. O robô aplica assim que o PC pegar.' : acao === 'pausar' ? 'Jornada pausada. Nenhum revendedor recebe toque até o senhor retomar.' : 'Jornada retomada.');
  } catch (e) { if (!(e && e.status === 401)) aviso(msgErro(e), true); }
  finally { S.ocupado = null; ocupar(btPausa, false); S.sig.mes = null; await carregar(true); }
}
btPausa.addEventListener('click', async ev => {
  if (S.ocupado) return;
  if (!(S.d && S.d.pausada)) return jornada('pausar');
  const ok = await dialogo({ gatilho: ev.currentTarget, icone: 'play', titulo: 'Retomar a jornada?', ok: 'Retomar',
    texto: 'Os check-ins voltam a sair para os revendedores conforme a fase do mês, dentro do teto do dia e só entre 9h e 20h.' });
  if (ok) jornada('retomar');
});

ul.addEventListener('click', ev => {
  const bt = ev.target.closest('.jr-tocar'); if (!bt || bt.disabled || !S.d) return;
  const r = lista(S.d.revendedores).find(x => x.ref === bt.dataset.ref); if (!r) return;
  const nome = nomeSeguro(r.nome, r.telefone);
  const pr = r.proximo;
  dialogo({
    gatilho: bt, icone: 'enviar', titulo: `Tocar ${nome} agora?`, ok: 'Tocar agora', progresso: 'Agendando o toque…',
    texto: `O robô manda a próxima mensagem da jornada${pr && txt(pr.rotulo) ? ` (${txt(pr.rotulo)})` : ''}${r.painel_numero != null ? ` para o dono do painel nº ${r.painel_numero}` : ''}. É uma mensagem de verdade no WhatsApp dele.`,
    nota: 'Sai no próximo horário livre, sem passar do teto do dia.',
    acao: async () => {
      const res = await pegar('/api/jornada/tocar', { metodo: 'POST', corpo: { ref: r.ref, confirmar: true } });
      if (res && res.ok === false) return { ok: false, titulo: 'Não deu certo', texto: txt(res.motivo || res.erro) || 'O robô não aceitou o pedido agora.' };
      setTimeout(() => carregar(true), 400);
      return { ok: true, titulo: res && res.enfileirado ? 'Pedido enviado' : 'Toque agendado', texto: txt(res && res.aviso) || 'O robô manda a mensagem no próximo horário livre.' };
    },
  });
});

/* ---------- Visibilidade ---------- */
function ver() { return MOVEL.matches ? appEl.dataset.aba === 'funil' && appEl.dataset.fj === 'jornada' : appEl.dataset.vista === 'jornada'; }
function replay() { raiz.classList.remove('fk-ok'); void raiz.offsetWidth; requestAnimationFrame(() => raiz.classList.add('fk-ok')); }
function checar() {
  const v = ver();
  if (v && !S.vis) { S.vis = true; replay(); if (S.d) { S.sig = {}; aplicar(S.d); } carregar(); }
  else if (!v) S.vis = false;
}
new MutationObserver(checar).observe(appEl, { attributes: true, attributeFilter: ['data-vista', 'data-aba', 'data-fj'] });
MOVEL.addEventListener('change', checar);
setInterval(() => { if (!document.hidden && ver()) carregar(); }, ATUALIZA_MS);
document.addEventListener('visibilitychange', () => { if (!document.hidden && ver()) carregar(); });
checar();
})();
