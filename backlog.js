'use strict';
// Backlog de follow-ups do robô da revenda (08/11/2026, pedido do senhor).
// Mapeia as conversas antigas (SOMENTE LEITURA), cadastra/renomeia contatos, gera um follow-up por conversa
// e envia DEVAGAR, com travas de segurança do número. Carregado (e recarregado quando o arquivo muda) pelo bot.js,
// que passa o contexto `ctx` (client, fichas, log, evento...). Nada aqui liga sozinho.
//
// Arquivos (pasta do robô):
//   backlog.json          o mapa (uma linha por conversa, com categoria, resumo, elegibilidade, follow-up sugerido)
//   backlog-fila.json     a fila de envio (status na_fila|enviado|respondeu|fechou_painel|descartado)
//   backlog-config.json   {"modo":"piloto"|"completo"}  (piloto = só os itens marcados piloto:true)
//   backlog-estado.json   estado do motor (proximo_envio_em, enviados_hoje, mapeamento...) lido pela API
//   backlog-comando.json  {"acao":"mapear","dias":14}  (lido a cada 10 s e apagado)
//   backlog-pausado       se existir, o motor não envia nada
// Log: linhas "backlog ..." sem ": " (o lib.mjs dos relatórios lê o conversas.log).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const PASTA_PADRAO = __dirname;
const LIM = Object.freeze({
  janela_ini: 9, janela_fim: 20,          // só envia das 9h às 20h (horário local)
  intervalo_min: 60,                      // nunca menos de 60 s entre envios
  jitter: 0.25,                           // o intervalo calculado varia ±25%
  min_entre_envios_s: 45,                 // nenhum envio a menos de 45 s do anterior (sem rajada)
  espera_reinicio_s: 180,                 // depois de qualquer reinício do robô, espera 3 min
  piloto_intervalo_max_s: 180,            // no piloto o intervalo calculado não passa de 3 min (5 envios em ~15 min, sem rajada)
  pausa_leitura_s: [1, 2],                // pausa entre uma conversa lida e a próxima no mapa
  pausa_renomeio_s: [3, 5],               // no máximo 1 contato renomeado a cada 3-5 s
  teto_dia: 120,                          // máximo de envios por dia
  erros_para_parar: 3,                    // erros de envio seguidos que param tudo
  segundo_apos_h: 24,                     // 2º e último follow-up só depois de 24 h sem resposta
  segundo_ativo: false,                   // 08/11 (funil): DESLIGADO; depois do 1º toque do atrasado, a cadência de dias (funil\motor.js) assume
  senhor_dias: 3,                         // quem o senhor atendeu na mão nesse prazo não recebe
  dias_mapa: 14,
  silencio_min_h: 12,                     // conversa mais nova que isso fica com o fluxo ao vivo
  tentativas_max: 3,
});
const TIPOS_CONTEUDO = ['chat', 'ptt', 'audio', 'image', 'video', 'document'];
const CATEGORIAS = ['painel_criado', 'testando', 'interessado_sem_painel', 'duvida_aberta', 'sem_resposta_nossa', 'esfriou', 'sem_interesse', 'suporte', 'equipe_ou_parceiro', 'irrelevante'];
const CAT_ELEGIVEIS = ['testando', 'interessado_sem_painel', 'duvida_aberta', 'sem_resposta_nossa', 'esfriou'];
const ETAPAS = ['primeiro_contato', 'explicando', 'duvidas', 'criando_painel', 'painel_criado', 'testando', 'cliente_ativo', 'parado'];
const ETAPAS_BLOQ = ['painel_criado', 'encerrado', 'fechado'];
const PALAVRAS_COMUNS = new Set(['mestre', 'painel', 'iptv', 'box', 'revenda', 'capyplay', 'capy', 'oficial', 'suporte', 'teste', 'lead', 'dos', 'das', 'the', 'and', 'tvs', 'cliente', 'clientes', 'loja', 'store', 'whatsapp', 'app', 'apps']);
const ENCERRA = /^\s*(ok|okay|blz|beleza|valeu|vlw|obrigad[oa]?|brigad[oa]?|show|certo|top|tmj|entendi|combinado|fechou|perfeito|isso|de nada|tudo bem|tranquilo|bom dia|boa tarde|boa noite|👍|🙏)[\s.!,👍🙏😊]*$/i;  // igual ao relatorios\lib.mjs
const NOSSO_NOME =/\s·\s(painel(\s\d+)?|lead|teste|suporte)$/;

// ---------- utilidades ----------
const lerJson = (arq, padrao) => { try { return JSON.parse(fs.readFileSync(arq, 'utf8').replace(/^﻿/, '')); } catch { return padrao; } };
const gravar = (arq, obj) => { const t = arq + '.tmp'; fs.writeFileSync(t, JSON.stringify(obj, null, 1)); fs.renameSync(t, arq); };
const digitos = (s) => String(s || '').replace(/\D/g, '');
const fim8 = (s) => digitos(s).slice(-8);
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const refDe = (id) => crypto.createHash('sha1').update(String(id)).digest('hex').slice(0, 10);
const iso = (ms) => new Date(ms).toISOString();
const redigir = (t) => String(t == null ? '' : t).replace(/(senha|password|pass)\s*[:=]\s*\S+/gi, '$1: [oculta]').replace(/(senha)\s+(?=\S*\d)\S+/gi, '$1 [oculta]');
const paraHaiku = (t) => redigir(t).replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[e-mail]').replace(/\b(\d{9,})\b/g, '[número]').replace(/\s+/g, ' ').trim().slice(0, 400);
const limparLocal = (t) => String(t || '').replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '').replace(/[*~`]/g, '').replace(/[ \t]+\n/g, '\n').trim();
const dormirPadrao = (ms) => new Promise((r) => setTimeout(r, ms));

function arqs(pasta = PASTA_PADRAO) {
  const p = (n) => path.join(pasta, n);
  return { pasta, mapa: p('backlog.json'), fila: p('backlog-fila.json'), cfg: p('backlog-config.json'), estado: p('backlog-estado.json'), comando: p('backlog-comando.json'),
    pausado: p('backlog-pausado'), classificar: p('backlog-classificar.md'), revendedores: p('revendedores.json'), base: p('base.md') };
}
const cx = (ctx) => ({ A: arqs(ctx.pasta || PASTA_PADRAO), agora: () => (ctx.agora ? ctx.agora() : Date.now()), dormir: ctx.dormir || dormirPadrao, rand: ctx.rand || Math.random });
const pausar = (ctx, [a, b]) => cx(ctx).dormir(Math.round((a + cx(ctx).rand() * (b - a)) * 1000));
const logar = (ctx, t) => { try { ctx.log(String(t).replace(/: /g, ' - ')); } catch {} };

// ---------- travas (funções puras, testadas em relatorios\testar-backlog.mjs) ----------
function dentroDaJanela(d, lim = LIM) { const h = d.getHours(); return h >= lim.janela_ini && h < lim.janela_fim; }
function inicioDaProximaJanela(d, lim = LIM) {
  const x = new Date(d);
  if (x.getHours() < lim.janela_ini) { x.setHours(lim.janela_ini, 0, 0, 0); return x; }
  x.setDate(x.getDate() + 1); x.setHours(lim.janela_ini, 0, 0, 0); return x;
}
// Intervalo UNIFORME: tempo que resta da janela de hoje / quantos faltam enviar (até o teto do dia). Fora da janela, planeja a
// próxima janela inteira. Piloto: no máximo piloto_intervalo_max_s. Nunca menos que intervalo_min.
function planejarIntervalo({ agora, hoje = 0, pendentes = 0, modo = 'piloto', lim = LIM }) {
  if (!pendentes) return null;
  const d = new Date(agora);
  let ini = agora, fim = new Date(agora);
  if (!dentroDaJanela(d, lim)) { const i = inicioDaProximaJanela(d, lim); ini = i.getTime(); fim = new Date(i); if (i.toDateString() !== d.toDateString()) hoje = 0; }
  fim.setHours(lim.janela_fim, 0, 0, 0);
  const restante = Math.max(0, fim.getTime() - ini);
  const faltam = Math.max(1, Math.min(lim.teto_dia - hoje, pendentes));
  let base = restante / faltam;
  if (modo !== 'completo') base = Math.min(base, lim.piloto_intervalo_max_s * 1000);
  return Math.max(lim.intervalo_min * 1000, Math.round(base));
}
function sortearIntervalo(baseMs, rand = Math.random, lim = LIM) {
  const base = baseMs || lim.intervalo_min * 1000;
  return Math.max(lim.intervalo_min * 1000, Math.round(base * (1 - lim.jitter + rand() * 2 * lim.jitter)));
}
function contarPendentes(itens, modo, agora, lim = LIM) {
  const piloto = modo !== 'completo';
  let n = 0;
  for (const it of itens || []) {
    if (it.status === 'na_fila' && (!piloto || it.piloto)) n++;
    else if (!piloto && lim.segundo_ativo && it.status === 'enviado' && !it.encerrado && !it.respondeu_em && (it.followups || []).length === 1 && agora - Date.parse(it.followups[0].quando) >= lim.segundo_apos_h * 3600e3) n++;
  }
  return n;
}
const mesmoDia = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
function enviadosHoje(itens, agora) {
  let n = 0;
  for (const it of itens || []) for (const f of it.followups || []) if (mesmoDia(Date.parse(f.quando), agora)) n++;
  return n;
}
function mascararTelefone(t) { const d = digitos(t); return d ? '•••• ' + d.slice(-4) : ''; }

// Quem pode receber: regras de bloqueio (tudo que for "não" aqui vence qualquer outra coisa).
// item: { categoria, elegivel_haiku, pediu_para_parar, individual, ultimo_manual_senhor (ms|null), ultimo_ts (ms),
//         salvo_pelo_senhor, followup_ao_vivo, fechou_painel, ja_no_backlog, ao_vivo_ativo, quieto, etapa_ficha }
function avaliarElegibilidade(item, { agora = Date.now(), lim = LIM } = {}) {
  const no = (motivo) => ({ ok: false, motivo });
  if (item.individual === false) return no('não é conversa individual');
  if (item.fechou_painel || item.categoria === 'painel_criado') return no('já fechou painel');
  if (item.pediu_para_parar || item.categoria === 'sem_interesse') return no('disse que não quer ou pediu para parar');
  if (item.categoria === 'suporte') return no('assunto de suporte, cliente final ou pagamento');
  if (item.categoria === 'equipe_ou_parceiro') return no('equipe ou parceiro');
  if (!CAT_ELEGIVEIS.includes(item.categoria)) return no('conversa sem relação com a revenda (' + (item.categoria || 'sem categoria') + ')');
  if (item.ultimo_manual_senhor && agora - item.ultimo_manual_senhor < lim.senhor_dias * 86400e3) return no('o senhor atendeu na mão nos últimos ' + lim.senhor_dias + ' dias');
  if (item.ja_no_backlog) return no('já recebeu follow-up do backlog');
  if (item.followup_ao_vivo) return no('já recebeu follow-up ao vivo depois da última mensagem dele');
  if (item.ao_vivo_ativo) return no('o fluxo ao vivo ainda está cuidando dessa conversa');
  if (item.quieto) return no('conversa em silêncio por pedido do robô ou do senhor');
  if (ETAPAS_BLOQ.includes(item.etapa_ficha)) return no('etapa da ficha ' + item.etapa_ficha);
  if (item.salvo_pelo_senhor) return no('contato salvo pelo senhor com nome próprio (pode ser conhecido ou equipe)');
  if (!item.elegivel_haiku) return no(item.motivo_haiku || 'a leitura da conversa não recomendou follow-up');
  if (item.ultimo_ts && agora - item.ultimo_ts < lim.silencio_min_h * 3600e3) return no('conversa recente demais, o fluxo ao vivo cuida');
  return { ok: true, motivo: item.motivo_haiku || 'interesse real e conversa parada' };
}

// Decide o próximo envio. Pura: recebe o estado e devolve { acao: 'enviar', item, tipo } ou { acao: 'esperar', motivo, ate? }.
function decidirEnvio({ itens, agora, pausado, modo, estado = {}, adiados = {}, uptimeMs = Infinity, ultimoEnvio = 0, lim = LIM }) {
  if (pausado) return { acao: 'esperar', motivo: 'pausado' };
  if (estado.parado_por_erros) return { acao: 'esperar', motivo: 'parado_por_erros' };
  if (uptimeMs < lim.espera_reinicio_s * 1000) return { acao: 'esperar', motivo: 'reinicio_recente', ate: agora + (lim.espera_reinicio_s * 1000 - uptimeMs) };
  const d = new Date(agora);
  if (!dentroDaJanela(d, lim)) return { acao: 'esperar', motivo: 'fora_da_janela', ate: inicioDaProximaJanela(d, lim).getTime() };
  if (enviadosHoje(itens, agora) >= lim.teto_dia) {
    const x = new Date(agora); x.setDate(x.getDate() + 1); x.setHours(lim.janela_ini, 0, 0, 0);
    return { acao: 'esperar', motivo: 'teto_diario', ate: x.getTime() };
  }
  if (ultimoEnvio && agora - ultimoEnvio < lim.min_entre_envios_s * 1000) return { acao: 'esperar', motivo: 'rajada', ate: ultimoEnvio + lim.min_entre_envios_s * 1000 };
  if (estado.proximo_em && agora < estado.proximo_em) return { acao: 'esperar', motivo: 'intervalo', ate: estado.proximo_em };
  const livre = (it) => !(adiados[it.id] > agora);
  const piloto = modo !== 'completo';
  const naFila = (itens || []).filter((it) => it.status === 'na_fila' && (!piloto || it.piloto) && livre(it)).sort((a, b) => Date.parse(b.ultimo_contato) - Date.parse(a.ultimo_contato));
  const segundos = piloto || !lim.segundo_ativo ? [] : (itens || []).filter((it) => it.status === 'enviado' && (it.followups || []).length === 1 && !it.respondeu_em && agora - Date.parse(it.followups[0].quando) >= lim.segundo_apos_h * 3600e3 && livre(it)).sort((a, b) => Date.parse(a.followups[0].quando) - Date.parse(b.followups[0].quando));
  if (segundos.length) return { acao: 'enviar', item: segundos[0], tipo: 'segundo' };
  if (naFila.length) return { acao: 'enviar', item: naFila[0], tipo: 'primeiro' };
  return { acao: 'esperar', motivo: piloto && (itens || []).some((it) => it.piloto) ? 'piloto_concluido' : 'fila_vazia' };
}

function validarFollowup(texto, { nomes = [], baseMd = '', anteriores = [] } = {}) {
  const t = String(texto || '').trim();
  if (t.length < 15) return { ok: false, motivo: 'curto demais' };
  if (t.length > 300) return { ok: false, motivo: 'longo demais' };
  if (/[\p{Extended_Pictographic}]/u.test(t)) return { ok: false, motivo: 'tem emoji' };
  if ((t.match(/[.!?](\s|$)/g) || []).length > 3) return { ok: false, motivo: 'mais de 3 frases' };
  if (!/\bmestre\b/i.test(t)) return { ok: false, motivo: 'não chama de mestre' };
  const nt = norm(t);
  for (const n of nomes) for (const p of norm(n).split(/[^a-z0-9]+/).filter((x) => x.length >= 3 && !PALAVRAS_COMUNS.has(x))) if (new RegExp('(^|[^a-z0-9])' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z0-9]|$)').test(nt)) return { ok: false, motivo: 'usa o nome da pessoa (' + p + ')' };
  if (/senha|usuario:/.test(nt)) return { ok: false, motivo: 'fala de senha ou usuário' };
  if (/\d{9,}/.test(t.replace(/(\d)[\s.-](?=\d)/g, '$1'))) return { ok: false, motivo: 'tem número de telefone' };
  for (const u of t.match(/https?:\/\/[^\s]+/g) || []) if (!baseMd.includes(u.replace(/[.,;!?)]+$/, ''))) return { ok: false, motivo: 'link que não está no base.md' };
  if ((t.match(/\?/g) || []).length > 2) return { ok: false, motivo: 'perguntas demais' };
  if (/(ultima chance|vagas limitadas|\bcorra\b|urgente|so hoje|promocao)/.test(nt)) return { ok: false, motivo: 'tom de pressão' };
  if (anteriores.some((a) => norm(a) === nt)) return { ok: false, motivo: 'igual a outro follow-up' };
  return { ok: true };
}

// ---------- Haiku ----------
function chamarHaiku(ctx, sistemaArq, entrada, timeoutMs = 120000) {
  if (ctx.haiku) return ctx.haiku(sistemaArq, entrada);
  return new Promise((resolve) => {
    const args = ['-p', '--model', 'haiku', '--setting-sources', '""', '--system-prompt-file', sistemaArq, '--tools', '""', '--no-session-persistence', '--strict-mcp-config', '--output-format', 'json'];
    const p = spawn('claude.cmd', args, { cwd: path.dirname(sistemaArq), shell: true, windowsHide: true });
    let out = '';
    const t = setTimeout(() => { try { p.kill(); } catch {} resolve(null); }, timeoutMs);
    p.stdout.on('data', (d) => (out += d));
    p.on('error', () => { clearTimeout(t); resolve(null); });
    p.on('close', () => {
      clearTimeout(t);
      const m = require('./uso-ia.js').desembrulhar(out, 'backlog', 'haiku').match(/\{[\s\S]*\}/);
      try { resolve(m ? JSON.parse(m[0]) : null); } catch { resolve(null); }
    });
    p.stdin.end(entrada);
  });
}

// ---------- leitura das mensagens ----------
const rotuloTipo = { ptt: '[áudio]', audio: '[áudio]', image: '[foto]', video: '[vídeo]', document: '[arquivo]' };
function indiceRobo(eventos) {
  const robo = new Map(), senhor = new Map(), aoVivo = new Map();
  for (const e of eventos || []) {
    if (!e.chat) continue;
    const t = Date.parse(e.t);
    if (!Number.isFinite(t)) continue;
    if (e.tipo === 'resposta_robo' || e.tipo === 'followup' || e.tipo === 'followup_backlog') { (robo.get(e.chat) || robo.set(e.chat, []).get(e.chat)).push({ t, texto: norm(e.texto) }); if (e.tipo === 'followup') (aoVivo.get(e.chat) || aoVivo.set(e.chat, []).get(e.chat)).push(t); }
    else if (e.tipo === 'senhor_escreveu') (senhor.get(e.chat) || senhor.set(e.chat, []).get(e.chat)).push(t);
  }
  return { robo, senhor, aoVivo };
}
function quemFalou(m, id, idx) {
  if (!m.fromMe) return 'cliente';
  if (m.type === 'automated_greeting_message') return 'automatico';
  const ts = m.timestamp * 1000;
  if ((idx.senhor.get(id) || []).some((t) => Math.abs(t - ts) <= 15000)) return 'senhor';
  const robo = idx.robo.get(id) || [], tx = norm(m.body);
  if (tx && robo.some((r) => r.texto && r.texto === tx)) return 'robo';
  if (robo.some((r) => Math.abs(r.t - ts) <= 150000)) return 'robo';
  return 'senhor';
}
const conteudo = (ms) => (ms || []).filter((m) => TIPOS_CONTEUDO.includes(m.type) && (m.type !== 'chat' || String(m.body || '').trim()));
const textoMsg = (m) => (m.type === 'chat' ? String(m.body || '') : (rotuloTipo[m.type] || '[' + m.type + ']') + (m.body ? ' ' + m.body : ''));
const dataCurta = (ts) => { const d = new Date(ts * 1000); const z = (n) => String(n).padStart(2, '0'); return `${z(d.getDate())}/${z(d.getMonth() + 1)} ${z(d.getHours())}:${z(d.getMinutes())}`; };
const ROTULO_QUEM = { cliente: 'Cliente', robo: 'Robô', senhor: 'Senhor', automatico: 'Automático' };

function limparNome(n) {
  return String(n || '').replace(NOSSO_NOME, '').replace(/[\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
}

// ---------- estado do motor ----------
function escreverEstado(ctx, extra = {}) {
  try {
    const { A, agora } = cx(ctx), est = ctx.est || (ctx.est = {});
    const fila = lerJson(A.fila, { itens: [] }).itens || [];
    const cfg = lerJson(A.cfg, {});
    const novo = {
      pausado: fs.existsSync(A.pausado), modo: cfg.modo === 'completo' ? 'completo' : 'piloto', parado_por_erros: !!est.parado_por_erros, erros_seguidos: est.erros || 0,
      proximo_envio_em: est.proximo_envio_em || null, intervalo_medio_s: est.intervalo_medio_s ?? null, motivo_espera: est.motivo_espera || null, ultimo_envio_em: est.ultimo_envio_em || null,
      enviados_hoje: enviadosHoje(fila, agora()), teto_dia: LIM.teto_dia, mapeamento: est.map || null, ...extra,
    };
    const chave = JSON.stringify(novo);
    if (est._estadoChave === chave) return;
    est._estadoChave = chave;
    gravar(A.estado, { atualizado_em: iso(agora()), ...novo });
  } catch (e) { logar(ctx, 'backlog estado nao gravou ' + (e.message || e)); }
}

// ---------- mapa ----------
async function mapear(ctx, op = {}) {
  const { A, agora } = cx(ctx), est = ctx.est || (ctx.est = {});
  if (est.mapeando) return { ok: false, motivo: 'já está mapeando' };
  est.mapeando = true;
  const dias = Math.min(Math.max(parseInt(op.dias, 10) || LIM.dias_mapa, 1), 60);
  const renomear = op.renomear !== false, gerar = op.gerar !== false;
  const t0 = agora();
  const prog = (o) => { est.map = { ...(est.map || {}), ...o }; escreverEstado(ctx); };
  const custo = { chamadas_classificacao: 0, chamadas_followup: 0, falhas_haiku: 0 };
  try {
    prog({ em_andamento: true, etapa: 'lendo as conversas', feito: 0, total: 0, iniciado_em: iso(t0), concluido_em: null, erro: null, dias });
    const eventos = ctx.recentes ? ctx.recentes(45 * 86400e3) : [];
    const idx = indiceRobo(eventos);
    const revs = lerJson(A.revendedores, {});
    const revFones = new Map(); // fim8 -> { id, r }
    for (const [id, r] of Object.entries(revs)) { const f = fim8(r.telefone); if (f.length === 8) revFones.set(f, { id, r }); }
    const baseMd = (() => { try { return fs.readFileSync(A.base, 'utf8'); } catch { return ''; } })();

    // 1) conversas individuais com atividade nos últimos `dias`
    const todos = await ctx.client.getChats();
    const limiteTs = agora() / 1000 - dias * 86400;
    const chats = todos.filter((c) => !c.isGroup && ctx.conversaValida(c.id._serialized) && ((c.lastMessage && c.lastMessage.timestamp) || c.timestamp || 0) >= limiteTs);
    prog({ etapa: 'lendo as conversas', total: chats.length, feito: 0, conversas_no_whatsapp: todos.length });
    const convs = [];
    let feito = 0;
    for (const c of chats) {
      const id = c.id._serialized;
      try {
        const ms = conteudo(await c.fetchMessages({ limit: 30 }));
        let ct = null; try { ct = await c.getContact(); } catch {}
        const pushname = (ct && ct.pushname) || '';
        const salvo = ct && ct.isMyContact ? String(ct.name || '') : '';
        const ehNosso = NOSSO_NOME.test(salvo);
        const salvoSenhor = !!salvo && !ehNosso && norm(salvo) !== norm(pushname) && !/^[+\d\s()-]+$/.test(salvo);
        const linhas = ms.map((m) => ({ quem: quemFalou(m, id, idx), ts: m.timestamp, tipo: m.type, texto: textoMsg(m), mid: m.id && m.id._serialized, fromMe: !!m.fromMe }));
        if (!linhas.length) { feito++; continue; }
        const ult = linhas[linhas.length - 1];
        const manual = linhas.filter((l) => l.quem === 'senhor').map((l) => l.ts * 1000);
        const lastCli = linhas.filter((l) => l.quem === 'cliente').map((l) => l.ts * 1000);
        convs.push({
          id, ref: refDe(id), nome: pushname || (ehNosso ? limparNome(salvo) : '') || limparNome(c.name || '') || id.split('@')[0], pushname, nome_salvo: salvo || null, salvo_pelo_senhor: salvoSenhor,
          telefone: id.endsWith('@c.us') ? id.split('@')[0] : (ctx.fichas[id] && ctx.fichas[id].telefone_real) || null,
          linhas, ultima_msg_id: ult.mid, ultimo_ts: ult.ts * 1000, ultimo_a_falar: ult.quem === 'cliente' ? 'cliente' : 'nos', ultimo_quem: ult.quem,
          ultimo_manual_senhor: manual.length ? Math.max(...manual) : null, ultima_do_cliente: lastCli.length ? Math.max(...lastCli) : null,
          cliente_falou: lastCli.length > 0, mensagens_lidas: linhas.length,
        });
      } catch (e) { logar(ctx, 'backlog conversa nao leu ' + id + ' ' + (e.message || e)); }
      feito++;
      if (feito % 10 === 0) prog({ feito });
      await pausar(ctx, LIM.pausa_leitura_s);
    }
    prog({ feito: chats.length, etapa: 'achando os telefones' });

    // 2) telefones reais
    const faltam = convs.filter((c) => !c.telefone);
    for (let i = 0; i < faltam.length; i += 10) {
      const lote = faltam.slice(i, i + 10);
      try {
        const r = await ctx.client.getContactLidAndPhone(lote.map((x) => x.id));
        lote.forEach((x, k) => { const pn = r && r[k] && r[k].pn; if (pn) x.telefone = digitos(String(pn).split('@')[0]); });
      } catch (e) { logar(ctx, 'backlog telefone real nao resolveu ' + (e.message || e)); break; }
    }

    // 3) painel: quem já tem painel (lista de revendedores do painel, só leitura) e revendedores.json
    prog({ etapa: 'cruzando com o painel' });
    let painel = [];
    if (ctx.painelRev && op.painel !== false) {
      try { painel = await Promise.race([ctx.painelRev.listarRevendedores(), new Promise((_, rej) => setTimeout(() => rej(new Error('tempo')), 180000))]); } catch (e) { logar(ctx, 'backlog painel nao leu ' + (e.message || e)); }
    }
    for (const c of convs) {
      const f8 = fim8(c.telefone);
      const rev = revs[c.id] ? { id: c.id, r: revs[c.id] } : (f8.length === 8 ? revFones.get(f8) : null);
      let pm = null;
      if (c.telefone && painel.length && ctx.painelRev) { try { pm = ctx.painelRev.casar({ telefone: c.telefone }, painel); } catch {} }
      c.em_revendedores = !!rev;
      c.painel_numero = (rev && rev.r.painel_numero) || (pm && pm.numero) || null;
      c.painel_usuario = (rev && rev.r.usuario_painel) || (pm && (pm.username || pm.email)) || null;
      c.tem_painel = !!(rev || pm);
    }

    // 4) classificação (Haiku, lotes de 5)
    prog({ etapa: 'classificando com o Haiku', feito: 0 });
    const aClassificar = convs.filter((c) => !c.tem_painel);
    const resultados = new Map();
    const tamLote = 5;
    for (let i = 0; i < aClassificar.length; i += tamLote) {
      const lote = aClassificar.slice(i, i + tamLote);
      const entrada = lote.map((c, k) => {
        const ult20 = c.linhas.slice(-20);
        return `### Conversa ${k + 1}\nNome no WhatsApp: ${paraHaiku(c.pushname || c.nome)}${c.salvo_pelo_senhor ? ' | Nome na agenda (salvo pelo dono): ' + paraHaiku(c.nome_salvo) : ''}\nÚltima mensagem de: ${ROTULO_QUEM[c.ultimo_quem]} em ${dataCurta(c.ultimo_ts / 1000)}\n` +
          ult20.map((l) => `[${dataCurta(l.ts)}] ${ROTULO_QUEM[l.quem]}: ${paraHaiku(l.texto)}`).join('\n');
      }).join('\n\n') + '\n\nResponda com o JSON pedido, um item por conversa.';
      let r = null;
      for (let t = 0; t < 2 && !r; t++) { custo.chamadas_classificacao++; r = await chamarHaiku(ctx, A.classificar, entrada); if (!r || !Array.isArray(r.itens)) { r = null; custo.falhas_haiku++; } }
      lote.forEach((c, k) => { const it = r && r.itens.find((x) => Number(x.n) === k + 1); if (it) resultados.set(c.id, it); });
      prog({ feito: Math.min(i + tamLote, aClassificar.length), total_classificar: aClassificar.length });
    }

    // 5) monta os itens do mapa
    prog({ etapa: 'montando o mapa' });
    const filaAntiga = lerJson(A.fila, { itens: [] }).itens || [];
    const jaNoBacklog = new Set(filaAntiga.filter((it) => (it.followups || []).length).map((it) => it.id));
    const itens = [];
    for (const c of convs) {
      const h = resultados.get(c.id) || {};
      let categoria = c.tem_painel ? 'painel_criado' : (CATEGORIAS.includes(h.categoria) ? h.categoria : 'irrelevante');
      if (!c.tem_painel) {
        if (c.ultimo_a_falar === 'cliente' && categoria === 'esfriou') categoria = 'sem_resposta_nossa';
        else if (c.ultimo_a_falar !== 'cliente' && categoria === 'sem_resposta_nossa') categoria = 'esfriou';
      }
      let etapa = c.tem_painel ? 'painel_criado' : (ETAPAS.includes(h.etapa) ? h.etapa : (categoria === 'testando' ? 'testando' : 'duvidas'));
      if (CAT_ELEGIVEIS.includes(categoria) && etapa === 'parado') etapa = 'duvidas';
      const ficha = ctx.fichas[c.id];
      const aoVivoApos = (idx.aoVivo.get(c.id) || []).some((t) => t > (c.ultima_do_cliente || 0));
      const q = (ctx.quieto && ctx.quieto.get(c.id)) || 0;
      const aval = avaliarElegibilidade({
        categoria, elegivel_haiku: !!h.elegivel && c.cliente_falou, motivo_haiku: !c.cliente_falou ? 'a pessoa nunca escreveu, só nós' : (h.motivo || (resultados.has(c.id) ? '' : 'a leitura da conversa falhou')), pediu_para_parar: !!h.pediu_para_parar, individual: true,
        ultimo_manual_senhor: c.ultimo_manual_senhor, ultimo_ts: c.ultimo_ts, salvo_pelo_senhor: c.salvo_pelo_senhor, followup_ao_vivo: aoVivoApos,
        fechou_painel: c.tem_painel, ja_no_backlog: jaNoBacklog.has(c.id), ao_vivo_ativo: !!(ctx.aguardando && ctx.aguardando.has(c.id)) || !!(ctx.atendendo && ctx.atendendo.has(c.id)) || !!(ctx.fila && ctx.fila.has(c.id)),
        quieto: q > agora(), etapa_ficha: ficha && ficha.etapa,
      }, { agora: agora() });
      if (!resultados.has(c.id) && !c.tem_painel) aval.motivo = 'a leitura da conversa falhou (Haiku sem resposta)';
      itens.push({
        ref: c.ref, id: c.id, nome: c.nome, nome_salvo: c.nome_salvo, telefone: c.telefone, categoria, etapa, ultimo_contato: iso(c.ultimo_ts), ultimo_a_falar: c.ultimo_a_falar, ultimo_quem: c.ultimo_quem,
        ultima_msg_id: c.ultima_msg_id, resumo: redigir(String(h.resumo || (ficha && ficha.resumo) || (c.tem_painel ? 'Já tem painel criado.' : 'Sem leitura da conversa.'))).slice(0, 160),
        pergunta_aberta: !!h.pergunta_aberta, cliente_falou: c.cliente_falou, elegivel: aval.ok, motivo: aval.motivo, ultimo_manual_senhor: c.ultimo_manual_senhor ? iso(c.ultimo_manual_senhor) : null,
        salvo_pelo_senhor: c.salvo_pelo_senhor, painel_numero: c.painel_numero, tem_painel: c.tem_painel, em_revendedores: c.em_revendedores, followup_sugerido: null, renomeio: null, ficha_nova: !ctx.fichas[c.id],
        _c: c,
      });
    }
    itens.sort((a, b) => Date.parse(b.ultimo_contato) - Date.parse(a.ultimo_contato));

    // 6) fichas das conversas novas + telefone real nas fichas existentes
    prog({ etapa: 'cadastrando as fichas' });
    let fichasNovas = 0;
    for (const it of itens) {
      const f = ctx.fichas[it.id];
      if (!f) {
        ctx.fichas[it.id] = { criado_em: iso(agora()), notas: [], nome: it.nome, telefone: it.id.split('@')[0], telefone_real: it.telefone || undefined, etapa: it.etapa, resumo: it.resumo, origem: 'backlog', contado_conversa: true, ultimo_contato: it.ultimo_contato, categoria_backlog: it.categoria };
        if (!it.telefone) delete ctx.fichas[it.id].telefone_real;
        fichasNovas++;
      } else if (!f.telefone_real && it.telefone) f.telefone_real = it.telefone;
    }
    try { ctx.salvarFichas(); } catch {}

    // 7) renomeio dos contatos (só onde é seguro)
    const contagemRen = { renomeados: 0, mantidos: 0, falhas: 0 };
    if (renomear) {
      prog({ etapa: 'renomeando contatos', feito: 0, total: itens.length });
      let n = 0;
      for (const it of itens) {
        const r = await renomearContato(ctx, it);
        it.renomeio = r;
        if (r.status === 'renomeado') contagemRen.renomeados++; else if (r.status === 'falhou') contagemRen.falhas++; else contagemRen.mantidos++;
        if (r.status !== 'mantido') await pausar(ctx, LIM.pausa_renomeio_s);   // no máximo 1 contato a cada 3-5 s
        if (++n % 10 === 0) prog({ feito: n });
      }
    } else for (const it of itens) it.renomeio = { status: 'mantido', motivo: 'renomeio desligado nesta rodada' };

    // 8) follow-ups sugeridos (Haiku, uma chamada por conversa elegível)
    const textosFeitos = filaAntiga.map((it) => it.texto).filter(Boolean);
    const anteriores = [];
    if (gerar) {
      const elegiveis = itens.filter((it) => it.elegivel);
      prog({ etapa: 'escrevendo os follow-ups', feito: 0, total: elegiveis.length });
      let n = 0;
      for (const it of elegiveis) {
        const ex = filaAntiga.find((f) => f.id === it.id && f.texto && (f.status !== 'na_fila' || f.ultima_msg_id === it.ultima_msg_id));
        if (ex) { it.followup_sugerido = ex.texto; }
        else {
          const g = await gerarFollowup(ctx, it, { baseMd, anteriores: textosFeitos.concat(anteriores), custo, tipo: 'primeiro' });
          if (g.ok) { it.followup_sugerido = g.texto; anteriores.push(g.texto); }
          else { it.elegivel = false; it.motivo = 'não consegui escrever um follow-up válido (' + g.motivo + ')'; }
        }
        if (++n % 5 === 0) prog({ feito: n });
      }
    }
    for (const it of itens) delete it._c;

    // 9) grava o mapa e a fila (escrita atômica)
    const contagens = { total: itens.length, elegiveis: itens.filter((i) => i.elegivel).length, por_categoria: {} };
    for (const c of CATEGORIAS) contagens.por_categoria[c] = itens.filter((i) => i.categoria === c).length;
    const mapa = { gerado_em: iso(agora()), dias, duracao_s: Math.round((agora() - t0) / 1000), parametros: { ...LIM }, conversas_no_whatsapp: todos.length, fichas_novas: fichasNovas, custo, contagens, renomeio: contagemRen, itens: itens.map(({ followup_sugerido, ...r }) => ({ ...r, followup_sugerido })) };
    gravar(A.mapa, mapa);
    const fila = mesclarFila(lerJson(A.fila, { itens: [] }).itens || [], itens, agora());
    gravar(A.fila, { atualizado_em: iso(agora()), itens: fila });
    if (!fs.existsSync(A.cfg)) gravar(A.cfg, { modo: 'piloto' });
    prog({ em_andamento: false, etapa: 'pronto', concluido_em: iso(agora()), feito: itens.length, total: itens.length, resultado: { contagens, renomeio: contagemRen, custo, na_fila: fila.filter((f) => f.status === 'na_fila').length } });
    logar(ctx, `backlog mapa pronto - ${itens.length} conversas, ${contagens.elegiveis} elegiveis, ${contagemRen.renomeados} renomeados, ${custo.chamadas_classificacao + custo.chamadas_followup} chamadas ao Haiku`);
    return { ok: true, contagens, renomeio: contagemRen, custo };
  } catch (e) {
    prog({ em_andamento: false, etapa: 'falhou', erro: String(e && e.message || e), concluido_em: iso(agora()) });
    logar(ctx, 'backlog mapear falhou ' + (e && e.stack || e));
    try { ctx.erroEv('backlog_mapear', e); } catch {}
    return { ok: false, motivo: String(e && e.message || e) };
  } finally { est.mapeando = false; }
}

// Junta o mapa novo com a fila que já existe: quem já foi enviado/respondeu/fechou NUNCA volta para "na_fila".
function mesclarFila(antiga, itens, agora) {
  const porId = new Map(antiga.map((f) => [f.id, f]));
  const saida = [];
  for (const it of itens) {
    const ex = porId.get(it.id); porId.delete(it.id);
    if (ex && ex.status !== 'na_fila') { saida.push(ex); continue; }
    if (it.elegivel && it.followup_sugerido) {
      saida.push({ ref: it.ref, id: it.id, nome: it.nome, telefone: it.telefone, categoria: it.categoria, etapa: it.etapa, ultimo_contato: it.ultimo_contato, ultima_msg_id: it.ultima_msg_id, ultimo_a_falar: it.ultimo_a_falar,
        resumo: it.resumo, texto: it.followup_sugerido, status: 'na_fila', piloto: !!(ex && ex.piloto), criado_em: (ex && ex.criado_em) || iso(agora), tentativas: (ex && ex.tentativas) || 0, followups: [], respondeu_em: null });
    } else if (ex) saida.push({ ...ex, status: 'descartado', descartado_motivo: it.motivo || 'não é mais elegível', descartado_em: iso(agora) });
  }
  for (const ex of porId.values()) saida.push(ex); // fora da janela do mapa desta vez: mantém como está
  if (!saida.some((f) => f.piloto)) escolherPiloto(saida);
  return saida.sort((a, b) => Date.parse(b.ultimo_contato) - Date.parse(a.ultimo_contato));
}
// Piloto: 5 entre os mais recentes e mais claros (pergunta em aberto / pediu painel ou teste vale mais que "esfriou").
function escolherPiloto(fila, n = 5) {
  const prio = { sem_resposta_nossa: 0, duvida_aberta: 0, testando: 1, interessado_sem_painel: 1, esfriou: 2 };
  const cands = fila.filter((f) => f.status === 'na_fila').sort((a, b) => Date.parse(b.ultimo_contato) - Date.parse(a.ultimo_contato)).slice(0, 14);
  cands.sort((a, b) => (prio[a.categoria] ?? 3) - (prio[b.categoria] ?? 3) || Date.parse(b.ultimo_contato) - Date.parse(a.ultimo_contato));
  for (const f of cands.slice(0, n)) f.piloto = true;
}

// ---------- renomear contatos ----------
function sufixoPara(it) {
  if (it.categoria === 'painel_criado') return it.painel_numero ? `· painel ${it.painel_numero}` : '· painel';
  if (it.categoria === 'testando') return '· teste';
  if (it.categoria === 'suporte') return '· suporte';
  if (CAT_ELEGIVEIS.includes(it.categoria)) return '· lead';
  return null; // equipe, parceiro, irrelevante e sem interesse não mexem na agenda
}
async function renomearContato(ctx, it) {
  const sufixo = sufixoPara(it);
  if (!sufixo) return { status: 'mantido', motivo: 'categoria sem renomeio (' + it.categoria + ')' };
  if (it.categoria === 'painel_criado' && it.em_revendedores) return { status: 'mantido', motivo: 'painel já tratado pela rotina dos revendedores' };
  if (!it.telefone) return { status: 'falhou', motivo: 'telefone real não resolvido' };
  if (it.salvo_pelo_senhor) return { status: 'mantido', motivo: 'contato salvo pelo senhor com nome próprio', de: it.nome_salvo };
  const base = limparNome(it.nome);
  if (!base || digitos(base).length >= 7) return { status: 'mantido', motivo: 'sem nome para usar' };
  const para = `${base} ${sufixo}`;
  if (it.nome_salvo === para) return { status: 'mantido', motivo: 'já está com o nome certo', de: it.nome_salvo, para };
  try {
    await ctx.client.saveOrEditAddressbookContact(digitos(it.telefone), base, sufixo, !!ctx.SINCRONIZAR_AGENDA);
    return { status: 'renomeado', de: it.nome_salvo || it.nome || null, para };
  } catch (e) { return { status: 'falhou', motivo: String(e && e.message || e).slice(0, 120) }; }
}

// ---------- follow-up (texto) ----------
const dur = (ms) => { const h = ms / 3600e3; return h < 36 ? Math.round(h) + ' horas' : Math.round(h / 24) + ' dias'; };
function pedidoFollowup(ctx, it, tipo) {
  const c = it._c;
  const linhas = c ? c.linhas.slice(-20).map((l) => `${l.quem === 'cliente' ? 'Cliente' : 'Revenda'}: ${paraHaiku(l.texto)}`).join('\n') : '';
  const f = ctx.fichas[it.id] || {};
  const ficha = { etapa: it.etapa, resumo: it.resumo, ja_revende: f.ja_revende, aparelhos: f.aparelhos, interesse: f.interesse };
  const caso = it.categoria === 'sem_resposta_nossa' || it.pergunta_aberta
    ? 'O cliente fez uma pergunta ou mandou algo e ninguém respondeu. RESPONDA primeiro a pergunta dele, com o que está no base.md, e depois ofereça ajuda. Se ele mandou só áudio ou foto que não dá para entender, peça com jeito para escrever.'
    : it.categoria === 'testando' ? 'Ele pediu ou recebeu teste e sumiu. Pergunte com leveza se conseguiu testar ou se precisa de ajuda com o app do aparelho dele.'
    : it.categoria === 'interessado_sem_painel' ? 'Ele ia criar o painel ou conhecer a revenda e sumiu. Ofereça ajuda para criar o painel e lembre que é pós-pago e sem taxa para abrir, só se ainda não estiver na conversa.'
    : 'A conversa esfriou depois da nossa última mensagem. Retome o último assunto e ofereça ajuda, sem repetir o que já foi dito.';
  const segundo = tipo === 'segundo' ? 'Este é o SEGUNDO e ÚLTIMO acompanhamento: o primeiro já foi enviado há mais de 24 horas e ele não respondeu. Mude o jeito de falar, seja ainda mais leve, diga que fica à disposição quando ele quiser e NÃO insista.' : '';
  return `Hoje é ${new Date(cx(ctx).agora()).toLocaleDateString('pt-BR')}.\n\nFicha do cliente:\n${JSON.stringify(ficha)}\n\nConversa (a última linha é a mais nova; o silêncio dura ${dur(cx(ctx).agora() - Date.parse(it.ultimo_contato))}):\n${linhas}\n\n` +
    `TAREFA ESPECIAL (follow-up de conversa antiga): escreva UMA única mensagem de WhatsApp para retomar essa conversa. ${caso} ${segundo}\n` +
    `Regras: no máximo 2 frases curtas (até 220 caracteres); português simples; sem emoji; chame a pessoa SEMPRE de "mestre" e NUNCA pelo nome; sem pressão e sem urgência; retome o último assunto; não cumprimente de novo como se fosse a primeira vez; não mande link se ele já tem; só use links que estão no base.md. ` +
    `Responda no formato JSON pedido, com "mensagens" contendo só essa mensagem e os demais campos vazios ou falsos (sem teste, sem guia, sem vídeos, sem avisar).`;
}
async function gerarFollowup(ctx, it, { baseMd, anteriores = [], custo = {}, tipo = 'primeiro', evitar = null } = {}) {
  const pergunta = ctx.perguntarHaiku || (async () => null);
  const nomes = [it.nome, it.nome_salvo].filter(Boolean);
  const aberturas = evitar || anteriores.slice(-8).map((t) => String(t).split(/\s+/).slice(0, 3).join(' '));
  let motivo = 'sem resposta do Haiku';
  for (let t = 0; t < 3; t++) {
    let pedido = pedidoFollowup(ctx, it, tipo);
    if (aberturas.length) pedido += `\nJá usamos estas aberturas em outras conversas, não comece igual: ${aberturas.map((a) => '"' + a + '"').join(', ')}.`;
    if (t > 0) pedido += `\nA tentativa anterior foi recusada porque: ${motivo}. Corrija isso.`;
    custo.chamadas_followup = (custo.chamadas_followup || 0) + 1;
    const r = await pergunta(pedido);
    if (!r) { custo.falhas_haiku = (custo.falhas_haiku || 0) + 1; motivo = 'sem resposta do Haiku'; continue; }
    const lista = (Array.isArray(r.mensagens) ? r.mensagens : [r.resposta]).map((x) => (ctx.limpar || limparLocal)(x)).filter(Boolean);
    const texto = lista.join(' ').replace(/\s+/g, ' ').trim();
    const v = validarFollowup(texto, { nomes, baseMd, anteriores });
    if (v.ok) return { ok: true, texto };
    motivo = v.motivo;
  }
  return { ok: false, motivo };
}

// ---------- engine de envio ----------
const esperarMs = (ctx, ms) => cx(ctx).dormir(ms);
function conferirPaineis(ctx) {
  const { A, agora } = cx(ctx), est = ctx.est;
  if (agora() - (est.ultimaConfPainel || 0) < 60000) return;
  est.ultimaConfPainel = agora();
  const filaArq = lerJson(A.fila, null);
  if (!filaArq) return;
  const revs = lerJson(A.revendedores, {});
  const fones = new Map(); for (const r of Object.values(revs)) { const f = fim8(r.telefone); if (f.length === 8) fones.set(f, r); }
  let mudou = false;
  for (const it of filaArq.itens) {
    if (it.status !== 'na_fila' && it.status !== 'enviado') continue;
    const r = revs[it.id] || fones.get(fim8(it.telefone));
    if (r) { it.status = 'fechou_painel'; it.fechou_painel_em = r.fechou_em || iso(agora()); mudou = true; try { ctx.evento('backlog_fechou_painel', it.id, it.nome, { n: (it.followups || []).length }); } catch {} }
  }
  if (mudou) { filaArq.atualizado_em = iso(agora()); gravar(A.fila, filaArq); }
}
// Chamado pelo bot quando uma pessoa escreve.
function aoReceber(ctx, id, tsSeg) {
  try {
    const { A, agora } = cx(ctx);
    const filaArq = lerJson(A.fila, null); if (!filaArq) return;
    const it = filaArq.itens.find((x) => x.id === id && (x.status === 'enviado' || x.status === 'na_fila')); if (!it) return;
    const ts = (tsSeg || agora() / 1000) * 1000;
    if (it.status === 'na_fila') { if (ts > Date.parse(it.ultimo_contato)) { it.status = 'descartado'; it.descartado_motivo = 'a pessoa voltou sozinha antes do follow-up (o fluxo normal responde)'; it.descartado_em = iso(agora()); } else return; }
    else {
      const ult = (it.followups || []).slice(-1)[0]; if (!ult || ts <= Date.parse(ult.quando) + 1000) return;
      it.status = 'respondeu'; it.respondeu_em = iso(ts); it.minutos_ate_resposta = Math.max(0, Math.round((ts - Date.parse(ult.quando)) / 6000) / 10);
      try { ctx.evento('backlog_respondeu', id, it.nome, { n: it.followups.length, minutos_ate_resposta: it.minutos_ate_resposta }); } catch {}
      logar(ctx, 'backlog respondeu ' + it.nome);
    }
    filaArq.atualizado_em = iso(agora()); gravar(A.fila, filaArq);
  } catch (e) { logar(ctx, 'backlog aoReceber falhou ' + (e.message || e)); }
}

// Confere a conversa de novo logo antes de enviar (nada mudou desde o mapa?).
async function conferirAntes(ctx, it, tipo) {
  const { A, agora } = cx(ctx);
  if ((ctx.quieto && (ctx.quieto.get(it.id) || 0) > agora()) || (ctx.aguardando && ctx.aguardando.has(it.id)) || (ctx.atendendo && ctx.atendendo.has(it.id)) || (ctx.fila && ctx.fila.has(it.id))) return { acao: 'adiar', motivo: 'fluxo ao vivo ativo nessa conversa' };
  const revs = lerJson(A.revendedores, {});
  if (revs[it.id] || Object.values(revs).some((r) => fim8(r.telefone) === fim8(it.telefone) && fim8(it.telefone).length === 8)) return { acao: 'fechou_painel', motivo: 'já fechou painel' };
  const chat = await ctx.client.getChatById(it.id);
  const ms = conteudo(await chat.fetchMessages({ limit: 15 }));
  // 08/11 (coordenador): quem encerrou com "ok/blz/obrigado" ou foi respondido pelo senhor por último não recebe toque.
  const ultCli = [...ms].reverse().find((m) => !m.fromMe);
  if (ultCli && ultCli.type === 'chat' && ENCERRA.test(String(ultCli.body || ''))) return { acao: 'descartar', motivo: 'o cliente encerrou a conversa com ok/obrigado' };
  const ultNosso = [...ms].reverse().find((m) => m.fromMe);
  if (ultNosso && (!ultCli || ultNosso.timestamp > ultCli.timestamp) && Date.now() - ultNosso.timestamp * 1000 < 72 * 3600e3) {   // só quando o senhor falou nas últimas 72 h (antes do robô, ele era o atendente)
    const idx = indiceRobo(ctx.recentes ? ctx.recentes(30 * 86400e3) : []);
    if (quemFalou(ultNosso, it.id, idx) === 'senhor') return { acao: 'descartar', motivo: 'o senhor respondeu por último' };
  }
  const marco = tipo === 'segundo' ? Date.parse(it.followups[0].quando) + 1000 : Date.parse(it.ultimo_contato) + 999;
  const novas = ms.filter((m) => m.timestamp * 1000 > marco && !(it.followups || []).some((f) => f.msg_id === (m.id && m.id._serialized)));
  if (novas.some((m) => !m.fromMe)) return { acao: 'respondeu', motivo: 'a pessoa escreveu depois do mapa (o fluxo normal responde)', quando: Math.max(...novas.filter((m) => !m.fromMe).map((m) => m.timestamp * 1000)) };
  if (novas.some((m) => m.fromMe)) return { acao: 'descartar', motivo: 'alguém já falou nessa conversa depois do mapa' };
  return { acao: 'enviar', chat };
}
async function enviarTexto(ctx, chat, id, texto) {
  try { if (require('./desligados.js').desligado(id)) return false; } catch {}
  try { await chat.sendStateTyping(); } catch {}
  await esperarMs(ctx, Math.min(2000 + texto.length * 40 + Math.floor(cx(ctx).rand() * 1500), 9000));
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
// 08/11 (Dashboard, "Atender novamente todos"): backlog-config.json { acelerado_ate } = fila anda no mínimo (60 s) até essa hora.
function acelerado(ctx) { const c = lerJson(cx(ctx).A.cfg, {}); return !!(c.acelerado_ate && Date.parse(c.acelerado_ate) > cx(ctx).agora()); }
function intervaloPlanejado(ctx, itens, modo) {
  const agora = cx(ctx).agora();
  if (acelerado(ctx) && contarPendentes(itens, modo, agora)) return LIM.intervalo_min * 1000;
  return planejarIntervalo({ agora, hoje: enviadosHoje(itens, agora), pendentes: contarPendentes(itens, modo, agora), modo });
}
async function enviarProximo(ctx) {
  const { A, agora, rand } = cx(ctx), est = ctx.est;
  const filaArq = lerJson(A.fila, null);
  if (!filaArq || !filaArq.itens) return;
  const cfg = lerJson(A.cfg, {});
  if (est.parado_por_erros && !fs.existsSync(A.pausado)) { est.parado_por_erros = false; est.erros = 0; }
  if (est.ultimo_envio_em == null) { const e0 = lerJson(A.estado, {}); est.ultimo_envio_em = e0.ultimo_envio_em || ''; }
  if (est.proximo_em == null) est.proximo_em = est.ultimo_envio_em ? Date.parse(est.ultimo_envio_em) + LIM.intervalo_min * 1000 : 0;
  const plano = intervaloPlanejado(ctx, filaArq.itens, cfg.modo);
  est.intervalo_medio_s = plano ? Math.round(plano / 10000) * 10 : null;
  const uptimeMs = ctx.uptimeMs ? ctx.uptimeMs() : process.uptime() * 1000;
  const d = decidirEnvio({ itens: filaArq.itens, agora: agora(), pausado: fs.existsSync(A.pausado), modo: cfg.modo, estado: { proximo_em: est.proximo_em, parado_por_erros: est.parado_por_erros }, adiados: est.adiados || {}, uptimeMs, ultimoEnvio: est.ultimo_envio_em ? Date.parse(est.ultimo_envio_em) : 0 });
  est.motivo_espera = d.acao === 'esperar' ? d.motivo : null;
  est.proximo_envio_em = d.acao === 'enviar' ? iso(Math.max(agora(), est.proximo_em || 0)) : (d.ate ? iso(d.ate) : null);
  if (d.acao !== 'enviar') return escreverEstado(ctx);
  const it = d.item;
  // 08/11 (funil): fila única. O portão confere o teto TOTAL do dia (todos os proativos), os 60 s e a prioridade (ao vivo > retomada > lacuna > cadência > jornada > atrasado).
  const acel = acelerado(ctx);
  if (acel && est.proximo_em && est.proximo_em - agora() > 2 * LIM.intervalo_min * 1000) { est.proximo_em = agora(); return escreverEstado(ctx); }
  if (ctx.portao) { const p = ctx.portao.pode('atrasado'); if (!p.ok && !(acel && p.motivo === 'ritmo')) { est.motivo_espera = 'portao_' + p.motivo; return escreverEstado(ctx); } }
  est.enviando = true;
  try {
    const c = await conferirAntes(ctx, it, d.tipo);
    const reg = filaArq.itens.find((x) => x.id === it.id);
    if (c.acao === 'adiar') { (est.adiados || (est.adiados = {}))[it.id] = agora() + 10 * 60e3; return; }
    if (c.acao !== 'enviar') {
      if (c.acao === 'fechou_painel') { reg.status = 'fechou_painel'; reg.fechou_painel_em = iso(agora()); }
      else if (c.acao === 'respondeu') { if (d.tipo === 'segundo') { reg.status = 'respondeu'; reg.respondeu_em = iso(c.quando); } else { reg.status = 'descartado'; reg.descartado_motivo = c.motivo; reg.descartado_em = iso(agora()); } }
      else { reg.status = d.tipo === 'segundo' ? 'enviado' : 'descartado'; reg.descartado_motivo = c.motivo; reg.descartado_em = iso(agora()); if (d.tipo === 'segundo') reg.encerrado = true; }
      filaArq.atualizado_em = iso(agora()); gravar(A.fila, filaArq);
      logar(ctx, `backlog nao enviou a ${it.nome} - ${c.motivo}`);
      return;
    }
    let texto = reg.texto;
    if (d.tipo === 'segundo') {
      if (!reg.texto2) {
        const baseMd = (() => { try { return fs.readFileSync(A.base, 'utf8'); } catch { return ''; } })();
        const mapa = lerJson(A.mapa, { itens: [] }).itens.find((x) => x.id === it.id) || {};
        let linhas = [];
        try { linhas = conteudo(await c.chat.fetchMessages({ limit: 20 })).map((m) => ({ quem: m.fromMe ? 'robo' : 'cliente', texto: textoMsg(m) })); } catch {}
        const g = await gerarFollowup(ctx, { ...it, ...mapa, nome: it.nome, ultimo_contato: reg.followups[0].quando, _c: { linhas } }, { baseMd, anteriores: filaArq.itens.flatMap((x) => [x.texto, x.texto2]).filter(Boolean), tipo: 'segundo' });
        if (!g.ok) { reg.encerrado = true; filaArq.atualizado_em = iso(agora()); gravar(A.fila, filaArq); logar(ctx, `backlog sem 2o follow-up para ${it.nome} - ${g.motivo}`); return; }
        reg.texto2 = g.texto;
      }
      texto = reg.texto2;
    }
    const n = (reg.followups || []).length + 1;
    let m;
    if (ctx.portao) { const p2 = ctx.portao.pode('atrasado'); if (!p2.ok && !(acel && p2.motivo === 'ritmo')) { est.motivo_espera = 'portao_' + p2.motivo; return; } ctx.portao.registrar('atrasado'); }
    try { if (require('./desligados.js').desligado(it.id)) { reg.status = 'descartado'; reg.descartado_motivo = 'robô desligado nesta conversa'; reg.encerrado = true; filaArq.atualizado_em = iso(agora()); gravar(A.fila, filaArq); logar(ctx, 'backlog: robô desligado para ' + it.nome + ', pulei'); return; } } catch {}
    try { m = await enviarTexto(ctx, c.chat, it.id, texto); }
    catch (e) {
      est.erros = (est.erros || 0) + 1;
      reg.tentativas = (reg.tentativas || 0) + 1;
      if (reg.tentativas >= LIM.tentativas_max) { reg.status = d.tipo === 'segundo' ? 'enviado' : 'descartado'; reg.descartado_motivo = 'falhou ' + reg.tentativas + ' vezes ao enviar'; if (d.tipo === 'segundo') reg.encerrado = true; }
      filaArq.atualizado_em = iso(agora()); gravar(A.fila, filaArq);
      logar(ctx, `backlog erro de envio ${est.erros} de ${LIM.erros_para_parar} para ${it.nome} - ${e && e.message || e}`);
      try { ctx.erroEv('backlog_envio', e, it.id); } catch {}
      if (est.erros >= LIM.erros_para_parar) {
        est.parado_por_erros = true;
        try { fs.writeFileSync(A.pausado, 'parado sozinho em ' + iso(agora()) + ' depois de ' + est.erros + ' erros de envio seguidos'); } catch {}
        logar(ctx, 'backlog PARADO - ' + est.erros + ' erros de envio seguidos');
        try { await ctx.avisarSenhor('Revenda (backlog): o WhatsApp devolveu erro de envio ' + est.erros + ' vezes seguidas. Parei todos os follow-ups do backlog (arquivo backlog-pausado). Último erro: ' + String(e && e.message || e).slice(0, 120)); } catch {}
      }
      est.proximo_em = agora() + sortearIntervalo(intervaloPlanejado(ctx, filaArq.itens, cfg.modo), rand);
      return;
    }
    est.erros = 0;
    const quando = iso(agora());
    reg.followups = (reg.followups || []).concat({ n, quando, texto, msg_id: m.id._serialized });
    reg.status = 'enviado'; reg.enviado_em = reg.enviado_em || quando;
    if (n >= 2) reg.encerrado = true;
    filaArq.atualizado_em = quando; gravar(A.fila, filaArq);
    est.ultimo_envio_em = quando;
    est.proximo_em = agora() + sortearIntervalo(intervaloPlanejado(ctx, filaArq.itens, cfg.modo), rand);
    try { ctx.evento('followup_backlog', it.id, it.nome, { n, texto, categoria: it.categoria, piloto: !!reg.piloto }); } catch {}
    try { const f = ctx.fichas[it.id]; if (f) { f.notas = (f.notas || []).concat(`${new Date(agora()).toLocaleDateString('pt-BR')}: follow-up do backlog ${n} enviado.`).slice(-15); ctx.salvarFichas(); } } catch {}
    try { ctx.log(`robô -> ${it.nome}: [follow-up backlog ${n}] ${texto}`); } catch {}
  } finally { est.enviando = false; escreverEstado(ctx); }
}

// ---------- manutenção do mapa (comandos por arquivo) ----------
// renomear: tenta de novo os contatos que falharam, devagar (3-5 s entre um e outro) e para depois de 3 falhas seguidas.
async function renomearPendentes(ctx, op = {}) {
  const { A, agora } = cx(ctx), est = ctx.est;
  if (est.mapeando) return { ok: false, motivo: 'mapeando' };
  est.mapeando = true;
  const max = Math.min(Math.max(parseInt(op.max, 10) || 20, 1), 100);
  let feitos = 0, seguidas = 0, tentados = 0;
  try {
    const mapa = lerJson(A.mapa, null); if (!mapa) return { ok: false, motivo: 'sem mapa' };
    for (const it of mapa.itens) {
      if (tentados >= max || seguidas >= 3) break;
      if (!it.renomeio || it.renomeio.status !== 'falhou' || !it.telefone) continue;
      tentados++;
      const r = await renomearContato(ctx, it);
      it.renomeio = r;
      if (r.status === 'renomeado') { feitos++; seguidas = 0; } else if (r.status === 'falhou') seguidas++;
      await pausar(ctx, LIM.pausa_renomeio_s);
    }
    mapa.renomeio = { renomeados: mapa.itens.filter((i) => i.renomeio && i.renomeio.status === 'renomeado').length, mantidos: mapa.itens.filter((i) => i.renomeio && i.renomeio.status === 'mantido').length, falhas: mapa.itens.filter((i) => i.renomeio && i.renomeio.status === 'falhou').length };
    gravar(A.mapa, mapa);
    logar(ctx, `backlog renomeio retomado - ${feitos} de ${tentados} tentados, ${mapa.renomeio.falhas} ainda falhando` + (seguidas >= 3 ? ' (parou apos 3 falhas seguidas)' : ''));
    return { ok: true, feitos, tentados, parou_por_falhas: seguidas >= 3, ...mapa.renomeio };
  } finally { est.mapeando = false; }
}
// diversificar: reescreve os follow-ups (fora do piloto) que começam igual a outro, para não parecer mensagem em massa.
async function diversificar(ctx) {
  const { A } = cx(ctx), est = ctx.est;
  if (est.mapeando) return { ok: false, motivo: 'mapeando' };
  est.mapeando = true;
  try {
    const filaArq = lerJson(A.fila, null); if (!filaArq) return { ok: false, motivo: 'sem fila' };
    const mapa = lerJson(A.mapa, { itens: [] });
    const baseMd = (() => { try { return fs.readFileSync(A.base, 'utf8'); } catch { return ''; } })();
    const abertura = (t) => norm(t).split(' ').slice(0, 3).join(' ');
    const naFila = filaArq.itens.filter((x) => x.status === 'na_fila');
    const usadas = new Map(); // abertura -> quantas
    for (const x of filaArq.itens) for (const t of [x.texto, x.texto2].filter(Boolean)) usadas.set(abertura(t), (usadas.get(abertura(t)) || 0) + 1);
    const vistos = new Set(); let refeitos = 0, tentados = 0;
    const custo = { chamadas_followup: 0, falhas_haiku: 0 };
    for (const x of naFila.sort((a, b) => Date.parse(b.ultimo_contato) - Date.parse(a.ultimo_contato))) {
      const ab = abertura(x.texto);
      if (!vistos.has(ab)) { vistos.add(ab); continue; }       // primeira com essa abertura fica
      if (x.piloto) continue;                                  // o piloto já foi revisado
      tentados++;
      let linhas = [];
      try { const ch = await ctx.client.getChatById(x.id); linhas = conteudo(await ch.fetchMessages({ limit: 20 })).map((m) => ({ quem: m.fromMe ? 'robo' : 'cliente', texto: textoMsg(m) })); } catch {}
      const todas = filaArq.itens.flatMap((y) => [y.texto, y.texto2]).filter(Boolean);
      const m = mapa.itens.find((i) => i.id === x.id) || {};
      for (let t = 0; t < 3; t++) {
        const g = await gerarFollowup(ctx, { ...x, ...m, nome: x.nome, _c: { linhas } }, { baseMd, anteriores: todas, custo, tipo: 'primeiro', evitar: [...usadas.keys(), ...vistos].slice(-30) });
        if (g.ok && !vistos.has(abertura(g.texto)) && (usadas.get(abertura(g.texto)) || 0) < 2) {
          x.texto = g.texto; vistos.add(abertura(g.texto)); usadas.set(abertura(g.texto), (usadas.get(abertura(g.texto)) || 0) + 1);
          if (m && 'followup_sugerido' in m) m.followup_sugerido = g.texto;
          refeitos++; break;
        }
      }
      if (tentados % 5 === 0) { gravar(A.fila, { ...filaArq, atualizado_em: iso(cx(ctx).agora()) }); gravar(A.mapa, mapa); }
    }
    gravar(A.fila, { ...filaArq, atualizado_em: iso(cx(ctx).agora()) }); gravar(A.mapa, { ...mapa, custo: { ...(mapa.custo || {}), chamadas_followup: ((mapa.custo || {}).chamadas_followup || 0) + custo.chamadas_followup } });
    logar(ctx, `backlog follow-ups diversificados - ${refeitos} de ${tentados} reescritos, ${custo.chamadas_followup} chamadas`);
    return { ok: true, refeitos, tentados, chamadas: custo.chamadas_followup };
  } finally { est.mapeando = false; }
}

// ---------- comandos por arquivo ----------
async function comandos(ctx) {
  const { A } = cx(ctx);
  if (!fs.existsSync(A.comando)) return;
  let cmd; try { cmd = JSON.parse(fs.readFileSync(A.comando, 'utf8').replace(/^﻿/, '')); } catch { try { fs.unlinkSync(A.comando); } catch {} return; }
  try { fs.unlinkSync(A.comando); } catch {}
  if (cmd.acao === 'mapear') { logar(ctx, 'backlog mapeamento pedido - ' + (cmd.dias || LIM.dias_mapa) + ' dias'); mapear(ctx, cmd).catch((e) => logar(ctx, 'backlog mapear falhou ' + (e.message || e))); }
  else if (cmd.acao === 'renomear') renomearPendentes(ctx, cmd).catch((e) => logar(ctx, 'backlog renomear falhou ' + (e.message || e)));
  else if (cmd.acao === 'diversificar') diversificar(ctx).catch((e) => logar(ctx, 'backlog diversificar falhou ' + (e.message || e)));
  else if (cmd.acao === 'pausar') fs.writeFileSync(A.pausado, 'pausado em ' + new Date().toISOString());
  else if (cmd.acao === 'retomar') { try { fs.unlinkSync(A.pausado); } catch {} gravar(A.cfg, { ...lerJson(A.cfg, {}), modo: 'completo' }); }
}
async function tick(ctx) {
  const est = ctx.est || (ctx.est = {});
  await comandos(ctx);
  if (est.mapeando || est.enviando) return;
  try { conferirPaineis(ctx); } catch {}
  // 08/11/2026: renomeação dos contatos que faltam, devagar: até 30 por hora (o WhatsApp recusa edição de contato depois de umas 45 seguidas).
  if (!est.renomeando && Date.now() - (est.ultimaRenomeacao || 0) > 60 * 60e3) {
    est.ultimaRenomeacao = Date.now();
    try { renomearPendentes(ctx, { max: 30 }).catch((e) => logar(ctx, 'backlog renomear falhou ' + (e.message || e))); } catch {}
  }
  await enviarProximo(ctx);
}

module.exports = { LIM, CATEGORIAS, CAT_ELEGIVEIS, arqs, dentroDaJanela, inicioDaProximaJanela, sortearIntervalo, planejarIntervalo, contarPendentes, intervaloPlanejado, enviadosHoje, mascararTelefone, avaliarElegibilidade, decidirEnvio, validarFollowup,
  mapear, renomearPendentes, diversificar, mesclarFila, escolherPiloto, renomearContato, sufixoPara, gerarFollowup, indiceRobo, quemFalou, aoReceber, tick, enviarProximo, conferirPaineis, comandos, escreverEstado, refDe, chamarHaiku };
