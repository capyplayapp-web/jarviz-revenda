/* Releitura (08/11/2026): botão "Rodar releitura" do topo.
   POST /api/releitura {horas, agir:true} pede ao robô; GET /api/releitura traz o andamento e o resultado.
   O robô lê o WhatsApp das últimas N horas, responde sozinho o que pode e lista o que precisa do senhor.
   Sem innerHTML com dado de fora. Na nuvem (sem a rota) cai no "Responder pendentes" antigo. */
(() => {
'use strict';
const BASE = location.protocol === 'file:' ? 'http://127.0.0.1:8811' : '';
const NS = 'http://www.w3.org/2000/svg';
const ICO = {
  gira: '<path d="M12 3a9 9 0 1 0 9 9"/>',
  ok: '<path d="M5 12.5 10 17.5 19 7"/>',
  alerta: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5"/><path d="M12 16.5h.01"/>',
  robo: '<rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01M9.5 16.5h5"/>',
  pessoa: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
  ideia: '<path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1.1 1.2 1.1 2.2h5c0-1 .5-1.7 1.1-2.2A6 6 0 0 0 12 3Z"/>',
  copiar: '<rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15"/>',
  fechar: '<path d="M6 6l12 12M18 6 6 18"/>',
  atualizar: '<path d="M21 12a8 8 0 0 1-13.6 5.7L4 15"/><path d="M3 12a8 8 0 0 1 13.6-5.7L20 9"/><path d="M4 20v-5h5M20 4v5h-5"/>',
};
function ic(n) { const s = document.createElementNS(NS, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.8'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true'); s.innerHTML = ICO[n] || ''; return s; }
function h(tag, p, ...f) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(p || {})) { if (v == null || v === false) continue; if (k === 'text') el.textContent = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v === true ? '' : v); }
  for (const x of f.flat()) if (x != null && x !== false) el.append(x);
  return el;
}
const txt = (v) => (v == null ? '' : String(v)).replace(/[\p{Co}\u0000-\u0008\u000B\u000C\u000E-\u001F]/gu, '').trim();
const nomeOk = (n) => { const t = txt(n); return /^\d{8,}$/.test(t) ? '•••• ' + t.slice(-4) : (t || 'Sem nome'); };
function ha(iso) {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (!Number.isFinite(m)) return '';
  if (m < 1) return 'agora'; if (m < 60) return `há ${m} min`;
  const hh = Math.round(m / 60); return hh < 24 ? `há ${hh} h` : `há ${Math.round(hh / 24)} d`;
}
const hora = (iso) => { const d = new Date(iso); return Number.isFinite(d.getTime()) ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''; };

async function api(metodo, corpo) {
  const r = await fetch(BASE + '/api/releitura', { method: metodo, cache: 'no-store', headers: corpo ? { 'Content-Type': 'application/json' } : undefined, body: corpo ? JSON.stringify(corpo) : undefined });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, j };
}

const S = { horas: 12, timer: 0, dlg: null, corpo: null, rodape: null, pedido: null, alternativa: null };

function montar() {
  if (S.dlg) return;
  const segs = [6, 12, 24].map((n) => h('button', { type: 'button', 'aria-pressed': String(n === S.horas), 'data-h': n, onclick: () => escolher(n), text: n + ' h' }));
  S.seg = h('div', { class: 'rl-seg', role: 'group', 'aria-label': 'Período da releitura' }, segs);
  S.corpo = h('div', { class: 'rl-corpo', 'aria-live': 'polite' });
  S.btnRodar = h('button', { type: 'button', class: 'btn principal', onclick: () => rodar() }, ic('atualizar'), h('span', { text: 'Rodar de novo' }));
  S.nota = h('p', { class: 'rl-nota' });
  S.dlg = h('dialog', { class: 'rl', 'aria-labelledby': 'rl-t', tabindex: '-1' },
    h('header', { class: 'rl-topo' },
      h('div', { class: 'rl-tit' }, h('h2', { id: 'rl-t', text: 'Releitura das conversas' }),
        h('p', { text: 'Lê o WhatsApp de ponta a ponta, acha dúvida que ficou sem resposta e responde o que o robô sabe. O resto vem para o senhor.' })),
      S.seg,
      h('button', { type: 'button', class: 'rl-x', 'aria-label': 'Fechar', onclick: fechar }, ic('fechar'))),
    S.corpo,
    h('footer', { class: 'rl-rodape' }, S.nota, h('div', { class: 'rl-bts' }, h('button', { type: 'button', class: 'btn', onclick: fechar, text: 'Fechar' }), S.btnRodar)));
  S.dlg.addEventListener('close', () => { clearTimeout(S.timer); S.dlg.classList.remove('on'); });
  S.dlg.addEventListener('click', (e) => { if (e.target === S.dlg) fechar(); });
  document.body.append(S.dlg);
}
function escolher(n) { S.horas = n; for (const b of S.seg.querySelectorAll('button')) b.setAttribute('aria-pressed', String(Number(b.dataset.h) === n)); }
function fechar() { if (S.dlg && S.dlg.open) S.dlg.close(); }

function vistaRodando(r) {
  const sp = ic('gira'); sp.classList.add('gira');
  const etapa = r && r.etapa ? txt(r.etapa) : 'pedindo ao robô';
  const lidas = r && r.conversas_lidas != null ? ` · ${r.conversas_lidas} conversas` : '';
  S.corpo.replaceChildren(h('div', { class: 'rl-prog', role: 'status' }, h('div', { class: 'rl-selo' }, sp),
    h('h3', { text: etapa.charAt(0).toUpperCase() + etapa.slice(1) + '…' }),
    h('p', { text: 'Leva de um a três minutos.' + lidas + ' Pode fechar, continua rodando.' })));
  S.btnRodar.disabled = true; S.nota.textContent = `Últimas ${(r && r.horas) || S.horas} h`;
}
function vistaErro(msg) {
  S.corpo.replaceChildren(h('div', { class: 'rl-prog erro', role: 'status' }, h('div', { class: 'rl-selo' }, ic('alerta')), h('h3', { text: 'Não deu certo' }), h('p', { text: msg })));
  S.btnRodar.disabled = false;
}
const ESTADO = { na_fila: 'Na fila', respondido: 'Respondido', pulado: 'Pulado', falhou: 'Falhou', 'só leitura': 'Só leitura' };
function chip(e) { return h('span', { class: 'rl-chip ' + (e === 'respondido' ? 'ok' : e === 'falhou' ? 'erro' : e === 'na_fila' ? 'fila' : ''), text: ESTADO[e] || 'Na fila' }); }
function itemRobo(it) {
  const fala = it.tipo === 'sem_resposta' ? (it.mensagens || []).slice(-2).join(' · ') : it.pergunta;
  return h('li', { class: 'rl-it' },
    h('div', { class: 'rl-it-l' }, h('b', { text: nomeOk(it.nome) }), h('span', { text: it.tipo === 'sem_resposta' ? 'última palavra do cliente' : 'pergunta ignorada' }), h('time', { text: ha(it.desde || it.quando || it.ultimo) }), chip(it.estado)),
    h('q', { text: txt(fala).slice(0, 220) }));
}
function itemSenhor(it) {
  const fala = it.tipo === 'sem_resposta' ? (it.mensagens || []).slice(-2).join(' · ') : it.pergunta;
  const sug = txt(it.resposta_sugerida || (it.duvidas && it.duvidas[0] && it.duvidas[0].resposta_sugerida));
  const copiar = sug ? h('button', { type: 'button', class: 'rl-copiar', 'aria-label': 'Copiar resposta sugerida', onclick: (e) => { navigator.clipboard && navigator.clipboard.writeText(sug).then(() => { e.currentTarget.classList.add('feito'); }).catch(() => {}); } }, ic('copiar')) : null;
  return h('li', { class: 'rl-it' },
    h('div', { class: 'rl-it-l' }, h('b', { text: nomeOk(it.nome) }), h('span', { text: it.telefone || '' }), h('time', { text: ha(it.desde || it.quando || it.ultimo) })),
    h('q', { text: txt(fala).slice(0, 240) }),
    it.motivo ? h('p', { class: 'rl-motivo', text: txt(it.motivo) }) : null,
    sug ? h('div', { class: 'rl-sug' }, h('span', { text: 'Sugestão' }), h('p', { text: sug }), copiar) : null);
}
function coluna(icone, titulo, itens, fazer, vazio) {
  return h('section', { class: 'rl-col' }, h('h3', {}, ic(icone), h('span', { text: titulo }), h('em', { text: String(itens.length) })),
    itens.length ? h('ul', { class: 'rl-lista' }, itens.map(fazer)) : h('p', { class: 'rl-vazio', text: vazio }));
}
function vistaResultado(r, fila) {
  const itens = (r.itens || []).filter(Boolean);
  const robo = itens.filter((i) => i.acao === 'robo_responde'), senhor = itens.filter((i) => i.acao === 'senhor');
  const kpi = (v, l, cls) => h('div', { class: 'rl-kpi ' + (cls || '') }, h('b', { text: String(v ?? '—') }), h('span', { text: l }));
  const apr = (r.aprendizados || []).slice(0, 8);
  S.corpo.replaceChildren(...[
    h('div', { class: 'rl-kpis' }, kpi(r.conversas_lidas, 'conversas lidas'), kpi(r.sem_resposta, 'sem resposta', r.sem_resposta ? 'quente' : ''), kpi(r.ignoradas, 'dúvidas ignoradas', r.ignoradas ? 'quente' : ''), kpi(senhor.length, 'precisam do senhor', senhor.length ? 'alerta' : '')),
    r.falhas_haiku ? h('p', { class: 'rl-aviso', text: `O Haiku não respondeu em ${r.falhas_haiku} de ${r.lotes} partes. Rode de novo para conferir tudo.` }) : null,
    h('div', { class: 'rl-cols' },
      coluna('robo', r.agir ? 'O robô responde' : 'O robô responderia', robo, itemRobo, 'Nada para o robô retomar.'),
      coluna('pessoa', 'Precisa do senhor', senhor, itemSenhor, 'Nada esperando o senhor.')),
    apr.length ? h('section', { class: 'rl-apr' }, h('h3', {}, ic('ideia'), h('span', { text: 'O que aprender' })),
      h('ul', {}, apr.map((a) => h('li', {}, h('span', { class: 'rl-tag', text: a.tipo === 'lacuna' ? 'Lacuna' : a.tipo === 'erro' ? 'Erro' : 'Regra' }), h('p', { text: txt(a.texto) }), a.exemplo ? h('small', { text: txt(a.exemplo) }) : null)))) : null].filter(Boolean));
  S.btnRodar.disabled = false;
  const dentro = (() => { const hh = new Date().getHours(); return hh >= 8 && hh < 21; })();
  S.nota.textContent = `Últimas ${r.horas} h · feita às ${hora(r.concluido_em)}` + (fila ? ` · ${fila} na fila do robô` + (dentro ? ', uma a cada 45 s' : ', saem a partir das 8h') : '');
}

async function acompanhar() {
  clearTimeout(S.timer);
  if (!S.dlg || !S.dlg.open) return;
  let res;
  try { res = await api('GET'); } catch { vistaErro('Não consegui falar com o robô. Confira se o PC está ligado.'); return; }
  const r = res.j && res.j.resultado;
  const novo = r && (!S.pedido || Date.parse(r.pedido_em) >= Date.parse(S.pedido) - 1000);
  if (novo && r.concluido_em) { if (r.etapa === 'falhou') vistaErro(txt(r.erro) || 'A releitura parou no meio.'); else vistaResultado(r, res.j.fila); S.timer = setTimeout(acompanhar, 15000); return; }
  if (S.pedido && Date.now() - Date.parse(S.pedido) > 6 * 60e3) { vistaErro('O robô não terminou em 6 minutos. Ele pode estar reiniciando; tente de novo.'); return; }
  vistaRodando(novo ? r : null);
  S.timer = setTimeout(acompanhar, 2500);
}
async function rodar() {
  vistaRodando(null);
  let res;
  try { res = await api('POST', { horas: S.horas, agir: true }); } catch { vistaErro('Não consegui falar com o robô. Confira se o PC está ligado.'); return; }
  if (res.status === 404 && S.alternativa) { fechar(); S.alternativa(); return; }
  if (res.status === 409) { S.pedido = res.j.resultado && res.j.resultado.pedido_em; return acompanhar(); }
  if (!res.j.ok) { vistaErro(txt(res.j.erro) || 'O pedido não saiu.'); return; }
  S.pedido = res.j.pedido_em; acompanhar();
}
/* Abre o painel. Se houver releitura em andamento, acompanha; senão roda já (o senhor voltou ao PC e quer conferir tudo). */
window.abrirReleitura = async (alternativa) => {
  S.alternativa = alternativa || null;
  montar();
  if (!S.dlg.open) { S.dlg.showModal(); S.dlg.focus(); requestAnimationFrame(() => S.dlg.classList.add('on')); }
  let atual = null; try { atual = (await api('GET')).j.resultado; } catch {}
  if (atual && !atual.concluido_em && Date.now() - Date.parse(atual.iniciado_em || atual.pedido_em) < 6 * 60e3) { S.pedido = atual.pedido_em; return acompanhar(); }
  rodar();
};
})();
