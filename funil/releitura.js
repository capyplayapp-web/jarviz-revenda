// Releitura (08/11/2026, pedido do senhor: "botão rodar releitura, ele lê tudo e age se for preciso").
// Lê no PRÓPRIO WhatsApp todas as conversas das últimas N horas (pega até mensagem que o robô nunca viu),
// separa (1) conversas cuja última palavra é do cliente e (2) perguntas que ficaram sem resposta no meio da conversa
// (o Haiku julga), e age: o robô responde pelo fluxo normal (atender, com todos os filtros); o que é do senhor vai para a lista.
// Pedido: funil/comando.json {"acao":"releitura","horas":12,"agir":true}. Resultado: releitura-resultado.json na pasta do robô.
// Ações pendentes (fora da janela 8-21h ou na fila) ficam em funil/releitura-estado.json e o tick do motor continua.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const N = require('./nucleo.js');

const DIR = process.env.FUNIL_DIR || __dirname;
const PASTA = process.env.FUNIL_PASTA || path.resolve(__dirname, '..');
const ARQ = {
  resultado: path.join(PASTA, 'releitura-resultado.json'), historico: path.join(PASTA, 'releitura-historico.jsonl'),
  estado: path.join(DIR, 'releitura-estado.json'), prompt: path.join(DIR, 'releitura-prompt.md'), log: path.join(PASTA, 'conversas.log'),
  clientes: path.join(PASTA, 'clientes.json'), base: path.join(PASTA, 'base.md'), pausado: path.join(PASTA, 'pausado'),
};
const lerJson = (arq, padrao) => { try { return JSON.parse(fs.readFileSync(arq, 'utf8').replace(/^﻿/, '')); } catch { return padrao; } };
const gravar = (arq, obj) => { const t = arq + '.tmp'; fs.writeFileSync(t, JSON.stringify(obj, null, 1)); fs.renameSync(t, arq); };
const iso = (ms) => new Date(ms).toISOString();
const logar = (ctx, t) => { try { ctx.log(String(t)); } catch {} };
const hhmm = (s) => new Date(s * 1000).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const HUMANO = ['chat', 'ptt', 'audio', 'image', 'document', 'video'];
const ENCERRA = /^\s*(ok+|okay|blz|beleza|obrigad[oa]s?|obg|valeu|vlw|show|top|certo|t[aá]|tmj|sim|joia|j[oó]ia|perfeito|combinado|fechado|boa|isso|entendi|kk+|rs+|[\p{Extended_Pictographic}\s]+)[\s.!]*$/iu;
const MAX_ACOES = 25, ESPACO_MS = 45e3;

// Textos do robô e transcrições de áudio, tirados do conversas.log (para saber quem falou: robô ou o senhor).
function lerLog() {
  let txt = ''; try { txt = fs.readFileSync(ARQ.log, 'utf8'); } catch {}
  const robo = new Set(), audios = [];
  const RX = /^\[(\d{2})\/(\d{2})\/(\d{4}), (\d{2}):(\d{2}):(\d{2})\] (.*)$/;
  let ult = null;
  for (const l of txt.split(/\r?\n/)) {
    const m = l.match(RX);
    if (!m) { if (ult && ult.tipo === 'robo') ult.txt += '\n' + l; continue; }
    if (ult && ult.tipo === 'robo') robo.add(chaveTexto(ult.txt));
    ult = null;
    const corpo = m[7], t = new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +m[6]).getTime() / 1000;
    let r;
    if ((r = corpo.match(/^robô -> [^:]*?: ([\s\S]*)$/))) ult = { tipo: 'robo', txt: r[1] };
    else if ((r = corpo.match(/^(.*?) \[áudio transcrito\]: ([\s\S]*)$/))) audios.push({ nome: r[1].trim(), t, txt: r[2] });
  }
  if (ult && ult.tipo === 'robo') robo.add(chaveTexto(ult.txt));
  return { robo, audios };
}
const chaveTexto = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 70).toLowerCase();

function quemFalou(ctx, m, robo) {
  if (!m.fromMe) return 'cliente';
  if (m.type === 'automated_greeting_message') return 'robô';
  if ((ctx.enviadasPeloRobo && ctx.enviadasPeloRobo.has(m.id._serialized)) || (ctx.textosDoRobo && ctx.textosDoRobo.has(m.body)) || robo.has(chaveTexto(m.body))) return 'robô';
  return 'senhor';
}
function corpoDe(m, nome, audios) {
  if (m.type === 'chat' || m.type === 'automated_greeting_message') return String(m.body || '').trim();
  if (m.type === 'ptt' || m.type === 'audio') {
    const a = audios.filter((x) => x.nome === nome && Math.abs(x.t - m.timestamp) < 600).sort((x, y) => Math.abs(x.t - m.timestamp) - Math.abs(y.t - m.timestamp))[0];
    return a ? '(áudio) ' + a.txt : '[áudio sem transcrição]';
  }
  if (m.type === 'image') return '[foto]' + (m.body ? ' ' + m.body : '');
  if (m.type === 'video') return '[vídeo]' + (m.body ? ' ' + m.body : '');
  if (m.type === 'document') return '[arquivo]' + (m.body ? ' ' + m.body : '');
  return '';
}

// 1) Lê o WhatsApp
async function lerConversas(ctx, horas) {
  const limite = Date.now() / 1000 - horas * 3600;
  const fichas = lerJson(ARQ.clientes, {});
  const { robo, audios } = lerLog();
  const chats = await ctx.client.getChats();
  const out = [];
  for (const c of chats) {
    const id = c.id._serialized;
    if (c.isGroup || !ctx.conversaValida(id)) continue;
    const lm = c.lastMessage;
    if (!lm || lm.timestamp < limite) continue;
    const ms = await c.fetchMessages({ limit: 40 }).catch(() => []);
    const nome = (fichas[id] && fichas[id].nome) || c.name || (lm._data && lm._data.notifyName) || id.split('@')[0];
    const linhas = [];
    for (const m of ms) {
      if (!HUMANO.includes(m.type) && m.type !== 'automated_greeting_message') continue;
      const corpo = corpoDe(m, nome, audios); if (!corpo) continue;
      linhas.push({ m, quem: quemFalou(ctx, m, robo), corpo, t: m.timestamp, janela: m.timestamp >= limite });
    }
    if (!linhas.some((l) => l.quem === 'cliente' && l.janela)) continue;   // sem fala do cliente no período
    const ult = linhas[linhas.length - 1];
    const pend = [];
    for (let i = linhas.length - 1; i >= 0 && linhas[i].quem === 'cliente'; i--) pend.unshift(linhas[i]);
    out.push({ id, ref: N.refDe(id), nome, linhas, ultimo: ult, pend, naoLidas: c.unreadCount || 0,
      ficha: fichas[id] ? { etapa: fichas[id].etapa || null, painel: !!fichas[id].painel_criado, interesse: fichas[id].interesse || null } : null });
  }
  return out;
}

// 2) Haiku julga as perguntas não respondidas
const PROMPT = `Você é o conferente do atendimento de WhatsApp da revenda CapyPlay. Lê conversas (cliente, robô e o responsável, chamado de "senhor") e acha DÚVIDAS DO CLIENTE QUE FICARAM SEM RESPOSTA. Português do Brasil, frases curtas, sem emoji.

Para cada conversa você recebe linhas numeradas "c12 [08/11 14:03] cliente: texto". As linhas "senhor" são o responsável respondendo na mão: conte como respondido.

Uma dúvida conta quando o cliente perguntou ou pediu algo (preço, como funciona, link, teste, problema técnico, pagamento, app, lista, servidor) e:
- "sem_resposta": ninguém respondeu depois;
- "ignorada": o robô falou depois, mas de outra coisa, sem responder;
- "mal_respondida": o robô respondeu errado, incompleto ou contraditório.
Não liste: cumprimentos, "ok/blz/obrigado", dúvida já resolvida mais à frente, nem dúvida que o próprio cliente abandonou trocando de assunto e foi atendido no novo.

"acao":
- "robo_responde": o base.md cobre a resposta e o robô pode retomar sozinho.
- "senhor": envolve pagamento feito, comprovante, reclamação, cancelamento, problema técnico que o robô não resolve, pedido fora do base.md, ou o senhor já estava conversando.
- "nada": não vale retomar (passou muito tempo e o assunto morreu, ou o cliente encerrou).

Responda SOMENTE com JSON numa linha, sem nada antes ou depois:
{"conversas":[{"ref":"id da conversa","duvidas":[{"linha":"c12","pergunta":"o que o cliente perguntou, nas palavras dele, curto","situacao":"sem_resposta|ignorada|mal_respondida","acao":"robo_responde|senhor|nada","motivo":"por que, curto","resposta_sugerida":"resposta curta, sem inventar preço, prazo ou link que não esteja no base.md"}]}],
 "aprendizados":[{"tipo":"regra|lacuna|erro","texto":"o que o robô deve aprender, no imperativo, até 160 caracteres","exemplo":"nome do cliente e a fala"}]}
Conversa sem dúvida pendente: não inclua. Nunca invente cliente, fala nem número. Se não houver nada: {"conversas":[],"aprendizados":[]}`;

function perguntar(sistema, texto, ms = 240000) {
  return new Promise((resolve) => {
    try { fs.writeFileSync(ARQ.prompt, sistema); } catch {}
    const args = ['-p', '--model', 'haiku', '--setting-sources', '""', '--system-prompt-file', ARQ.prompt, '--tools', '""', '--no-session-persistence', '--strict-mcp-config', '--output-format', 'json'];
    const p = spawn('claude.cmd', args, { cwd: PASTA, shell: true, windowsHide: true });
    let out = '';
    const t = setTimeout(() => { try { p.kill(); } catch {} resolve(null); }, ms);
    p.stdout.on('data', (d) => (out += d));
    p.on('error', () => { clearTimeout(t); resolve(null); });
    p.on('close', () => { clearTimeout(t); const m = require('../uso-ia.js').desembrulhar(out, 'releitura', 'haiku').match(/\{[\s\S]*\}/); try { resolve(m ? JSON.parse(m[0]) : null); } catch { resolve(null); } });
    p.stdin.end(texto);
  });
}

function transcrever(cv) {
  const linhas = cv.linhas.slice(-30);
  let n = 0;
  const txt = linhas.map((l) => { l.cod = 'c' + (++n); return `${l.cod} [${hhmm(l.t)}] ${l.quem}: ${l.corpo.replace(/\s+/g, ' ').slice(0, 350)}`; }).join('\n');
  return `### conversa ref=${cv.ref} | ${cv.nome} | ficha: ${JSON.stringify(cv.ficha)}\n${txt}`;
}

async function julgar(conversas) {
  let base = ''; try { base = fs.readFileSync(ARQ.base, 'utf8'); } catch {}
  const sistema = PROMPT + '\n\n--- base.md (regras atuais do robô) ---\n' + base.slice(0, 16000);
  const lotes = []; let atual = [], tam = 0;
  for (const cv of conversas) { const t = transcrever(cv); if (atual.length && (tam + t.length > 22000 || atual.length >= 14)) { lotes.push(atual); atual = []; tam = 0; } atual.push(t); tam += t.length; }
  if (atual.length) lotes.push(atual);
  const duvidas = new Map(), aprendizados = []; let falhas = 0;
  for (const l of lotes) {
    const r = await perguntar(sistema, `Hoje é ${new Date().toLocaleString('pt-BR')}.\n\n` + l.join('\n\n'));
    if (!r) { falhas++; continue; }
    for (const c of r.conversas || []) if (c && c.ref && Array.isArray(c.duvidas) && c.duvidas.length) duvidas.set(String(c.ref), c.duvidas);
    for (const a of r.aprendizados || []) if (a && a.texto) aprendizados.push(a);
  }
  return { duvidas, aprendizados, lotes: lotes.length, falhas };
}

// 3) Monta o plano e o resultado
async function rodar(ctx, pedido) {
  const horas = Math.min(72, Math.max(1, Number(pedido.horas) || 12)), agir = pedido.agir !== false;
  const res = { pedido_em: pedido.pedido_em || iso(Date.now()), iniciado_em: iso(Date.now()), horas, agir, etapa: 'lendo o WhatsApp' };
  gravar(ARQ.resultado, res);
  logar(ctx, `releitura iniciada: últimas ${horas} h` + (agir ? '' : ' (só leitura)'));
  const conversas = await lerConversas(ctx, horas);
  res.conversas_lidas = conversas.length; res.etapa = 'conferindo as dúvidas com o Haiku'; gravar(ARQ.resultado, res);
  const j = await julgar(conversas);
  const itens = [], acoes = [];
  for (const cv of conversas) {
    const ds = j.duvidas.get(cv.ref) || [];
    const temPend = cv.pend.length > 0, soEncerra = temPend && cv.pend.every((l) => ENCERRA.test(l.corpo));
    const quietoAte = (ctx.quieto && ctx.quieto.get(cv.id)) || 0;
    const base = { ref: cv.ref, nome: cv.nome, telefone: '•••• ' + N.digitos(cv.id).slice(-4), ultimo: iso(cv.ultimo.t * 1000), ultimo_quem: cv.ultimo.quem, nao_lidas: cv.naoLidas };
    // (a) última palavra do cliente
    if (temPend && !soEncerra) {
      const doSenhor = ds.some((d) => d.acao === 'senhor');
      const it = { ...base, tipo: 'sem_resposta', mensagens: cv.pend.map((l) => l.corpo.slice(0, 300)), desde: iso(cv.pend[0].t * 1000), duvidas: ds,
        acao: doSenhor ? 'senhor' : (quietoAte > Date.now() ? 'senhor' : 'robo_responde'), motivo: doSenhor ? (ds.find((d) => d.acao === 'senhor').motivo || '') : (quietoAte > Date.now() ? 'o senhor está na conversa (robô quieto)' : 'a última mensagem é do cliente') };
      itens.push(it);
      if (it.acao === 'robo_responde') acoes.push({ id: cv.id, ref: cv.ref, nome: cv.nome, tipo: 'pendentes' });
      continue;
    }
    // (b) dúvidas ignoradas ou mal respondidas no meio da conversa
    for (const d of ds) {
      if (d.situacao === 'sem_resposta' && !temPend) d.situacao = 'ignorada';
      const lin = cv.linhas.find((l) => l.cod === d.linha && l.quem === 'cliente');
      const it = { ...base, tipo: d.situacao || 'ignorada', pergunta: d.pergunta || (lin && lin.corpo) || '', quando: lin ? iso(lin.t * 1000) : null, acao: d.acao || 'senhor', motivo: d.motivo || '', resposta_sugerida: d.resposta_sugerida || '' };
      if (it.acao === 'robo_responde' && (!lin || !ctx.atender)) { it.acao = 'senhor'; it.motivo = (it.motivo ? it.motivo + '; ' : '') + (lin ? 'o robô ainda não sabe retomar dúvida antiga' : 'não achei a mensagem'); }
      if (it.acao === 'robo_responde' && quietoAte > Date.now()) { it.acao = 'senhor'; it.motivo = 'o senhor está na conversa (robô quieto)'; }
      itens.push(it);
      if (it.acao === 'robo_responde') acoes.push({ id: cv.id, ref: cv.ref, nome: cv.nome, tipo: 'retomar', msg_id: lin.m.id._serialized, pergunta: it.pergunta });
    }
  }
  // uma ação por conversa (a primeira dúvida basta: o robô vê a conversa inteira)
  const vistas = new Set(), plano = acoes.filter((a) => !vistas.has(a.id) && vistas.add(a.id)).slice(0, MAX_ACOES);
  Object.assign(res, {
    etapa: 'concluída', concluido_em: iso(Date.now()), lotes: j.lotes, falhas_haiku: j.falhas,
    total: itens.length, sem_resposta: itens.filter((i) => i.tipo === 'sem_resposta').length, ignoradas: itens.filter((i) => i.tipo !== 'sem_resposta').length,
    robo_vai_responder: agir ? plano.length : 0, para_o_senhor: itens.filter((i) => i.acao === 'senhor').length, itens, aprendizados: j.aprendizados,
  });
  for (const it of itens) if (it.acao === 'robo_responde') it.estado = agir ? 'na_fila' : 'só leitura';
  gravar(ARQ.resultado, res);
  try { fs.appendFileSync(ARQ.historico, JSON.stringify({ t: res.concluido_em, horas, agir, lidas: res.conversas_lidas, sem_resposta: res.sem_resposta, ignoradas: res.ignoradas, robo: res.robo_vai_responder, senhor: res.para_o_senhor }) + '\n'); } catch {}
  if (agir) { const st = lerJson(ARQ.estado, {}); st.acoes = plano.map((a) => ({ ...a, criado: iso(Date.now()) })); st.pedido_em = res.pedido_em; gravar(ARQ.estado, st); }
  try { ctx.evento('releitura', null, null, { horas, agir, lidas: res.conversas_lidas, sem_resposta: res.sem_resposta, ignoradas: res.ignoradas, robo: res.robo_vai_responder, senhor: res.para_o_senhor }); } catch {}
  logar(ctx, `releitura concluída: ${res.conversas_lidas} conversas, ${res.sem_resposta} sem resposta, ${res.ignoradas} dúvidas ignoradas, robô responde ${res.robo_vai_responder}, ${res.para_o_senhor} para o senhor`);
  const doSenhor = itens.filter((i) => i.acao === 'senhor');
  if (agir && doSenhor.length && ctx.avisarSenhor) ctx.avisarSenhor(`Releitura da revenda: ${doSenhor.length} conversa(s) precisam do senhor - ${[...new Set(doSenhor.map((i) => i.nome))].slice(0, 8).join(', ')}. Detalhes no Dashboard, aba Resumo.`).catch?.(() => {});
  return res;
}

// 4) Executa as ações, uma por vez, na janela 8-21h
function marcar(ref, tipo, estado, extra = {}) {
  const res = lerJson(ARQ.resultado, null); if (!res || !res.itens) return;
  for (const it of res.itens) if (it.ref === ref && it.acao === 'robo_responde' && (tipo === 'pendentes' ? it.tipo === 'sem_resposta' : it.tipo !== 'sem_resposta')) Object.assign(it, { estado, ...extra });
  gravar(ARQ.resultado, res);
}
async function executarUma(ctx) {
  const st = lerJson(ARQ.estado, {});
  if (!st.acoes || !st.acoes.length) return;
  const agora = Date.now();
  if (fs.existsSync(ARQ.pausado) || !N.naJanela(agora, 8, 21) || agora - (st.ultima_em || 0) < ESPACO_MS) return;
  const a = st.acoes.find((x) => !ctx.fila.has(x.id) && !ctx.atendendo.has(x.id));
  if (!a) return;
  st.acoes = st.acoes.filter((x) => x !== a); st.ultima_em = agora; gravar(ARQ.estado, st);
  if (((ctx.quieto && ctx.quieto.get(a.id)) || 0) > agora) { marcar(a.ref, a.tipo, 'pulado', { motivo_pulo: 'o senhor entrou na conversa' }); return; }
  try {
    let ok = false;
    if (a.tipo === 'pendentes') ok = await ctx.responderAgora(a.id);
    else if (ctx.atender) {
      const ms = await (await ctx.client.getChatById(a.id)).fetchMessages({ limit: 40 });
      const alvo = ms.find((m) => m.id._serialized === a.msg_id);
      const depois = alvo ? ms.slice(ms.indexOf(alvo) + 1) : [];
      if (alvo && !depois.some((m) => m.fromMe && !(ctx.enviadasPeloRobo && ctx.enviadasPeloRobo.has(m.id._serialized)) && !lerLog().robo.has(chaveTexto(m.body)))) {   // o senhor não respondeu nesse meio-tempo
        await ctx.atender(a.id, [alvo], `RETOMADA: o cliente perguntou antes "${String(a.pergunta || alvo.body || '').slice(0, 300)}" e essa dúvida ficou sem resposta. Responda essa dúvida agora, de forma natural (ex.: "Sobre o que você perguntou..."), sem repetir o que já foi dito.`);
        ok = true;
      }
    }
    marcar(a.ref, a.tipo, ok ? 'respondido' : 'pulado', ok ? { respondido_em: iso(Date.now()) } : { motivo_pulo: 'já tinha resposta quando chegou a vez' });
    logar(ctx, `releitura ${ok ? 'respondeu' : 'pulou'} ${a.nome} (${a.tipo === 'pendentes' ? 'última palavra do cliente' : 'dúvida ignorada'})`);
    try { ctx.evento('releitura_respondeu', a.id, a.nome, { tipo: a.tipo, ok }); } catch {}
  } catch (e) { marcar(a.ref, a.tipo, 'falhou', { erro: String(e.message || e).slice(0, 200) }); logar(ctx, 'releitura falhou em ' + a.nome + ' - ' + (e.message || e)); }
}

// chamado pelo motor a cada 10 s
const E = (ctx) => ctx.estReleitura || (ctx.estReleitura = {});
function pedir(ctx, c) {
  const est = E(ctx);
  if (est.rodando) { logar(ctx, 'releitura já está rodando'); return; }
  est.rodando = true;
  rodar(ctx, c).catch((e) => { const r = lerJson(ARQ.resultado, {}); r.etapa = 'falhou'; r.erro = String(e.message || e).slice(0, 300); r.concluido_em = iso(Date.now()); gravar(ARQ.resultado, r); logar(ctx, 'releitura falhou - ' + (e.message || e)); })
    .finally(() => { est.rodando = false; });
}
async function tick(ctx) {
  const est = E(ctx);
  if (est.executando) return;
  est.executando = true;
  try { await executarUma(ctx); } catch (e) { logar(ctx, 'releitura tick falhou - ' + (e.message || e)); } finally { est.executando = false; }
}
module.exports = { pedir, tick, rodar, lerConversas, transcrever, ENCERRA, ARQ };
