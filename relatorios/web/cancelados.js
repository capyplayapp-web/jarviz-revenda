/* Painéis cancelados (09/11/2026, pedido do senhor). Cartão na fila de números da aba Sigma + modal com os motivos.
   "Corrigir erro" chama o Opus, que estuda as conversas daquele motivo e grava como contornar nas diretrizes do Haiku (base.md).
   API: GET /api/cancelados, POST /api/cancelados/ler | corrigir | desfazer (cancelados-lib.mjs). Prefixo cx-. Só no PC. */
(() => {
'use strict';
const appEl = document.getElementById('app'); if (!appEl) return;
const BASE = location.protocol === 'file:' ? 'http://127.0.0.1:8811' : '';
const REDUZ = matchMedia('(prefers-reduced-motion: reduce)');

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
const ICONES = {
  sair: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11',
  seta: 'M9 6l6 6-6 6', fechar: 'M6 6l12 12M18 6 6 18', ok: 'M5 12.5 10 17.5 19 7',
  girar: 'M21 12a8 8 0 0 1-13.6 5.7L4 15M3 12a8 8 0 0 1 13.6-5.7L20 9M4 20v-5h5M20 4v5h-5',
  faisca: 'M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4ZM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8Z',
  chat: 'M20 12a8 8 0 0 1-11.5 7.2L4 20l1-4.2A8 8 0 1 1 20 12Z', alerta: 'M12 8v5M12 16.5v.01M10.3 4.2 2.8 17.2A2 2 0 0 0 4.5 20h15a2 2 0 0 0 1.7-2.8L13.7 4.2a2 2 0 0 0-3.4 0Z',
  desfazer: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11', livro: 'M4 19.5V5a2 2 0 0 1 2-2h14v16H6.5A2.5 2.5 0 0 0 4 21.5M20 19v3H6.5',
  busca: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4',
};
function ic(nome, cls) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.8');
  s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true'); if (cls) s.setAttribute('class', cls);
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', ICONES[nome] || ICONES.ok); s.append(p); return s;
}
const int = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString('pt-BR') : '—');
const pct = (n) => (Number.isFinite(n) ? n.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%' : '—');
const plural = (n, a, b) => (n === 1 ? a : b);
const hora = (iso) => { const d = new Date(iso); return Number.isFinite(+d) ? d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', ' às') : ''; };
const zap = (n) => n ? 'https://web.whatsapp.com/send?phone=' + (String(n).length <= 11 ? '55' + n : n) : null;
async function post(rota, corpo) {
  const r = await fetch(BASE + rota, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo || {}) });
  let j = {}; try { j = await r.json(); } catch {}
  if (!r.ok && r.status !== 202) throw new Error(j.erro || 'HTTP ' + r.status);
  return j;
}

const CURTO = { nunca_comecou: 'nunca começaram', nao_conseguiu_vender: 'não venderam', instabilidade: 'por instabilidade', dificuldade_tecnica: 'não conseguiram instalar', preco_cobranca: 'pelo preço', desconfianca: 'por desconfiança', outro_fornecedor: 'foram para outro', sem_resposta_nossa: 'sem resposta nossa', sumiu_sem_dizer: 'sumiram', desativado_por_nos: 'desativados por nós', outro: 'por outro motivo' };

/* ---------- Estado ---------- */
const S = { d: null, sel: null, aberto: false, timer: 0, vis: false, erro: null, msg: null };

/* ---------- Cartão na fila de números do Sigma ---------- */
const tVal = h('b', { text: '—' }), tNota = h('span', { class: 'sg-kpi-n', text: 'lendo…' });
const tile = h('button', { type: 'button', class: 'sg-kpi cx-kpi', id: 'cx-kpi', style: '--i:5', 'aria-haspopup': 'dialog', 'aria-label': 'Painéis cancelados: ver motivos' },
  h('span', { class: 'sg-kpi-r' }, ic('sair'), 'Painéis cancelados'),
  h('span', { class: 'sg-kpi-v' }, tVal),
  tNota,
  h('span', { class: 'cx-ver' }, h('span', { text: 'Ver motivos' }), ic('seta')));
tile.addEventListener('click', () => abrir());
function encaixar() { const k = document.querySelector('.sg-kpis'); if (k && tile.parentNode !== k) k.append(tile); }

function pintarTile() {
  const d = S.d; if (!d) return;
  tVal.textContent = pct(d.taxa);
  const top = (d.motivos || []).find((g) => g.chave !== 'nao_lido');
  tNota.textContent = `${int(d.cancelados)} de ${int(d.total_paineis)} painéis` + (top ? ` · ${int(top.n)} ${CURTO[top.chave] || top.nome.toLowerCase()}` : ' · motivos ainda não lidos');
  tile.classList.toggle('alto', d.taxa >= 20);
}

/* ---------- Modal ---------- */
let dlg, lado, det, listaM, ind;
function montar() {
  listaM = h('div', { class: 'cx-motivos', role: 'listbox', 'aria-label': 'Motivos de cancelamento' });
  listaM.addEventListener('scroll', () => listaM.classList.toggle('corta', listaM.scrollTop + listaM.clientHeight < listaM.scrollHeight - 4), { passive: true });
  ind = h('span', { class: 'cx-ind', 'aria-hidden': 'true' });
  lado = h('aside', { class: 'cx-lado' });
  det = h('section', { class: 'cx-det', 'aria-live': 'polite' });
  dlg = h('dialog', { class: 'cx-dlg', 'aria-labelledby': 'cx-t' },
    h('button', { type: 'button', class: 'cx-x', 'aria-label': 'Fechar', onclick: () => fechar() }, ic('fechar')),
    h('div', { class: 'cx-in' }, lado, det));
  dlg.addEventListener('cancel', (ev) => { ev.preventDefault(); fechar(); });
  dlg.addEventListener('click', (ev) => { if (ev.target === dlg) fechar(); });
  listaM.addEventListener('keydown', (ev) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(ev.key)) return; ev.preventDefault();
    const bs = [...listaM.querySelectorAll('[role="option"]')], i = bs.findIndex((b) => b.dataset.k === S.sel);
    const j = ev.key === 'Home' ? 0 : ev.key === 'End' ? bs.length - 1 : i + (ev.key === 'ArrowDown' ? 1 : -1);
    const b = bs[Math.max(0, Math.min(bs.length - 1, j))]; if (b) { escolher(b.dataset.k); b.focus({ preventScroll: true }); }
  });
  /* partes fixas do lado: montadas uma vez e só atualizadas (a lista não é recriada, então foco e barras não pulam) */
  L.taxa = h('b'); L.taxaT = h('span'); L.f1 = h('b'); L.f2 = h('b'); L.f3 = h('b');
  L.ler = h('button', { type: 'button', class: 'btn cx-ler', onclick: ler }); L.nota = h('span', { class: 'cx-nota' });
  lado.append(
    h('h2', { id: 'cx-t', text: 'Painéis cancelados' }),
    h('div', { class: 'cx-taxa' }, L.taxa, L.taxaT),
    h('ul', { class: 'cx-fatos' },
      h('li', null, h('span', { text: 'Pediram para cancelar' }), L.f1),
      h('li', null, h('span', { text: 'Dava para segurar' }), L.f2),
      h('li', null, h('span', { text: 'Abertos pelo robô' }), L.f3)),
    h('h3', { class: 'cx-h3', text: 'Por motivo' }),
    listaM,
    h('div', { class: 'cx-pe' }, L.ler, L.nota));
  document.body.append(dlg);
}
const L = {};
function escolher(k) {
  if (!k || k === S.sel) return;
  S.sel = k;
  listaM.querySelectorAll('[role="option"]').forEach((b) => { const on = b.dataset.k === k; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
  moverInd(); pintarDet();
}
function abrir() {
  if (!dlg) montar();
  const r = tile.getBoundingClientRect();
  dlg.style.setProperty('--ox', `${r.left + r.width / 2 - innerWidth / 2}px`); dlg.style.setProperty('--oy', `${r.top + r.height / 2 - innerHeight / 2}px`);
  S.aberto = true; pintarModal(); dlg.showModal();
  const sel = listaM.querySelector('[aria-selected="true"]'); if (sel) sel.focus({ preventScroll: true });
  carregar();
}
function fechar() {
  if (!dlg || !dlg.open) return;
  const fim = () => { dlg.classList.remove('sai'); dlg.close(); S.aberto = false; tile.focus({ preventScroll: true }); };
  if (REDUZ.matches) fim(); else { dlg.classList.add('sai'); setTimeout(fim, 180); }
}

function pintarLado() {
  const d = S.d;
  if (!d) { L.taxa.textContent = '—'; L.taxaT.textContent = 'Lendo…'; return; }
  const lendo = d.leitura && d.leitura.rodando;
  L.ler.disabled = !!lendo;
  L.ler.replaceChildren(ic('girar', lendo ? 'gira' : null), h('span', { text: lendo ? (d.leitura.etapa === 'analisando' ? `Analisando ${int(d.leitura.feitos)} de ${int(d.leitura.total)}` : `Lendo conversas ${int(d.leitura.feitos)} de ${int(d.leitura.total)}`) : (d.lidos ? 'Ler os motivos de novo' : 'Ler os motivos') }));
  L.taxa.textContent = pct(d.taxa);
  L.taxaT.textContent = `${int(d.cancelados)} de ${int(d.total_paineis)} painéis estão desativados no Sigma`;
  L.f1.textContent = d.lidos ? int(d.pediram_cancelar_conversa) : '—'; L.f1.className = d.pediram_cancelar_conversa ? 'erro' : '';
  L.f2.textContent = d.lidos ? `${int(d.evitaveis)} de ${int(d.lidos)}` : '—';
  L.f3.textContent = `${int(d.do_robo.cancelados)} de ${int(d.do_robo.total)}`;
  L.nota.textContent = d.analisado_em ? `Lidos ${hora(d.analisado_em)} · Haiku, uns centavos` : 'O robô lê as conversas no WhatsApp e o Haiku diz o motivo. Só leitura: nada é enviado.';
  pintarLista(d.motivos || []);
  requestAnimationFrame(moverInd);
}
function opcao(g) {
  const b = h('button', { type: 'button', role: 'option', class: 'cx-m', 'data-k': g.chave, onclick: () => escolher(g.chave) },
    h('span', { class: 'cx-m-t' }, h('b'), h('span', { class: 'cx-selo', title: 'O Opus já ensinou o Haiku a contornar' }, ic('ok'), 'corrigido')),
    h('span', { class: 'cx-m-n' }), h('span', { class: 'cx-barra', 'aria-hidden': 'true' }, h('i')));
  return b;
}
function pintarLista(motivos) {
  const atuais = new Map([...listaM.querySelectorAll('.cx-m')].map((b) => [b.dataset.k, b]));
  const bs = motivos.map((g) => {
    const b = atuais.get(g.chave) || opcao(g), on = g.chave === S.sel;
    b.classList.toggle('fraco', g.chave === 'nao_lido');
    b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1;
    const nome = b.querySelector('b'); nome.textContent = g.nome; nome.title = g.nome;
    b.querySelector('.cx-selo').hidden = !g.contorno;
    b.querySelector('.cx-m-n').textContent = int(g.n);
    b.querySelector('.cx-barra i').style.setProperty('--p', g.pct + '%');
    return b;
  });
  const mesmaOrdem = bs.length === atuais.size && bs.every((b, i) => listaM.children[i + 1] === b);
  if (!mesmaOrdem) listaM.replaceChildren(ind, ...bs);
  requestAnimationFrame(() => listaM.classList.toggle('corta', listaM.scrollHeight > listaM.clientHeight + 2 && listaM.scrollTop + listaM.clientHeight < listaM.scrollHeight - 4));
  if (!listaM.dataset.pintado) setTimeout(() => { listaM.dataset.pintado = '1'; }, 700);   // barras crescem só na primeira vez
}
function moverInd() {
  const b = listaM && listaM.querySelector('[aria-selected="true"]');
  if (!b) { ind.style.opacity = '0'; return; }
  ind.style.opacity = '1'; ind.style.transform = `translateY(${b.offsetTop}px)`; ind.style.height = b.offsetHeight + 'px';
  b.scrollIntoView({ block: 'nearest', behavior: REDUZ.matches ? 'auto' : 'smooth' });
}

function pessoa(p) {
  const u = zap(p.whatsapp);
  return h('li', { class: 'cx-p' },
    h('span', { class: 'sg-av', 'aria-hidden': 'true', text: (String(p.nome || '?').trim()[0] || '?').toUpperCase() }),
    h('div', { class: 'cx-p-t' },
      h('b', null, p.nome || '—', p.pediu_cancelar ? h('span', { class: 'cx-tag', text: 'pediu para cancelar' }) : null),
      p.citacao ? h('q', { text: p.citacao }) : null,
      h('span', { text: p.motivo || (p.clientes_total ? `${p.clientes_total} clientes criados` : 'Não criou nenhum cliente') })),
    u ? h('a', { class: 'sg-zap', href: u, target: '_blank', rel: 'noopener noreferrer', 'aria-label': `Conversar com ${p.nome} no WhatsApp`, title: 'Abrir no WhatsApp Web' }, ic('chat')) : null);
}

function pintarDet() {
  const d = S.d; if (!d) { det.replaceChildren(); return; }
  const g = (d.motivos || []).find((x) => x.chave === S.sel);
  if (!g) { det.replaceChildren(h('div', { class: 'cx-vazio' }, ic('ok'), h('b', { text: 'Nenhum painel cancelado' }), h('span', { text: 'Quando algum painel for desativado no Sigma, ele aparece aqui com o motivo.' }))); return; }
  if (g.chave === 'nao_lido') {
    det.replaceChildren(h('div', { class: 'cx-vazio' }, ic('busca'), h('b', { text: `${int(g.n)} ${plural(g.n, 'painel ainda sem motivo', 'painéis ainda sem motivo')}` }),
      h('span', { text: 'Clique em "Ler os motivos": o robô lê a conversa de cada um no WhatsApp e o Haiku diz por que desistiram. Leva uns 2 minutos.' })));
    return;
  }
  const op = d.opus || {}, estudando = op.rodando && op.categoria === g.chave, outro = op.rodando && op.categoria !== g.chave;
  const falhou = !op.rodando && op.ultimo && op.ultimo.categoria === g.chave && !op.ultimo.ok ? op.ultimo : null;
  const c = g.contorno;
  const btnCorrigir = g.corrigivel ? h('button', { type: 'button', class: 'btn principal cx-corrigir', disabled: op.rodando || null, onclick: () => corrigir(g) },
    estudando ? ic('girar', 'gira') : ic('faisca'), h('span', { text: estudando ? 'O Opus está estudando…' : c ? 'Corrigir de novo' : 'Corrigir erro' })) : null;
  const topo = h('header', { class: 'cx-det-topo' },
    h('div', null, h('h3', { text: g.nome }),
      h('p', { class: 'cx-sub', text: `${int(g.n)} ${plural(g.n, 'painel', 'painéis')} · ${g.pct}% dos cancelados` + (g.evitaveis ? ` · ${int(g.evitaveis)} ${plural(g.evitaveis, 'dava para segurar', 'davam para segurar')}` : '') })),
    btnCorrigir);
  const blocos = [topo];
  if (S.msg) { blocos.push(h('p', { class: 'cx-aviso', role: 'alert' }, ic('alerta'), h('span', { text: 'Não deu certo: ' + S.msg }))); S.msg = null; }
  if (!g.corrigivel) blocos.push(h('p', { class: 'cx-aviso' }, ic('alerta'), h('span', { text: 'Esses painéis foram desativados pela equipe. Não é coisa do atendimento corrigir.' })));
  if (estudando) blocos.push(h('div', { class: 'cx-estudo', role: 'status' }, h('span', { class: 'cx-pulso', 'aria-hidden': 'true' }),
    h('div', null, h('b', { text: 'O Opus está lendo as conversas de quem desistiu' }), h('span', { text: 'Ele compara com as diretrizes do Jarvis, acha onde o atendimento falhou e escreve como contornar. Leva de 1 a 3 minutos.' }))));
  else if (outro) blocos.push(h('p', { class: 'cx-aviso fraco' }, ic('girar'), h('span', { text: 'O Opus está estudando outro motivo agora. Este fica liberado quando ele terminar.' })));
  if (falhou) blocos.push(h('p', { class: 'cx-aviso' }, ic('alerta'), h('span', { text: 'Não deu certo da última vez: ' + falhou.erro })));
  if (c) {
    blocos.push(h('section', { class: 'cx-aprendeu' },
      h('header', null, h('h4', null, ic('livro'), 'O que o Opus ensinou ao Haiku'),
        h('button', { type: 'button', class: 'cx-desfazer', onclick: () => desfazer(g) }, ic('desfazer'), h('span', { text: 'Desfazer' }))),
      c.diagnostico ? h('p', { class: 'cx-diag', text: c.diagnostico }) : null,
      h('ul', { class: 'cx-regras' }, ...c.regras.map((r) => h('li', null, ic('ok'), h('span', { text: r.replace(/^- /, '') })))),
      c.exemplo && c.exemplo.cliente ? h('div', { class: 'cx-exemplo', 'aria-label': 'Exemplo de conversa' },
        h('p', { class: 'cx-bal cli', text: c.exemplo.cliente }), ...(c.exemplo.jarvis || []).map((t) => h('p', { class: 'cx-bal jv', text: t }))) : null,
      c.para_o_senhor && c.para_o_senhor.length ? h('div', { class: 'cx-senhor' }, h('b', { text: 'Para o senhor resolver' }), h('ul', null, ...c.para_o_senhor.map((t) => h('li', { text: t })))) : null,
      h('p', { class: 'cx-nota', text: `Nas diretrizes do Haiku (base.md) desde ${hora(c.em)} · ${int(c.casos)} conversas estudadas` + (c.custo ? ` · US$ ${c.custo.toFixed(2).replace('.', ',')}` : '') + (c.rejeitadas && c.rejeitadas.length ? ` · ${c.rejeitadas.length} ${plural(c.rejeitadas.length, 'regra barrada', 'regras barradas')} por prometer o que não está nas diretrizes` : '') })));
  }
  blocos.push(h('h4', { class: 'cx-h4', text: 'Quem desistiu' }), h('ul', { class: 'cx-pessoas' }, ...g.pessoas.slice(0, 60).map(pessoa)));
  const rolar = h('div', { class: 'cx-rolar', tabindex: '0', role: 'region', 'aria-label': 'Detalhes do motivo' }, ...blocos);
  const antes = det.querySelector('.cx-rolar'), mesmo = det.dataset.k === g.chave, y = antes ? antes.scrollTop : 0;
  det.replaceChildren(rolar); det.dataset.k = g.chave;
  if (mesmo) rolar.scrollTop = y; else if (!REDUZ.matches) rolar.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.23,1,.32,1)' });
}
function pintarModal() {
  if (!dlg) return;
  const d = S.d;
  if (d && (!S.sel || !(d.motivos || []).some((g) => g.chave === S.sel))) S.sel = (d.motivos || [])[0] ? d.motivos[0].chave : null;
  pintarLado(); pintarDet();
}

/* ---------- Ações ---------- */
async function ler() {
  try { await post('/api/cancelados/ler', {}); } catch (e) { S.msg = e.message; }
  carregar();
}
async function corrigir(g) {
  try { await post('/api/cancelados/corrigir', { categoria: g.chave }); } catch (e) { S.msg = e.message; }
  carregar();
}
async function desfazer(g) {
  if (!confirm(`Tirar das diretrizes do Haiku o que o Opus ensinou sobre "${g.nome}"?`)) return;
  try { await post('/api/cancelados/desfazer', { categoria: g.chave }); } catch (e) { S.msg = e.message; }
  carregar();
}

/* ---------- Dados ---------- */
async function carregar() {
  clearTimeout(S.timer);
  try { const r = await fetch(BASE + '/api/cancelados', { cache: 'no-store' }); S.d = await r.json(); S.erro = null; } catch (e) { S.erro = e; }
  encaixar(); pintarTile(); if (S.aberto) pintarModal();
  const ocupado = S.d && ((S.d.leitura && S.d.leitura.rodando) || (S.d.opus && S.d.opus.rodando));
  if (S.vis || S.aberto) S.timer = setTimeout(carregar, ocupado ? 3000 : 60000);
}
function conferirVista() {
  const vis = appEl.dataset.vista === 'sigma';
  if (vis === S.vis) return; S.vis = vis;
  if (vis) carregar(); else if (!S.aberto) clearTimeout(S.timer);
}
new MutationObserver(conferirVista).observe(appEl, { attributes: true, attributeFilter: ['data-vista'] });
/* o Sigma refaz a fila de números a cada leitura: devolve o cartão para o lugar */
const kp = document.querySelector('.sg-kpis');
if (kp) new MutationObserver(() => { if (tile.parentNode !== kp) kp.append(tile); }).observe(kp, { childList: true });
addEventListener('resize', () => { if (S.aberto) moverInd(); });
encaixar(); conferirVista();
})();
