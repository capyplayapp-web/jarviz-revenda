// Robô da revenda CapyPlay: atende sozinho o WhatsApp 11 97052-1624.
// Entende a dúvida com o Haiku (base.md) e responde curto, sem emoji.
// Pausar tudo: criar o arquivo "pausado" nesta pasta. Se o senhor responder
// uma conversa pelo celular, o robô fica quieto nela por 2 horas.
const fs = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const { criarTeste } = require('./teste-gratis.js');
const { evento, recentes } = require('./eventos.js');
const { desligado } = require('./desligados.js');
const LN = require('./lista-negra.js'); const HIST = require('./historico.js');   // 10/11/2026: lista negra e histórico permanente
const avisouLN = new Map();                 // conversas com o robô desligado de vez (desligados.json)             // registro de eventos (eventos.jsonl) para os relatórios
const painelRev = require('./painel-revendedores.js');            // leitura (GET) dos revendedores do painel
// Lacunas de conhecimento (LACUNAS.md, ligado em 08/11/2026 no MODO A: o robô avisa o senhor como antes e registra a lacuna).
const lac = (() => { try { return require('./lacunas.mjs'); } catch (e) { console.log('lacunas.mjs não carregou: ' + e.message); return null; } })();
// Estratégia de funil (funil\motor.js, recarregado quando muda): vigia de leads, cadência, jornada, portão dos proativos, etiquetas.
const FUNIL_ARQ = path.join(__dirname, 'funil', 'motor.js');
let _fu = null, _fuM = 0;
function fu() {
  try {
    const m = Math.max(fs.statSync(FUNIL_ARQ).mtimeMs, fs.statSync(path.join(__dirname, 'funil', 'nucleo.js')).mtimeMs);
    if (!_fu || m !== _fuM) { for (const k of Object.keys(require.cache)) if (k.includes(path.join('robo-revenda', 'funil'))) delete require.cache[k]; _fu = require(FUNIL_ARQ); _fuM = m; console.log('funil/motor.js carregado'); }
  } catch (e) { console.log('funil/motor.js não carregou: ' + e.message); }
  return _fu;
}
// Portão único dos envios proativos (teto TOTAL 120/dia, 60 s entre proativos, janela, prioridade). Se o motor não carregar,
// a escada ao vivo segue como antes e o resto fica parado.
const portao = {
  pode: (tipo) => { const m = fu(); if (!m) return { ok: tipo === 'ao_vivo', motivo: 'motor do funil não carregou' }; try { return m.pode(blCtx, tipo); } catch (e) { return { ok: tipo === 'ao_vivo', motivo: 'erro no portão: ' + e.message }; } },
  registrar: (tipo) => { const m = fu(); try { if (m) m.registrar(blCtx, tipo); } catch {} },
};
const nomeDe = (id) => fichas[id]?.nome || null;
const SALVAR_CONTATO = true;          // ao fechar painel, salva o contato "Nome · painel N" no WhatsApp da revenda
const SINCRONIZAR_AGENDA = true;      // e também na agenda do celular
const ULTIMO_SENHOR = new Map();      // chatId -> quando o senhor escreveu por último (decide a origem do painel fechado)
const followupAberto = new Map();     // chatId -> { n, t } follow-up enviado que o cliente ainda não respondeu
const lerJson = (arq, padrao) => { try { return JSON.parse(fs.readFileSync(arq, 'utf8')); } catch { return padrao; } };
const erroEv = (onde, e, chat) => evento('erro', chat || null, chat ? nomeDe(chat) : null, { onde, mensagem: String((e && (e.message || e)) || e).slice(0, 300) });
// Retoma o estado dos follow-ups abertos e das mensagens já contadas (para a varredura não contar duas vezes).
const msgsContadas = new Set();
try {
  for (const e of recentes(24 * 3600e3)) {
    if (e.tipo === 'followup') followupAberto.set(e.chat, { n: e.n, t: e.t, v: e.variante || null });
    else if (e.tipo === 'mensagem_cliente' || e.tipo === 'cliente_respondeu_followup') followupAberto.delete(e.chat);
    if (e.tipo === 'mensagem_cliente') msgsContadas.add(e.chat + '|' + e.texto);
  }
} catch {}

// ---------- Transcrição de áudio (faster-whisper local, transcrever.py fica ligado) ----------
const transcricoes = new Map(); // id da mensagem -> texto
let transcritor = null, filaAudio = Promise.resolve();
function iniciarTranscritor() {
  const p = spawn('python', ['-I', path.join(__dirname, 'transcrever.py')], { cwd: __dirname, windowsHide: true });
  p.esperando = [];
  let buf = '';
  p.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf(String.fromCharCode(10))) >= 0) {
      const linha = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!linha) continue;
      let j; try { j = JSON.parse(linha); } catch { continue; }
      if (j.pronto) { log('transcritor de áudio pronto (' + j.pronto + ')'); continue; }
      const cb = p.esperando.shift(); if (cb) cb(j);
    }
  });
  p.on('exit', () => { log('transcritor parou; religa no próximo áudio'); transcritor = null; for (const cb of p.esperando) cb({ erro: 'parou' }); });
  return p;
}
function transcrever(arquivo) {
  const tarefa = filaAudio.then(() => new Promise((ok) => {
    if (!transcritor) transcritor = iniciarTranscritor();
    const t = setTimeout(() => ok({ erro: 'tempo' }), 120000);
    transcritor.esperando.push((j) => { clearTimeout(t); ok(j); });
    transcritor.stdin.write(arquivo + String.fromCharCode(10));
  }));
  filaAudio = tarefa.catch(() => {});
  return tarefa;
}
// Limite de espera (08/11/2026): getChat, histórico e download de áudio às vezes travam para sempre e a conversa nunca é atendida.
const comLimite = (pr, ms, nome) => Promise.race([pr, new Promise((_, erro) => setTimeout(() => erro(new Error(nome + ' passou de ' + ms / 1000 + ' s')), ms))]);
async function textoDoAudio(msg) {
  if (transcricoes.has(msg.id._serialized)) return transcricoes.get(msg.id._serialized);
  try {
    const media = await comLimite(msg.downloadMedia(), 30000, 'download do áudio');
    if (!media) return null;
    const arq = path.join(__dirname, 'tmp-audio', msg.id.id + '.ogg');
    fs.mkdirSync(path.dirname(arq), { recursive: true });
    fs.writeFileSync(arq, Buffer.from(media.data, 'base64'));
    const r = await transcrever(arq);
    try { fs.unlinkSync(arq); } catch {}
    if (!r.texto) { log('transcrição falhou: ' + (r.erro || 'vazia')); return null; }
    transcricoes.set(msg.id._serialized, r.texto);
    return r.texto;
  } catch (e) { log('áudio não baixou: ' + e.message); return null; }
}

const PASTA = __dirname;
// Variante deste robô (10/11/2026): um robô por número de WhatsApp, cada um na sua pasta (cadastro em Scripts\robos-whats\robos.json).
// Sem variante.json = o robô da revenda de sempre, nas portas 8811 (relatórios) e 8871 (Hub).
const VARIANTE = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'variante.json'), 'utf8')); } catch { return {}; } })();
const PORTA_REL = Number(VARIANTE.porta_relatorios) || 8811;
const PREFIXO_AVISO = VARIANTE.id && VARIANTE.id !== 'revenda' ? '[' + (VARIANTE.nome || VARIANTE.id) + '] ' : '';
const BASE = path.join(PASTA, 'base.md');
const LOG = path.join(PASTA, 'conversas.log');
const PAUSADO = path.join(PASTA, 'pausado');
const TESTE = process.argv.includes('--teste'); // responde só os números em teste.txt

const ESPERA_JUNTAR = 6000;            // junta mensagens seguidas da mesma pessoa
const CALAR_QUANDO_SENHOR_ENTRA = false;
// Follow-up (08/11/2026): cliente sem responder por 7 min recebe UMA mensagem de acompanhamento.
const FOLLOWUP_MIN = [7, 20, 60, 180];   // minutos de silêncio (contados da última mensagem do robô) de cada follow-up: 1º aos 7, 2º aos 20, 3º com 1 h, 4º com 3 h; depois para
const FOLLOWUP_VALIDADE = 5 * 3600e3;  // passou disso (PC dormiu, robô reiniciou), não manda mais
const aguardando = new Map();          // chatId -> quando o robô mandou a última coisa
const seguiuN = new Map();             // chatId -> quantos follow-ups já mandou desde a última resposta do cliente
const seguindo = new Set();            // chatIds recebendo follow-up agora (não reinicia a contagem)
const passouEm = new Map();            // 10/11/2026: chatId -> quando passou ao responsável (a escada não cobra depois de "já passei para o responsável")
const QUIETO_HUMANO = 30 * 60e3;       // senhor respondeu: robô quieto 30 min (#robo devolve na hora)
const QUIETO_AVISO = 5 * 60e3;         // passou pro responsável: quieto 5 min (era 30; o cliente que pergunta de novo no silêncio é respondido ao voltar)
const INICIO = Math.floor(Date.now() / 1000);
const AUDIO_BOAS_VINDAS = path.join(PASTA, 'audios', 'boasvindas.ogg');
const SAUDADOS = path.join(PASTA, 'saudados.json'); // quem já recebeu o áudio de boas-vindas
let saudados = new Set();
try { saudados = new Set(JSON.parse(fs.readFileSync(SAUDADOS, 'utf8'))); } catch {}
const VIDEOS = JSON.parse(fs.readFileSync(path.join(PASTA, 'videos.json'), 'utf8'));
const VIDEOS_ENVIADOS = path.join(PASTA, 'videos-enviados.json'); // não repetir vídeo na mesma conversa
let videosEnviados = {};
try { videosEnviados = JSON.parse(fs.readFileSync(VIDEOS_ENVIADOS, 'utf8')); } catch {}
// ---------- Memória: ficha de cada cliente (clientes.json) ----------
const FICHAS = path.join(PASTA, 'clientes.json');
let fichas = {};
try { fichas = JSON.parse(fs.readFileSync(FICHAS, 'utf8')); } catch {}
function ficha(id) { return fichas[id] || (fichas[id] = { criado_em: new Date().toISOString(), notas: [] }); }
function salvarFichas() { try { fs.writeFileSync(FICHAS + '.tmp', JSON.stringify(fichas, null, 1)); fs.renameSync(FICHAS + '.tmp', FICHAS); } catch (e) { log('ficha não salvou: ' + e.message); } }
const CAMPOS_MEMORIA = ['etapa', 'publico', 'ja_revende', 'qtd_clientes', 'aparelhos', 'painel_criado', 'usuario_painel', 'cidade', 'interesse', 'resumo', 'ciente_pagamento'];
function atualizarFicha(id, mem) {
  if (!mem || typeof mem !== 'object') return;
  const f = ficha(id);
  const etapaAntes = f.etapa;
  for (const k of CAMPOS_MEMORIA) if (mem[k] !== undefined && mem[k] !== null && mem[k] !== '') f[k] = mem[k];
  // Etapa virou painel_criado (o cliente disse que criou): conta como painel fechado.
  if (f.etapa === 'painel_criado' && etapaAntes !== 'painel_criado') { try { fecharPainel(id, f.nome, f.usuario_painel, 'etapa'); } catch (e) { erroEv('fecharPainel', e, id); } }
  if (mem.nota) { f.notas.push(`${new Date().toLocaleDateString('pt-BR')}: ${String(mem.nota).slice(0, 200)}`); f.notas = f.notas.slice(-15); }
}

const GUIAS_ARQ = 'D:/CAPY/Guias TV/guias.json';
let GUIAS = {};
try { GUIAS = JSON.parse(fs.readFileSync(GUIAS_ARQ, 'utf8')); } catch (e) { console.log('guias não carregaram: ' + e.message); }
const catalogoGuias = () => Object.entries(GUIAS).map(([k, g]) => `- ${k}: ${g.titulo}. Como reconhecer: ${g.quando}`).join(String.fromCharCode(10));

function marcarSaudado(id) { saudados.add(id); fs.writeFileSync(SAUDADOS, JSON.stringify([...saudados])); }

const enviadasPeloRobo = new Set();
const textosDoRobo = new Set();
const roboEnviando = new Map(); // chatId -> até quando o robô está mandando algo (texto, áudio, vídeo)
const marcarEnvio = (id) => { if (!seguindo.has(id)) { aguardando.set(id, Date.now()); seguiuN.delete(id); } return roboEnviando.set(id, Date.now() + 15000); }; // texto marcado antes de enviar (o evento chega antes do id)
const QUIETO_ARQ = path.join(__dirname, 'quieto.json');
const quieto = new Map(Object.entries((() => { try { return JSON.parse(fs.readFileSync(QUIETO_ARQ, 'utf8')); } catch { return {}; } })()));
const _set = quieto.set.bind(quieto);
quieto.set = (k, v) => { _set(k, v); try { fs.writeFileSync(QUIETO_ARQ, JSON.stringify(Object.fromEntries(quieto))); } catch {} return quieto; };
const fila = new Map();     // chatId -> { timer, msgs }

function log(t) {
  const linha = `[${new Date().toLocaleString('pt-BR')}] ${t}`;
  console.log(linha);
  fs.appendFileSync(LOG, linha + '\n');
}

// ---------- Telegram (aviso para o senhor) ----------
function tokenTelegram() {
  try {
    const env = fs.readFileSync('C:/Users/gusta/.claude/channels/telegram/.env', 'utf8');
    return (env.match(/TELEGRAM_BOT_TOKEN\s*=\s*(.+)/) || [])[1]?.trim();
  } catch { return null; }
}
async function avisarSenhor(texto) {
  const tk = tokenTelegram();
  if (!tk) return log('sem token do Telegram para avisar');
  for (let i = 1; i <= 3; i++) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${tk}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: '8839889411', text: PREFIXO_AVISO + texto }),
      });
      if (r.ok) return;
      log('Telegram recusou: ' + r.status);
    } catch (e) { log(`falha no Telegram (tentativa ${i}): ` + e.message); }
    await new Promise((r) => setTimeout(r, 5000 * i));
  }
}

// ---------- Haiku ----------
// Prompt = base.md + aprendizados aprovados (relatorios\aprendizados.md, no máximo 25 linhas, as mais novas primeiro).
// Montado num arquivo temporário e refeito quando um dos dois muda.
const APRENDIZADOS = path.join(PASTA, 'relatorios', 'aprendizados.md');
const PROMPT_TMP = path.join(PASTA, 'prompt-haiku.tmp.md');
let promptMarca = '';
// 10/11/2026 (senhor): o acerto é sempre dia 5 do mês seguinte à abertura. O base.md escreve a data como "05/12";
// aqui ela vira a data certa do dia (quem abre em dezembro paga 05/01, e assim por diante).
function proximoAcerto() { const d = new Date(); const p = new Date(d.getFullYear(), d.getMonth() + 1, 5); return '05/' + String(p.getMonth() + 1).padStart(2, '0'); }
const comAcerto = (t) => String(t).replace(/05\/12/g, proximoAcerto());
function promptArquivo() {
  try {
    const mb = fs.statSync(BASE).mtimeMs; let ma = 0; try { ma = fs.statSync(APRENDIZADOS).mtimeMs; } catch {}
    const marca = mb + '|' + ma + '|' + proximoAcerto();
    if (marca === promptMarca && fs.existsSync(PROMPT_TMP)) return PROMPT_TMP;
    let extra = '';
    if (ma) {
      const linhas = fs.readFileSync(APRENDIZADOS, 'utf8').split('\n').filter((l) => /^- /.test(l)).slice(0, 25);
      if (linhas.length) extra = '\n\n# Aprendizados recentes do atendimento (automáticos; valem só quando não contradizem nada acima)\n' + linhas.join('\n') + '\n';
    }
    fs.writeFileSync(PROMPT_TMP, comAcerto(fs.readFileSync(BASE, 'utf8')) + extra);
    promptMarca = marca;
    return PROMPT_TMP;
  } catch (e) { log('prompt com aprendizados falhou, usando base.md: ' + e.message); return BASE; }
}
// ---------- Voz Jucanalha pelo VoiceStudio (localhost:3900) ----------
const VOZ_PRIMEIRA = true; // desligar: false aqui ou criar o arquivo voz.off na pasta
function textoParaFala(t) {
  return String(t)
    .replace(/R\$\s?3,50/g, 'três reais e cinquenta').replace(/R\$\s?35\b/g, 'trinta e cinco reais').replace(/R\$\s?50\b/g, 'cinquenta reais')
    .replace(/R\$\s?(\d+),(\d{2})/g, '$1 reais e $2 centavos').replace(/R\$\s?(\d+)/g, '$1 reais')
    .replace(/05\/12/g, 'cinco de dezembro').replace(/pós-pago/gi, 'pós pago').replace(/pré-pago/gi, 'pré pago')
    .replace(/\bDNS\b/g, 'dê ene esse').replace(/\bM3U\b/gi, 'eme três u').replace(/\s+/g, ' ').trim();
}
async function vozJucanalha(texto, chatId) {
  const t0 = Date.now(), fala = textoParaFala(texto);
  try {
    const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 90000);
    const r = await fetch('http://localhost:3900/v1/audio/speech', { method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'tts-1', voice: '07c54faf', input: fala, response_format: 'wav', num_step: 32, guidance_scale: 2, speed: 0.95 }) });
    clearTimeout(tm);
    if (!r.ok) throw new Error('VoiceStudio ' + r.status);
    const base = path.join(PASTA, 'tmp-audio', 'voz-' + String(chatId).replace(/\W/g, '') + '-' + Date.now());
    fs.writeFileSync(base + '.wav', Buffer.from(await r.arrayBuffer()));
    await new Promise((ok, erro) => exec(`ffmpeg -y -loglevel error -i "${base}.wav" -c:a libopus -b:a 32k -ac 1 -ar 48000 "${base}.ogg"`, { windowsHide: true }, (e) => (e ? erro(e) : ok())));
    fs.unlink(base + '.wav', () => {});
    evento('voz_gerada', chatId, '', { ms: Date.now() - t0, chars: fala.length, ok: true });
    return base + '.ogg';
  } catch (e) { log('voz Jucanalha indisponível (' + e.message + '): resposta vai em texto'); evento('voz_gerada', chatId, '', { ms: Date.now() - t0, chars: fala.length, ok: false, erro: String(e.message).slice(0, 80) }); return null; }
}
// ---------- Parceirinhos (pedido do senhor, 09/11/2026) ----------
// Ramirez Campari (2 números) e Espinhaço (Felipe Felix): chamados de "parceirinho", atendidos pelo Sonnet,
// que lê todas as dúvidas, analisa e pode pesquisar na internet (WebSearch/WebFetch). Sem follow-up automático.
const PARCEIRINHOS = {
  ids: ['175905469145166@lid', '64656488063041@lid', '48774319714522@lid'],
  telefones: ['5511918433749', '5519997471743', '554198663243'],
};
function ehParceirinho(chatId) {
  if (PARCEIRINHOS.ids.includes(chatId)) return true;
  const tel = String((fichas[chatId] || {}).telefone_real || String(chatId).split('@')[0]);
  return PARCEIRINHOS.telefones.includes(tel);
}
// ---------- O dono (pedido do senhor, 10/11/2026): o número 11 98364-0724 é o próprio Gustavo ----------
const DONO = { telefones: ['5511983640724'] };
function ehDono(chatId) {
  const tel = String((fichas[chatId] || {}).telefone_real || String(chatId).split('@')[0]);
  return DONO.telefones.includes(tel);
}
const NOTA_DONO = 'REGRA DO DONO PARA ESTE CONTATO (10/11/2026, vale acima do texto base): quem escreve agora é o PRÓPRIO DONO da Capy (Gustavo), não um cliente. Trate por "senhor", de forma curta e direta, em português. Nunca ofereça teste, preço, painel nem roteiro de venda, não mande figurinha e não passe ao responsável (ele é o responsável). Responda ao que ele pedir ou perguntar com base no texto base e na ficha; se ele mandar uma instrução, confirme em uma frase. Responda no formato JSON pedido.';
const NOTA_PARCEIRINHO = 'REGRA DO DONO PARA ESTE CONTATO (09/11/2026, vale acima de qualquer regra de tratamento do texto base): esta pessoa é um PARCEIRINHO, parceiro de confiança do dono. Chame SEMPRE de "parceirinho" (ex.: "Fala, parceirinho!", "Parceirinho, funciona assim..."), nunca de "mestre" e nunca pelo nome. Leia TODAS as dúvidas das últimas mensagens dele, analise com calma e entenda o que ele quer de fato antes de responder; responda cada dúvida. Se precisar confirmar algo técnico (app, TV, aparelho, DNS, erro, configuração) ou que não está no texto base, PESQUISE na internet com WebSearch/WebFetch e responda com base no que achou, de forma simples. Você tem o aval do dono para pesquisar e responder; só passe ao responsável (avisar) o que for pagamento, comprovante, preço ou condição comercial nova que não está no texto base. Pode usar até 6 mensagens curtas. Não ofereça teste grátis nem o roteiro de venda, a não ser que ele peça. Responda no formato JSON pedido.';

// ---------- Alerta vermelho (pedido do senhor, 09/11/2026) ----------
// Revendedor quer cancelar o painel, pede reembolso, fala em golpe ou está bravo: a conversa troca para o Sonnet 5.5,
// que atende cordial e rápido, em frases curtas, para resolver. Quando o Sonnet marca "resolvido": true, a conversa volta ao Haiku;
// se nunca marcar, o alerta vence em 2 h (as próximas mensagens
// seguem no Sonnet) e o senhor é avisado no Telegram uma vez por alerta.
const MODELO_ALERTA = 'claude-sonnet-5-5';
// 10/11/2026 (senhor): "sobe a conversa dele pro Opus e resolve". escalados.json = {"<chatId>": {"modelo":"claude-opus-5-5","desde":"..."}}.
// Enquanto estiver aí, a conversa é atendida pelo modelo forte, com atenção total; quando ele marca "resolvido": true, volta ao Haiku.
const ESCALADOS = path.join(PASTA, 'escalados.json');
const lerEscalados = () => { try { return JSON.parse(fs.readFileSync(ESCALADOS, 'utf8')); } catch { return {}; } };
const NOTA_ESCALADA = 'CONVERSA ESCALADA PELO DONO (10/11/2026): o dono pediu atenção total a este cliente. Leia o histórico inteiro, entenda o aparelho real dele (marca, se é Android ou não, se tem Google Play) e resolva o problema de instalação com o caminho certo da base e dos guias, passo a passo detalhado, um passo por mensagem curta, sem emoji. Se faltar um dado, pergunte UMA coisa só (por exemplo a marca e o modelo da TV). Não repita instrução que já falhou e não discuta com o cliente. Quando o problema estiver resolvido ou o cliente confirmar que funcionou, devolva "resolvido": true.';
const ALERTA_DURA = 2 * 60 * 60e3;
const RX_ALERTA = /cancel|desist|encerr|quero sair|vou sair|parar de usar|n[aã]o quero mais|n[aã]o vou mais|reembols|estorn|devolv\w* (o |meu )?dinheiro|meu dinheiro de volta|golpe|engan|procon|reclame ?aqui|absurd|p[eé]ssim|palha[cç]ada|vergonha|horr[ií]vel|decepcion|insatisfeit|lixo|n[aã]o funciona nada|vou trocar de|outro fornecedor|nunca mais/i;
function ehAlertaVermelho(chatId, textoCliente) {
  const fx = fichas[chatId] || {};
  if (fx.alerta_vermelho && Date.now() - Date.parse(fx.alerta_vermelho) < ALERTA_DURA) return 'continua';
  return RX_ALERTA.test(String(textoCliente || '')) ? 'novo' : null;
}
const NOTA_ALERTA = 'ALERTA VERMELHO (regra do dono, 09/11/2026, vale acima do texto base): este revendedor está querendo cancelar o painel, reclamando ou insatisfeito. Atenda de forma CORDIAL e RÁPIDA: frases curtas e calmas, no máximo 3 mensagens, sem textão, sem discutir e sem pressionar. Primeiro acolha ("Entendo, mestre. Vamos resolver."), depois pergunte objetivamente o que aconteceu ou qual é o problema, e já ofereça a solução que estiver no texto base (técnica, de uso ou de cobrança). Nunca prometa reembolso, desconto, prazo ou cancelamento feito: se a pessoa insistir em cancelar, pedir dinheiro de volta ou precisar de algo que só o responsável faz, diga "Certo, mestre. Já passei para o responsável resolver com você agora." e marque "avisar": true com o motivo. Não use "Certo, já vou passar para o responsável" como primeira resposta: tente resolver antes. VOLTA AO NORMAL (regra do dono, 09/11/2026): acrescente no JSON o campo "resolvido". Marque "resolvido": true SÓ quando a dificuldade estiver sanada: o problema foi resolvido, a pessoa confirmou que voltou a funcionar, desistiu de cancelar, se acalmou e agradeceu, ou o caso já foi passado ao responsável e ela aceitou. Enquanto a pessoa ainda estiver brava, com o problema aberto ou falando em cancelar, use "resolvido": false. Responda no formato JSON pedido.';

function perguntarHaiku(conversa, area, opc = {}) {
  area = area || (/^TAREFA ESPECIAL \(follow-up\)/m.test(conversa) ? 'followup' : 'responder');
  const modelo = opc.modelo || 'haiku';
  return new Promise((resolve) => {
    const args = ['-p', '--model', modelo, '--setting-sources', '""',
      '--system-prompt-file', promptArquivo(), '--tools', opc.pesquisa ? 'WebSearch,WebFetch' : '""',
      ...(opc.pesquisa ? ['--allowedTools', 'WebSearch,WebFetch'] : []),
      '--no-session-persistence', '--strict-mcp-config', '--output-format', 'json'];
    const p = spawn('claude.cmd', args, { cwd: PASTA, shell: true, windowsHide: true });
    let out = '';
    const t = setTimeout(() => { p.kill(); resolve(null); }, opc.pesquisa ? 240000 : 60000);
    p.stdout.on('data', (d) => (out += d));
    p.on('close', () => {
      clearTimeout(t);
      const m = require('./uso-ia.js').desembrulhar(out, area, modelo).match(/\{[\s\S]*\}/);
      try { resolve(m ? JSON.parse(m[0]) : null); } catch { resolve(null); }
    });
    p.stdin.end(conversa);
  });
}

function limpar(texto) {
  return String(texto || '')
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '') // sem emoji
    .replace(/[*~`]/g, '')
    .replace(/(^|\s)_+|_+(?=\s|$)/g, '$1') // "_" de formatação (negrito/itálico) sai; o de dentro de link e palavra fica
    .replace(/t\.me\/manual[_ ]?do[_ ]?revenda/gi, 't.me/manual_do_revenda') // link certo do Manual (por último, para o "_" não ser apagado)
    .replace(/[ \t]+\n/g, '\n').trim();
}

// ---------- WhatsApp ----------
const client = new Client({
  authStrategy: new LocalAuth({ clientId: 'revenda', dataPath: path.join(PASTA, 'sessao') }),
  puppeteer: {
    headless: true,
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    args: ['--no-sandbox', '--disable-gpu'],
  },
});

client.on('qr', async (qr) => {
  const arq = path.join(PASTA, 'qr.png');
  await QRCode.toFile(arq, qr, { width: 480, margin: 2 });
  log('QR novo em ' + arq + ' (escanear com o celular da revenda)');
  if (!client._qrAberto) { client._qrAberto = true; exec(`start "" "${arq}"`); }
});
client.on('authenticated', () => log('conectado ao WhatsApp'));
// Figurinhas da capivara (10/11/2026, pedido do senhor): módulo figurinhas.js, pacote em D:\CAPY\Figurinhas. Desligar: figurinhas.off.
const FIG = require('./figurinhas.js').criarFigurinhas({ client, MessageMedia, log, evento, ficha, salvarFichas, desligado, marcarEnvio, enviadasPeloRobo, PASTA, nomeDe });
// Vitrine do cliente final (10/11/2026): artes de conteúdo para quem quer assistir (vitrine.js). Campo "vitrine" do Haiku.
const VIT = require('./vitrine.js').criarVitrine({ client, MessageMedia, log, marcarEnvio, enviadasPeloRobo, textosDoRobo });
const figurinhaDeOi = () => { const h = new Date().getHours(); return h >= 5 && h < 12 ? 'bom_dia' : 'oi_mestre'; };
// 09/11/2026: se autenticou e não ficou pronto em 4 min, reinicia (o ligar.ps1 religa). Antes ficava preso sem vigia.
let _prontoOk = false; client.on('ready', () => { _prontoOk = true; });
client.on('authenticated', () => setTimeout(() => { if (!_prontoOk) { log('WhatsApp não ficou pronto em 4 min: reiniciando'); process.exit(1); } }, 240000));
client.on('loading_screen', (p, m) => log(`carregando WhatsApp ${p}% ${m || ''}`));
client.on('change_state', (e) => log('estado do WhatsApp: ' + e));
client.on('auth_failure', (m) => log('falha de login: ' + m));
client.on('ready', () => {
  log('robô da revenda LIGADO' + (TESTE ? ' (modo teste)' : ''));
  try { fs.unlinkSync(path.join(PASTA, 'qr.png')); } catch {}
  avisarSenhor('Robô da revenda ligado no WhatsApp 11 97052-1624.');
});
client.on('disconnected', (r) => {
  log('desconectado: ' + r);
  avisarSenhor('Robô da revenda caiu do WhatsApp (' + r + '). Precisa escanear o QR de novo.');
  setTimeout(() => process.exit(1), 2000);
});

function conversaValida(id) {
  return /@(c\.us|lid)$/.test(id);  // só conversa individual (sem grupo, status, canal)
}
function numerosTeste() {
  try { return fs.readFileSync(path.join(PASTA, 'teste.txt'), 'utf8').split(/\s+/).filter(Boolean); }
  catch { return []; }
}

// Senhor respondeu na mão: robô sai da conversa por 2h.
client.on('message_create', (msg) => {
  if (!msg.fromMe || enviadasPeloRobo.has(msg.id._serialized) || textosDoRobo.has(msg.body)) return;
  if ((roboEnviando.get(msg.to) || 0) > Date.now()) return;
  // Só conta como "senhor respondeu" mensagem digitada/gravada por gente. A boas-vindas automática do
  // anúncio (automated_greeting_message) e avisos do WhatsApp não calam o robô.
  if (!['chat', 'ptt', 'audio', 'image', 'video', 'document'].includes(msg.type)) return;
  if (/^\s*#robo\s*$/i.test(msg.body || '')) {
    quieto.set(msg.to, 0);
    msg.delete(true).catch(() => {});
    log(`senhor devolveu ${msg.to} ao robô (#robo)`);
    return;
  }
  if (!conversaValida(msg.to)) return;
  // 08/11/2026: o senhor pediu que o robô NÃO saia da conversa quando ele entra (precisa acompanhar o processo).
  // Para voltar ao antigo (quieto 30 min), trocar CALAR_QUANDO_SENHOR_ENTRA para true.
  aguardando.delete(msg.to); // o senhor está na conversa: sem follow-up do robô
  ULTIMO_SENHOR.set(msg.to, Date.now());
  try { if (lac) lac.cancelarRetornos(msg.to); } catch {}   // o senhor respondeu: retorno de lacuna dessa pessoa cancelado
  evento('senhor_escreveu', msg.to, nomeDe(msg.to), { msg_tipo: msg.type });
  if (!CALAR_QUANDO_SENHOR_ENTRA) { log(`senhor escreveu em ${msg.to}: robô continua ativo`); return; }
  quieto.set(msg.to, Date.now() + QUIETO_HUMANO);
  log(`senhor respondeu ${msg.to}: robô quieto 30 min nessa conversa`);
});

// Lista dos revendedores que fecharam painel. Arquivo: revendedores.json (chave = id da conversa). Nunca guarda senha.
// Campos: nome, telefone (real, quando conhecido), telefone_lid, usuario_painel, fechou_em (ISO), fonte (usuario_senha|etapa),
// origem (robo|senhor), painel_id (id do revendedor no painel, hashid), painel_numero (ordem de criação no painel), contato_salvo.
const REVENDEDORES = path.join(__dirname, 'revendedores.json');
const paraIso = (s) => { const m = String(s || '').match(/(\d+)\/(\d+)\/(\d+),? (\d+):(\d+):(\d+)/); return m ? new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +m[6]).toISOString() : null; };
function fecharPainel(id, nome, usuario, fonte) {
  if (VARIANTE.foco === 'cliente_final') return;   // revisão 10/11/2026: cliente final não é revendedor (sem kit, figurinha de painel nem revendedores.json)
  const lista = lerJson(REVENDEDORES, {});
  const antigo = lista[id] || {};
  const novo = !antigo.fechou_em && !antigo.criado_em;
  const noSenhor = Date.now() - (ULTIMO_SENHOR.get(id) || 0) < 30 * 60e3;
  lista[id] = {
    nome: nome || antigo.nome || '',
    telefone: antigo.telefone || fichas[id]?.telefone_real || null,
    telefone_lid: id.split('@')[0],
    usuario_painel: usuario || antigo.usuario_painel || null,
    fechou_em: antigo.fechou_em || paraIso(antigo.criado_em) || new Date().toISOString(),
    fonte: antigo.fonte || fonte,
    origem: antigo.origem || (noSenhor ? 'senhor' : 'robo'),
    painel_id: antigo.painel_id ?? null,
    painel_numero: antigo.painel_numero ?? null,
    ...(antigo.contato_salvo ? { contato_salvo: antigo.contato_salvo } : {}),
  };
  try { fs.writeFileSync(REVENDEDORES, JSON.stringify(lista, null, 1)); } catch (e) { log('revendedores.json não salvou: ' + e.message); erroEv('revendedores.json', e, id); return; }
  if (novo) {
    log(`painel fechado: ${nome} (${lista[id].usuario_painel || 'usuário ainda não informado'}) [${fonte}]`);
    evento('painel_fechado', id, nome, { usuario_painel: lista[id].usuario_painel, painel_id: null, fonte, origem: lista[id].origem });
    // Figurinha "PAINEL CRIADO!" só para quem conversou nas últimas 48 h (a sincronização não pode cutucar painel antigo), 8h-22h.
    const h = new Date().getHours();
    if (h >= 8 && h < 22 && Date.now() - Date.parse(fichas[id]?.ultimo_contato || 0) < 48 * 3600e3) setTimeout(() => FIG.mandar(id, 'painel_criado', 'sistema', 'painel fechado'), 4000);
    // 10/11/2026 (senhor: "assim que alguém abrir painel, você tem que enviar a Escola e o site de criativos, sempre"): kit pós-painel, uma vez por conversa.
    if (Date.now() - Date.parse(fichas[id]?.ultimo_contato || 0) < 72 * 3600e3) setTimeout(() => enviarKitPosPainel(id, nome).catch((e) => { log('kit pós-painel falhou: ' + (e.message || e)); erroEv('kit_pos_painel', e, id); }), 90000);
  }
  setTimeout(() => sincronizarPainel(true).catch((e) => erroEv('sincronizarPainel', e)), 5000);
}
const registrarRevendedor = (id, nome, usuario) => fecharPainel(id, nome, usuario, 'usuario_senha');
// Kit pós-painel: Escola do Revendedor + site de criativos, com explicação curta. Uma vez por conversa (ficha.kit_pos_painel).
// Respeita robô pausado/desligado e a janela das 8h às 22h (fora dela, a mensagem sai às 8h pelo ciclo do kit).
const KIT_POS_PAINEL = [
  'Parabéns pelo painel, mestre! Agora o que faz você vender de verdade: a Escola do Revendedor.',
  'Ela tem aulas curtas de como cadastrar clientes, usar o painel e conseguir clientes. É só entrar e seguir na ordem:',
  'https://escola.capyapp.net',
  'E para divulgar sem precisar desenhar nada, temos o site de criativos: artes prontas com preço para você postar no status, nos grupos e nos anúncios. É só escolher, baixar e postar:',
  'https://criativos.capyapp.net',
  'Se travar em algum passo, me chama aqui.',
];
async function enviarKitPosPainel(id, nome) {
  const f = ficha(id);
  if (f.kit_pos_painel) return;
  if (fs.existsSync(PAUSADO) || desligado(id)) return;
  const h = new Date().getHours();
  if (h < 8 || h >= 22) { f.kit_pos_painel_pendente = true; salvarFichas(); return; }
  if (atendendo.has(id) || fila.has(id)) { setTimeout(() => enviarKitPosPainel(id, nome).catch(() => {}), 30000); return; }
  f.kit_pos_painel = new Date().toISOString(); delete f.kit_pos_painel_pendente; salvarFichas();
  const chat = await client.getChatById(id).catch(() => null);
  for (const texto of KIT_POS_PAINEL) { await enviar(chat, texto, id); await new Promise((r) => setTimeout(r, 2500)); }
  log(`robô -> ${nome}: [kit pós-painel: Escola + criativos]`);
  evento('kit_pos_painel', id, nome, {});
}
setInterval(() => { try { const h = new Date().getHours(); if (h < 8 || h >= 22) return; for (const [id, f] of Object.entries(fichas)) if (f && f.kit_pos_painel_pendente && !f.kit_pos_painel) enviarKitPosPainel(id, f.nome || id).catch(() => {}); } catch {} }, 5 * 60e3);


// Telefone real de cada conversa (o WhatsApp novo usa @lid; o número de verdade vem do mapeamento lid -> telefone).
async function resolverTelefones(ids) {
  const alvo = (ids || Object.keys(fichas)).filter((id) => conversaValida(id) && !fichas[id]?.telefone_real).slice(0, 60);
  let achou = 0;
  for (let i = 0; i < alvo.length; i += 10) {
    const lote = alvo.slice(i, i + 10);
    try {
      const r = await client.getContactLidAndPhone(lote);
      lote.forEach((id, k) => { const pn = r?.[k]?.pn; if (pn) { fichas[id].telefone_real = pn.split('@')[0].replace(/\D/g, ''); achou++; } });
    } catch (e) { log('telefone real não resolveu: ' + e.message); break; }
  }
  if (achou) salvarFichas();
  return achou;
}

// Casa os revendedores fechados com o painel (id e número), completa o telefone e salva o contato. Só lê o painel.
let sincronizando = false, ultimaSincPainel = 0;
async function sincronizarPainel(forcar) {
  if (VARIANTE.foco === 'cliente_final') return;   // revisão 10/11/2026: cliente final não é revendedor (não abre o painel nem salva contato)
  if (sincronizando || !client.pupPage) return;
  const lista = lerJson(REVENDEDORES, {});
  const pendente = Object.values(lista).some((r) => !r.painel_id || (SALVAR_CONTATO && !r.contato_salvo));
  if (!forcar && Date.now() - ultimaSincPainel < (pendente ? 15 : 30) * 60e3) return;
  sincronizando = true;
  try {
    await resolverTelefones(Object.keys(lista));
    for (const [id, r] of Object.entries(lista)) if (!r.telefone && fichas[id]?.telefone_real) r.telefone = fichas[id].telefone_real;
    const painel = await painelRev.listarRevendedores();
    ultimaSincPainel = Date.now();
    let mudou = false;
    for (const [id, r] of Object.entries(lista)) {
      const p = painelRev.casar(r, painel);
      if (!p) continue;
      if (r.painel_id !== p.id || r.painel_numero !== p.numero) { r.painel_id = p.id; r.painel_numero = p.numero; mudou = true; }
      if (!r.usuario_painel) { r.usuario_painel = p.username || p.email; mudou = true; }
      if (!r.telefone && p.whatsapp) { r.telefone = p.whatsapp; mudou = true; }
      // Uso do painel para a jornada do revendedor (só leitura): o painel abre com 500 créditos; usados = 500 - saldo.
      if (p.creditos != null) { r.uso = { saldo: p.creditos, usados: Math.max(0, 500 - p.creditos), ultimo_login: p.ultimo_login || null, lido_em: new Date().toISOString() }; mudou = true; }
    }
    // Painéis criados por quem recebeu o link mas não avisou o robô (telefone da conversa = telefone do painel).
    const semAviso = [];
    const fechados = new Set(Object.values(lista).map((r) => r.painel_id).filter(Boolean));
    for (const [id, f] of Object.entries(fichas)) {
      if (!f.telefone_real || lista[id]) continue;
      const p = painelRev.casar({ telefone: f.telefone_real }, painel);
      if (p && !fechados.has(p.id) && Date.parse(p.criado_em) >= Date.parse(f.criado_em || 0)) semAviso.push({ chat: id, nome: f.nome || null, usuario: p.username || p.email || null, painel_id: p.id, painel_numero: p.numero, criado_no_painel: p.criado_em });
    }
    try { fs.writeFileSync(path.join(PASTA, 'painel-sync.json'), JSON.stringify({ atualizado_em: new Date().toISOString(), total_no_painel: painel.length, criados_sem_avisar: semAviso }, null, 1)); } catch {}
    // Contato no WhatsApp: "Nome · painel N" (nome + número do painel).
    if (SALVAR_CONTATO) {
      for (const [id, r] of Object.entries(lista)) {
        if (r.contato_salvo || !r.painel_numero || !r.telefone) continue;
        const primeiro = String(r.nome || '').trim() || 'Revendedor', sobrenome = `· painel ${r.painel_numero}`;
        try {
          await client.saveOrEditAddressbookContact(String(r.telefone).replace(/\D/g, ''), primeiro, sobrenome, SINCRONIZAR_AGENDA);
          r.contato_salvo = `${primeiro} ${sobrenome}`; mudou = true;
          log(`contato salvo no WhatsApp: ${r.contato_salvo}`);
        } catch (e) { log(`contato não salvou (${primeiro}): ${e.message}`); erroEv('salvar_contato', e, id); }
      }
    }
    // Relê antes de gravar (um fechamento novo pode ter entrado durante a consulta ao painel).
    const atual = lerJson(REVENDEDORES, {});
    for (const [id, r] of Object.entries(lista)) atual[id] = { ...(atual[id] || {}), ...r };
    fs.writeFileSync(REVENDEDORES, JSON.stringify(atual, null, 1));
    log(`painéis sincronizados: ${Object.values(atual).filter((r) => r.painel_id).length}/${Object.keys(atual).length} com id${semAviso.length ? ', ' + semAviso.length + ' criado(s) no painel sem avisar o robô' : ''}`);
  } catch (e) { log('sincronizar painel falhou: ' + e.message); erroEv('sincronizarPainel', e); }
  finally { sincronizando = false; }
  // 08/11/2026 (pedido do senhor): quem criou o painel pelo link do robô, mesmo sem avisar, também conta como painel fechado.
  try {
    const sync = lerJson(path.join(PASTA, 'painel-sync.json'), {});
    for (const s of sync.criados_sem_avisar || []) if (!lerJson(REVENDEDORES, {})[s.chat]) fecharPainel(s.chat, s.nome, s.usuario, 'painel');
  } catch (e) { erroEv('fechar_sem_avisar', e); }
}
// Evento de cada mensagem do cliente + resposta a follow-up (quando o cliente volta depois de um acompanhamento).
function registrarMensagemCliente(msg, daVarredura) {
  try {
    const id = msg.from, texto = msg.type === 'chat' ? String(msg.body || '') : '[' + msg.type + ']';
    const t = new Date((msg.timestamp || Date.now() / 1000) * 1000).toISOString();
    const chave = id + '|' + texto.slice(0, 600);
    if (daVarredura && msgsContadas.has(chave)) return;   // a varredura reencontra mensagens que já foram contadas
    msgsContadas.add(chave);
    const nome = nomeDe(id) || msg._data?.notifyName || null;
    evento('mensagem_cliente', id, nome, { t, msg_tipo: msg.type, texto, ...(daVarredura ? { varredura: true } : {}) });
    const fu = followupAberto.get(id);
    if (fu) {
      followupAberto.delete(id);
      evento('cliente_respondeu_followup', id, nome, { t, n: fu.n, followup_t: fu.t, variante: fu.v || null, minutos_ate_resposta: Math.max(0, Math.round((Date.parse(t) - Date.parse(fu.t)) / 6000) / 10) });
    }
  } catch (e) { erroEv('registrarMensagemCliente', e); }
}
const vistas = new Set(); // ids de mensagens já tratadas (evento ou varredura)
client.on('message', (msg) => receber(msg, false));
function receber(msg, daVarredura) {
  if (msg.fromMe || !conversaValida(msg.from)) return;
  if (!daVarredura && msg.timestamp < INICIO - 60) return;
  if (vistas.has(msg.id._serialized)) return;
  vistas.add(msg.id._serialized);
  if (['chat', 'ptt', 'audio', 'image', 'document', 'video'].includes(msg.type)) { aguardando.delete(msg.from); seguiuN.delete(msg.from); registrarMensagemCliente(msg, daVarredura); try { const b = bl(); if (b && b.aoReceber) b.aoReceber(blCtx, msg.from, msg.timestamp); } catch {} try { const m = fu(); if (m && m.aoReceber) m.aoReceber(blCtx, msg.from, msg.timestamp, msg.type === 'chat' ? msg.body : ''); } catch {} }
  // Revendedor que criou o painel manda "Usuário: ... Senha: ...": guarda o usuário (nunca a senha) no contato dele.
  const mu = msg.type === 'chat' && /Senha:/i.test(msg.body || '') && String(msg.body).match(/Usu[aá]rio:\s*(\S+)/i);
  if (mu) {
    const fr = ficha(msg.from);
    fr.usuario_painel = mu[1]; fr.painel_criado = true; fr.etapa = 'painel_criado';
    registrarRevendedor(msg.from, fr.nome || msg._data?.notifyName || '', mu[1]);
    salvarFichas();
  }
  // Pausado ou em silêncio: a mensagem NÃO fica como "vista", para a varredura pegar de novo quando o robô voltar a falar.
  if (fs.existsSync(PAUSADO)) { vistas.delete(msg.id._serialized); return; }
  if (TESTE && !numerosTeste().some((n) => msg.from.includes(n))) return;
  if ((quieto.get(msg.from) || 0) > Date.now()) { vistas.delete(msg.id._serialized); return; }
  if (desligado(msg.from)) return;   // robô desligado nesta conversa (desligados.json)
  // Lista negra (golpistas, decisão do senhor): não responde, não manda link e avisa o senhor uma vez por dia.
  { const ln = LN.bloqueado({ chatId: msg.from, telefone: (fichas[msg.from] || {}).telefone_real });
    if (ln) { const dia = new Date().toISOString().slice(0, 10); if (avisouLN.get(msg.from) !== dia) { avisouLN.set(msg.from, dia); log('LISTA NEGRA: ' + msg.from + ' escreveu e não foi atendido (' + (ln.motivo || 'sem motivo') + ')'); try { avisarSenhor('Lista negra: ' + (ln.nome || msg.from) + ' mandou mensagem e o robô não respondeu. Motivo registrado: ' + (ln.motivo || 'não informado') + '.'); } catch {} } return; } }
  if (daVarredura) log('varredura achou mensagem sem resposta de ' + msg.from);
  // Só mensagem de gente: texto, áudio, foto, arquivo. Avisos do WhatsApp, figurinha, reação etc. ficam de fora.
  if (!['chat', 'ptt', 'audio', 'image', 'document', 'video'].includes(msg.type)) return;
  if (msg.type === 'chat' && !String(msg.body || '').trim()) return;

  // 10/11/2026 (senhor): "a última mensagem é sempre do robô e irrita". Cliente que só concorda/agradece/promete fica sem resposta e sem cobrança por 3 h.
  if (ehFechamento(msg)) { encerradoAte.set(msg.from, Date.now() + FOLGA_FECHAMENTO); aguardando.delete(msg.from); seguiuN.delete(msg.from); log('cliente encerrou/prometeu (' + String(msg.body).slice(0, 30) + '): sem resposta e sem cobrança por 3 h: ' + msg.from); return; }
  encerradoAte.delete(msg.from);
  const f = fila.get(msg.from) || { msgs: [] };
  clearTimeout(f.timer);
  f.msgs.push(msg);
  // Uma conversa por vez: se o robô ainda está respondendo este cliente, espera terminar (senão as respostas saem em dobro).
  const disparar = () => {
    if (atendendo.has(msg.from)) { f.timer = setTimeout(disparar, 2000); return; }
    fila.delete(msg.from);
    atender(msg.from, f.msgs).catch((e) => { log('erro ao atender: ' + (e.stack || e.message)); erroEv('atender', e, msg.from); });
  };
  // 10/11/2026 (senhor): respondia rápido demais e parecia pressão. Agora espera 20 a 40 s antes de responder (e junta o que o cliente mandar nesse tempo).
  f.timer = setTimeout(disparar, ESPERA_JUNTAR + 14000 + Math.floor(Math.random() * 20000));
  fila.set(msg.from, f);
}
const encerradoAte = new Map();        // chatId -> até quando o robô fica quieto porque o cliente só concordou ou prometeu
const FOLGA_FECHAMENTO = 3 * 3600e3;
const ehFechamento = (m) => { try { return !!m && m.type === 'chat' && require('./funil/nucleo.js').ENCERRA.test(String(m.body || '')); } catch { return false; } };
const atendendo = new Set(); // chatIds que o robô está respondendo agora

// Rede de segurança: a cada minuto procura conversa com mensagem não lida (até 3 h) que ficou sem resposta.
// ---------- Varredura de partida (09/11/2026, pedido do senhor: "assim que ligar, ver se não ficou nada pendente") ----------
// ultimo-vivo.json é gravado a cada minuto. Ao ligar, o robô sabe quanto tempo ficou fora e, 3 min depois de conectar
// (a varredura rápida de 3 h já rodou), pede uma releitura do funil cobrindo esse período: mínimo 12 h, máximo 48 h.
const VIVO = path.join(PASTA, 'ultimo-vivo.json');
const HORAS_FORA = (() => { try { return Math.max(0, (Date.now() - JSON.parse(fs.readFileSync(VIVO, 'utf8')).t) / 3600e3); } catch { return 24; } })();
setInterval(() => { try { fs.writeFileSync(VIVO, JSON.stringify({ t: Date.now() })); } catch {} }, 60000);
let releituraPartida = false;
function pedirReleituraPartida() {
  if (releituraPartida || fs.existsSync(PAUSADO)) return;
  releituraPartida = true;
  const horas = Math.min(48, Math.max(12, Math.ceil(HORAS_FORA + 1)));
  try {
    const arq = path.join(PASTA, 'funil', 'comando.json');
    let cmds = []; try { cmds = [].concat(JSON.parse(fs.readFileSync(arq, 'utf8'))).filter(Boolean); } catch {}
    cmds.push({ acao: 'releitura', horas, agir: true, pedido_em: new Date().toISOString(), origem: 'partida' });
    fs.writeFileSync(arq, JSON.stringify(cmds));
    log(`varredura de partida: releitura das últimas ${horas} h pedida (robô ficou ${HORAS_FORA.toFixed(1)} h fora)`);
  } catch (e) { erroEv('releitura_partida', e); }
}
async function varrer() {
  if (fs.existsSync(PAUSADO)) return;
  const chats = await client.getChats();
  const limite = Date.now() / 1000 - 3 * 3600;
  for (const c of chats) {
    if (c.isGroup || !conversaValida(c.id._serialized)) continue;
    const id = c.id._serialized;
    if (fila.has(id) || atendendo.has(id)) continue;
    // Conversa cuja última palavra é do cliente (lida ou não no celular) e ficou sem resposta nas últimas 3 h.
    const lm = c.lastMessage;
    if (!c.unreadCount && (!lm || lm.fromMe || lm.timestamp < limite)) continue;
    const ms = await c.fetchMessages({ limit: 12 }).catch(() => []);
    const pend = [];
    for (let i = ms.length - 1; i >= 0; i--) {
      const m = ms[i];
      if (m.fromMe && m.type !== 'automated_greeting_message') break;   // a partir daqui já foi respondido
      if (!m.fromMe && m.timestamp >= limite) pend.unshift(m);
    }
    for (const m of pend) receber(m, true);
  }
}
// Vigia da conexão: se o WhatsApp não estiver conectado em 2 conferências seguidas, reinicia (o ligar.ps1 religa).
let falhasConexao = 0;
async function vigiar() {
  const estado = await Promise.race([client.getState().catch(() => null), new Promise((ok) => setTimeout(() => ok('SEM_RESPOSTA'), 20000))]);
  if (estado === 'CONNECTED') { falhasConexao = 0; return; }
  falhasConexao++;
  log('conexão estranha: ' + estado + ' (' + falhasConexao + ')');
  if (falhasConexao >= 2) {
    log('WhatsApp travado: reiniciando o robô');
    await avisarSenhor('Robô da revenda travou na conexão com o WhatsApp e está reiniciando sozinho.');
    process.exit(1);
  }
}
// Vigia de leads (funil): responde UMA conversa cuja última palavra é do cliente e ficou sem resposta (3 min a 48 h).
async function responderAgora(id) {
  if (fila.has(id) || atendendo.has(id) || fs.existsSync(PAUSADO)) return false;
  const ms = await (await client.getChatById(id)).fetchMessages({ limit: 15 });
  const pend = [];
  for (let i = ms.length - 1; i >= 0; i--) {
    const m = ms[i];
    if (m.fromMe && m.type !== 'automated_greeting_message') break;
    if (!m.fromMe && ['chat', 'ptt', 'audio', 'image', 'document', 'video'].includes(m.type)) pend.unshift(m);
  }
  if (!pend.length || ehFechamento(pend[pend.length - 1])) return false;
  log('respondendo conversa que ficou sem resposta (vigia de leads): ' + id);
  pend.forEach((m) => vistas.add(m.id._serialized));
  await atender(id, pend);
  return true;
}
let respondendoPendentes = false;
// Gatilho do pacote de figurinhas para o próprio número: criar mandar-pacote.txt (vazio = conversa "eu"; ou o id do chat).
async function processarPacote() {
  const arq = path.join(PASTA, 'mandar-pacote.txt');
  if (!fs.existsSync(arq)) return;
  let alvo = 'eu';
  try { alvo = fs.readFileSync(arq, 'utf8').trim() || 'eu'; fs.unlinkSync(arq); } catch { return; }
  await FIG.mandarPacote(alvo);
}
async function processarResponder() {
  const arq = path.join(PASTA, 'responder.json');
  if (respondendoPendentes || !fs.existsSync(arq)) return;
  let ids = [];
  try { ids = JSON.parse(fs.readFileSync(arq, 'utf8')); fs.unlinkSync(arq); } catch { return; }
  respondendoPendentes = true;
  try {
    for (const id of [].concat(ids)) {
      try {
        quieto.set(id, 0);
        const ms = await (await client.getChatById(id)).fetchMessages({ limit: 15 });
        const pend = [];
        for (let i = ms.length - 1; i >= 0; i--) {
          const m = ms[i];
          if (m.fromMe && m.type !== 'automated_greeting_message') break;
          if (!m.fromMe && ['chat', 'ptt', 'audio', 'image', 'document', 'video'].includes(m.type)) pend.unshift(m);
        }
        if (pend.length) { log('respondendo conversa que ficou sem resposta: ' + id); pend.forEach((m) => vistas.add(m.id._serialized)); await atender(id, pend); }
      } catch (e) { log('responder pendente falhou ' + id + ': ' + e.message); erroEv('responder_json', e, id); }
    }
  } finally { respondendoPendentes = false; }
}
// Pedido do dono (09/11/2026): proativo.json = [{"id":"123@lid","nota":"instrução para o Haiku"}]. Roda o atendimento
// normal (base.md, guias, ficha) sobre a última mensagem do cliente, com a instrução do dono. Lê a cada 15 s e apaga o arquivo.
async function processarProativo() {
  const arq = path.join(PASTA, 'proativo.json');
  if (!fs.existsSync(arq)) return;
  let itens = [];
  try { itens = JSON.parse(fs.readFileSync(arq, 'utf8')); fs.unlinkSync(arq); } catch { return; }
  for (const it of [].concat(itens)) {
    try {
      quieto.set(it.id, 0);
      const ms = await (await client.getChatById(it.id)).fetchMessages({ limit: 15 });
      const alvo = [...ms].reverse().find((m) => !m.fromMe && ['chat', 'ptt', 'audio', 'image', 'document', 'video'].includes(m.type));
      if (!alvo) { log('proativo: sem mensagem do cliente em ' + it.id); continue; }
      log('atendimento pedido pelo dono: ' + it.id);
      await atender(it.id, [alvo], String(it.nota || ''));
    } catch (e) { log('proativo falhou ' + it.id + ': ' + e.message); erroEv('proativo', e, it.id); }
  }
}
client.on('ready', () => {
  setInterval(() => processarProativo().catch((e) => log('proativo.json falhou: ' + e.message)), 15000);
  setTimeout(() => varrer().catch((e) => log('varredura falhou: ' + e.message)), 8000);
  setTimeout(pedirReleituraPartida, 180000);   // varredura completa do tempo em que ficou desligado
  // Conversas que ficaram sem resposta por engano: responder.json = ["id@lid", ...]. Atende uma vez e apaga.
  // Lido ao ligar e a cada 15 s, para liberar uma conversa sem reiniciar o robô.
  setTimeout(() => processarResponder().catch((e) => log('responder.json falhou: ' + e.message)), 5000);
  setInterval(() => processarResponder().catch((e) => log('responder.json falhou: ' + e.message)), 15000);
  setInterval(() => processarPacote().catch((e) => log('pacote falhou: ' + e.message)), 15000);
  setInterval(() => varrer().catch((e) => log('varredura falhou: ' + e.message)), 60000);
  setInterval(() => vigiar().catch(() => {}), 120000);
});
client.on('change_state', (st) => log('estado do WhatsApp: ' + st));

const ultimosTextos = new Map(); // chatId|texto -> quando; nunca manda o mesmo texto 2 vezes em 3 min para a mesma conversa
async function enviar(chat, texto, chatId, ev) {
  if (desligado(chatId)) { log('robô desligado nesta conversa, não enviei a ' + chatId); return; }
  if (LN.bloqueado({ chatId, telefone: (fichas[chatId] || {}).telefone_real })) { log('lista negra: não enviei a ' + chatId); return; }
  const chave = chatId + '|' + texto, agora = Date.now();
  if (agora - (ultimosTextos.get(chave) || 0) < 180000) { log(`texto repetido não enviado a ${chatId}: ${texto.slice(0, 60)}`); evento('repeticao_bloqueada', chatId, nomeDe(chatId), { texto }); return; }
  ultimosTextos.set(chave, agora);
  try { await chat?.sendStateTyping(); } catch {}
  await new Promise((r) => setTimeout(r, Math.min(3500 + texto.length * 50, 9000)));   // 10/11/2026: ritmo mais calmo entre as bolhas
  marcarEnvio(chatId);
  textosDoRobo.add(texto); setTimeout(() => textosDoRobo.delete(texto), 60000);
  const m = chat ? await chat.sendMessage(texto).catch(() => null) : null;
  const ok = m || await client.sendMessage(chatId, texto);
  enviadasPeloRobo.add(ok.id._serialized);
  try { await chat?.clearState(); } catch {}
  if (ev && ev.tipo === 'followup') {
    const e = evento('followup', chatId, nomeDe(chatId), { n: ev.n, minutos: ev.minutos, variante: ev.variante || null, texto });
    if (e) followupAberto.set(chatId, { n: ev.n, t: e.t, v: ev.variante || null });
  } else evento('resposta_robo', chatId, nomeDe(chatId), { texto, ...(ev || {}) });
}

// Catálogo de filmes/séries (pasta catalogo\, módulo catalogo.js com buscar(titulo)). Ainda não integrado de verdade:
// se o módulo existir, chama buscar(); se devolver texto, manda ao cliente; o resto só é registrado.
async function buscarConteudo(chat, chatId, nome, titulo) {
  let cat; try { cat = require('./catalogo/catalogo.js'); } catch { log('catálogo ainda não instalado (pedido: ' + titulo.slice(0, 80) + ')'); return; }
  const res = await cat.buscar(titulo);
  evento('conteudo_pedido', chatId, nome, { titulo: titulo.slice(0, 120), achou: !!res });
  log(`conteúdo pedido por ${nome}: ${titulo.slice(0, 80)} -> ${res ? 'achou' : 'não achou'}`);
  if (typeof res === 'string' && res.trim()) await enviar(chat, limpar(res), chatId);
}
// Origem do lead (aba Tráfego, 09/11/2026): lê o cartão do anúncio (Facebook/Instagram) nas mensagens. Nunca quebra o atendimento.
function origemAnuncio(lista) {
  try {
    const out = { origem_anuncio: 'sem_registro' };
    for (const m of lista || []) {
      const d = (m && m._data) || {};
      const ctx = d.ctwaContext || (d.contextInfo && d.contextInfo.externalAdReply) || d.externalAdReply || d.referral || null;
      if (ctx || m.type === 'automated_greeting_message') {
        const alvo = ctx ? [ctx.sourceApp, ctx.source, ctx.sourceUrl, ctx.mediaUrl, ctx.thumbnailUrl].filter(Boolean).join(' ').toLowerCase() : '';
        out.origem_anuncio = /insta|instagram/.test(alvo) ? 'instagram' : /face|fb\.|\bfb\b/.test(alvo) ? 'facebook' : 'anuncio';
        if (ctx && (ctx.title || ctx.headline)) out.anuncio_titulo = String(ctx.title || ctx.headline).slice(0, 80);
        if (ctx && (ctx.sourceId || ctx.adId)) out.anuncio_id = String(ctx.sourceId || ctx.adId).slice(0, 40);
        if (out.origem_anuncio !== 'anuncio' || ctx) break;
      }
    }
    try {   // só nomes de campos (sem conteúdo), para conferir depois de onde a origem vem
      const f = path.join(PASTA, 'anuncio-debug.json'); let dbg = []; try { dbg = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
      if (dbg.length < 15) { const m0 = (lista || []).find((m) => m && m._data); dbg.push({ em: new Date().toISOString(), tipos: (lista || []).slice(0, 6).map((m) => m.type), chaves: m0 ? Object.keys(m0._data).filter((k) => /ctwa|referral|ad|source|context|greet/i.test(k)) : [], resultado: out.origem_anuncio }); fs.writeFileSync(f, JSON.stringify(dbg, null, 1)); }
    } catch {}
    return out;
  } catch { return {}; }
}
async function atender(chatId, msgs, nota) {
  atendendo.add(chatId);
  try { return await atenderCore(chatId, msgs, nota); } finally { atendendo.delete(chatId); }
}
async function atenderCore(chatId, msgs, nota) {   // nota: recado extra da releitura (retomar dúvida que ficou sem resposta)
  let chat = null;
  try { chat = await comLimite(msgs[0].getChat(), 20000, 'getChat'); } catch (e) { log('getChat falhou: ' + e.message); }
  let nome = msgs[0]._data?.notifyName || chatId.split('@')[0];
  try { const c = await msgs[0].getContact(); nome = c.pushname || c.name || nome; } catch {}
  const ultima = msgs[msgs.length - 1];
  // Lista dos revendedores (10/11/2026): "sair" tira da lista diária e confirma.
  try { if (require('./lista-revendedores.js').pedidoSair(chatId, ultima.body)) { log(`${nome} saiu da lista dos revendedores`); return enviar(chat, 'Pronto, mestre. Você não recebe mais o material diário.', chatId); } } catch {}

  // Áudio: transcreve e trata como texto.
  for (const m of msgs) {
    if (m.type === 'ptt' || m.type === 'audio') {
      const t = await textoDoAudio(m);
      if (t) { m._textoAudio = t; log(`${nome} [áudio transcrito]: ${t}`); }
    }
  }
  if (msgs.every((m) => (m.type === 'ptt' || m.type === 'audio') && !m._textoAudio)) {
    log(`${nome}: [áudio que não deu para entender]`);
    return enviar(chat, 'Não consegui ouvir seu áudio direito. Pode escrever sua dúvida, por favor?', chatId);
  }
  // Foto/arquivo (comprovante, print): passa para o senhor.
  if (msgs.some((m) => ['image', 'document'].includes(m.type)) && !msgs.some((m) => m.body && m.type === 'chat')) {
    log(`${nome}: [imagem/arquivo] -> responsável`);
    quieto.set(chatId, Date.now() + QUIETO_AVISO); passouEm.set(chatId, Date.now());
    evento('passou_ao_senhor', chatId, nome, { motivo: 'mandou foto ou arquivo (talvez comprovante)' });
    avisarSenhor(`Revenda: ${nome} mandou foto ou arquivo (talvez comprovante). Abra a conversa no WhatsApp da revenda.`);
    await enviar(chat, 'Recebi. Já vou passar para o responsável conferir.', chatId);
    // Figurinha: comprovante quando parece pagamento (legenda ou revendedor com painel), senão "verificando".
    const legenda = msgs.map((m) => m.body || '').join(' ');
    // 10/11/2026: só a fala de pagamento conta (ter painel não basta: quem acabou de criar manda print do painel, não comprovante).
    const pareceComprovante = /pag|pix|comprov|transfer|deposit/i.test(legenda);
    return FIG.mandar(chatId, pareceComprovante ? 'comprovante_recebido' : 'verificando', 'sistema', 'foto ou arquivo');
  }

  let historico = msgs;
  try { if (chat) historico = await comLimite(chat.fetchMessages({ limit: 25 }), 20000, 'histórico'); } catch (e) { log('histórico falhou: ' + e.message); }
  const texto = historico
    .map((m) => {
      const aud = (m.type === 'ptt' || m.type === 'audio') ? (transcricoes.get(m.id._serialized) || null) : null;
      if (/notification|e2e|protocol|revoked|ciphertext/.test(m.type)) return null;
      let corpo = (m.type === 'chat' || m.type === 'automated_greeting_message') ? m.body : aud ? `(áudio) ${aud}` : (m.body && /image|video|document/.test(m.type)) ? `[${m.type}] ${m.body}` : `[${m.type}]`;
      // 10/11/2026: resposta em cima de outra mensagem (citada) leva o trecho citado, senão o robô perde o assunto.
      const q = m.hasQuotedMsg && m._data && m._data.quotedMsg;
      if (corpo && q) { const qt = q.type === 'chat' ? q.body : (q.caption || (q.type ? `[${q.type}]` : '')); if (qt) corpo = `(respondendo a: "${String(qt).replace(/\s+/g, ' ').slice(0, 160)}") ${corpo}`; }
      return corpo ? `${m.fromMe ? 'Revenda' : 'Cliente'}: ${corpo}` : null;
    })
    .filter(Boolean)
    .join('\n');
  const pedido = `Hoje é ${new Date().toLocaleDateString('pt-BR')}. Nome do cliente no WhatsApp: ${nome}. Vídeos já enviados nesta conversa: ${(videosEnviados[chatId] || []).join(', ') || 'nenhum'}.

Guias ilustrados disponíveis (use o nome em "guia"):
${catalogoGuias()}

Figurinhas da capivara (use o nome em "figurinha", no máximo uma, só quando encaixar; na maioria das respostas deixe ""):
${FIG.catalogo()}
Figurinhas já mandadas nesta conversa: ${(ficha(chatId).figurinhas || []).map((h) => h.id).join(', ') || 'nenhuma'}.

Vitrine do cliente final (use em "vitrine" só com quem quer ASSISTIR): ${VIT.catalogo()}.
Vitrine já mandada nesta conversa: ${(ficha(chatId).vitrine || []).join(', ') || 'nada'}.

Ficha do cliente (memória do atendimento, pode ser de dias atrás):
${JSON.stringify(ficha(chatId))}\n\nConversa (a última linha é a mais nova):\n${texto}\n\n${nota ? 'Responda no formato JSON pedido. ' + nota : 'Responda à última mensagem do cliente no formato JSON pedido.'}`;

  const fx = ficha(chatId);
  fx.nome = nome; fx.telefone = chatId.split('@')[0]; fx.ultimo_contato = new Date().toISOString();
  fx.mensagens = (fx.mensagens || 0) + msgs.length;
  if (!fx.contado_conversa && Date.now() - Date.parse(fx.criado_em || 0) < 5 * 60e3) { fx.contado_conversa = true; evento('conversa_nova', chatId, nome, origemAnuncio(historico)); }
  if (!fx.telefone_real) resolverTelefones([chatId]).catch(() => {});
  log(`${nome}: ${msgs.map((m) => m.body || '[' + m.type + ']').join(' | ')}`);
  // Primeiro contato (geralmente vindo do anúncio): puxa a conversa em 3 mensagens curtas.
  // Se a primeira mensagem já for uma pergunta de verdade, cumprimenta e responde a pergunta em seguida.
  const parceirinho = ehParceirinho(chatId);
  const dono = ehDono(chatId);
  const primeiroContato = !parceirinho && !dono && !historico.some((m) => m.fromMe) && !saudados.has(chatId);
  if (primeiroContato) {
    marcarSaudado(chatId);
    const primeiroNome = String(nome || '').trim().split(/\s+/)[0];
    const pareceNome = /^[A-Za-zÀ-ÿ]{2,}$/.test(primeiroNome);
    const textoCliente = msgs.map((m) => m._textoAudio || m.body || '').join(' ').trim();
    const jaDisseOQuer = /revend|condi[cç]|como funciona|pre[cç]o|valor|painel|cr[eé]dito|teste|j[aá] fa[cç]o|come[cç]ar|quanto|ativos?|assistir|assinar|assinatura|filme|s[eé]rie|futebol|jogo|canais|novela|pega no|funciona na|[eé] tv/i.test(textoCliente); // 08/11: quem já disse o que quer vai direto ao Haiku, sem a saudação de menu
    const generica = !jaDisseOQuer && !textoCliente.includes('?') && (textoCliente.length < 80 || /informa|saber mais|an[uú]ncio|vi o|ol[aá]|oi|bom dia|boa tarde|boa noite|quero/i.test(textoCliente));
    const saud = 'Oi mestre'; // regra do dono (08/11/2026): nunca pelo nome, sempre "mestre"
    await enviar(chat, saud, chatId);
    await enviar(chat, 'tudo bem?', chatId);
    await FIG.mandar(chatId, figurinhaDeOi(), 'sistema', 'primeiro contato');
    if (generica) {
      await enviar(chat, 'em que posso ajudar?', chatId);
      fx.etapa = 'primeiro_contato'; salvarFichas();
      log('robô -> ' + nome + ': [saudação do anúncio]');
      return;
    }
  }
  const primeiraResposta = primeiroContato || (ficha(chatId).etapa === 'primeiro_contato' && !ficha(chatId).primeira_resposta);
  if (parceirinho) log(`${nome} é parceirinho: Sonnet com pesquisa`);
  const alerta = ehAlertaVermelho(chatId, msgs.map((m) => m._textoAudio || m.body || '').join(' '));
  if (alerta) {
    const fa = ficha(chatId);
    if (alerta === 'novo') {
      fa.alerta_vermelho = new Date().toISOString(); salvarFichas();
      log(`${nome}: ALERTA VERMELHO -> conversa no ${MODELO_ALERTA}`);
      evento('alerta_vermelho', chatId, nome, { texto: String(ultima._textoAudio || ultima.body || '').slice(0, 160), modelo: MODELO_ALERTA });
      avisarSenhor(`ALERTA VERMELHO na revenda: ${nome} quer cancelar ou está insatisfeito. O robô passou a conversa para o Sonnet 5.5 e está tentando resolver.\nÚltima mensagem: "${ultima._textoAudio || ultima.body || ''}"`);
    }
  }
  const escalado = lerEscalados()[chatId];
  const r = dono
    ? await perguntarHaiku(pedido + '\n\n' + NOTA_DONO, 'dono')
    : parceirinho
    ? await perguntarHaiku(pedido + '\n\n' + NOTA_PARCEIRINHO + (alerta ? '\n\n' + NOTA_ALERTA : ''), 'parceirinho', { modelo: 'sonnet', pesquisa: true })
    : alerta
      ? await perguntarHaiku(pedido + '\n\n' + NOTA_ALERTA, 'alerta_vermelho', { modelo: MODELO_ALERTA })
      : escalado
        ? await perguntarHaiku(pedido + '\n\n' + NOTA_ESCALADA, 'escalada', { modelo: escalado.modelo || 'claude-opus-5-5', pesquisa: true })
        : await perguntarHaiku(pedido);
  if (!r) {
    log('Haiku não respondeu: conversa passada ao senhor');
    evento('passou_ao_senhor', chatId, nome, { motivo: 'o robô não conseguiu responder (Haiku sem resposta)' });
    erroEv('haiku_sem_resposta', 'Haiku não respondeu', chatId);
    return avisarSenhor('Revenda: o robô não conseguiu responder ' + nome + '. Última mensagem: "' + ultima.body + '"');
  }
  atualizarFicha(chatId, r.memoria);
  if (escalado && r.resolvido === true) { try { const es = lerEscalados(); delete es[chatId]; fs.writeFileSync(ESCALADOS, JSON.stringify(es, null, 1)); log(`${nome}: escalada resolvida -> conversa volta ao Haiku`); avisarSenhor(`Conversa escalada resolvida: ${nome}. Voltou para o Haiku.`); } catch {} }
  // 09/11/2026 (pedido do senhor): dificuldade sanada -> a conversa sai do Sonnet e volta ao Haiku na próxima mensagem.
  if (alerta && r.resolvido === true) {
    const fr = ficha(chatId);
    if (fr.alerta_vermelho) {
      const min = Math.round((Date.now() - Date.parse(fr.alerta_vermelho)) / 60e3);
      delete fr.alerta_vermelho; fr.alerta_resolvido = new Date().toISOString(); salvarFichas();
      log(`${nome}: alerta resolvido em ${min} min -> conversa volta ao Haiku`);
      evento('alerta_resolvido', chatId, nome, { minutos: min });
      avisarSenhor(`Alerta resolvido na revenda: ${nome} se acalmou ou teve o problema sanado (${min} min no Sonnet). A conversa voltou para o Haiku.`);
      r.figurinha = r.figurinha || 'resolvido';
    }
  }
  const lista = (Array.isArray(r.mensagens) ? r.mensagens : [r.resposta]).map(limpar).filter(Boolean).slice(0, 9); // não cortar em 6: já cortou o link do painel (08/11)
  // Voz Jucanalha (08/11/2026, pedido do senhor): só na 1ª resposta de lead novo; links seguem em texto; sem VoiceStudio, volta ao texto.
  let foiVoz = false;
  // A/B de conversão (08/11): metade dos leads novos recebe a 1ª resposta em áudio, metade em texto; fica em ficha.primeira_resposta.
  const sorteioVoz = !parceirinho && primeiraResposta && Math.random() < 0.5;
  // Modo "Todas" (09/11/2026, ligado pelo dashboard = arquivo voz-tudo.on): toda resposta ao vivo sai em áudio, menos parceirinhos.
  const vozTodas = !parceirinho && fs.existsSync(path.join(PASTA, 'voz-tudo.on'));
  if ((sorteioVoz || vozTodas) && VOZ_PRIMEIRA && !fs.existsSync(path.join(PASTA, 'voz.off'))) {
    const falar = lista.filter((t) => !/https?:\/\/|www\./i.test(t));
    const links = lista.filter((t) => /https?:\/\/|www\./i.test(t));
    const arq = falar.length ? await vozJucanalha(falar.join(' '), chatId) : null;
    if (arq) {
      try {
        try { await chat?.sendStateRecording(); } catch {}
        await new Promise((ok) => setTimeout(ok, 2500));
        marcarEnvio(chatId);
        const m = await client.sendMessage(chatId, MessageMedia.fromFilePath(arq), { sendAudioAsVoice: true });
        enviadasPeloRobo.add(m.id._serialized);
        try { await chat?.clearState(); } catch {}
        log(`robô -> ${nome}: [áudio Jucanalha] ${falar.join(' ')}`);
        evento('resposta_robo', chatId, nome, { texto: '[áudio] ' + falar.join(' '), midia: true });
        for (const t of links) { await enviar(chat, t, chatId); log(`robô -> ${nome}: ${t}`); }
        foiVoz = true;
      } catch (e) { log('áudio Jucanalha falhou, mandando texto: ' + e.message); }
      fs.unlink(arq, () => {});
    }
  }
  if (!foiVoz) for (const t of lista) { await enviar(chat, t, chatId); log(`robô -> ${nome}: ${t}`); }
  if (primeiraResposta) { ficha(chatId).primeira_resposta = { canal: foiVoz ? 'audio' : 'texto', sorteio: sorteioVoz ? 'audio' : 'texto', em: new Date().toISOString() }; salvarFichas(); evento('primeira_resposta', chatId, nome, { canal: foiVoz ? 'audio' : 'texto' }); }
  // Teste grátis automático (Teste Rápido do painel, 6 horas, 0 crédito).
  if (r.teste) {
    const tel = (msgs[0]._data?.from?.user) || chatId.split('@')[0];
    log(`gerando teste para ${nome}...`);
    const t = await criarTeste({ nome, telefone: tel });
    if (t.ok) {
      const ex = t.extras || {};
      await enviar(chat, 'Pronto, seu teste está liberado. Ele vale por 6 horas.', chatId);
      await FIG.mandar(chatId, 'teste_liberado', 'sistema', 'teste gerado');
      await enviar(chat, `Usuário: ${t.usuario}
Senha: ${t.senha}`, chatId);
      if (ex.dns) await enviar(chat, `Se o app pedir servidor ou URL, use: ${ex.dns}`, chatId);
      for (const d of (Array.isArray(r.depois) ? r.depois : []).map(limpar).filter(Boolean).slice(0, 3)) await enviar(chat, d, chatId);
      log(`robô -> ${nome}: [teste ${t.usuario} enviado]`);
      ficha(chatId).teste = { usuario: t.usuario, em: new Date().toISOString(), validade: t.validade };
      evento('teste_gerado', chatId, nome, { usuario: t.usuario, horas: ex.horas || 6 });
      avisarSenhor(`Revenda: teste grátis gerado para ${nome} (usuário ${t.usuario}).`);
    } else {
      log(`teste falhou para ${nome}: ${t.erro}`);
      const jaTeve = /^ja_teve_teste/.test(t.erro || '');
      await enviar(chat, jaTeve ? 'Vi que você já fez um teste há poucos dias. Vou chamar o responsável para te ajudar.' : 'Certo, já vou passar para o responsável liberar seu teste. Ele te responde em instantes.', chatId);
      await FIG.mandar(chatId, 'so_um_instante', 'sistema', 'teste não gerado');
      quieto.set(chatId, Date.now() + QUIETO_AVISO); passouEm.set(chatId, Date.now());
      erroEv('teste_gratis', t.erro, chatId);
      evento('passou_ao_senhor', chatId, nome, { motivo: 'teste não gerado: ' + String(t.erro || '').slice(0, 120) });
      avisarSenhor(`Revenda: ${nome} pediu teste e o robô não conseguiu gerar (${t.erro}).` + (/sem_sessao/.test(t.erro || '') ? ' Rode o login do painel: node teste-gratis.js --login' : ''));
    }
  }
  // Ponto de extensão do catálogo de filmes/séries: o Haiku pode devolver "conteudo": "título pedido" (ver buscarConteudo).
  if (r.conteudo) await buscarConteudo(chat, chatId, nome, String(r.conteudo)).catch((e) => { log('catálogo falhou: ' + e.message); erroEv('catalogo', e, chatId); });
  // Guia ilustrado da TV (cards passo a passo), uma vez por conversa.
  const fg = ficha(chatId); fg.guias = fg.guias || [];
  if (r.guia && GUIAS[r.guia] && !fg.guias.includes(r.guia)) {
    const g = GUIAS[r.guia];
    fg.guias.push(r.guia);
    for (let i = 0; i < g.imagens.length; i++) {
      try {
        try { await chat?.sendStateTyping(); } catch {}
        await new Promise((ok) => setTimeout(ok, 1800));
        marcarEnvio(chatId);
        const legenda = limpar(g.passos[i] || '');
        textosDoRobo.add(legenda); setTimeout(() => textosDoRobo.delete(legenda), 60000);
        const m = await client.sendMessage(chatId, MessageMedia.fromFilePath(g.imagens[i]), { caption: legenda });
        enviadasPeloRobo.add(m.id._serialized);
      } catch (e) { log(`card ${r.guia} ${i + 1} falhou: ` + e.message); }
    }
    log(`robô -> ${nome}: [guia ${r.guia}, ${g.imagens.length} cards]`);
    evento('resposta_robo', chatId, nome, { texto: `[guia ${r.guia}, ${g.imagens.length} cards]`, midia: true });
  }
  // Vídeos de instalação pedidos pelo Haiku (no máximo 2, sem repetir na conversa).
  const ja = new Set(videosEnviados[chatId] || []);
  for (const v of (Array.isArray(r.videos) ? r.videos : []).filter((v) => VIDEOS[v] && !ja.has(v)).slice(0, 2)) {
    try {
      try { await chat?.sendStateTyping(); } catch {}
      marcarEnvio(chatId);
      const m = await client.sendMessage(chatId, MessageMedia.fromFilePath(VIDEOS[v]));
      enviadasPeloRobo.add(m.id._serialized);
      ja.add(v); videosEnviados[chatId] = [...ja]; ficha(chatId).videos = [...ja]; fs.writeFileSync(VIDEOS_ENVIADOS, JSON.stringify(videosEnviados));
      log(`robô -> ${nome}: [vídeo ${v}]`);
      evento('resposta_robo', chatId, nome, { texto: `[vídeo ${v}]`, midia: true });
    } catch (e) { log(`vídeo ${v} falhou: ` + e.message); }
  }
  // Vitrine do cliente final (10/11/2026): vídeo dos lançamentos e/ou pôster no preço do cliente final.
  if (r.vitrine) {
    try { await chat?.sendStateTyping(); } catch {}
    const foi = await VIT.mandar(chatId, ficha(chatId), r.vitrine);
    if (foi.length) { log(`robô -> ${nome}: [vitrine ${foi.join(', ')}]`); evento('resposta_robo', chatId, nome, { texto: `[vitrine ${foi.join(', ')}]`, midia: true }); }
  }
  if (r.avisar) { ficha(chatId).ultimo_aviso = r.motivo || ''; }
  // Figurinha (10/11/2026): a escolhida pelo Haiku; se ele passou ao responsável sem escolher, "SÓ UM INSTANTE!". Uma por resposta.
  if (r.figurinha) await FIG.mandar(chatId, String(r.figurinha).trim(), 'haiku');
  else if (r.avisar && !r.teste) await FIG.mandar(chatId, 'so_um_instante', 'sistema', 'passou ao responsável');
  // Lacunas de conhecimento (MODO A, 08/11/2026): registra e chama o agente em segundo plano, sem bloquear a conversa.
  try {
    const det = lac && lac.detectarLacuna({ r, mensagens: lista, ultimaMensagem: ultima._textoAudio || ultima.body || '' });
    if (det) {
      const reg = lac.registrarLacuna({ chat: chatId, nome1: nome, pergunta: det.pergunta, contexto: texto.split('\n').slice(-6), motivo: det.motivo, origem: 'bot' });
      if (reg && reg.id) { evento('lacuna_registrada', chatId, nome, { id: reg.id, motivo: det.motivo, nova: reg.nova, ocorrencias: reg.ocorrencias }); lac.drenarFila(); }
    }
  } catch (e) { log('lacuna não registrada: ' + e.message); }
  salvarFichas();
  if (r.avisar) {
    evento('passou_ao_senhor', chatId, nome, { motivo: r.motivo || 'o robô pediu ajuda do senhor' });
    quieto.set(chatId, Date.now() + QUIETO_AVISO); passouEm.set(chatId, Date.now());
    avisarSenhor(`Revenda: ${nome} precisa de você. ${r.motivo || ''}\nÚltima mensagem: "${ultima.body}"`);
  }
}

// Fila de envio manual: enviar-fila.json = [{"id":"123@lid","texto":"...","imagens":["C:/...jpg"],"cru":true,"espera_s":75}].
// Um item por vez (o resto volta ao arquivo, sobrevive a reinício); espera_s = intervalo até o próximo. "cru" manda direto
// (mantém *negrito*, não passa pelo limpar nem abre follow-up). Mídia e espaçamento: 09/11/2026 (comunicado aos revendedores).
let proximoManual = 0, enviandoManual = false;
setInterval(async () => {
  if (enviandoManual || Date.now() < proximoManual) return;
  const arq = path.join(PASTA, 'enviar-fila.json');
  let itens = [];
  try { itens = JSON.parse(fs.readFileSync(arq, 'utf8')); } catch { return; }
  const it = itens.shift();
  if (itens.length) fs.writeFileSync(arq, JSON.stringify(itens, null, 1)); else fs.unlinkSync(arq);
  if (!it) return;
  enviandoManual = true;
  try {
    // {"id":"eu","pacote_figurinhas":true} manda as 12 figurinhas para a conversa do próprio número (para favoritar no celular).
    if (it.pacote_figurinhas) { await FIG.mandarPacote(it.id); return; }
    if (it.figurinha) await FIG.mandar(it.id, it.figurinha, 'sistema', 'envio manual');
    for (const img of (it.imagens || [])) { await client.sendMessage(it.id, MessageMedia.fromFilePath(img)); await new Promise((r) => setTimeout(r, 2000)); }
    if (it.texto) {
      if (it.cru) await client.sendMessage(it.id, it.texto);
      else await enviar(await client.getChatById(it.id), limpar(it.texto), it.id);
    }
    log(`robô -> ${it.id}: [envio manual${it.imagens ? ' + ' + it.imagens.length + ' imagens' : ''}] ${String(it.texto || '').slice(0, 80)}`);
  } catch (e) { log('envio manual falhou: ' + e.message); erroEv('envio_manual', e, it.id); }
  finally { enviandoManual = false; proximoManual = Date.now() + (it.espera_s || 0) * 1000; }
}, 15000);

// ---------- Follow-up: cliente sem responder (7 min, 20 min, 1 h, 3 h) ----------
const ORDINAL = ['primeiro', 'segundo', 'terceiro', 'quarto'];
// A/B da escada (08/11/2026, funil): duas variantes por degrau, sorteadas por lead; a pior é desligada quando o teste decide (funil\ab.json).
const ANGULO_VIVO = {
  A: ['pergunte se conseguiu seguir o passo ou se ficou dúvida', 'mude o jeito de perguntar, mais leve, oferecendo ajuda', 'lembre de forma simpática que está à disposição e que o painel não tem taxa', 'faça um último aviso leve, dizendo que fica à disposição quando ele quiser'],
  B: ['ofereça uma ajuda concreta para o próximo passo (por exemplo, explicar em um minuto ou mandar o vídeo do aparelho dele)', 'traga um fato curto do base.md que ajude a decidir, sem repetir o que já foi dito, e convide a continuar', 'pergunte qual é a única coisa que falta para ele começar', 'despeça-se leve dizendo que ele pode retomar daqui de onde parou quando quiser'],
};
const tarefaFollowup = (n, v = 'A') => `TAREFA ESPECIAL (follow-up): o cliente não respondeu à última mensagem da Revenda. Este é o ${ORDINAL[n]} acompanhamento (o ${n + 1}º de ${FOLLOWUP_MIN.length}); o silêncio já dura ${FOLLOWUP_MIN[n]} minutos. Leia a conversa inteira e a ficha do cliente e escreva UMA mensagem curta, natural e sem pressão, que retome exatamente o ponto em que a conversa parou (se ele já respondeu algo, não pergunte de novo; se faltou o link do painel, mande o link). Chame de "mestre", nunca pelo nome. NÃO repita o texto de um acompanhamento anterior: ${(ANGULO_VIVO[v] || ANGULO_VIVO.A)[n]}. Responda no formato JSON pedido, com "mensagens" contendo só essa mensagem e os demais campos vazios ou falsos (sem teste, sem guia, sem vídeos, sem avisar). Se a conversa já se encerrou (o cliente agradeceu ou se despediu) ou a última mensagem da Revenda não esperava resposta, devolva "mensagens": [].`;
const ETAPAS_SEM_FOLLOWUP = ['painel_criado', 'encerrado', 'fechado', 'parado'];
async function seguimento(chatId, n) {
  if (fs.existsSync(PAUSADO) || (quieto.get(chatId) || 0) > Date.now() || atendendo.has(chatId) || fila.has(chatId)) return;
  if (desligado(chatId)) return;
  if (ehDono(chatId)) return;   // o dono nunca recebe follow-up (10/11)
  if (ehParceirinho(chatId)) return;   // parceirinho não recebe follow-up automático (09/11)
  const fx = ficha(chatId);
  if (ETAPAS_SEM_FOLLOWUP.includes(fx.etapa)) { seguiuN.set(chatId, FOLLOWUP_MIN.length); return; }
  const chat = await client.getChatById(chatId);
  const ms = (await chat.fetchMessages({ limit: 25 })).filter((m) => !/notification|e2e|protocol|revoked|ciphertext/.test(m.type));
  const ultima = ms[ms.length - 1];
  if (!ultima || !ultima.fromMe) return;                                   // cliente já falou por último
  if (ultima.type !== 'automated_greeting_message' && !enviadasPeloRobo.has(ultima.id._serialized)) return; // o senhor falou por último
  const nome = fx.nome || chat.name || chatId.split('@')[0];
  const texto = ms.map((m) => {
    const aud = (m.type === 'ptt' || m.type === 'audio') ? (transcricoes.get(m.id._serialized) || null) : null;
    const corpo = (m.type === 'chat' || m.type === 'automated_greeting_message') ? m.body : aud ? `(áudio) ${aud}` : `[${m.type}]`;
    return corpo ? `${m.fromMe ? 'Revenda' : 'Cliente'}: ${corpo}` : null;
  }).filter(Boolean).join('\n');
  // 08/11 (coordenador): conversa que o cliente encerrou com "ok/blz/obrigado" não recebe follow-up.
  const ultCli = [...ms].reverse().find((m) => !m.fromMe);
  const N_ = (() => { try { return require('./funil/nucleo.js'); } catch { return null; } })();
  if (N_ && ultCli && ultCli.type === 'chat' && N_.ENCERRA.test(String(ultCli.body || ''))) { log(`follow-up de ${nome}: conversa encerrada pelo cliente (${String(ultCli.body).slice(0, 20)})`); seguiuN.set(chatId, FOLLOWUP_MIN.length); return; }
  let v = 'A'; try { const m = fu(); if (m) v = m.variante('vivo' + (n + 1), chatId); } catch {}
  const baseMd = (() => { try { return comAcerto(fs.readFileSync(BASE, 'utf8')); } catch { return ''; } })();
  const anteriores = ms.filter((m) => m.fromMe && m.type === 'chat').slice(-8).map((m) => m.body);
  let lista = [], motivo = '';
  for (let tent = 0; tent < 2; tent++) {
    const pedido = `Hoje é ${new Date().toLocaleDateString('pt-BR')}. Nome do cliente no WhatsApp: ${nome}.\n\nFicha do cliente:\n${JSON.stringify(fx)}\n\nConversa (a última linha é a mais nova):\n${texto}\n\n${tarefaFollowup(n, v)}${motivo ? '\nA tentativa anterior foi recusada porque: ' + motivo + '. Corrija.' : ''}`;
    const r = await perguntarHaiku(pedido);
    lista = (r && Array.isArray(r.mensagens) ? r.mensagens : []).map(limpar).filter(Boolean).slice(0, 1);
    if (!lista.length) break;
    const chk = N_ ? N_.filtrarTexto(lista[0], { baseMd, nomes: [nome, fx.nome].filter(Boolean), anteriores }) : { ok: true };
    if (chk.ok) break;
    motivo = chk.motivo; log(`follow-up de ${nome} recusado pelo filtro (${motivo})`); lista = [];
  }
  if (!lista.length) { log(`follow-up de ${nome}: nada a dizer (conversa encerrada, sem pergunta aberta ou texto recusado${motivo ? ': ' + motivo : ''})`); seguiuN.set(chatId, FOLLOWUP_MIN.length); return; }
  if ((quieto.get(chatId) || 0) > Date.now() || fs.existsSync(PAUSADO) || atendendo.has(chatId) || fila.has(chatId)) return;
  const pp = portao.pode('ao_vivo');
  if (!pp.ok) { log(`follow-up de ${nome} adiado pelo portão (${pp.motivo})`); seguiuN.set(chatId, n); return; }   // tenta de novo no próximo ciclo
  portao.registrar('ao_vivo');
  seguindo.add(chatId);
  try { for (const t of lista) { await enviar(chat, t, chatId, { tipo: 'followup', n: n + 1, minutos: FOLLOWUP_MIN[n], variante: v }); log(`robô -> ${nome}: [follow-up ${n + 1} · ${FOLLOWUP_MIN[n]} min · ${v}] ${t}`); } }
  finally { seguindo.delete(chatId); }
  fx.notas = (fx.notas || []).concat(`${new Date().toLocaleDateString('pt-BR')}: follow-up ${n + 1} enviado (${FOLLOWUP_MIN[n]} min sem resposta).`).slice(-15);
  salvarFichas();
}
setInterval(() => {
  const agora = Date.now(), hora = new Date().getHours();
  for (const [id, desde] of [...aguardando]) {
    const n = seguiuN.get(id) || 0;
    if (n >= FOLLOWUP_MIN.length || agora - desde > FOLLOWUP_VALIDADE) { aguardando.delete(id); continue; }
    // 10/11/2026 (caso luiz Cláudio): a última fala do robô foi "já passei para o responsável": nada de follow-up (o quieto de 5 min vencia antes dos 7 min).
    if ((passouEm.get(id) || 0) >= desde - 120e3) { aguardando.delete(id); continue; }
    if (agora - desde < FOLLOWUP_MIN[n] * 60e3 || roboEnviando.get(id) > agora || seguindo.has(id)) continue;
    if (hora < 8 || hora >= 21) continue;           // de noite não manda follow-up
    if (!conversaValida(id)) { aguardando.delete(id); continue; }
    if ((encerradoAte.get(id) || 0) > agora) continue;   // cliente encerrou ou prometeu: sem cobrança por 3 h
    if (!portao.pode('ao_vivo').ok) continue;         // teto total do dia ou menos de 60 s do último proativo: tenta no próximo ciclo
    seguiuN.set(id, n + 1);                          // conta já, para não disparar duas vezes
    seguimento(id, n).catch((e) => { log('follow-up falhou: ' + (e.message || e)); erroEv('followup', e, id); });
  }
}, 30000);

process.on('unhandledRejection', (e) => { erroEv('erro_solto', e && (e.message || e)); log('erro solto: ' + String(e && e.stack || '') + ' | ' + (() => { try { return JSON.stringify(e, Object.getOwnPropertyNames(e || {})); } catch { return String(e); } })().slice(0, 800)); });
process.on('uncaughtException', (e) => { erroEv('erro_grave', e && (e.message || e)); log('erro grave: ' + (e && (e.stack || e.message)).toString().slice(0, 800)); });

// ---------- Pendentes: conversas cuja última palavra é do cliente (botão "Responder pendentes" dos relatórios) ----------
async function listarPendentes(horas = 12) {
  const chats = await client.getChats();
  const limite = Date.now() / 1000 - horas * 3600;
  const out = [];
  for (const c of chats) {
    const id = c.id._serialized;
    if (c.isGroup || !conversaValida(id)) continue;
    const lm = c.lastMessage;
    if (!lm || lm.fromMe || lm.timestamp < limite) continue;
    if (fila.has(id) || atendendo.has(id)) continue;                       // já está sendo respondida
    const ms = await c.fetchMessages({ limit: 12 }).catch(() => []);
    const pend = [];
    for (let i = ms.length - 1; i >= 0; i--) {
      const m = ms[i];
      if (m.fromMe && m.type !== 'automated_greeting_message') break;      // a partir daqui já foi respondido
      if (!m.fromMe && ['chat', 'ptt', 'audio', 'image', 'document', 'video'].includes(m.type) && m.timestamp >= limite) pend.unshift(m);
    }
    if (pend.length) out.push({ id, nome: ficha(id).nome || c.name || id.split('@')[0], msgs: pend, desde: pend[0].timestamp });
  }
  return out;
}
let contandoPendentes = false;
async function gravarPendentes() {
  if (contandoPendentes || !client.pupPage) return;
  contandoPendentes = true;
  try {
    const p = await listarPendentes(12);
    fs.writeFileSync(path.join(PASTA, 'pendentes.json'), JSON.stringify({ quando: new Date().toISOString(), total: p.length, itens: p.map((x) => ({ nome: x.nome, desde_min: Math.round((Date.now() / 1000 - x.desde) / 60), mensagens: x.msgs.length })) }));
  } catch (e) { erroEv('pendentes', e); }
  finally { contandoPendentes = false; }
}
// Botão "Responder pendentes": o servidor de relatórios grava reanalisar.json; o robô refaz a análise de cada conversa sem resposta.
async function reanalisarPendentes() {
  const arq = path.join(PASTA, 'reanalisar.json');
  let pedido; try { pedido = JSON.parse(fs.readFileSync(arq, 'utf8')); fs.unlinkSync(arq); } catch { return; }
  const res = { pedido_em: pedido.pedido_em || null, iniciado_em: new Date().toISOString(), encontrados: 0, nomes: [] };
  try {
    const p = await listarPendentes(12);
    res.encontrados = p.length; res.nomes = p.map((x) => x.nome);
    log(`reanálise pedida no relatório: ${p.length} conversa(s) sem resposta` + (p.length ? ' (' + res.nomes.join(', ') + ')' : ''));
    evento('reanalise_pendentes', null, null, { encontrados: p.length, nomes: res.nomes });
    p.forEach((x, i) => setTimeout(() => {
      quieto.set(x.id, 0);
      for (const m of x.msgs) vistas.delete(m.id._serialized);
      for (const m of x.msgs) receber(m, true);
    }, i * 2500));                                                          // uma de cada vez, com calma
  } catch (e) { res.erro = String(e.message || e); erroEv('reanalisar', e); }
  res.concluido_em = new Date().toISOString();
  try { fs.writeFileSync(path.join(PASTA, 'reanalisar-resultado.json'), JSON.stringify(res)); } catch {}
}
setInterval(() => reanalisarPendentes().catch((e) => erroEv('reanalisar', e)), 4000);
setInterval(() => gravarPendentes().catch(() => {}), 60000);
setTimeout(() => gravarPendentes().catch(() => {}), 25000);

// ---------- Relatórios: servidor local (127.0.0.1:8811) e leitura/aprendizado das últimas 2 h ----------
// O servidor roda como processo à parte (sobrevive aos reinícios do robô). Se não responder, o robô o liga de novo.
const SERVIDOR_REL = path.join(PASTA, 'relatorios', 'server.mjs');
let servidorSubindo = 0;
async function vigiarServidor() {
  if (!fs.existsSync(SERVIDOR_REL) || Date.now() - servidorSubindo < 20000) return;
  try { await fetch(`http://127.0.0.1:${PORTA_REL}/api/ping`, { signal: AbortSignal.timeout(3000) }); return; } catch {}
  servidorSubindo = Date.now();
  try {
    const p = spawn(process.execPath, [SERVIDOR_REL], { cwd: path.join(PASTA, 'relatorios'), detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, RELATORIOS_PORTA: String(PORTA_REL) } });
    p.unref(); log(`servidor de relatórios ligado em http://127.0.0.1:${PORTA_REL}/`);
  } catch (e) { log('servidor de relatórios não subiu: ' + e.message); }
}
setTimeout(() => vigiarServidor().catch(() => {}), 4000);
setInterval(() => vigiarServidor().catch(() => {}), 60000);
// Leitura das últimas 2 h (Haiku, uma chamada): aprender.mjs decide sozinho se já passou o intervalo e se houve conversa nova.
const APRENDER = path.join(PASTA, 'relatorios', 'aprender.mjs');
setInterval(() => {
  if (!fs.existsSync(APRENDER)) return;
  try { spawn(process.execPath, [APRENDER, '--auto'], { cwd: PASTA, stdio: 'ignore', windowsHide: true }).on('error', () => {}); } catch {}
}, 10 * 60e3);
client.on('ready', () => {
  setTimeout(() => sincronizarPainel(true).catch((e) => erroEv('sincronizarPainel', e)), 45000);
  setInterval(() => sincronizarPainel().catch((e) => erroEv('sincronizarPainel', e)), 5 * 60e3);
  setTimeout(() => resolverTelefones().catch(() => {}), 20000);
});
// ---------- Backlog de follow-ups (08/11/2026): mapa das conversas antigas + envio lento e travado ----------
// A lógica fica em backlog.js (recarregado sozinho quando o arquivo muda). Comandos por arquivo: backlog-comando.json;
// pausa: arquivo backlog-pausado. Ver relatorios\LEIAME.md. NUNCA envia em massa: janela 9-20h, 1 envio a cada 60-120 s, teto 120/dia.
const BACKLOG_ARQ = path.join(PASTA, 'backlog.js');
let _bl = null, _blM = 0;
function bl() {
  try {
    const m = fs.statSync(BACKLOG_ARQ).mtimeMs;
    if (!_bl || m !== _blM) { delete require.cache[require.resolve(BACKLOG_ARQ)]; _bl = require(BACKLOG_ARQ); _blM = m; log('backlog.js carregado'); }
  } catch (e) { log('backlog.js nao carregou - ' + e.message); }
  return _bl;
}
const blCtx = { client, fichas, salvarFichas, log, evento, erroEv, avisarSenhor, limpar, perguntarHaiku: (c, a) => perguntarHaiku(c, a || 'funil'), marcarEnvio, seguindo, aguardando, textosDoRobo, enviadasPeloRobo,
  quieto, atendendo, fila, ULTIMO_SENHOR, painelRev, conversaValida, recentes, pasta: PASTA, SINCRONIZAR_AGENDA, est: {},
  portao, lac, seguiuN, FOLLOWUP_MIN, responderAgora, atender, aoVivoDevidos: () => { const m = fu(); return m ? m.aoVivoDevidos(aguardando, seguiuN, FOLLOWUP_MIN) : 0; } };
let blPronto = false;
client.on('ready', () => { try { require('./lista-revendedores.js').iniciar({ client, MessageMedia, log, marcarEnvio, enviadasPeloRobo }); } catch (e) { log('lista dos revendedores não iniciou: ' + e.message); } });   // 10/11/2026: pacote diário aos revendedores
client.on('ready', () => { try { HIST.garantirDoDia(); setInterval(() => { try { if (new Date().getHours() === 5) HIST.garantirDoDia(); } catch {} }, 20 * 60e3); } catch (e) { log('histórico não gravou: ' + e.message); } });
client.on('ready', () => { try { require('./status.js').iniciar({ client, MessageMedia, log }); } catch (e) { log('status do WhatsApp não iniciou: ' + e.message); } });   // 10/11/2026: status sempre em movimento
client.on('ready', () => { setTimeout(() => { blPronto = true; }, 30000); });  // espera o WhatsApp assentar
setInterval(() => {
  if (!client.pupPage || !blPronto) return;
  const m = bl();
  if (m) m.tick(blCtx).catch((e) => { erroEv('backlog', e); log('backlog falhou - ' + (e && e.message || e)); });
}, 10000);
// ---------- Estratégia de funil (08/11/2026): vigia de leads, cadência D+1/3/7/14, jornada do revendedor, etiquetas ----------
// Espera 3 min depois de ligar antes de qualquer envio proativo (mesma regra do backlog). Pausar só a cadência: funil\pausado;
// só a jornada: funil\jornada-pausada; só as etiquetas: funil\etiquetas-pausadas. Ver funil\LEIAME.md.
let fuPronto = false;
client.on('ready', () => { setTimeout(() => { fuPronto = true; }, 180000); });
setInterval(() => {
  if (!client.pupPage || !fuPronto) return;
  const m = fu();
  if (m) m.tick(blCtx).catch((e) => { erroEv('funil', e); log('funil falhou - ' + (e && e.message || e)); });
}, 10000);
// Retornos das lacunas aprendidas: pela fila única (portão "lacuna"), só 9h-20h, um por vez.
setInterval(async () => {
  if (!lac || !client.pupPage || !fuPronto) return;
  try {
    lac.drenarFila();
    if (fs.existsSync(PAUSADO)) return;
    for (const rt of lac.proximosRetornos({ max: 1 })) {
      if (atendendo.has(rt.chat) || fila.has(rt.chat) || (quieto.get(rt.chat) || 0) > Date.now()) continue;
      const p = portao.pode('lacuna'); if (!p.ok) continue;
      portao.registrar('lacuna');
      try {
        const chat = await client.getChatById(rt.chat);
        for (const m of rt.mensagens) { await enviar(chat, limpar(m), rt.chat, { lacuna: rt.lacuna, retorno: true }); log(`robô -> ${rt.chat}: [retorno da lacuna ${rt.lacuna}] ${m}`); }
        lac.confirmarRetorno(rt.id, { enviado: true });
      } catch (e) { lac.confirmarRetorno(rt.id, { enviado: false, erro: e.message }); log('retorno de lacuna falhou: ' + e.message); }
    }
  } catch (e) { log('lacunas: ' + e.message); }
}, 60000);

// Porta interna do Hub do senhor (WhatsApp no Hub, 10/11/2026). Falhar aqui nunca derruba o robô.
try { require('./hub-api.js')({ client, enviadasPeloRobo, log }); } catch (e) { log('hub-api não carregou: ' + e.message); }

client.initialize();
