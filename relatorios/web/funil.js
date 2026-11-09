/* Tela Funil do Atendimento da revenda (08/11/2026). JS puro, sem dependências, nada de innerHTML com dado de fora.
   Fonte: GET /api/funil?dias=1|7. Ações: POST /api/funil/pausar | retomar | jogadas (sempre com corpo JSON).
   PC: vista "Funil" do seletor do topo. Celular: aba "Funil", com Funil | Jornada no alto.
   Prefixo fn- nesta tela; fk- nas peças comuns (diálogo, rede, datas), que a jornada.js também usa via window.funilKit. */
(() => {
'use strict';

const appEl = document.getElementById('app');
const raiz = document.getElementById('fn');
if (!appEl || !raiz) return;

const BASE = location.protocol === 'file:' ? 'http://127.0.0.1:8811' : '';
const REDUZ = matchMedia('(prefers-reduced-motion: reduce)');
const MOVEL = matchMedia('(max-width: 820px), (max-height: 500px) and (pointer: coarse)');
const ATUALIZA_MS = 60000;

/* =====================================================================
   Kit comum (também usado pela jornada.js)
   ===================================================================== */
function h(tag, props, ...filhos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const f of filhos.flat()) { if (f == null || f === false) continue; el.append(f.nodeType ? f : document.createTextNode(String(f))); }
  return el;
}
const NS = 'http://www.w3.org/2000/svg';
const ICONES = {
  ok: '<path d="M5 12.5 10 17.5 19 7"/>',
  alerta: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5"/><path d="M12 16.5h.01"/>',
  caixa: '<path d="m4 13 2-7h12l2 7v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z"/><path d="M4 13h4l1 2h6l1-2h4"/>',
  gira: '<path d="M12 3a9 9 0 1 0 9 9"/>',
  pausa: '<rect x="6.5" y="5" width="3.8" height="14" rx="1.2"/><rect x="13.7" y="5" width="3.8" height="14" rx="1.2"/>',
  play: '<path d="M8 5.5v13l10.5-6.5Z"/>',
  ideia: '<path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1.1 1.2 1.1 2.2h5c0-1 .5-1.7 1.1-2.2A6 6 0 0 0 12 3Z"/>',
  livro: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5Z"/><path d="M4 5.5v16"/>',
  seta: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
  etiqueta: '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9Z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  enviar: '<path d="M21 3 10 14"/><path d="m21 3-7 18-4-7-7-4Z"/>',
  relogio: '<path d="M12 7v5l3 2"/><circle cx="12" cy="12" r="9"/>',
  escudo: '<path d="M12 3 5 6v6c0 4.4 3 7.6 7 9 4-1.4 7-4.6 7-9V6Z"/>',
  funil: '<path d="M4 5h16l-6 7.5V19l-4 1.5v-8Z"/>',
};
function ic(nome) {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '1.8'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true'); s.innerHTML = ICONES[nome] || '';
  return s;
}
function giro() { const s = ic('gira'); s.classList.add('gira'); return s; }
const num = v => (v == null || v === '' || typeof v === 'boolean' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
const int = v => { const n = num(v); return n == null ? '—' : Math.round(n).toLocaleString('pt-BR'); };
const lista = v => (Array.isArray(v) ? v : []);
const txt = v => (v == null ? '' : String(v)).replace(/[\p{Co}\u0000-\u0008\u000B\u000C\u000E-\u001F]/gu, '').trim();
const pctTxt = f => { const n = num(f); return n == null ? '—' : `${Math.round((n <= 1 ? n * 100 : n))}%`; };
const plural = (n, um, varios) => `${int(n)} ${num(n) === 1 ? um : varios}`;
/* Telefone: só os 4 últimos dígitos, venha como vier (a API já manda mascarado; isto é só cinto e suspensório). */
function masc(v) { const d = String(v == null ? '' : v).replace(/\D/g, ''); return d.length >= 2 ? `•••• ${d.slice(-4)}` : ''; }
/* Nome que é só número (telefone ou id do WhatsApp) vira "Contato" + final do telefone */
function nomeSeguro(nome, tel) {
  const t = txt(nome);
  if (t.replace(/\D/g, '').length >= 8) return `Contato ${masc(tel) || masc(t)}`.trim();
  return t.replace(/^[-.\s]+$/, '') || 'Sem nome';
}
/* replaceChildren que ignora null/false (senão o navegador escreve "null" na tela) */
const trocar = (el, ...nos) => el.replaceChildren(...nos.flat().filter(n => n != null && n !== false));
const inicial = n => (txt(n).replace(/[^\p{L}\p{N}]/gu, '')[0] || '?').toUpperCase();

function data(v) { if (v == null || v === '') return null; const d = new Date(v); return isNaN(d) ? null : d; }
const hhmm = d => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const mesmoDia = (a, b) => a.toDateString() === b.toDateString();
function diaRel(d) {
  const ag = new Date(); if (mesmoDia(d, ag)) return 'hoje';
  const o = new Date(ag); o.setDate(o.getDate() - 1); if (mesmoDia(d, o)) return 'ontem';
  const a = new Date(ag); a.setDate(a.getDate() + 1); if (mesmoDia(d, a)) return 'amanhã';
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function proxLabel(v) {
  const d = data(v); if (!d) return '';
  const m = Math.round((d.getTime() - Date.now()) / 60000);
  if (m <= 0) return 'agora';
  if (m < 60) return `em ${m} min`;
  return `${diaRel(d)} às ${hhmm(d)}`;
}
function atras(v) {
  const d = data(v); if (!d) return '';
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 3600) return s < 60 ? 'agora há pouco' : `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  return `há ${Math.floor(s / 86400)} d`;
}
const quandoCurto = v => { const d = data(v); return d ? `${diaRel(d)} ${hhmm(d)}` : ''; };
const dias = () => (window.relatorios && window.relatorios.dias ? window.relatorios.dias() : 1);
const aviso = (msg, erro) => { if (window.relatorios && window.relatorios.aviso) window.relatorios.aviso(msg, erro); };

/* Números que contam até o valor novo (só no que é herói) */
function contar(el, alvo, fmt = v => Math.round(v).toLocaleString('pt-BR')) {
  cancelAnimationFrame(el._raf);
  if (alvo == null) { el._v = null; el.textContent = '—'; return; }
  const de = el._v == null ? 0 : el._v;
  const fim = () => { el.textContent = fmt(alvo); el._v = alvo; };
  if (REDUZ.matches || de === alvo || document.hidden) return fim();
  const t0 = performance.now(), dur = 650;
  const passo = agora => {
    const t = Math.min(1, (agora - t0) / dur), e = 1 - Math.pow(1 - t, 3);
    if (t >= 1) return fim();
    const v = de + (alvo - de) * e; el.textContent = fmt(v); el._v = v;
    el._raf = requestAnimationFrame(passo);
  };
  el._raf = requestAnimationFrame(passo);
}

/* Rede: GET simples; POST sempre com Content-Type JSON e corpo JSON (a API recusa sem). */
async function pegar(caminho, { metodo = 'GET', corpo, limite = 15000 } = {}) {
  const ctl = new AbortController();
  const corta = setTimeout(() => ctl.abort(new DOMException('tempo esgotado', 'TimeoutError')), limite);
  try {
    const opt = { method: metodo, signal: ctl.signal, cache: 'no-store', headers: { Accept: 'application/json' } };
    if (metodo !== 'GET') { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(corpo || {}); }
    const r = await fetch(BASE + caminho, opt);
    const tipo = r.headers.get('content-type') || '';
    if (r.status === 401 || (r.ok && /text\/html/i.test(tipo))) throw Object.assign(new Error('HTTP 401'), { status: 401 });
    let j = null; try { j = await r.json(); } catch { /* sem corpo */ }
    if (!r.ok) throw Object.assign(new Error(txt(j && j.erro) || 'HTTP ' + r.status), { status: r.status, corpo: j });
    return j || {};
  } finally { clearTimeout(corta); }
}
const MSG_FALHA = 'Não consegui falar com o robô agora. Confira se o PC está ligado e tente de novo.';
function msgErro(e) {
  if (e && (e.status === 404 || e.status === 501)) return 'Essa ação ainda está sendo preparada no robô.';
  if (e && e.status === 400 && e.message && !/^HTTP/.test(e.message)) return 'O robô recusou o pedido: ' + e.message + '.';
  return MSG_FALHA;
}

/* ---------- Diálogo de confirmação (vidro, centro no PC, folha de baixo no celular) ----------
   dialogo({ titulo, texto, itens, nota, notaAviso, ok, icone, acao, progresso, gatilho })
   acao(): Promise<{ ok, titulo, texto }> roda depois do OK; sem acao, só confirma e devolve true. */
let dlg = null;
function montarDlg() {
  dlg = h('dialog', { class: 'fk-dlg', 'aria-labelledby': 'fk-dlg-t', 'aria-describedby': 'fk-dlg-p' });
  dlg.addEventListener('cancel', ev => { ev.preventDefault(); if (!dlg._ocupado) fecharDlg(); });
  dlg.addEventListener('click', ev => { if (ev.target === dlg && !dlg._ocupado) fecharDlg(); });
  document.body.append(dlg);
}
function fecharDlg(valor) {
  if (!dlg || !dlg.open) return;
  const fim = () => { dlg.classList.remove('sai'); if (dlg.open) dlg.close(); const g = dlg._gatilho; if (g && g.isConnected && g.focus) g.focus({ preventScroll: true }); };
  if (dlg._resolve) { dlg._resolve(valor === true); dlg._resolve = null; }
  if (REDUZ.matches) fim(); else { dlg.classList.add('sai'); setTimeout(fim, 170); }
}
function telaDlg(...nos) {
  const v = h('div', { class: 'fk-dlg-in' }, nos.filter(Boolean));
  trocar(dlg, v);
  const foco = v.querySelector('[data-foco]') || v.querySelector('button');
  if (foco) foco.focus({ preventScroll: true });
}
function dialogo(o) {
  if (!dlg) montarDlg();
  dlg._gatilho = o.gatilho || document.activeElement; dlg._ocupado = false;
  return new Promise(resolve => {
    dlg._resolve = resolve;
    const confirmar = async () => {
      if (!o.acao) { fecharDlg(true); return; }
      dlg._ocupado = true;
      telaDlg(h('div', { class: 'fk-dlg-selo', role: 'status' }, giro()), h('h2', { id: 'fk-dlg-t', text: o.progresso || 'Pedindo ao robô…' }),
        h('p', { id: 'fk-dlg-p', class: 'fk-dlg-p', text: 'Só um instante.' }));
      let r;
      try { r = await o.acao(); } catch (e) { r = { ok: false, titulo: 'Não deu certo', texto: msgErro(e) }; }
      dlg._ocupado = false;
      if (dlg._resolve) { dlg._resolve(!!(r && r.ok)); dlg._resolve = null; }
      telaDlg(h('div', { class: 'fk-dlg-selo ' + (r && r.ok ? 'ok' : 'erro'), role: 'status' }, ic(r && r.ok ? 'ok' : 'alerta')),
        h('h2', { id: 'fk-dlg-t', text: (r && r.titulo) || 'Pronto' }), r && r.texto ? h('p', { id: 'fk-dlg-p', class: 'fk-dlg-p', text: r.texto }) : null,
        h('div', { class: 'fk-dlg-bts' }, h('button', { type: 'button', class: 'btn principal', 'data-foco': '', onclick: () => fecharDlg(), text: 'Fechar' })));
    };
    telaDlg(
      o.icone ? h('div', { class: 'fk-dlg-selo' }, ic(o.icone)) : null,
      h('h2', { id: 'fk-dlg-t', text: o.titulo }),
      o.texto ? h('p', { id: 'fk-dlg-p', class: 'fk-dlg-p', text: o.texto }) : null,
      o.itens && o.itens.length ? h('ul', { class: 'fk-dlg-lista' }, o.itens.map(t => h('li', { text: t }))) : null,
      o.notaAviso ? h('p', { class: 'fk-dlg-nota aviso' }, ic('alerta'), h('span', { text: o.notaAviso })) : null,
      o.nota ? h('p', { class: 'fk-dlg-nota', text: o.nota }) : null,
      h('div', { class: 'fk-dlg-bts' },
        h('button', { type: 'button', class: 'btn', 'data-foco': '', onclick: () => fecharDlg(false), text: 'Cancelar' }),
        h('button', { type: 'button', class: 'btn principal', onclick: confirmar, text: o.ok || 'Confirmar' })));
    dlg.showModal();
  });
}

/* Botão em espera: mostra o giro e o texto, e volta como era */
function ocupar(btn, on, texto) {
  if (on) { btn._antes = [...btn.childNodes]; btn.disabled = true; btn.setAttribute('aria-busy', 'true'); trocar(btn, giro(), h('span', { text: texto })); }
  else { btn.disabled = false; btn.removeAttribute('aria-busy'); if (btn._antes) trocar(btn, ...btn._antes); }
}
/* Corpo rolável: esmaece o pé quando há mais conteúdo abaixo */
function rolavel(el) {
  const marca = () => el.classList.toggle('mais-abaixo', el.scrollTop + el.clientHeight < el.scrollHeight - 3);
  el.addEventListener('scroll', marca, { passive: true }); addEventListener('resize', marca);
  el._marca = marca; return el;
}
function vazio(icone, texto) { return h('div', { class: 'vazio' }, ic(icone), h('span', { text: texto })); }
function cartao(cls, titulo, { sub, acao, rolar = true, rotulo } = {}) {
  const sb = h('span', { class: 'sub' });
  const corpo = h('div', { class: 'corpo' + (rolar ? '' : ' fixo'), tabindex: rolar ? '0' : null, role: rolar ? 'region' : null, 'aria-label': rolar ? (rotulo || titulo) : null });
  const el = h('article', { class: 'cartao fk-card ' + cls },
    h('header', null, h('h2', { text: titulo }), sb, acao || null), corpo);
  if (sub) sb.textContent = sub;
  if (rolar) rolavel(corpo);
  return { el, sub: sb, corpo };
}
function assinatura(o) { try { return JSON.stringify(o); } catch { return String(Math.random()); } }

window.funilKit = { h, ic, giro, trocar, num, int, lista, txt, pctTxt, plural, masc, nomeSeguro, inicial, data, hhmm, diaRel, proxLabel, atras, quandoCurto, contar, pegar, msgErro, MSG_FALHA, dialogo, ocupar, rolavel, vazio, cartao, assinatura, aviso, REDUZ, MOVEL, ATUALIZA_MS };

/* =====================================================================
   Celular: Funil | Jornada no alto da aba
   ===================================================================== */
const segFj = document.getElementById('seletor-fj');
function irFj(v, { rolar = true } = {}) {
  v = v === 'jornada' || v === 'trafego' ? v : 'funil';   /* Tráfego: terceira opção da aba (trafego.js) */
  appEl.dataset.fj = v;
  if (segFj) {
    segFj.dataset.pos = v === 'jornada' ? '1' : v === 'trafego' ? '2' : '0';
    segFj.querySelectorAll('button').forEach(b => { const on = b.dataset.fj === v; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; });
  }
  if (rolar) scrollTo(0, 0);
}
if (segFj) {
  segFj.addEventListener('click', ev => { const b = ev.target.closest('button[data-fj]'); if (b) irFj(b.dataset.fj); });
  segFj.addEventListener('keydown', ev => {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(ev.key)) return;
    ev.preventDefault(); const ordem = ['funil', 'jornada', 'trafego'], passo = ev.key === 'ArrowRight' || ev.key === 'ArrowDown' ? 1 : -1;
    irFj(ordem[(ordem.indexOf(appEl.dataset.fj || 'funil') + passo + 3) % 3]); segFj.querySelector('[aria-checked="true"]').focus();
  });
}
irFj(appEl.dataset.fj || 'funil', { rolar: false });

/* =====================================================================
   Tela Funil
   ===================================================================== */
const ROT_TIPO = { ao_vivo: 'Escada ao vivo', atrasado: 'Fila do atrasado', cadencia: 'Cadência', jornada: 'Jornada', retomada: 'Robô retomou', lacuna: 'Retorno de lacuna', conversa_direta: 'Conversa direta' };
const ROT_DEVIDO = { responder: ['resposta', 'respostas'], cadencia: ['toque da cadência', 'toques da cadência'], retomada: ['retomada', 'retomadas'], jornada: ['toque da jornada', 'toques da jornada'] };
const ROT_SINAL = { sem_aparelho: 'sem aparelho', sumiu_depois_do_link: 'sumiu depois do link', testando: 'testando' };
const ROT_ETQ = { revendedor: 'Revendedor', lead: 'Lead', teste: 'Teste', esfriou: 'Esfriou', suporte: 'Suporte', senhor: 'Senhor', atrasado: 'Atrasado' };
const COR_ETQ = { revendedor: '#30d158', lead: '#5be7ff', teste: '#bf5af2', esfriou: '#64a8ff', suporte: '#ffd60a', senhor: '#ff9f0a', atrasado: '#ff6961' };
const COR_NOME = { verde: '#30d158', azul: '#0a84ff', 'azul claro': '#64d2ff', ciano: '#5be7ff', amarelo: '#ffd60a', laranja: '#ff9f0a', vermelho: '#ff453a', roxo: '#bf5af2', rosa: '#ff375f', cinza: '#8e8e93', marrom: '#ac8e68' };
const SEM = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const S = { d: null, conv: dias() === 7 ? 'sete' : 'hoje', sig: {}, vis: false, ocupado: null, lendo: false };

/* ---------- Esqueleto ---------- */
const avisoRede = h('div', { class: 'fk-aviso', role: 'status', hidden: true }, ic('alerta'), h('span', { text: 'Sem conexão com o robô agora. Mostrando os últimos números; tento de novo em instantes.' }));
const geral = h('div', { class: 'fk-geral', hidden: true }, ic('caixa'), h('p', { class: 'fk-geral-t' }), h('span', { class: 'fk-geral-d' }));
const grade = h('div', { class: 'fn-grade' });

/* herói: leads sem próximo passo */
const heroi = h('article', { class: 'cartao fk-card fn-heroi', 'aria-labelledby': 'fn-heroi-t' });
const hVal = h('div', { class: 'fn-heroi-num', 'aria-hidden': 'true' });
const hLeitor = h('span', { class: 'so-leitor', 'aria-live': 'polite' });
const hSelo = h('span', { class: 'fn-heroi-selo' });
const hLeg = h('p', { class: 'fn-heroi-leg' });
const hNomes = h('ul', { class: 'fn-nomes', 'aria-label': 'Leads sem próximo passo' });
const hMini = h('div', { class: 'fn-mini' });
heroi.append(h('header', null, h('h2', { id: 'fn-heroi-t', text: 'Leads sem próximo passo' }), h('span', { class: 'sub fn-meta', text: 'meta 0' })),
  h('div', { class: 'fn-heroi-linha' }, hSelo, hVal, hLeitor), hLeg, hNomes, hMini);

/* funil em degraus, com Hoje | 7 dias */
const segConv = h('div', { class: 'seletor fn-seg', role: 'radiogroup', 'aria-label': 'Período do funil', 'data-pos': '0' },
  h('span', { class: 'pilula', 'aria-hidden': 'true' }),
  h('button', { type: 'button', role: 'radio', 'aria-checked': 'true', 'data-c': 'hoje', text: 'Hoje' }),
  h('button', { type: 'button', role: 'radio', 'aria-checked': 'false', 'data-c': 'sete', tabindex: '-1', text: '7 dias' }));
const cFunil = cartao('fn-funil', 'Funil', { acao: segConv, rolar: false });
const degraus = h('ol', { class: 'fn-degraus', 'aria-label': 'Etapas do funil' });
const fnTotal = h('p', { class: 'fn-total' });
cFunil.corpo.append(degraus, fnTotal);

/* ritmo: proativos de hoje x teto, cadência */
const btPausa = h('button', { type: 'button', class: 'btn fn-pausa' }, ic('pausa'), h('span', { text: 'Pausar cadência' }));
const cRitmo = cartao('fn-ritmo', 'Toques do robô hoje', { rolar: false });
const anel = h('div', { class: 'fn-anel' });
anel.innerHTML = '<svg viewBox="0 0 100 100" aria-hidden="true"><defs><linearGradient id="fn-grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7aedff"/><stop offset="1" stop-color="#00c7ff"/></linearGradient></defs><circle class="trk" cx="50" cy="50" r="42" fill="none" stroke-width="9"/><circle class="pr" cx="50" cy="50" r="42" fill="none" stroke-width="9" stroke-linecap="round" stroke-dasharray="263.9"/></svg>';
const anelC = h('div', { class: 'fn-anel-c' }, h('b', { class: 'fn-anel-n' }), h('span', { class: 'fn-anel-t' }));
anel.append(anelC);
const ritmoLista = h('ul', { class: 'fn-tipos' });
const ritmoEstado = h('div', { class: 'fn-cad' });
cRitmo.corpo.append(h('div', { class: 'fn-ritmo-topo' }, anel, ritmoLista), ritmoEstado);

const cEstados = cartao('fn-estados', 'Leads por estado');
const cProx = cartao('fn-prox', 'Próximos toques');
const grafico = h('div', { class: 'fn-dias', role: 'img' });
const proxLista = h('ul', { class: 'fn-lista' });
cProx.corpo.append(grafico, h('div', { class: 'fn-dias-leg', 'aria-hidden': 'true' }, h('span', null, h('i'), 'Cadência'), h('span', null, h('i', { class: 'j' }), 'Jornada')), h('h3', { class: 'titulinho fn-tt', text: 'Fila, do mais cedo ao mais tarde' }), proxLista);
/* celular: a fila mostra 5 e o resto atrás do "Ver todos" (no PC a lista rola dentro do cartão) */
const btVerProx = h('button', { type: 'button', class: 'ver-mais fn-ver', 'aria-expanded': 'false', hidden: true });
btVerProx.addEventListener('click', () => {
  const aberto = cProx.el.classList.toggle('aberto');
  btVerProx.setAttribute('aria-expanded', String(aberto));
  btVerProx.textContent = aberto ? 'Ver menos' : `Ver todos (${proxLista.children.length})`;
  if (!aberto) cProx.el.scrollIntoView({ block: 'nearest' });
});
cProx.corpo.append(btVerProx);
const cRisco = cartao('fn-risco', 'Leads em risco');
const cAB = cartao('fn-ab', 'Testes A/B');
const cOrigem = cartao('fn-origem', 'De onde vieram os painéis');
const btLer = h('button', { type: 'button', class: 'btn fn-ler' }, ic('livro'), h('span', { text: 'Ler agora' }));
const cJog = cartao('fn-jog', 'Livro de jogadas', { acao: btLer });
const cSug = cartao('fn-sug', 'Para o senhor decidir');
/* frios: quem esfriou, se está na fila e quando sai; botão "Atender todos" (pedido do senhor 08/11) */
const btFrios = h('button', { type: 'button', class: 'btn principal fn-reaq' }, ic('enviar'), h('span', { text: 'Atender todos' }));
const cFrios = cartao('fn-frios', 'Leads frios', { acao: btFrios, rotulo: 'Leads frios e a fila de atendimento' });
const friosResumo = h('div', { class: 'fn-fr-res' });
const friosRitmo = h('p', { class: 'fn-fr-ritmo' });
const friosLista = h('div', { class: 'fn-fr-lista' });
const btVerFrios = h('button', { type: 'button', class: 'ver-mais fn-ver', 'aria-expanded': 'false', hidden: true });
btVerFrios.addEventListener('click', () => {
  const aberto = cFrios.el.classList.toggle('aberto');
  btVerFrios.setAttribute('aria-expanded', String(aberto));
  btVerFrios.textContent = aberto ? 'Ver menos' : `Ver todos (${friosLista.querySelectorAll('li').length})`;
  if (!aberto) cFrios.el.scrollIntoView({ block: 'nearest' });
});
cFrios.corpo.append(friosResumo, friosRitmo, friosLista, btVerFrios);

/* esqueleto de carregamento: mesmo espaço do conteúdo, sem tela vazia */
const sk = (...w) => w.map(x => h('span', { class: 'sk', style: `width:${x}%` }));
friosLista.append(...sk(70, 90, 60, 80));
[cEstados.corpo, cRisco.corpo, cAB.corpo, cOrigem.corpo, cJog.corpo, cSug.corpo].forEach(c => c.append(...sk(62, 88, 74, 80)));
proxLista.append(h('li', null, ...sk(70, 90, 60)));
degraus.append(h('li', { class: 'fn-sk' }, ...sk(100, 100, 100)));
hVal.textContent = '—';

const cartoes = [heroi, cFunil.el, cRitmo.el, cEstados.el, cProx.el, cRisco.el, cAB.el, cOrigem.el, cJog.el, cSug.el, cFrios.el];
cartoes.forEach((c, i) => c.style.setProperty('--i', i));
grade.append(...cartoes);
raiz.append(avisoRede, geral, grade);

/* ---------- Pintura ---------- */
function so(chave, valor, fn) { const s = assinatura(valor); if (S.sig[chave] === s) return; S.sig[chave] = s; fn(); }
const linhaPessoa = (l, { risco } = {}) => {
  const nome = nomeSeguro(l.nome, l.telefone), tel = masc(l.telefone), p = l.proximo || {};
  const quando = p.quando ? proxLabel(p.quando) : '';
  const sinal = ROT_SINAL[l.sinal] || txt(l.sinal).replace(/_/g, ' ');
  /* detalhe que só repete o rótulo ("D+1 · ajuda" ao lado de "D+1 · ajuda prática") fica de fora */
  const det = txt(p.detalhe), rot = txt(p.rotulo);
  const repete = !det || det === rot || det.split(' · ')[0].toLowerCase() === rot.split(' · ')[0].toLowerCase();
  return h('li', { class: 'fn-pessoa' + (risco ? ' risco' : '') },
    h('span', { class: 'avatar', 'aria-hidden': 'true', text: inicial(nome) }),
    h('div', { class: 'fn-p1' },
      h('span', { class: 'nome', text: nome }), tel && !nome.endsWith(tel) ? h('span', { class: 'tel', text: tel }) : null,
      l.travado ? h('span', { class: 'pilula-t aviso', text: 'travado' }) : null,
      h('span', { class: 'fn-quando' + (quando === 'agora' ? ' agora' : ''), text: quando })),
    h('div', { class: 'fn-p2' },
      h('b', { text: txt(p.rotulo) || 'Sem próximo passo' }),
      repete ? null : h('span', { class: 'corta', text: det })),
    h('div', { class: 'fn-p3' },
      h('span', { class: 'pilula-t neutra', text: txt(l.estado_rotulo) || 'Sem estado' }),
      sinal ? h('span', { text: sinal }) : null,
      num(l.toques) ? h('span', { text: plural(l.toques, 'toque', 'toques') }) : h('span', { text: 'nenhum toque ainda' })));
};

function pintarHeroi(d) {
  const n = num(d.leads_sem_proximo_passo);
  heroi.classList.toggle('ok', n === 0); heroi.classList.toggle('alerta', n != null && n > 0); heroi.classList.toggle('sem', n == null);
  trocar(hSelo, ic(n === 0 ? 'ok' : 'alerta'));
  contar(hVal, n);
  const nomes = lista(d.sem_proximo_passo_nomes).map(x => nomeSeguro(typeof x === 'object' && x ? x.nome : x));
  if (n === 0) { hLeg.textContent = 'Todo lead vivo tem o próximo toque marcado.'; hLeitor.textContent = 'Nenhum lead sem próximo passo. Meta cumprida.'; }
  else if (n > 0) {
    const desde = data(d.alerta_desde);
    hLeg.textContent = `${n === 1 ? 'Um lead ficou' : `${int(n)} leads ficaram`} sem o próximo toque${desde ? `, desde ${diaRel(desde) === 'hoje' ? '' : diaRel(desde) + ' '}${hhmm(desde)}` : ''}.`;
    hLeitor.textContent = `${int(n)} ${n === 1 ? 'lead' : 'leads'} sem próximo passo. A meta é zero.`;
  } else { hLeg.textContent = 'O vigia ainda não contou os leads.'; hLeitor.textContent = ''; }
  const vis = nomes.slice(0, 6);
  trocar(hNomes, ...vis.map(t => h('li', { text: t })), nomes.length > 6 ? h('li', { class: 'mais', text: `e mais ${nomes.length - 6}` }) : null);
  hNomes.hidden = !(n > 0 && nomes.length);
  trocar(hMini, 
    h('div', null, h('b', { text: int(d.leads_vivos) }), h('span', { text: `leads vivos de ${int(d.leads_total)}` })),
    h('div', { class: num(d.esperando_senhor) ? 'quente' : '' }, h('b', { text: int(d.esperando_senhor || 0) }), h('span', { text: 'esperando o senhor' })));
}

function pintarFunil(d) {
  const etapas = lista(d.conversao && d.conversao[S.conv === 'sete' ? 'sete_dias' : 'hoje']);
  segConv.dataset.pos = S.conv === 'sete' ? '1' : '0';
  segConv.querySelectorAll('button').forEach(b => { const on = b.dataset.c === S.conv; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; });
  if (!etapas.length || !etapas.some(e => num(e.qtd))) {
    trocar(degraus, ); fnTotal.textContent = '';
    cFunil.corpo.querySelector('.vazio')?.remove();
    cFunil.corpo.prepend(vazio('funil', S.conv === 'sete' ? 'Nenhum contato nos últimos 7 dias ainda.' : 'Nenhum contato hoje ainda. O funil enche conforme as conversas chegam.'));
    return;
  }
  cFunil.corpo.querySelector('.vazio')?.remove();
  const topo = Math.max(1, ...etapas.map(e => num(e.qtd) || 0));
  const itens = [];
  etapas.forEach((e, i) => {
    if (i) {
      const t = num(e.taxa_da_anterior);
      itens.push(h('li', { class: 'fn-conn', 'aria-hidden': 'true' }, h('span', { class: 'fn-conn-p' + (t != null && t < .6 ? ' baixa' : '') }, ic('seta'), h('b', { text: t == null ? '—' : pctTxt(t) }))));
    }
    const v = (num(e.qtd) || 0) / topo, ult = i === etapas.length - 1;
    const t = num(e.taxa_da_anterior);
    itens.push(h('li', { class: 'fn-deg' + (ult ? ' fim' : ''), style: `--v:${v.toFixed(4)};--n:${i}` },
      h('span', { class: 'fn-deg-val', text: int(e.qtd) }),
      h('span', { class: 'fn-deg-rot', text: txt(e.etapa) }),
      h('span', { class: 'so-leitor', text: i && t != null ? `, ${pctTxt(t)} da etapa anterior` : '' }),
      h('span', { class: 'fn-deg-barra', 'aria-hidden': 'true' }, h('i'))));
  });
  trocar(degraus, ...itens);
  const a = num(etapas[0].qtd), z = num(etapas[etapas.length - 1].qtd);
  trocar(fnTotal, a ? h('b', { text: pctTxt(z / a) }) : '—', a ? ` de quem entrou em contato ${S.conv === 'sete' ? 'nos últimos 7 dias' : 'hoje'} criou o painel` : '');
  requestAnimationFrame(() => requestAnimationFrame(() => cFunil.el.classList.add('pronto')));
}

function pintarRitmo(d) {
  const p = d.proativos_hoje || {}, total = num(p.total) || 0, teto = num(p.teto) || 120;
  const f = Math.min(1, total / teto);
  anel.style.setProperty('--off', (263.9 * (1 - f)).toFixed(1));
  anel.classList.toggle('cheio', f >= .9);
  contar(anelC.querySelector('b'), total);
  anelC.querySelector('span').textContent = `de ${int(teto)}`;
  anel.setAttribute('aria-label', `${int(total)} toques proativos hoje, de um teto de ${int(teto)}`); anel.setAttribute('role', 'img');
  const tipos = Object.keys(ROT_TIPO).filter(k => k !== 'conversa_direta' && num(p[k]));
  trocar(ritmoLista, ...(tipos.length ? tipos.sort((a, b) => p[b] - p[a]).map(k => h('li', null, h('span', { text: ROT_TIPO[k] }), h('b', { text: int(p[k]) })))
    : [h('li', { class: 'nada' }, h('span', { text: 'Nenhum toque saiu hoje ainda.' }))]));
  const c = d.controles || {}, pausada = !!c.cadencia_pausada;
  const dev = d.devidos_agora || {};
  const devTxt = Object.keys(ROT_DEVIDO).filter(k => num(dev[k])).map(k => `${int(dev[k])} ${num(dev[k]) === 1 ? ROT_DEVIDO[k][0] : ROT_DEVIDO[k][1]}`);
  trocar(ritmoEstado, 
    h('div', { class: 'fn-cad-t' },
      h('span', { class: 'pilula-t ' + (pausada ? 'aviso' : 'ok') }, h('i', { class: 'fn-led' }), pausada ? 'Cadência pausada' : 'Cadência ligada'),
      c.jornada_pausada ? h('span', { class: 'pilula-t aviso', text: 'Jornada pausada' }) : null),
    h('p', { class: 'fn-cad-d', text: devTxt.length ? `Devidos agora: ${devTxt.join(' · ')}.` : 'Nada devido agora.' }),
    btPausa);
  if (S.ocupado !== 'cadencia') trocar(btPausa, ic(pausada ? 'play' : 'pausa'), h('span', { text: pausada ? 'Retomar cadência' : 'Pausar cadência' }));
  btPausa.classList.toggle('principal', pausada);
}

function barras(itens, { total, cor } = {}) {
  const max = Math.max(1, ...itens.map(i => i.qtd));
  return h('ul', { class: 'fn-barras' }, itens.map((it, i) => h('li', { class: it.cls || '', style: `--v:${(it.qtd / max).toFixed(4)};--n:${i}` },
    h('span', { class: 'fn-b-rot', text: it.rotulo }),
    h('span', { class: 'fn-b-trilho', 'aria-hidden': 'true' }, h('i', { style: cor ? `background:${cor}` : null })),
    h('span', { class: 'fn-b-qtd' }, h('b', { text: int(it.qtd) }), total ? h('small', { text: pctTxt(it.qtd / total) }) : null))));
}
function pintarEstados(d) {
  const est = lista(d.por_estado).filter(e => num(e.qtd));
  cEstados.sub.textContent = `${int(d.leads_vivos)} vivos de ${int(d.leads_total)}`;
  if (!est.length) { trocar(cEstados.corpo, vazio('caixa', 'Nenhum lead mapeado ainda.')); return; }
  const vivos = est.filter(e => e.vivo), outros = est.filter(e => !e.vivo);
  trocar(cEstados.corpo, 
    vivos.length ? h('h3', { class: 'titulinho', text: 'Vivos, o robô ainda trabalha' }) : null,
    vivos.length ? barras(vivos.map(e => ({ rotulo: txt(e.rotulo), qtd: num(e.qtd), cls: 'vivo' }))) : null,
    outros.length ? h('h3', { class: 'titulinho fn-tt', text: 'Fora da cadência' }) : null,
    outros.length ? barras(outros.map(e => ({ rotulo: txt(e.rotulo), qtd: num(e.qtd), cls: e.estado === 'fechou' ? 'fechou' : 'parado' }))) : null);
  cEstados.corpo._marca && requestAnimationFrame(cEstados.corpo._marca);
}

function chave(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function pintarProx(d) {
  const mapa = {}; for (const x of lista(d.proximos_por_dia)) mapa[x.dia] = x;
  const hoje = new Date(); hoje.setHours(12, 0, 0, 0);
  const dd = Array.from({ length: 7 }, (_, i) => { const t = new Date(hoje); t.setDate(t.getDate() + i); const x = mapa[chave(t)] || {}; return { t, i, c: num(x.qtd) || 0, j: num(x.jornada) || 0 }; });
  const max = Math.max(1, ...dd.map(x => x.c + x.j)), soma = dd.reduce((a, x) => a + x.c + x.j, 0);
  grafico.setAttribute('aria-label', `Toques marcados nos próximos 7 dias: ${dd.map(x => `${x.i ? SEM[x.t.getDay()] : 'hoje'} ${x.c + x.j}`).join(', ')}`);
  trocar(grafico, ...dd.map(x => h('div', { class: 'fn-dia' + (x.i ? '' : ' hoje'), style: `--c:${(x.c / max).toFixed(4)};--j:${(x.j / max).toFixed(4)};--n:${x.i}` },
    h('span', { class: 'fn-dia-n', text: x.c + x.j ? int(x.c + x.j) : '' }),
    h('span', { class: 'fn-dia-col' }, h('i', { class: 'j' }), h('i', { class: 'c' })),
    h('span', { class: 'fn-dia-r', text: x.i ? SEM[x.t.getDay()] : 'hoje' }))));
  const dev = d.devidos_agora || {}, nDev = Object.keys(ROT_DEVIDO).reduce((a, k) => a + (num(dev[k]) || 0), 0);
  cProx.sub.textContent = soma ? `${int(soma)} em 7 dias${nDev ? ` · ${int(nDev)} devidos agora` : ''}` : 'nada marcado';
  const pr = lista(d.proximos_toques);
  trocar(proxLista, ...(pr.length ? pr.map(l => linhaPessoa(l)) : [h('li', null, vazio('relogio', 'Nenhum toque na fila agora.'))]));
  btVerProx.hidden = pr.length <= 5;
  btVerProx.textContent = cProx.el.classList.contains('aberto') ? 'Ver menos' : `Ver todos (${pr.length})`;
  requestAnimationFrame(cProx.corpo._marca);
}

function pintarRisco(d) {
  const r = lista(d.leads_em_risco);
  cRisco.sub.textContent = r.length ? plural(r.length, 'lead', 'leads') : '';
  cRisco.el.classList.toggle('tem', r.length > 0);
  trocar(cRisco.corpo, r.length ? h('ul', { class: 'fn-lista' }, r.map(l => linhaPessoa(l, { risco: true }))) : vazio('escudo', 'Nenhum lead em risco agora.'));
  requestAnimationFrame(cRisco.corpo._marca);
}

/* Leads frios: na fila (posição e previsão), agendados e fora da fila */
const ROT_SIT = { na_fila: 'Na fila', agendado: 'Agendados', fora: 'Fora da fila' };
function linhaFrio(l) {
  const nome = nomeSeguro(l.nome, l.telefone), tel = masc(l.telefone), f = l.fila || {};
  const quando = f.previsto ? proxLabel(f.previsto) : '';
  return h('li', { class: 'fn-pessoa fn-frio ' + (f.situacao || 'fora') },
    h('span', { class: 'avatar', 'aria-hidden': 'true', text: inicial(nome) }),
    h('div', { class: 'fn-p1' },
      h('span', { class: 'nome', text: nome }), tel && !nome.endsWith(tel) ? h('span', { class: 'tel', text: tel }) : null,
      f.posicao ? h('span', { class: 'fn-pos', text: '#' + int(f.posicao) }) : null,
      h('span', { class: 'fn-quando' + (quando === 'agora' ? ' agora' : ''), text: quando || (f.situacao === 'fora' ? 'parado' : '') })),
    h('div', { class: 'fn-p2' }, h('span', { class: 'corta', text: txt(f.detalhe) })),
    h('div', { class: 'fn-p3' },
      h('span', { class: 'pilula-t neutra', text: txt(l.estado_rotulo) }),
      l.ultimo_contato ? h('span', { text: 'última conversa ' + atras(l.ultimo_contato) }) : null,
      num(l.toques) ? h('span', { text: plural(l.toques, 'toque', 'toques') }) : null));
}
function pintarFrios(d) {
  const fr = d.frios || {}, itens = lista(fr.itens);
  cFrios.sub.textContent = itens.length ? plural(itens.length, 'lead', 'leads') : '';
  const pilar = (cls, n, rot) => h('div', { class: 'fn-fr-n ' + cls }, h('b', { text: int(n) }), h('span', { text: rot }));
  trocar(friosResumo, pilar('fila', fr.na_fila, 'na fila'), pilar('agenda', fr.agendados, 'agendados'), pilar('fora', fr.fora, 'fora da fila'));
  const ritmo = num(fr.ritmo_s) || 0, cada = ritmo <= 90 ? '1 por minuto' : `1 a cada ${Math.round(ritmo / 60)} min`;
  const acel = data(fr.acelerado_ate);
  trocar(friosRitmo,
    fr.pausada ? h('span', { class: 'pilula-t aviso', text: 'fila pausada' }) : acel ? h('span', { class: 'pilula-t ciano' }, h('i', { class: 'fn-led' }), h('span', { text: 'acelerada até ' + hhmm(acel) })) : null,
    h('span', { text: fr.proximo_envio ? `Próximo envio ${proxLabel(fr.proximo_envio)} · ${cada} · ${txt(fr.janela) || '9h às 20h'}` : 'Nenhum envio marcado.' }));
  const grupos = ['na_fila', 'agendado', 'fora'].map(s => [s, itens.filter(i => (i.fila || {}).situacao === s)]).filter(([, g]) => g.length);
  trocar(friosLista, ...(grupos.length ? grupos.flatMap(([s, g]) => [h('h3', { class: 'titulinho fn-tt', text: `${ROT_SIT[s]} · ${int(g.length)}` }), h('ul', { class: 'fn-lista' }, g.map(linhaFrio))]) : [vazio('escudo', 'Nenhum lead frio agora.')]));
  const tot = itens.length;
  btVerFrios.hidden = tot <= 3;
  btVerFrios.textContent = cFrios.el.classList.contains('aberto') ? 'Ver menos' : `Ver todos (${tot})`;
  btFrios.disabled = !tot || S.ocupado === 'frios';
  requestAnimationFrame(cFrios.corpo._marca);
}

/* Experimento A/B: taxa com o intervalo de confiança desenhado numa régua de 0 a 100% */
function linhaVariante(nome, v, papel) {
  const taxa = num(v.taxa) || 0, ic0 = lista(v.ic), lo = Math.max(0, num(ic0[0]) ?? taxa), hi = Math.min(1, num(ic0[1]) ?? taxa);
  const n = num(v.enviados) || 0, k = num(v.responderam) || 0;
  return h('div', { class: 'fn-var ' + papel },
    h('span', { class: 'fn-var-l', text: nome }),
    h('span', { class: 'fn-regua', role: 'img', 'aria-label': `Variante ${nome}: ${pctTxt(taxa)} responderam, ${k} de ${n}; intervalo de confiança de ${pctTxt(lo)} a ${pctTxt(hi)}` },
      h('i', { class: 'fn-ic', style: `left:${(lo * 100).toFixed(2)}%;width:${Math.max(.4, (hi - lo) * 100).toFixed(2)}%` }),
      h('i', { class: 'fn-pt', style: `left:${(taxa * 100).toFixed(2)}%` })),
    h('span', { class: 'fn-var-n' }, h('b', { text: pctTxt(taxa) }), h('small', { text: `${int(k)} de ${int(n)}` })),
    h('span', { class: 'fn-var-x' },
      num(v.paineis) ? `${plural(v.paineis, 'painel', 'painéis')}` : 'nenhum painel',
      num(v.aguardando_48h) ? ` · ${int(v.aguardando_48h)} aguardando 48 h` : ''));
}
function pintarAB(d) {
  const ex = lista(d.experimentos);
  cAB.sub.textContent = ex.length ? plural(ex.length, 'teste', 'testes') : '';
  if (!ex.length) { trocar(cAB.corpo, vazio('caixa', 'Nenhum teste rodando ainda. Quando o robô alternar duas mensagens num mesmo degrau, o placar aparece aqui.')); return; }
  const DEC = { amostra_pequena: ['Amostra pequena, sem vencedor', 'neutra'], empate: ['Empate', 'neutra'], A: ['A vence', ''], B: ['B vence', ''] };
  trocar(cAB.corpo, h('ul', { class: 'fn-ab-lista' }, ex.map(e => {
    const dec = DEC[e.decisao] || ['Em análise', 'neutra'];
    const venc = e.decisao === 'A' || e.decisao === 'B' ? e.decisao : null;
    const papel = x => (venc ? (venc === x ? 'vence' : 'perde') : 'neutro');
    return h('li', { class: 'fn-exp' },
      h('div', { class: 'fn-exp-t' }, h('b', { text: txt(e.rotulo) || txt(e.degrau) }), h('span', { class: 'pilula-t ' + dec[1], text: dec[0] })),
      h('div', { class: 'fn-eixo', 'aria-hidden': 'true' }, h('span', { text: '0%' }), h('span', { text: '50%' }), h('span', { text: '100%' })),
      linhaVariante('A', e.A || {}, papel('A')), linhaVariante('B', e.B || {}, papel('B')),
      txt(e.texto) || num(e.amostra_minima) ? h('p', { class: 'fn-exp-p' }, txt(e.texto), num(e.amostra_minima) && e.decisao === 'amostra_pequena' ? `${txt(e.texto) ? ' ' : ''}Precisa de ${int(e.amostra_minima)} envios por lado.` : '') : null);
  })), h('p', { class: 'fn-nota', text: 'A barra é o intervalo de confiança: se as barras se cruzam, ainda não dá para dizer quem é melhor.' }));
  requestAnimationFrame(cAB.corpo._marca);
}

function pintarOrigem(d) {
  const o = d.paineis_por_origem || {};
  const itens = Object.keys(ROT_TIPO).map(k => ({ rotulo: ROT_TIPO[k], qtd: num(o[k]) || 0, cls: k === 'conversa_direta' ? 'parado' : 'vivo' })).filter(x => x.qtd);
  const total = itens.reduce((a, x) => a + x.qtd, 0);
  cOrigem.sub.textContent = total ? `${plural(total, 'painel', 'painéis')} ${dias() === 7 ? 'em 7 dias' : 'hoje'}` : '';
  if (!total) { trocar(cOrigem.corpo, vazio('caixa', dias() === 7 ? 'Nenhum painel fechado nos últimos 7 dias.' : 'Nenhum painel fechado hoje ainda.')); return; }
  const porToque = total - (num(o.conversa_direta) || 0);
  trocar(cOrigem.corpo, 
    h('p', { class: 'fn-origem-p' }, h('b', { text: pctTxt(porToque / total) }), ' vieram de um toque do robô nas 72 h anteriores'),
    barras(itens.sort((a, b) => b.qtd - a.qtd), { total }));
}

function pintarJogadas(d) {
  const j = lista(d.jogadas);
  if (S.lendo) return;
  cJog.sub.textContent = j.length ? `lido ${quandoCurto(j[0].gerado_em)}` : '';
  if (!j.length) { trocar(cJog.corpo, vazio('livro', 'O livro ainda não foi lido. Toque em Ler agora para o robô estudar as conversas que fecharam.')); return; }
  const corpo = r => {
    /* o livro às vezes manda texto solto, às vezes objeto ({pergunta, resposta_sugerida, precisa_aprovacao}); aceita os dois */
    const tx = x => (x && typeof x === 'object' ? txt(x.padrao || x.texto || x.pergunta || x.objecao || '') : txt(x));
    const pad = lista(r.padroes_que_fecharam).map(tx).filter(Boolean), obj = lista(r.objecoes).filter(o => o && typeof o === 'object');
    const pg = lista(r.perguntas_novas).map(x => ({ p: tx(x), r: x && typeof x === 'object' ? txt(x.resposta_sugerida) : '', senhor: !!(x && x.precisa_aprovacao) })).filter(x => x.p);
    return [
      pad.length ? h('div', { class: 'fn-jg' }, h('h3', { class: 'titulinho', text: 'O que fechou painel' }), h('ul', { class: 'fn-pontos' }, pad.map(t => h('li', { text: t })))) : null,
      obj.length ? h('div', { class: 'fn-jg' }, h('h3', { class: 'titulinho', text: 'Objeções e a melhor resposta' }), h('ul', { class: 'fn-obj' }, obj.map(o => h('li', null, h('b', null, txt(o.objecao), num(o.vezes) > 1 ? h('small', { class: 'fn-vezes', text: ` · ${int(o.vezes)} vezes` }) : null), h('span', { text: txt(o.melhor_resposta) }))))) : null,
      pg.length ? h('div', { class: 'fn-jg' }, h('h3', { class: 'titulinho', text: 'Perguntas novas' }), h('ul', { class: 'fn-obj' }, pg.map(x => h('li', null,
        h('b', null, x.p, x.senhor ? h('span', { class: 'pilula-t aviso fn-aprovar', text: 'o senhor aprova' }) : null), x.r ? h('span', { text: x.r }) : null)))) : null,
      !pad.length && !obj.length && !pg.length ? h('p', { class: 'fn-nota', text: 'Esta leitura não achou padrão novo.' }) : null,
    ];
  };
  const meta = r => [quandoCurto(r.gerado_em), txt(r.modelo), num(r.custo_usd) != null ? `US$ ${num(r.custo_usd).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 3 })}` : ''].filter(Boolean).join(' · ');
  trocar(cJog.corpo, 
    h('p', { class: 'fn-jg-meta', text: meta(j[0]) }), ...corpo(j[0]),
    j.length > 1 ? h('h3', { class: 'titulinho fn-tt', text: 'Leituras anteriores' }) : null,
    ...j.slice(1).map(r => h('details', { class: 'fn-ant' }, h('summary', { text: meta(r) }), h('div', { class: 'fn-ant-c' }, ...corpo(r)))));
  requestAnimationFrame(cJog.corpo._marca);
}

function pintarSug(d) {
  const s = lista(d.sugestoes_para_o_senhor).map(txt).filter(Boolean);
  cSug.sub.textContent = s.length ? String(s.length) : '';
  const et = d.etiquetas || {}, por = et.por_etiqueta || {}, faltam = lista(et.faltam);
  const estadoEt = et.ativa ? ['Sincronizando com o WhatsApp', 'ok'] : d.controles && d.controles.etiquetas_pausadas ? ['Sincronização pausada', 'aviso'] : !et.business ? ['Fora do WhatsApp Business', 'neutra'] : ['Sincronização desligada', 'aviso'];
  const chaves = Object.keys(por).filter(k => num(por[k])).sort((a, b) => por[b] - por[a]);
  const blocoEt = h('section', { class: 'fn-etq', 'aria-label': 'Etiquetas do WhatsApp' },
    h('div', { class: 'fn-etq-t' }, ic('etiqueta'), h('h3', { text: 'Etiquetas do WhatsApp' }), h('span', { class: 'pilula-t ' + estadoEt[1], text: estadoEt[0] })),
    !et.ativa && !et.business ? h('p', { class: 'fn-nota', text: 'As etiquetas ficam só aqui no painel; no celular elas aparecem quando o número for Business.' }) : null,
    chaves.length ? h('ul', { class: 'fn-etq-l' }, chaves.map(k => h('li', null, h('i', { style: `background:${COR_ETQ[k] || '#8e8e93'}` }), h('span', { text: ROT_ETQ[k] || txt(k) }), h('b', { text: int(por[k]) })))) : h('p', { class: 'fn-nota', text: 'Nenhum lead etiquetado ainda.' }),
    num(et.aplicadas) ? h('p', { class: 'fn-nota', text: `${plural(et.aplicadas, 'etiqueta aplicada', 'etiquetas aplicadas')} no WhatsApp.` }) : null,
    faltam.length ? h('div', { class: 'fn-faltam' }, h('p', { text: 'Crie estas etiquetas no app do WhatsApp:' }),
      h('ul', null, faltam.map(f => { const cor = txt(f.cor); return h('li', null, h('i', { style: `background:${COR_NOME[cor.toLowerCase()] || (/^#[0-9a-f]{3,8}$/i.test(cor) ? cor : '#8e8e93')}` }), h('b', { text: txt(f.nome) }), cor ? ` · ${cor}` : ''); }))) : null);
  trocar(cSug.corpo, 
    s.length ? h('ul', { class: 'fn-sug-l' }, s.map(t => h('li', null, ic('ideia'), h('span', { text: t })))) : vazio('ideia', 'Nada esperando decisão do senhor agora.'),
    blocoEt);
  requestAnimationFrame(cSug.corpo._marca);
}

function aplicar(d) {
  geral.hidden = true; grade.hidden = false;
  const minuto = Math.floor(Date.now() / 60000);
  so('heroi', [d.leads_sem_proximo_passo, d.sem_proximo_passo_nomes, d.alerta_desde, d.leads_vivos, d.leads_total, d.esperando_senhor], () => pintarHeroi(d));
  so('funil', [d.conversao, S.conv], () => pintarFunil(d));
  so('ritmo', [d.proativos_hoje, d.controles, d.devidos_agora, S.ocupado], () => pintarRitmo(d));
  so('estados', [d.por_estado, d.leads_vivos, d.leads_total], () => pintarEstados(d));
  so('prox', [d.proximos_por_dia, d.proximos_toques, d.devidos_agora, minuto], () => pintarProx(d));
  so('risco', [d.leads_em_risco, minuto], () => pintarRisco(d));
  so('ab', [d.experimentos], () => pintarAB(d));
  so('origem', [d.paineis_por_origem, dias()], () => pintarOrigem(d));
  so('jog', [d.jogadas, S.lendo], () => pintarJogadas(d));
  so('sug', [d.sugestoes_para_o_senhor, d.etiquetas, d.controles], () => pintarSug(d));
  so('frios', [d.frios, minuto, S.ocupado], () => pintarFrios(d));
  const vel = data(d.vigia_em), velho = vel && Date.now() - vel.getTime() > 20 * 60000;
  avisoRede.hidden = !(S.erro || velho);
  avisoRede.querySelector('span').textContent = S.erro ? 'Sem conexão com o robô agora. Mostrando os últimos números; tento de novo em instantes.' : `O vigia do funil não roda desde ${quandoCurto(vel)}. Os números podem estar atrasados.`;
}

/* ---------- Busca ---------- */
let busca = 0;
async function carregar(forcar) {
  if (!ver() && !forcar) return;
  const minha = ++busca;
  try {
    const d = await pegar(`/api/funil?dias=${dias()}`);
    if (minha !== busca) return;
    S.erro = null; S.d = d; aplicar(d);
  } catch (e) {
    if (minha !== busca) return;
    if (e && e.status === 401) return;   /* a tela principal mostra a sessão expirada */
    S.erro = true;
    if (e && (e.status === 404 || e.status === 501)) { S.d = null; S.sig = {}; mostrarGeral('O funil ainda está sendo preparado.', 'Quando o vigia do robô rodar pela primeira vez, os números aparecem aqui.'); return; }
    if (S.d) aplicar(S.d); else mostrarGeral('Não consegui carregar o funil agora.', 'Confira se o PC do robô está ligado. Tento de novo em um minuto.');
  }
}
function mostrarGeral(t, dd) { grade.hidden = true; geral.hidden = false; geral.querySelector('.fk-geral-t').textContent = t; geral.querySelector('.fk-geral-d').textContent = dd; }

/* ---------- Ações ---------- */
segConv.addEventListener('click', ev => { const b = ev.target.closest('button[data-c]'); if (!b || b.dataset.c === S.conv) return; S.conv = b.dataset.c; if (S.d) so('funil', [S.d.conversao, S.conv], () => pintarFunil(S.d)); });
segConv.addEventListener('keydown', ev => {
  if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(ev.key)) return;
  ev.preventDefault(); S.conv = S.conv === 'hoje' ? 'sete' : 'hoje'; if (S.d) pintarFunil(S.d); segConv.querySelector('[aria-checked="true"]').focus();
});

async function cadencia(acao) {
  S.ocupado = 'cadencia'; ocupar(btPausa, true, acao === 'pausar' ? 'Pausando…' : 'Retomando…');
  try {
    const r = await pegar('/api/funil/' + acao, { metodo: 'POST' });
    if (r && r.ok === false) throw new Error(txt(r.motivo || r.erro) || 'falhou');
    aviso(r && r.enfileirado ? 'Pedido enviado. O robô aplica assim que o PC pegar.' : acao === 'pausar' ? 'Cadência pausada. Nenhum toque novo sai até o senhor retomar.' : 'Cadência retomada.');
  } catch (e) { if (!(e && e.status === 401)) aviso(msgErro(e), true); }
  finally { S.ocupado = null; ocupar(btPausa, false); S.sig.ritmo = null; await carregar(true); }
}
btPausa.addEventListener('click', async ev => {
  if (S.ocupado) return;
  const pausada = !!(S.d && S.d.controles && S.d.controles.cadencia_pausada);
  if (!pausada) {
    const ok = await dialogo({ gatilho: ev.currentTarget, icone: 'pausa', titulo: 'Pausar a cadência?', ok: 'Pausar',
      texto: 'Nenhum toque novo da cadência sai para os leads que esfriaram até o senhor retomar. O robô continua respondendo quem escrever.' });
    if (ok) cadencia('pausar');
    return;
  }
  const ok = await dialogo({ gatilho: ev.currentTarget, icone: 'play', titulo: 'Retomar a cadência?', ok: 'Retomar',
    texto: 'Os toques da cadência voltam a sair para os leads que esfriaram, dentro do teto de 120 por dia e só entre 9h e 20h.' });
  if (ok) cadencia('retomar');
});

btFrios.addEventListener('click', async ev => {
  if (S.ocupado) return;
  const fr = (S.d && S.d.frios) || {};
  const agoraH = new Date().getHours(), fora = agoraH < 9 || agoraH >= 20;
  const ok = await dialogo({ gatilho: ev.currentTarget, icone: 'enviar', titulo: 'Atender novamente todos os frios?', ok: 'Atender todos',
    itens: [
      `${plural(fr.na_fila || 0, 'lead que já está', 'leads que já estão')} na fila passam a sair 1 por minuto.`,
      fr.podem_voltar ? `${plural(fr.podem_voltar, 'lead que estava', 'leads que estavam')} fora da fila ${fr.podem_voltar === 1 ? 'volta' : 'voltam'} com uma mensagem nova do robô.` : null,
    ].filter(Boolean),
    notaAviso: fora ? 'Agora está fora do horário de envio. Começa amanhã às 9h.' : null,
    nota: 'Continua só das 9h às 20h, dentro do teto de 120 toques por dia. Quem responder volta para o atendimento normal.' });
  if (!ok) return;
  S.ocupado = 'frios'; ocupar(btFrios, true, 'Pedindo…');
  try {
    const r = await pegar('/api/funil/reaquecer', { metodo: 'POST', corpo: { confirmar: true } });
    if (r && r.ok === false) throw new Error(txt(r.erro) || 'falhou');
    aviso(r && r.enfileirado ? 'Pedido enviado. O robô aplica assim que o PC pegar.' : 'Pronto. Os frios entraram na fila acelerada.');
  } catch (e) { if (!(e && e.status === 401)) aviso(msgErro(e), true); }
  finally { S.ocupado = null; ocupar(btFrios, false); S.sig.frios = null; setTimeout(() => carregar(true), 2500); await carregar(true); }
});

btLer.addEventListener('click', async ev => {
  if (S.lendo) return;
  const ult = S.d && lista(S.d.jogadas)[0], custo = ult && num(ult.custo_usd);
  const ok = await dialogo({ gatilho: ev.currentTarget, icone: 'livro', titulo: 'Ler o livro de jogadas agora?', ok: 'Ler agora',
    texto: 'O robô estuda as conversas que fecharam painel e as objeções que apareceram. Leva até 2 minutos e usa o modelo de IA.',
    nota: custo != null ? `A última leitura custou US$ ${custo.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 3 })}.` : null });
  if (!ok) return;
  S.lendo = true; ocupar(btLer, true, 'Lendo…');
  const capa = h('div', { class: 'lendo fn-lendo', role: 'status' }, giro(), h('span', { text: 'Lendo as conversas…' }), h('small', { text: 'Pode levar até 2 minutos. Pode trocar de tela, a leitura continua.' }));
  cJog.el.append(capa);
  try {
    const r = await pegar('/api/funil/jogadas', { metodo: 'POST', limite: 260000 });
    if (r && r.ok === false) aviso('A leitura não terminou: ' + (txt(r.motivo) || 'tente de novo em instantes') + '.', true);
    else aviso(r && r.enfileirado ? 'Pedido enviado. A leitura aparece aqui quando o robô terminar.' : 'Livro de jogadas atualizado.');
  } catch (e) { if (!(e && e.status === 401)) aviso(e && e.name === 'AbortError' ? 'A leitura demorou demais. Ela pode aparecer aqui daqui a pouco.' : msgErro(e), true); }
  finally { S.lendo = false; capa.remove(); ocupar(btLer, false); S.sig.jog = null; await carregar(true); }
});

/* ---------- Visibilidade: só busca quando a tela está à mostra ---------- */
function ver() { return MOVEL.matches ? appEl.dataset.aba === 'funil' && appEl.dataset.fj !== 'jornada' && appEl.dataset.fj !== 'trafego' : appEl.dataset.vista === 'funil'; }
function replay() { raiz.classList.remove('fk-ok'); cFunil.el.classList.remove('pronto'); void raiz.offsetWidth; requestAnimationFrame(() => { raiz.classList.add('fk-ok'); cFunil.el.classList.add('pronto'); }); }
function checar() {
  const v = ver();
  if (v && !S.vis) { S.vis = true; replay(); if (S.d) { S.sig = {}; aplicar(S.d); } carregar(); }
  else if (!v) S.vis = false;
}
new MutationObserver(checar).observe(appEl, { attributes: true, attributeFilter: ['data-vista', 'data-aba', 'data-fj'] });
MOVEL.addEventListener('change', checar);
const seletor = document.getElementById('seletor');
if (seletor) ['click', 'keydown'].forEach(ev => seletor.addEventListener(ev, () => setTimeout(() => {
  const novo = dias() === 7 ? 'sete' : 'hoje';
  if (novo !== S.conv) S.conv = novo;
  if (ver()) carregar(); else S.sig = {};
}, 0)));
setInterval(() => { if (!document.hidden && ver()) carregar(); }, ATUALIZA_MS);
document.addEventListener('visibilitychange', () => { if (!document.hidden && ver()) carregar(); });
checar();
})();
