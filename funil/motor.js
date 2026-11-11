'use strict';
// Motor da estratégia de funil (08/11/2026). Carregado (e recarregado quando muda) pelo bot.js, como o backlog.js.
// Faz: VIGIA DE LEADS (estado + próximo passo de cada lead, KPI "sem próximo passo", lembrete ao senhor, retomada em 24 h),
// CADÊNCIA DE DIAS (D+1/3/7/14 com ângulos), JORNADA DO REVENDEDOR (check-ins e fechamento do mês), PORTÃO único dos
// envios proativos (teto total 120/dia, 60 s, janela 9-20h, prioridade) e ETIQUETAS do WhatsApp.
// Arquivos em funil\: estado.json (toques e memória), leads.json e jornada.json (fotos para o Dashboard), ab.json,
// etiquetas.json, config.json, pausado (cadência parada), jornada-pausada, etiquetas-pausadas, comando.json.
const fs = require('fs');
const path = require('path');
const N = require('./nucleo.js');
const R = require('./releitura.js');   // 08/11: botão "Rodar releitura" (lê o WhatsApp, acha dúvida sem resposta e age)
const CAN = require('./cancelados.js');   // 09/11: painéis cancelados (lê o WhatsApp dos desativados e o Haiku diz o motivo)

const DIR = process.env.FUNIL_DIR || __dirname;                       // FUNIL_DIR/FUNIL_PASTA só nos testes
const PASTA = process.env.FUNIL_PASTA || path.resolve(__dirname, '..');
const A = {
  estado: path.join(DIR, 'estado.json'), leads: path.join(DIR, 'leads.json'), jornada: path.join(DIR, 'jornada.json'), ab: path.join(DIR, 'ab.json'),
  etiquetas: path.join(DIR, 'etiquetas.json'), cfg: path.join(DIR, 'config.json'), pausado: path.join(DIR, 'pausado'), jornadaPausada: path.join(DIR, 'jornada-pausada'),
  etiquetasPausadas: path.join(DIR, 'etiquetas-pausadas'), comando: path.join(DIR, 'comando.json'),
  revendedores: path.join(PASTA, 'revendedores.json'), mapa: path.join(PASTA, 'backlog.json'), fila: path.join(PASTA, 'backlog-fila.json'), backlogEstado: path.join(PASTA, 'backlog-estado.json'),
  base: path.join(PASTA, 'base.md'), eventos: path.join(PASTA, 'eventos.jsonl'), hist: path.join(PASTA, 'eventos-historico.jsonl'), botPausado: path.join(PASTA, 'pausado'),
};
const lerJson = (arq, padrao) => { try { return JSON.parse(fs.readFileSync(arq, 'utf8').replace(/^﻿/, '')); } catch { return padrao; } };
const gravar = (arq, obj) => { const t = arq + '.tmp'; fs.writeFileSync(t, JSON.stringify(obj, null, 1)); fs.renameSync(t, arq); };
const iso = (ms) => new Date(ms).toISOString();
const agoraDe = (ctx) => (ctx.agora ? ctx.agora() : Date.now());
const logar = (ctx, t) => { try { ctx.log(String(t)); } catch {} };
const E = (ctx) => ctx.estFunil || (ctx.estFunil = {});
const D = 86400e3, H = 3600e3;
const TIPOS_CONTEUDO = ['chat', 'ptt', 'audio', 'image', 'video', 'document'];
const fim8 = (t) => N.digitos(t).slice(-8);
const TRANSITORIO = /recente demais|fluxo ao vivo|atendeu na m[aã]o|follow-up ao vivo|sil[eê]ncio|j[aá] recebeu follow-up do backlog|n[aã]o consegui escrever|etapa da ficha/i;
const cfgDe = () => ({ cadencia: true, jornada: true, etiquetas: true, vigia_responde: true, lembretes: true, retomada: true, encerra_bloqueia: true, ...lerJson(A.cfg, {}) });

// ---------- eventos (cache por tamanho do arquivo) ----------
let _ev = { tam: -1, ht: -1, lista: [] };
function eventos() {
  let tam = 0, ht = 0; try { tam = fs.statSync(A.eventos).size; } catch {} try { ht = fs.statSync(A.hist).size; } catch {}
  if (tam === _ev.tam && ht === _ev.ht) return _ev.lista;
  const ler = (arq) => { try { return fs.readFileSync(arq, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((e) => e && e.t && e.tipo); } catch { return []; } };
  const vivo = ler(A.eventos), hist = ler(A.hist);
  const corte = vivo.filter((e) => !e.varredura).map((e) => Date.parse(e.t)).reduce((a, b) => Math.min(a, b), Infinity);
  _ev = { tam, ht, lista: hist.filter((e) => Date.parse(e.t) < corte).concat(vivo).sort((a, b) => Date.parse(a.t) - Date.parse(b.t)) };
  return _ev.lista;
}

// ---------- portão (usado também pela escada ao vivo, pelo backlog e pelos retornos de lacuna) ----------
function pode(ctx, tipo) {
  const est = E(ctx), agora = agoraDe(ctx);
  const { hoje, ultimo } = N.contarProativosHoje(eventos(), agora);
  const demandas = {};
  if (est.demandasEm && agora - est.demandasEm < 5 * 60e3) {
    const ad = est.adiados || {}, d = est.devidos || {};
    for (const k of ['retomada', 'cadencia', 'jornada']) demandas[k] = (d[k] || []).filter((x) => !(ad[x.id + '|' + k] > agora)).length;
    demandas.lacuna = est.lacunaDevidos || 0;
  }
  if (ctx.aoVivoDevidos) { try { demandas.ao_vivo = ctx.aoVivoDevidos(); } catch {} }
  const ocupado = (ctx.atendendo && ctx.atendendo.size > 0) || (ctx.fila && ctx.fila.size > 0);
  const r = N.portao({ tipo, agora, hoje: Math.max(hoje, est.hojeLocal && N.mesmoDia(est.hojeLocalEm, agora) ? est.hojeLocal : 0), ultimo: Math.max(ultimo, est.ultimoProativo || 0), proximoLivre: est.proximoLivre || 0, demandas, ocupado, pausado: fs.existsSync(A.botPausado) });
  r.hoje = hoje;
  return r;
}
function registrar(ctx, tipo) {
  const est = E(ctx), agora = agoraDe(ctx);
  est.ultimoProativo = agora;
  const { hoje } = N.contarProativosHoje(eventos(), agora);
  est.hojeLocal = (N.mesmoDia(est.hojeLocalEm || 0, agora) ? Math.max(est.hojeLocal || 0, hoje) : hoje) + 1; est.hojeLocalEm = agora;
  if (tipo !== 'ao_vivo') {
    const pend = Object.entries(est.demandas || {}).filter(([t]) => t !== 'ao_vivo').reduce((s, [, n]) => s + n, 0);
    const base = N.planoRitmo({ agora, pendentes: Math.max(1, pend) });
    est.proximoLivre = agora + Math.max(60e3, Math.round(base * (1 - N.LIM.jitter + Math.random() * 2 * N.LIM.jitter)));
  }
}

// ---------- A/B: variante por lead e degrau (a pior é desligada quando o teste decide) ----------
function variante(degrau, id) {
  const ab = lerJson(A.ab, {});
  const d = ab.decisoes && ab.decisoes[degrau];
  if (d && (d.decisao === 'A' || d.decisao === 'B')) return d.decisao;
  return N.varianteDe(id, degrau);
}
function calcularAB(evs, agora) {
  const grupos = {};
  const msgs = new Map(); for (const e of evs) if (e.tipo === 'mensagem_cliente' && e.chat) (msgs.get(e.chat) || msgs.set(e.chat, []).get(e.chat)).push(Date.parse(e.t));
  const paineis = new Map(); for (const e of evs) if (e.tipo === 'painel_fechado' && e.chat) paineis.set(e.chat, Date.parse(e.t));
  for (const e of evs) {
    let deg = null;
    if (e.tipo === 'followup' && e.variante) deg = 'vivo' + e.n;
    else if (e.tipo === 'toque_cadencia' && e.variante) deg = 'cad_' + e.angulo;
    else if (e.tipo === 'toque_jornada' && e.variante) deg = 'jor_' + String(e.toque || '').replace(/_d\d$/, '');
    if (!deg) continue;
    const t = Date.parse(e.t);
    const g = (grupos[deg] || (grupos[deg] = { A: { n: 0, k: 0, p: 0, pendentes: 0 }, B: { n: 0, k: 0, p: 0, pendentes: 0 } }))[e.variante];
    if (!g) continue;
    const resp = (msgs.get(e.chat) || []).some((x) => x > t && x - t <= N.LIM.ab_janela_h * H);
    if (!resp && agora - t < N.LIM.ab_janela_h * H) { g.pendentes++; continue; }   // ainda dentro das 48 h: não conta
    g.n++; if (resp) g.k++;
    const pf = paineis.get(e.chat); if (pf && pf > t && pf - t <= N.LIM.ab_janela_h * H) g.p++;
  }
  const decisoes = {};
  for (const [deg, g] of Object.entries(grupos)) decisoes[deg] = { ...N.compararAB(g.A, g.B), paineis: { A: g.A.p, B: g.B.p }, pendentes: { A: g.A.pendentes, B: g.B.pendentes } };
  return decisoes;
}

// ---------- leitura de dados de um lead ----------
function indice(evs) {
  const ix = new Map();
  const g = (id) => ix.get(id) || ix.set(id, { cli: [], robo: [], senhor: [], passou: [], fu: [], pro: [], paineis: [] }).get(id);
  for (const e of evs) {
    if (!e.chat) continue;
    const t = Date.parse(e.t), x = g(e.chat);
    if (e.tipo === 'mensagem_cliente') x.cli.push({ t, texto: e.texto || '' });
    else if (e.tipo === 'resposta_robo') x.robo.push({ t, texto: e.texto || '' });
    else if (e.tipo === 'senhor_escreveu') x.senhor.push(t);
    else if (e.tipo === 'passou_ao_senhor') x.passou.push({ t, motivo: e.motivo || '' });
    else if (e.tipo === 'painel_fechado') x.paineis.push(t);
    if (N.TIPOS_PROATIVOS.includes(e.tipo)) x.pro.push({ t, tipo: e.tipo, texto: e.texto || '' });
    if (e.tipo === 'followup') x.fu.push({ t, n: e.n });
  }
  return ix;
}
const ultimo = (arr) => (arr && arr.length ? arr[arr.length - 1] : null);
function passouPendente(x, agora) {
  const p = ultimo(x.passou); if (!p || agora - p.t > 7 * D) return null;
  if (x.senhor.some((t) => t > p.t)) return null;
  if (x.pro.some((q) => q.tipo === 'retomada_senhor' && q.t > p.t)) return null;    // o robô já retomou depois de 24 h
  const cliDepois = x.cli.filter((c) => c.t > p.t + 1000);
  if (cliDepois.length && x.robo.some((r) => r.t > cliDepois[0].t)) return null;   // o robô voltou a atender depois
  const uc = ultimo(x.cli); if (uc && uc.t > p.t && N.ENCERRA.test(uc.texto)) return null;
  return { t: iso(p.t), motivo: p.motivo };
}

// ---------- VIGIA ----------
async function vigia(ctx) {
  const est = E(ctx), agora = agoraDe(ctx), cfg = cfgDe();
  const evs = eventos(), ix = indice(evs);
  const st = lerJson(A.estado, { leads: {}, revendedores: {}, lembretes: {}, alerta: {}, retomadas: {} });
  st.leads = st.leads || {}; st.revendedores = st.revendedores || {}; st.lembretes = st.lembretes || {}; st.alerta = st.alerta || {}; st.retomadas = st.retomadas || {};
  const revs = lerJson(A.revendedores, {});
  const revFones = new Map(); for (const [id, r] of Object.entries(revs)) { const f = fim8(r.telefone); if (f.length === 8) revFones.set(f, id); }
  const mapa = lerJson(A.mapa, { itens: [] }); const porMapa = new Map((mapa.itens || []).map((i) => [i.id, i]));
  const filaB = lerJson(A.fila, { itens: [] }); const porFila = new Map((filaB.itens || []).map((i) => [i.id, i]));
  const bEst = lerJson(A.backlogEstado, {});
  const chats = await ctx.client.getChats();
  const porChat = new Map();
  for (const c of chats) { const id = c.id && c.id._serialized; if (!id || c.isGroup || !ctx.conversaValida(id)) continue; porChat.set(id, c); }
  const ids = new Set();
  for (const id of Object.keys(ctx.fichas)) if (ctx.conversaValida(id)) ids.add(id);
  for (const id of porMapa.keys()) ids.add(id);
  const leads = [], devidos = { retomada: [], cadencia: [], jornada: [] }, responder = [];
  const toquesDe = (id, desde) => {
    const l = (st.leads[id] && st.leads[id].toques) || [];
    const fb = porFila.get(id); const bt = fb ? (fb.followups || []).map((f) => ({ t: f.quando, angulo: 'ajuda', origem: 'atrasado', texto: f.texto })) : [];
    return l.concat(bt).filter((x) => Date.parse(x.t) > desde).sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
  };
  for (const id of ids) {
    const f = ctx.fichas[id] || {}, m = porMapa.get(id) || {}, c = porChat.get(id), x = ix.get(id) || { cli: [], robo: [], senhor: [], passou: [], fu: [], pro: [], paineis: [] };
    const lm = c && c.lastMessage;
    const lmTs = lm ? lm.timestamp * 1000 : 0;
    const ultimoTs = Math.max(lmTs, Date.parse(f.ultimo_contato) || 0, Date.parse(m.ultimo_contato) || 0);
    if (!ultimoTs || agora - ultimoTs > 21 * D) continue;
    const fone = f.telefone_real || m.telefone || '';
    const revId = revs[id] ? id : (fim8(fone).length === 8 ? revFones.get(fim8(fone)) : null);
    const fechou = !!revId || N.ETAPAS_FECHOU.includes(f.etapa) || m.categoria === 'painel_criado' || x.paineis.length > 0;
    const categoria = m.categoria || (f.interesse === 'suporte' ? 'suporte' : '');
    let fora = N.CAT_FORA.includes(categoria) ? categoria : null;
    // A leitura do backlog (Haiku) julgou que não cabe toque (interesse não comprovado, nunca escreveu, contato pessoal do senhor): respeita.
    const vetoMapa = m.id && m.elegivel === false && !TRANSITORIO.test(String(m.motivo || '')) && !['painel_criado', ...N.CAT_FORA, 'sem_interesse'].includes(m.categoria) && !(x.cli.length && x.cli[x.cli.length - 1].t > Date.parse(mapa.gerado_em || 0));
    if (!fora && vetoMapa && /salvo pelo senhor|nunca escreveu/.test(String(m.motivo))) fora = 'contato pessoal ou sem conversa';
    const textosCli = x.cli.map((y) => y.texto);
    const pediuParar = m.categoria === 'sem_interesse' || textosCli.some((t) => N.PEDIU_PARAR.test(t));
    // quem falou por último
    let ultimoQuem = m.ultimo_quem || (m.ultimo_a_falar === 'cliente' ? 'cliente' : 'robo');
    let ultimaClienteTs = ultimo(x.cli) ? ultimo(x.cli).t : (m.ultimo_a_falar === 'cliente' ? Date.parse(m.ultimo_contato) : 0);
    let ultimaCliente = ultimo(x.cli) ? ultimo(x.cli).texto : '';
    if (lm && TIPOS_CONTEUDO.concat('automated_greeting_message').includes(lm.type)) {
      if (!lm.fromMe) { ultimoQuem = 'cliente'; if (lmTs >= ultimaClienteTs) { ultimaClienteTs = lmTs; ultimaCliente = lm.type === 'chat' ? String(lm.body || '') : '[' + lm.type + ']'; } }
      else if (lm.type === 'automated_greeting_message') ultimoQuem = 'automatico';
      else {
        const tRobo = Math.max(...x.robo.map((r) => r.t), ...x.pro.map((p) => p.t), 0), tSen = Math.max(...x.senhor, 0);
        if (tSen && tSen >= tRobo - 1000 && Math.abs(tSen - lmTs) < 10 * 60e3) ultimoQuem = 'senhor';
        else if (tRobo && Math.abs(tRobo - lmTs) < 10 * 60e3) ultimoQuem = 'robo';
        else if (m.ultimo_quem && Math.abs(Date.parse(m.ultimo_contato) - lmTs) < 60e3) ultimoQuem = m.ultimo_quem === 'cliente' ? 'robo' : m.ultimo_quem;
        else ultimoQuem = tSen > tRobo ? 'senhor' : 'robo';
      }
    }
    const senhorTs = Math.max(...x.senhor, Date.parse(m.ultimo_manual_senhor) || 0, 0);
    // quando esfriou: última mensagem do cliente; sem ela (conversa antiga), o último contato do mapa. Nunca o horário de um toque nosso.
    const t0 = ultimaClienteTs || Date.parse(m.ultimo_contato) || Date.parse(f.criado_em) || ultimoTs;
    const toques = toquesDe(id, t0);
    const toques21 = ((st.leads[id] && st.leads[id].toques) || []).concat(porFila.get(id) ? (porFila.get(id).followups || []).map((y) => ({ t: y.quando })) : []).filter((y) => agora - Date.parse(y.t) < 21 * D).length;
    let aoVivo = null;
    if (ctx.aguardando && ctx.aguardando.has(id) && ctx.FOLLOWUP_MIN) {
      const n = (ctx.seguiuN && ctx.seguiuN.get(id)) || 0;
      if (n < ctx.FOLLOWUP_MIN.length) aoVivo = { n: n + 1, min: ctx.FOLLOWUP_MIN[n], quando: ctx.aguardando.get(id) + ctx.FOLLOWUP_MIN[n] * 60e3 };
    }
    const fb = porFila.get(id);
    const atrasado = fb && fb.status === 'na_fila' ? { status: 'na_fila', quando: Date.parse(bEst.proximo_envio_em) || agora } : null;
    const recebeuLink = x.robo.some((r) => /painel\.capyplay\.site\/#\/rs\//.test(r.texto)) || /link/i.test(m.resumo || '');
    const sinal = N.sinalDoLead({ textosCliente: textosCli, recebeuLink, teste: !!f.teste, aparelhos: f.aparelhos, ultimaCliente, categoria });
    const pp = passouPendente(x, agora);
    let s = vetoMapa && !fora && !fechou ? { estado: 'perdido_definitivo', vivo: false, proximo: null, motivo: 'a leitura da conversa não recomendou toque: ' + String(m.motivo || '').slice(0, 80) } : N.estadoLead({ id, agora, fechou, fora, pediuParar, ultimoQuem, ultimoTs, ultimaCliente, ultimaClienteTs, primeiroTs: Date.parse(f.criado_em) || 0, passouPendente: pp, senhorTs, aoVivo, atrasado, toques, toques21, t0, quieto: ctx.quieto && ctx.quieto.get(id), categoria, sinal, encerrada: !!(st.leads[id] && st.leads[id].encerrada && st.leads[id].encerrada > t0) });
    if (s.estado === 'encerrada' && !cfg.encerra_bloqueia) s = N.estadoLead({ id, agora, fechou, fora, pediuParar, ultimoQuem, ultimoTs, ultimaCliente: '', ultimaClienteTs, primeiroTs: 0, passouPendente: pp, senhorTs, aoVivo, atrasado, toques, toques21, t0, categoria, sinal });
    // 08/11 (Dashboard, "Atender novamente todos"): frio fora da fila volta para a fila com UM toque "reaquecer".
    if (st.reaquecer_pedido && st.reaquecer_aplicado !== st.reaquecer_pedido && ['perdido_definitivo', 'encerrada'].includes(s.estado) && !fechou && !fora && !pediuParar) (st.leads[id] || (st.leads[id] = { toques: [] })).reaquecer = st.reaquecer_pedido;
    const Lrq = st.leads[id];
    if (Lrq && Lrq.reaquecer) {
      const tRq = Date.parse(Lrq.reaquecer);
      const tocou = (Lrq.toques || []).some((y) => Date.parse(y.t) >= tRq - 60e3);
      if (tocou || agora - tRq > 72 * H || fechou || fora || pediuParar || !['perdido_definitivo', 'encerrada'].includes(s.estado)) delete Lrq.reaquecer;
      else s = { estado: 'esfriando', vivo: true, reaquecer: true, proximo: { tipo: 'cadencia', quando: N.paraJanela(tRq), angulo: 'reaquecer', indice: toques.length, detalhe: 'atender de novo (pedido do senhor)' } };
    }
    const prox = s.proximo;
    const lead = { id, ref: N.refDe(id), nome: f.nome || m.nome || id.split('@')[0], telefone: N.mascarar(fone), estado: s.estado, vivo: s.vivo, proximo: prox ? { ...prox, quando: prox.quando ? iso(prox.quando) : null } : null, motivo: s.motivo || null,
      ultimo_contato: iso(ultimoTs), ultimo_quem: ultimoQuem, categoria: categoria || null, sinal, toques: toques.length, toques_21d: toques21, etiqueta: N.etiquetaPara(s, { categoria, testando: sinal === 'testando' && !fechou }), passou: pp, reaquecer: !!s.reaquecer };
    // vencido: conta a partir da primeira vez que a vigia viu o passo vencido (um D+1 de dias atrás não é "travado" na hora)
    st.devido = st.devido || {};
    const chaveD = id + '|' + (prox ? prox.tipo + (prox.angulo || '') : '');
    if (prox && prox.quando && prox.quando <= agora) { if (!st.devido[chaveD]) st.devido[chaveD] = agora; } else delete st.devido[chaveD];
    const efetivo = prox && prox.quando && prox.quando <= agora ? { ...prox, quando: st.devido[chaveD] } : prox;
    if (efetivo && lead.proximo && prox.quando && prox.quando <= agora) lead.proximo.quando = iso(Math.max(prox.quando, st.devido[chaveD]));
    lead.travado = s.vivo && N.passoTravado(efetivo, agora, N.LIM, { teto: est.tetoAtingido });
    leads.push(lead);
    if (prox && prox.quando && prox.quando <= agora) {
      if (prox.tipo === 'responder' && agora - ultimaClienteTs >= N.LIM.responder_min * 60e3) responder.push(lead);
      else if (prox.tipo === 'retomada') devidos.retomada.push({ ...lead, motivo_passou: pp && pp.motivo });
      else if (prox.tipo === 'cadencia') devidos.cadencia.push({ ...lead, angulo: prox.angulo, indice: prox.indice, t0 });
    }
  }
  if (st.reaquecer_pedido && st.reaquecer_aplicado !== st.reaquecer_pedido) { st.reaquecer_aplicado = st.reaquecer_pedido; logar(ctx, 'funil atender novamente: ' + leads.filter((l) => l.reaquecer).length + ' frio(s) fora da fila voltaram para a fila'); }
  // ---------- jornada dos revendedores ----------
  const jornada = [];
  for (const [id, r] of Object.entries(revs)) {
    const fechouMs = Date.parse(r.fechou_em); if (!Number.isFinite(fechouMs)) continue;
    const x = ix.get(id) || { cli: [], robo: [], senhor: [], passou: [], fu: [], pro: [], paineis: [] };
    const j = st.revendedores[id] || (st.revendedores[id] = { toques: [] });
    const pp = passouPendente(x, agora);
    const uso = r.uso || null;
    const status = N.statusRevendedor({ fechouMs, agora, uso, resposta: j.resposta, passouPendente: pp });
    const prox = N.proximoJornada({ id, fechouMs, agora, toques: j.toques, uso, pausaAte: j.pausa_ate ? Date.parse(j.pausa_ate) : 0, status });
    const c = porChat.get(id), lm = c && c.lastMessage;
    const senhorTs = Math.max(...x.senhor, 0);
    let bloqueio = null;
    if ((x.cli || []).some((y) => N.PEDIU_PARAR.test(y.texto))) bloqueio = 'pediu para parar';
    else if (senhorTs && agora - senhorTs < N.LIM.senhor_manual_h * H) bloqueio = 'o senhor atendeu na mão nas últimas 48 h';
    else if (pp) bloqueio = 'passou ao senhor (aguardando)';
    else if (lm && !lm.fromMe && TIPOS_CONTEUDO.includes(lm.type) && agora - lm.timestamp * 1000 < 48 * H) bloqueio = 'a última palavra é dele: o robô responde primeiro';
    else if (ctx.quieto && (ctx.quieto.get(id) || 0) > agora) bloqueio = 'conversa em silêncio';
    const ult = ultimo(j.toques);
    const item = { id, ref: N.refDe(id), nome: r.nome || '', painel_numero: r.painel_numero ?? null, telefone: N.mascarar(r.telefone || ''), fechou_em: r.fechou_em, dias: Math.floor((agora - fechouMs) / D),
      uso: uso ? { creditos_usados: uso.usados ?? null, saldo: uso.saldo ?? null, ultimo_login: uso.ultimo_login || null, lido_em: uso.lido_em || null } : null, status,
      ultimo_toque: ult ? { quando: ult.t, tipo: ult.tipo, texto: ult.texto || '', respondeu: !!ult.respondeu_em } : null,
      proximo: prox ? { tipo: prox.tipo, quando: iso(prox.quando), fechamento: !prox.regular } : null, bloqueio, resposta: j.resposta || null, toques: j.toques.length, tocar_agora: !!j.tocar_agora };
    jornada.push(item);
    if (!bloqueio && prox && (prox.quando <= agora || j.tocar_agora)) devidos.jornada.push({ ...item, toque: prox.tipo, regular: prox.regular, uso });
  }
  // ---------- KPIs, demandas e fotos ----------
  const vivos = leads.filter((l) => l.vivo);
  const semPasso = vivos.filter((l) => !l.proximo || l.travado);
  const porEstado = {}; for (const l of leads) porEstado[l.estado] = (porEstado[l.estado] || 0) + 1;
  est.demandas = { retomada: devidos.retomada.length, cadencia: devidos.cadencia.length, jornada: devidos.jornada.length, lacuna: est.lacunaDevidos || 0, atrasado: 0 };
  est.demandasEm = agora;
  est.devidos = devidos; est.responder = responder;
  const { hoje } = N.contarProativosHoje(evs, agora);
  est.tetoAtingido = hoje >= N.LIM.teto_total - N.LIM.reserva_ao_vivo;
  // alerta: sem próximo passo > 0 por mais de 1 h
  if (semPasso.length) { if (!st.alerta.desde) st.alerta.desde = iso(agora); } else st.alerta.desde = null;
  const alertaAtivo = !!(st.alerta.desde && agora - Date.parse(st.alerta.desde) > N.LIM.alerta_min * 60e3);
  if (alertaAtivo && (!st.alerta.ultimo_aviso || agora - Date.parse(st.alerta.ultimo_aviso) > 3 * H) && N.naJanela(agora, 9, 21)) {
    st.alerta.ultimo_aviso = iso(agora);
    try { ctx.avisarSenhor(`Revenda (vigia de leads): ${semPasso.length} lead(s) sem próximo passo há mais de 1 h: ${semPasso.slice(0, 8).map((l) => l.nome).join(', ')}. Veja a aba Funil.`); } catch {}
    try { ctx.evento('alerta_sem_passo', null, null, { n: semPasso.length, nomes: semPasso.slice(0, 8).map((l) => l.nome) }); } catch {}
  }
  // lembrete agrupado ao senhor (passou ao senhor há mais de 2 h, sem ele escrever), no máximo a cada 2 h, 9h-21h
  const esperando = leads.filter((l) => l.passou && agora - Date.parse(l.passou.t) >= N.LIM.lembrete_h * H)
    .concat(jornada.filter((j) => j.status === 'passou_ao_senhor').map((j) => ({ nome: j.nome, passou: passouPendente(ix.get(j.id) || { passou: [], senhor: [], cli: [], robo: [] }, agora) })).filter((j) => j.passou && agora - Date.parse(j.passou.t) >= N.LIM.lembrete_h * H));
  if (cfg.lembretes && esperando.length && N.naJanela(agora, N.LIM.lembrete_ini, N.LIM.lembrete_fim) && (!st.lembretes.ultimo || agora - Date.parse(st.lembretes.ultimo) >= N.LIM.lembrete_intervalo_h * H)) {
    st.lembretes.ultimo = iso(agora);
    const linhas = esperando.slice(0, 12).map((l) => `${l.nome} (há ${Math.round((agora - Date.parse(l.passou.t)) / H)} h${l.passou.motivo ? ': ' + String(l.passou.motivo).slice(0, 60) : ''})`);
    try { ctx.avisarSenhor(`Revenda: ${esperando.length} conversa(s) esperando o senhor:\n- ${linhas.join('\n- ')}\nSe ninguém pegar em 24 h, o robô retoma sozinho.`); } catch {}
    try { ctx.evento('lembrete_senhor', null, null, { n: esperando.length, nomes: esperando.slice(0, 12).map((l) => l.nome) }); } catch {}
  }
  // A/B
  const decisoes = calcularAB(evs, agora);
  const abAnt = lerJson(A.ab, {});
  for (const [deg, d] of Object.entries(decisoes)) if ((d.decisao === 'A' || d.decisao === 'B') && !(abAnt.decisoes && abAnt.decisoes[deg] && abAnt.decisoes[deg].decisao === d.decisao)) { try { ctx.evento('ab_decidido', null, null, { degrau: deg, vencedora: d.decisao, texto: d.texto }); } catch {} }
  gravar(A.ab, { atualizado_em: iso(agora), decisoes });
  // próximos toques por dia (7 dias)
  const proxDias = {};
  const diaDe = (q) => { const d = new Date(Math.max(Date.parse(q), agora)); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const proxJor = {};
  for (const l of leads) if (l.vivo && l.proximo && l.proximo.quando && ['cadencia', 'retomada', 'atrasado'].includes(l.proximo.tipo)) { const k = diaDe(l.proximo.quando); proxDias[k] = (proxDias[k] || 0) + 1; }
  for (const j of jornada) if (j.proximo && !j.bloqueio) { const k = diaDe(j.proximo.quando); proxJor[k] = (proxJor[k] || 0) + 1; }
  const kpis = { leads_total: leads.length, vivos: vivos.length, sem_proximo_passo: semPasso.length, sem_proximo_passo_nomes: semPasso.slice(0, 10).map((l) => l.nome), alerta_desde: st.alerta.desde, por_estado: porEstado,
    devidos_agora: { responder: responder.length, retomada: devidos.retomada.length, cadencia: devidos.cadencia.length, jornada: devidos.jornada.length }, proativos_hoje: hoje, teto: N.LIM.teto_total, esperando_senhor: esperando.length,
    encerradas: porEstado.encerrada || 0 };
  gravar(A.leads, { atualizado_em: iso(agora), kpis, proximos_por_dia: proxDias, proximos_jornada_por_dia: proxJor, leads: leads.map(({ id, ...l }) => l) });
  gravar(A.jornada, { atualizado_em: iso(agora), pausada: fs.existsSync(A.jornadaPausada), revendedores: jornada.map(({ id, ...j }) => j) });
  gravar(A.estado, st);
  est.vigiaEm = agora; est.ultimoKpi = kpis;
  est.etiquetasAlvo = new Map(leads.filter((l) => l.etiqueta !== undefined).map((l) => [l.id, l.etiqueta]));
  for (const j of jornada) est.etiquetasAlvo.set(j.id, 'revendedor');
  return kpis;
}

// ---------- texto dos toques ----------
const ANGULO_TXT = {
  ajuda: {
    preco: 'AJUDA PRÁTICA sobre o valor: ele falou de preço. Faça a conta com ele usando SÓ os exemplos do base.md (20 clientes = R$ 70; menos de 10 clientes = mínimo de R$ 35) e diga que é pós-pago.',
    sumiu_depois_do_link: 'AJUDA PRÁTICA para criar o painel: ele recebeu o link e não criou. Lembre, em uma frase, que abrir não custa nada (é pós-pago e o painel já vem com 500 créditos) e que o link continua logo acima na conversa. Pergunte em qual tela ele parou e diga que pode mandar um print que você ajuda. Não mande o link de novo e não cobre.',
    testando: 'AJUDA PRÁTICA sobre o teste: pergunte como foi o teste e se conseguiu abrir no aparelho.',
    sem_aparelho: 'AJUDA PRÁTICA: pergunte em qual aparelho os clientes dele assistem (TV, TV Box, celular ou computador) para indicar o app certo.',
    pergunta_aberta: 'RESPONDA a última pergunta dele que ficou sem resposta, usando só o base.md, e ofereça ajuda.',
    geral: 'AJUDA PRÁTICA: retome o ponto em que a conversa parou e ofereça ajuda para o próximo passo.',
  },
  // 10/11/2026: a conta (20 clientes = R$ 70) só entra se ele falou de preço; senão a prova é a simplicidade (pós-pago, sem taxa, 500 créditos).
  prova: 'PROVA DE SIMPLICIDADE: mostre como é fácil começar com UM fato do base.md (pós-pago, sem taxa para abrir, painel já vem com 500 créditos, só acerta no dia 5). Só dê exemplo de conta em reais (20 clientes = R$ 70) se a conversa mostrar que ele perguntou de preço ou valor. Use SÓ fatos do base.md: não invente números, casos, depoimentos, quantos revendedores existem nem resultados de outras pessoas.',
  beneficio: 'BENEFÍCIO: conte UM benefício concreto do base.md: no canal https://t.me/capyplayoficial saem banners e vídeos prontos para divulgar, e a Escola do Revendedor (https://escola.capyapp.net) dá uma campanha de anúncios de R$ 50 feita por nós para quem termina. No máximo um link.',
  porta: 'PORTA ABERTA (último toque): mensagem leve dizendo que não vai mais insistir e que, quando ele quiser começar, é só chamar aqui. Sem pressão e sem pergunta insistente.',
  reativacao: 'REATIVAÇÃO (um mês depois): pergunte, leve, se ele ainda pensa em revender.',
  reaquecer: 'ATENDER DE NOVO (pedido do responsável): a conversa esfriou. Retome de forma leve no ponto em que ela parou e pergunte se ele ainda quer ajuda para começar a revender. Não mande link e não repita o que já foi dito.',
};
const ESTILO = { A: 'Estilo A: UMA frase curta que termina com uma pergunta simples de sim ou não.', B: 'Estilo B: duas frases curtas: um fato útil do base.md e um convite aberto para ele responder.' };
const JORNADA_TXT = {
  checkin_d1: 'O revendedor criou o painel ontem e ainda não vendeu. Dê UM passo para o primeiro cliente: criar no painel um teste para alguém de casa ou um amigo e deixar essa pessoa assistir na TV dela. Pergunte se ele já pensou em quem vai ser esse primeiro. Se a conversa ou o dado do painel mostrar que ele já cadastrou cliente, em vez disso sugira pegar um banner pronto no canal https://t.me/capyplayoficial para divulgar.',
  checkin_d3: 'Três dias de painel. Dê UM passo para a primeira venda: pegar um banner ou vídeo pronto no canal https://t.me/capyplayoficial e mandar para 5 contatos no WhatsApp ou postar no status. Pergunte se ele já sabe para quem vai mandar. Use só esse link. Se a conversa mostrar que ele já divulgou, pergunte se alguém respondeu e ofereça ajuda para fechar.',
  checkin_d7: 'Uma semana de painel. Pergunte, leve, se ele já fez a primeira venda. Se não fez, indique o caminho mais curto: as aulas da Escola do Revendedor (https://escola.capyapp.net), que ensinam do painel até a primeira venda, e conte que quem termina ganha uma campanha de anúncios feita por nós. Se o dado do painel mostrar cliente cadastrado, não fale da Escola: pergunte se esse cliente já pagou e se ele quer ajuda para achar o próximo.',
  checkin: 'Check-in de rotina, leve. Se ele ainda não vendeu, sugira UM passo que ainda não apareceu na conversa, nesta ordem: teste no painel para alguém de casa; banner ou vídeo pronto do canal https://t.me/capyplayoficial para 5 contatos; aulas da Escola do Revendedor (https://escola.capyapp.net). Se ele já vende, pergunte se precisa de ajuda com algum cliente. No máximo um link.',
  ajuda_sem_uso: 'O painel dele ainda não tem cliente cadastrado (dado do painel). Diga que o primeiro cliente pode ser alguém de casa: criar um teste no painel e ver funcionando na TV da pessoa. Indique a aula de cadastrar clientes da Escola do Revendedor (https://escola.capyapp.net) e pergunte em qual passo ele travou: entrar no painel, cadastrar o cliente ou instalar o app. Não diga números.',
  reconhecimento: 'O painel mostra que ele já está cadastrando clientes. Dê um reconhecimento curto (sem números) e pergunte como estão as vendas.',
  fechamento_vendas: 'Está chegando o fim do mês. Pergunte se ele conseguiu fazer vendas este mês. Não fale de valores nem de pagamento.',
  fechamento_pagamento: 'O acerto é no dia 5. Pergunte se ficou alguma dúvida sobre o pagamento e diga só que no dia 5 chega o link de pagamento com o valor dos créditos usados no mês. NÃO mande link de pagamento.',
};
function linhasConversa(ms, max = 14) {
  return ms.slice(-max).map((m) => `${m.fromMe ? 'Revenda' : 'Cliente'}: ${m.type === 'chat' ? String(m.body || '').replace(/(senha)\s*[:=]?\s*\S+/gi, '$1 [oculta]').slice(0, 300) : '[' + m.type + ']'}`).join('\n');
}
function pedidoToque(item, ms, ficha) {
  const fx = { etapa: ficha.etapa, ja_revende: ficha.ja_revende, aparelhos: ficha.aparelhos, qtd_clientes: ficha.qtd_clientes, resumo: ficha.resumo };
  let tarefa;
  if (item.tipo === 'cadencia') {
    const ang = item.angulo === 'ajuda' ? ANGULO_TXT.ajuda[item.sinal] || ANGULO_TXT.ajuda.geral : ANGULO_TXT[item.angulo];
    tarefa = `TAREFA ESPECIAL (cadência de funil, toque ${item.indice + 1}, ângulo ${item.angulo}): o cliente esfriou e não responde há ${Math.max(1, Math.round((Date.now() - item.t0) / D))} dia(s). ${ang} ${ESTILO[item.variante]}`;
  } else if (item.tipo === 'jornada') {
    const usoTxt = item.uso && Number.isFinite(item.uso.usados) ? (item.uso.usados === 0 ? 'o painel ainda não tem cliente cadastrado' : item.uso.usados < 10 ? 'uso baixo no painel (menos de 10 créditos usados)' : 'o painel já tem uso bom') : 'sem dado de uso do painel';
    const extra = item.toque === 'fechamento_pagamento' && item.uso && item.uso.usados < 10 ? ' Como o uso está baixo, explique em uma frase o mínimo de 10 créditos (R$ 35) no mês.' : '';
    tarefa = `TAREFA ESPECIAL (jornada do revendedor que JÁ TEM PAINEL, ${item.dias} dia(s) depois de criar; ${usoTxt}): ${JORNADA_TXT[item.toque] || JORNADA_TXT.checkin}${extra} ${ESTILO[item.variante]} Não explique de novo como funciona a revenda. Ele JÁ TEM painel: se precisar do link do painel (por exemplo, para ajudar a entrar), use só o de entrada https://painel.capyplay.site/#/dashboard e NUNCA o link de criar painel.`;
  } else {
    tarefa = `TAREFA ESPECIAL (retomada): este caso foi passado ao responsável há mais de 24 horas (motivo: ${String(item.motivo_passou || 'não informado').slice(0, 140)}) e ninguém retomou. Escreva UMA mensagem útil: peça desculpa pela demora de forma simples e pergunte se ainda precisa de ajuda com isso, dizendo que pode ajudar por aqui. Não prometa prazo e não diga que já foi resolvido.`;
  }
  return `Hoje é ${new Date().toLocaleDateString('pt-BR')}.\n\nFicha do cliente:\n${JSON.stringify(fx)}\n\nConversa (a última linha é a mais nova):\n${linhasConversa(ms)}\n\n${tarefa}\n` +
    'Regras: no máximo 2 frases curtas (até 220 caracteres); palavras simples; sem emoji; chame de "mestre" e NUNCA pelo nome; sem pressão e sem urgência; não cumprimente como se fosse a primeira vez; não repita o que já foi dito na conversa; só use links, números e valores que estão no base.md; nada de descontos, promoções, prazos, programas ou relatórios que não existem. ' +
    'Responda no formato JSON pedido, com "mensagens" contendo só essa mensagem e os demais campos vazios ou falsos (sem teste, sem guia, sem vídeos, sem avisar).';
}
async function gerarTexto(ctx, item, ms, ficha, anteriores, aberturas) {
  const baseMd = (() => { try { const d = new Date(); const p = new Date(d.getFullYear(), d.getMonth() + 1, 5); return fs.readFileSync(A.base, 'utf8').replace(/05\/12/g, '05/' + String(p.getMonth() + 1).padStart(2, '0')); } catch { return ''; } })();
  const nomes = [item.nome, ficha.nome].filter(Boolean);
  let motivo = 'sem resposta do Haiku';
  const custo = E(ctx).custo || (E(ctx).custo = { dia: '', chamadas: 0 });
  for (let t = 0; t < 3; t++) {
    let pedido = pedidoToque(item, ms, ficha);
    if (aberturas.length) pedido += `\nNão comece com: ${aberturas.slice(-8).map((a) => '"' + a + '"').join(', ')}.`;
    if (t > 0) pedido += `\nA tentativa anterior foi recusada porque: ${motivo}. Corrija.`;
    const hoje = new Date().toDateString(); if (custo.dia !== hoje) { custo.dia = hoje; custo.chamadas = 0; } custo.chamadas++;
    const r = await ctx.perguntarHaiku(pedido);
    if (!r) { motivo = 'sem resposta do Haiku'; continue; }
    const lista = (Array.isArray(r.mensagens) ? r.mensagens : []).map((x) => ctx.limpar(x)).filter(Boolean);
    if (!lista.length) return { ok: false, motivo: 'o Haiku achou que não cabe mensagem', vazio: true };
    const texto = lista.join(' ').replace(/\s+/g, ' ').trim();
    let v = N.filtrarTexto(texto, { baseMd, nomes, anteriores, aberturasRecentes: aberturas });
    if (v.ok && item.tipo === 'jornada' && /painel\.capyplay\.site\/#\/rs\//.test(texto)) v = { ok: false, motivo: 'revendedor já tem painel: use o link de entrada, nunca o de criar' };
    if (v.ok) return { ok: true, texto, tentativas: t + 1 };
    motivo = v.motivo;
  }
  return { ok: false, motivo };
}
async function enviarTexto(ctx, chat, id, texto) {
  try { if (require('../desligados.js').desligado(id)) return false; } catch {}
  try { await chat.sendStateTyping(); } catch {}
  await new Promise((r) => setTimeout(r, Math.min(2000 + texto.length * 40 + Math.floor(Math.random() * 1500), 9000)));
  ctx.seguindo.add(id);
  try {
    ctx.marcarEnvio(id);
    ctx.textosDoRobo.add(texto); setTimeout(() => ctx.textosDoRobo.delete(texto), 60000);
    const m = await chat.sendMessage(texto);
    if (!m || !m.id) throw new Error('envio sem confirmação do WhatsApp');
    ctx.enviadasPeloRobo.add(m.id._serialized);
    return m;
  } finally { ctx.seguindo.delete(id); if (ctx.aguardando) ctx.aguardando.delete(id); try { await chat.clearState(); } catch {} }
}

// Executa um toque (cadência, jornada ou retomada). Confere tudo de novo antes de mandar.
async function executar(ctx, item) {
  const agora = agoraDe(ctx), est = E(ctx), id = item.id;
  const st = lerJson(A.estado, { leads: {}, revendedores: {} });
  const nao = (motivo, consumir) => {
    logar(ctx, `funil não tocou ${item.nome} (${item.tipo}) - ${motivo}`);
    (est.adiados || (est.adiados = {}))[id + '|' + item.tipo] = agora + (consumir ? 6 * H : 20 * 60e3);
    return { ok: false, motivo };
  };
  if ((ctx.quieto && (ctx.quieto.get(id) || 0) > agora) || ctx.atendendo.has(id) || ctx.fila.has(id) || ctx.aguardando.has(id)) return nao('fluxo ao vivo ativo');
  const revs = lerJson(A.revendedores, {});
  if (item.tipo !== 'jornada' && revs[id]) return nao('já fechou painel', true);
  const ULT_SENHOR = ctx.ULTIMO_SENHOR && ctx.ULTIMO_SENHOR.get(id);
  if (ULT_SENHOR && agora - ULT_SENHOR < N.LIM.senhor_manual_h * H) return nao('o senhor escreveu nas últimas 48 h', true);
  // trava dura: no máximo 1 toque de dias (cadência/jornada/retomada/atrasado) por pessoa a cada 20 h, salvo "tocar agora"
  const recentePro = eventos().filter((e) => e.chat === id && ['toque_cadencia', 'toque_jornada', 'retomada_senhor', 'followup_backlog'].includes(e.tipo) && agora - Date.parse(e.t) < 20 * H);
  if (recentePro.length && !item.tocar_agora) return nao('já recebeu um toque nas últimas 20 h', true);
  const chat = await ctx.client.getChatById(id);
  const ms = (await chat.fetchMessages({ limit: 20 })).filter((m) => TIPOS_CONTEUDO.includes(m.type) && (m.type !== 'chat' || String(m.body || '').trim()));
  const ul = ms[ms.length - 1];
  if (ul && !ul.fromMe && agora - ul.timestamp * 1000 < 48 * H) return nao('o cliente escreveu: o fluxo normal responde');
  if (ul && !ul.fromMe && item.tipo === 'jornada') return nao('última palavra do revendedor: espera o robô responder');
  if (ms.filter((m) => !m.fromMe).some((m) => N.PEDIU_PARAR.test(String(m.body || '')))) return nao('pediu para parar', true);
  const ultCli = [...ms].reverse().find((m) => !m.fromMe);
  if (item.tipo === 'cadencia' && !item.reaquecer && cfgDe().encerra_bloqueia && ultCli && ultCli.type === 'chat' && N.ENCERRA.test(String(ultCli.body || ''))) {
    const s0 = lerJson(A.estado, { leads: {} }); s0.leads = s0.leads || {}; (s0.leads[id] || (s0.leads[id] = { toques: [] })).encerrada = agora; gravar(A.estado, s0);
    return nao('o cliente encerrou com ok/obrigado', true);
  }
  const ficha = ctx.fichas[id] || {};
  const evs = eventos();
  const anteriores = evs.filter((e) => e.chat === id && (e.tipo === 'resposta_robo' || N.TIPOS_PROATIVOS.includes(e.tipo))).slice(-30).map((e) => e.texto).filter(Boolean)
    .concat(ms.filter((m) => m.fromMe && m.type === 'chat').map((m) => m.body))
    .concat(evs.filter((e) => ['toque_cadencia', 'toque_jornada', 'retomada_senhor'].includes(e.tipo)).slice(-40).map((e) => e.texto));
  const aberturas = evs.filter((e) => N.TIPOS_PROATIVOS.includes(e.tipo)).slice(-10).map((e) => N.abertura(e.texto || '')).filter(Boolean);
  const degrau = item.tipo === 'cadencia' ? 'cad_' + item.angulo : item.tipo === 'jornada' ? 'jor_' + String(item.toque).replace(/_d\d$/, '') : 'retomada';
  item.variante = item.tipo === 'retomada' ? 'A' : variante(degrau, id);
  const g = await gerarTexto(ctx, item, ms, ficha, anteriores, aberturas);
  if (!g.ok) {
    if (item.tipo === 'cadencia') { const L = st.leads[id] || (st.leads[id] = { toques: [] }); L.pulos = (L.pulos || 0) + 1; if (L.pulos >= 2 || g.vazio) { L.toques.push({ t: iso(agora), angulo: item.angulo, pulado: true, motivo: g.motivo }); L.pulos = 0; } gravar(A.estado, st); }
    if (item.tipo === 'jornada') { const J = st.revendedores[id] || (st.revendedores[id] = { toques: [] }); if (g.vazio) J.toques.push({ t: iso(agora), tipo: item.toque, regular: item.regular, pulado: true }); J.tocar_agora = false; gravar(A.estado, st); }
    return nao('sem texto válido (' + g.motivo + ')');
  }
  // portão de novo, logo antes de enviar (o Haiku demora)
  const tipoPortao = item.tipo === 'retomada' ? 'retomada' : item.tipo;
  const p = pode(ctx, tipoPortao);
  if (!p.ok && !((item.tocar_agora || item.reaquecer) && ['ritmo', 'prioridade_cadencia', 'prioridade_atrasado'].includes(p.motivo))) return nao('portão fechou: ' + p.motivo);
  try { if (require('../desligados.js').desligado(id)) return nao('robô desligado nesta conversa', true); } catch {}
  registrar(ctx, tipoPortao);
  const m = await enviarTexto(ctx, chat, id, g.texto);
  const quando = iso(agoraDe(ctx));
  const st2 = lerJson(A.estado, { leads: {}, revendedores: {} }); st2.leads = st2.leads || {}; st2.revendedores = st2.revendedores || {};
  if (item.tipo === 'cadencia') {
    const L = st2.leads[id] || (st2.leads[id] = { toques: [] }); L.pulos = 0;
    L.toques.push({ t: quando, angulo: item.angulo, indice: item.indice, variante: item.variante, sinal: item.sinal, texto: g.texto, msg_id: m.id._serialized });
    ctx.evento('toque_cadencia', id, item.nome, { n: item.indice + 1, angulo: item.angulo, variante: item.variante, sinal: item.sinal, texto: g.texto });
  } else if (item.tipo === 'jornada') {
    const J = st2.revendedores[id] || (st2.revendedores[id] = { toques: [] }); J.tocar_agora = false;
    J.toques.push({ t: quando, tipo: item.toque, regular: item.regular, variante: item.variante, texto: g.texto, status: item.status, msg_id: m.id._serialized });
    ctx.evento('toque_jornada', id, item.nome, { toque: item.toque, variante: item.variante, status: item.status, texto: g.texto, painel_numero: item.painel_numero });
  } else {
    st2.retomadas = st2.retomadas || {}; st2.retomadas[id] = quando;
    ctx.evento('retomada_senhor', id, item.nome, { texto: g.texto, motivo: item.motivo_passou || '' });
  }
  gravar(A.estado, st2);
  try { const f = ctx.fichas[id]; if (f) { f.notas = (f.notas || []).concat(`${new Date().toLocaleDateString('pt-BR')}: ${item.tipo === 'jornada' ? 'check-in da jornada (' + item.toque + ')' : item.tipo === 'cadencia' ? 'toque da cadência (' + item.angulo + ')' : 'retomada depois de 24 h com o senhor'}.`).slice(-15); ctx.salvarFichas(); } } catch {}
  logar(ctx, `robô -> ${item.nome}: [${item.tipo === 'cadencia' ? 'cadência ' + item.angulo + ' ' + item.variante : item.tipo === 'jornada' ? 'jornada ' + item.toque + ' ' + item.variante : 'retomada'}] ${g.texto}`);
  return { ok: true, texto: g.texto };
}

// Chamado pelo bot a cada mensagem de cliente: marca resposta ao último toque e classifica a resposta do revendedor.
function aoReceber(ctx, id, tsSeg, texto) {
  try {
    const ts = (tsSeg || Date.now() / 1000) * 1000;
    const st = lerJson(A.estado, null); if (!st) return;
    let mudou = false;
    const L = st.leads && st.leads[id];
    const ult = L && L.toques && [...L.toques].reverse().find((x) => !x.pulado);
    if (ult && !ult.respondeu_em && ts > Date.parse(ult.t) && ts - Date.parse(ult.t) < 48 * H) {
      ult.respondeu_em = iso(ts); mudou = true;
      ctx.evento('toque_respondido', id, null, { origem: 'cadencia', angulo: ult.angulo, variante: ult.variante, minutos: Math.round((ts - Date.parse(ult.t)) / 60000) });
    }
    const J = st.revendedores && st.revendedores[id];
    const uj = J && J.toques && [...J.toques].reverse().find((x) => !x.pulado);
    if (J && texto) {
      const recente = uj && ts > Date.parse(uj.t) && ts - Date.parse(uj.t) < 72 * H;
      const classe = N.classificarResposta(texto);
      if (recente || classe === 'duvida_pagamento' || classe === 'problema') {
        J.resposta = { t: iso(ts), classe, texto: String(texto).replace(/(senha)\s*[:=]?\s*\S+/gi, '$1 [oculta]').slice(0, 140), ao_toque: uj ? uj.tipo : null };
        if (recente && !uj.respondeu_em) { uj.respondeu_em = iso(ts); ctx.evento('toque_respondido', id, null, { origem: 'jornada', toque: uj.tipo, variante: uj.variante, classe, minutos: Math.round((ts - Date.parse(uj.t)) / 60000) }); }
        if (classe === 'tudo_certo') {
          const r = lerJson(A.revendedores, {})[id];
          const jan = r ? N.janelasFechamento(Date.parse(r.fechou_em), ts).find((j) => j.ini > ts) : null;
          if (jan) J.pausa_ate = iso(jan.ini);
        }
        try { const f = ctx.fichas[id]; if (f) { f.jornada_resposta = { quando: iso(ts), classe }; ctx.salvarFichas(); } } catch {}
        mudou = true;
      }
    }
    if (mudou) gravar(A.estado, st);
  } catch (e) { logar(ctx, 'funil aoReceber falhou - ' + (e.message || e)); }
}

// ---------- etiquetas do WhatsApp ----------
async function descobrirEtiquetas(ctx) {
  const est = E(ctx), agora = agoraDe(ctx);
  const info = lerJson(A.etiquetas, {});
  if (info.descoberto_em && agora - Date.parse(info.descoberto_em) < 30 * 60e3 && est.etiquetasIds) return info;
  try {
    const plataforma = await ctx.client.pupPage.evaluate(() => { try { return window.require('WAWebConnModel').Conn.platform; } catch (e) { return 'desconhecida'; } });
    let labels = [];
    try { labels = await ctx.client.getLabels(); } catch (e) { info.erro_listar = String(e && e.message || e).slice(0, 160); }
    const lista = labels.map((l) => ({ id: String(l.id), nome: l.name, cor: l.hexColor }));
    const ids = {};
    for (const e of N.ETIQUETAS) { const a = lista.find((l) => N.norm(l.nome) === N.norm(e.nome) || (e.chave === 'atrasado' && /^atrasado/.test(N.norm(l.nome)))); if (a) ids[e.chave] = a.id; }
    // criação: só se a versão do WhatsApp expuser uma ação de criar etiqueta (descoberta; criação testada em UMA etiqueta)
    let criar = info.criar || null;
    if (!criar) {
      criar = await ctx.client.pupPage.evaluate(() => {
        const out = {};
        for (const nome of ['WAWebBizLabelEditingAction', 'WAWebLabelEditingAction', 'WAWebBizLabelAction', 'WAWebLabelCollection', 'WAWebCollections']) {
          try { const m = window.require(nome); out[nome] = Object.keys(m || {}).filter((k) => /label/i.test(k) || nome !== 'WAWebCollections').slice(0, 30); } catch (e) { out[nome] = null; }
        }
        try { const L = window.require('WAWebCollections').Label; out.Label_metodos = Object.getOwnPropertyNames(Object.getPrototypeOf(L)).filter((k) => /label|add|create|edit/i.test(k)).slice(0, 30); } catch (e) {}
        return out;
      }).catch((e) => ({ erro: String(e && e.message || e).slice(0, 160) }));
    }
    const novo = { ...info, descoberto_em: iso(agora), plataforma, business: ['smba', 'smbi'].includes(plataforma), existentes: lista, ids, faltam: N.ETIQUETAS.filter((e) => !ids[e.chave]).map((e) => ({ nome: e.nome, cor: e.cor })), criar };
    gravar(A.etiquetas, novo);
    est.etiquetasIds = ids;
    return novo;
  } catch (e) { logar(ctx, 'funil etiquetas - ' + (e.message || e)); return info; }
}
async function tentarCriarEtiqueta(ctx, nome, corIndice) {
  // Tenta a ação interna de criar etiqueta, se existir. Devolve { ok, motivo }. Usada uma vez, numa etiqueta, pelo comando "criar_etiquetas".
  return ctx.client.pupPage.evaluate(async (nome, cor) => {
    const cands = [['WAWebBizLabelEditingAction', ['labelAddAction', 'addLabelAction', 'createLabelAction', 'addLabel']], ['WAWebLabelEditingAction', ['labelAddAction', 'addLabel']]];
    for (const [mod, fns] of cands) {
      let m = null; try { m = window.require(mod); } catch (e) { continue; }
      for (const f of fns) if (m && typeof m[f] === 'function') { try { const r = await m[f](nome, cor); return { ok: true, via: mod + '.' + f, r: r ? String(r).slice(0, 80) : null }; } catch (e) { return { ok: false, via: mod + '.' + f, motivo: String(e && e.message || e).slice(0, 160) }; } }
    }
    return { ok: false, motivo: 'esta versão do WhatsApp Web não expõe ação de criar etiqueta' };
  }, nome, corIndice).catch((e) => ({ ok: false, motivo: String(e && e.message || e).slice(0, 160) }));
}
async function sincronizarUmaEtiqueta(ctx) {
  const est = E(ctx), agora = agoraDe(ctx);
  if (!cfgDe().etiquetas || fs.existsSync(A.etiquetasPausadas) || !est.etiquetasAlvo || !est.etiquetasIds) return;
  if (agora - (est.ultimaEtiqueta || 0) < 2000 + Math.random() * 2000) return;
  const info = lerJson(A.etiquetas, {}); info.aplicadas = info.aplicadas || {};
  if (!info.business) return;
  const nossos = new Set(Object.values(est.etiquetasIds));
  for (const [id, chave] of est.etiquetasAlvo) {
    const alvo = chave ? est.etiquetasIds[chave] || null : null;
    if (chave && !alvo) continue;                       // etiqueta ainda não existe no WhatsApp
    if ((info.aplicadas[id] || null) === (chave || null)) continue;
    if (!chave && !info.aplicadas[id]) continue;
    est.ultimaEtiqueta = agora;
    try {
      let atuais = []; try { atuais = (await ctx.client.getChatLabels(id)).map((l) => String(l.id)); } catch {}
      const manter = atuais.filter((x) => !nossos.has(x));     // preserva etiquetas que não são do robô
      await ctx.client.addOrRemoveLabels(alvo ? manter.concat(alvo) : manter, [id]);
      info.aplicadas[id] = chave || null; info.contagem_aplicadas = (info.contagem_aplicadas || 0) + 1; info.ultima_em = iso(agora);
      gravar(A.etiquetas, info);
    } catch (e) { info.erros = (info.erros || 0) + 1; info.ultimo_erro = String(e && e.message || e).slice(0, 160); gravar(A.etiquetas, info); if (info.erros > 20) fs.writeFileSync(A.etiquetasPausadas, 'muitos erros ' + iso(agora)); }
    return;
  }
}

// ---------- comandos por arquivo (gravados pela API do Dashboard) ----------
async function comandos(ctx) {
  if (!fs.existsSync(A.comando)) return;
  let cmds; try { cmds = [].concat(JSON.parse(fs.readFileSync(A.comando, 'utf8'))); } catch { cmds = []; }
  try { fs.unlinkSync(A.comando); } catch {}
  for (const c of cmds) {
    if (c.acao === 'pausar_jornada') fs.writeFileSync(A.jornadaPausada, 'pausada em ' + iso(Date.now()));
    else if (c.acao === 'retomar_jornada') { try { fs.unlinkSync(A.jornadaPausada); } catch {} }
    else if (c.acao === 'pausar_cadencia') fs.writeFileSync(A.pausado, 'pausada em ' + iso(Date.now()));
    else if (c.acao === 'retomar_cadencia') { try { fs.unlinkSync(A.pausado); } catch {} }
    else if (c.acao === 'tocar' && c.ref) {
      const revs = lerJson(A.revendedores, {}); const id = Object.keys(revs).find((k) => N.refDe(k) === c.ref);
      if (id) { const st = lerJson(A.estado, { leads: {}, revendedores: {} }); st.revendedores = st.revendedores || {}; (st.revendedores[id] || (st.revendedores[id] = { toques: [] })).tocar_agora = true; gravar(A.estado, st); logar(ctx, 'funil tocar agora pedido para ' + (revs[id].nome || c.ref)); }
    } else if (c.acao === 'reaquecer') {
      const st = lerJson(A.estado, { leads: {}, revendedores: {} }); st.reaquecer_pedido = iso(Date.now()); gravar(A.estado, st);
      E(ctx).vigiaEm = 0; logar(ctx, 'funil atender novamente todos os frios - pedido pelo Dashboard');
    } else if (c.acao === 'criar_etiquetas') {
      const info = await descobrirEtiquetas(ctx);
      if (!info.business) { logar(ctx, 'funil etiquetas - número não é Business'); continue; }
      const falta = N.ETIQUETAS.find((e) => !(info.ids || {})[e.chave]);
      if (falta) { const r = await tentarCriarEtiqueta(ctx, falta.nome, N.ETIQUETAS.indexOf(falta)); const i2 = lerJson(A.etiquetas, {}); i2.teste_criacao = { etiqueta: falta.nome, em: iso(Date.now()), ...r }; gravar(A.etiquetas, i2); logar(ctx, 'funil teste de criar etiqueta ' + falta.nome + ' - ' + JSON.stringify(r)); E(ctx).etiquetasIds = null; }
    } else if (c.acao === 'vigia') E(ctx).vigiaEm = 0;
    else if (c.acao === 'releitura') R.pedir(ctx, c);
    else if (c.acao === 'cancelados') CAN.pedir(ctx, c);
  }
}

// ---------- tick (a cada 10 s, chamado pelo bot) ----------
async function tick(ctx) {
  const est = E(ctx), agora = agoraDe(ctx), cfg = cfgDe();
  await comandos(ctx);
  CAN.tick(ctx).catch(() => {});   // leitura dos painéis cancelados (uma por vez)
  R.tick(ctx).catch(() => {});   // ações da releitura, uma por vez (não segura o resto do motor)
  if (est.ocupado) return;
  est.ocupado = true;
  try {
    if (!est.vigiaEm || agora - est.vigiaEm > 2 * 60e3) {
      try { const lac = ctx.lac; if (lac) est.lacunaDevidos = lac.proximosRetornos({ max: 5 }).length; } catch {}
      await vigia(ctx);
      // Livro de jogadas: uma vez por noite, a partir das 21h (Haiku, ~US$ 0,03). O próprio script confere se já rodou hoje.
      const hojeStr = new Date(agora).toDateString();
      if (new Date(agora).getHours() >= 21 && est.jogadasDia !== hojeStr && cfg.jogadas !== false) {
        est.jogadasDia = hojeStr;
        try { const { spawn } = require('child_process'); const p = spawn(process.execPath, [path.join(__dirname, 'jogadas.mjs'), '--auto'], { cwd: PASTA, detached: true, stdio: 'ignore', windowsHide: true }); p.unref(); logar(ctx, 'funil livro de jogadas da noite iniciado'); } catch {}
      }
      if (cfg.etiquetas && (!est.etiquetasIds || agora - (est.etiquetasDescEm || 0) > 30 * 60e3)) { est.etiquetasDescEm = agora; await descobrirEtiquetas(ctx); }
    }
    // (a) vigia responde conversas com a última palavra do cliente (3 min a 48 h), uma por vez
    if (cfg.vigia_responde && ctx.responderAgora && !fs.existsSync(A.botPausado)) {
      const r = (est.responder || []).find((l) => !(est.respondidos && est.respondidos[l.id] > agora - 30 * 60e3) && !ctx.fila.has(l.id) && !ctx.atendendo.has(l.id) && !((ctx.quieto && ctx.quieto.get(l.id)) > agora));
      if (r && N.naJanela(agora, 8, 21)) {
        (est.respondidos || (est.respondidos = {}))[r.id] = agora;
        est.responder = est.responder.filter((x) => x.id !== r.id);
        logar(ctx, `vigia de leads respondeu ${r.nome} (última palavra era do cliente)`);
        try { ctx.evento('vigia_respondeu', r.id, r.nome, { desde: r.proximo && r.proximo.quando }); } catch {}
        await ctx.responderAgora(r.id).catch((e) => logar(ctx, 'vigia responder falhou - ' + (e.message || e)));
        return;
      }
    }
    // toques proativos: retomada > cadência > jornada (o portão decide e respeita a ordem com ao vivo, lacuna e atrasado)
    const ad = est.adiados || {};
    const livre = (it, tipo) => !(ad[it.id + '|' + tipo] > agora);
    const d = est.devidos || {};
    const ordem = [];
    if (cfg.retomada) ordem.push(...(d.retomada || []).filter((x) => livre(x, 'retomada')).map((x) => ({ ...x, tipo: 'retomada' })));
    if (cfg.cadencia && !fs.existsSync(A.pausado)) ordem.push(...(d.cadencia || []).filter((x) => livre(x, 'cadencia')).sort((a, b) => Date.parse(a.proximo.quando) - Date.parse(b.proximo.quando)).map((x) => ({ ...x, tipo: 'cadencia' })));
    if (cfg.jornada && !fs.existsSync(A.jornadaPausada)) ordem.push(...(d.jornada || []).filter((x) => livre(x, 'jornada')).sort((a, b) => (b.tocar_agora ? 1 : 0) - (a.tocar_agora ? 1 : 0)).map((x) => ({ ...x, tipo: 'jornada' })));
    const prox = ordem[0];
    if (prox) {
      const p = pode(ctx, prox.tipo);
      est.motivoEspera = p.ok ? null : p.motivo;
      if (p.ok || ((prox.tocar_agora || prox.reaquecer) && ['ritmo', 'prioridade_cadencia', 'prioridade_atrasado'].includes(p.motivo))) {
        const r = await executar(ctx, prox).catch((e) => { logar(ctx, 'funil toque falhou - ' + (e.message || e)); try { ctx.erroEv('funil_toque', e, prox.id); } catch {} return { ok: false }; });
        // tira da lista de devidos (a vigia recalcula em 2 min)
        for (const k of ['retomada', 'cadencia', 'jornada']) if (d[k]) d[k] = d[k].filter((x) => x.id !== prox.id);
        if (r && r.ok) est.vigiaEm = Math.min(est.vigiaEm || 0, agora - 90e3);
      }
    }
    await sincronizarUmaEtiqueta(ctx);
  } finally { est.ocupado = false; }
}
// Quantos follow-ups ao vivo estão vencidos agora (o bot chama para o portão dar prioridade à escada).
function aoVivoDevidos(aguardando, seguiuN, FOLLOWUP_MIN, agora = Date.now()) {
  let n = 0; for (const [id, desde] of aguardando) { const k = seguiuN.get(id) || 0; if (k < FOLLOWUP_MIN.length && agora - desde >= FOLLOWUP_MIN[k] * 60e3) n++; } return n;
}

module.exports = { A, tick, vigia, pode, registrar, variante, aoReceber, executar, gerarTexto, pedidoToque, calcularAB, descobrirEtiquetas, sincronizarUmaEtiqueta, comandos, aoVivoDevidos, eventos, passouPendente, indice };
