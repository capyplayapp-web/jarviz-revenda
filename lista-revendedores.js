// Lista dos revendedores (pedido do senhor, 10/11/2026): um pacote por dia no privado de cada revendedor,
// com a tabela de jogos do dia e o vídeo dos conteúdos novos, mais uma frase curta que muda todo dia. Sem IA.
// Quem está na lista: todo mundo em revendedores.json (entra sozinho quando fecha painel) + lista-extra.json, menos lista-saidos.json.
// MODO ENSAIO enquanto existir o arquivo lista.ensaio: manda só para o senhor. Desligar tudo: lista.off.
// Mandar agora (sem esperar as 9h): criar lista-agora.on. Quem responder "sair" deixa de receber.
'use strict';
const fs = require('fs');
const path = require('path');

const PASTA = __dirname;
const ARQ = (n) => path.join(PASTA, n);
const ESTADO = ARQ('lista-estado.json');
const MOTIONS = 'C:/Users/gusta/.codex/.chatgpt-projects/g-p-6ad13036e67c819186ca8173794a4349/outputs/ILHA_CAPYPLAY/motions';
const TABELA = path.join(MOTIONS, 'tabela-do-dia');
const NOVIDADES = path.join(MOTIONS, 'p2pro-novidades', 'saida');
const DONO = '5511983640724';
const HORA_ENVIO = 9, HORA_FIM = 21;
const ESPACO_MIN = 20, ESPACO_MAX = 40;   // segundos entre um revendedor e outro

const ABERTURAS = [
  'Bom dia, mestre! Separei o material de hoje para você divulgar.',
  'Bom dia, mestre! Chegou o pacote do dia para o seu status.',
  'Mestre, bom dia! Material fresquinho para mostrar aos seus clientes.',
  'Bom dia, mestre! Hoje tem coisa boa para postar.',
  'Mestre, o material de hoje já está aqui. Bora vender!',
  'Bom dia, mestre! Posta no status e manda para os seus clientes.',
  'Mestre, bom dia! Seu material de divulgação de hoje.',
];
const TXT_TABELA = ['Os jogos de hoje:', 'Jogos do dia, para seus clientes não perderem nada:', 'A tabela de jogos de hoje:'];
const TXT_NOVIDADE = ['Conteúdos novos que entraram:', 'Chegou novidade no catálogo:', 'Lançamentos novos na CapyPlay:'];
const RODAPE = 'Para não receber mais, responda sair.';

const hoje = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const hora = () => Number(new Date().toLocaleString('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false }));
const lerJ = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const gravarJ = (f, v) => { try { fs.writeFileSync(f, JSON.stringify(v, null, 1)); } catch {} };
const sorteia = (l, n) => l[n % l.length];
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

function membros() {
  const saidos = new Set(lerJ(ARQ('lista-saidos.json'), []));
  const ids = [...Object.keys(lerJ(ARQ('revendedores.json'), {})), ...lerJ(ARQ('lista-extra.json'), [])];
  let desl = () => false; try { desl = require('./desligados.js').desligado; } catch {}
  return [...new Set(ids)].filter((id) => !saidos.has(id) && !desl(id));   // conversa com o robô desligado não recebe
}

// Conteúdo do dia: tabela de hoje (ou a mais recente, no ensaio) e o vídeo de novidades ainda não enviado.
function conteudo(est, ensaio) {
  const itens = [];
  try {
    const tabs = fs.readdirSync(TABELA).filter((f) => /^JOGOS_\d{4}-\d{2}-\d{2}\.mp4$/.test(f)).sort();
    const t = tabs.find((f) => f.includes(hoje())) || (ensaio ? tabs[tabs.length - 1] : null);
    if (t) itens.push({ tipo: 'tabela', arq: path.join(TABELA, t), id: t });
  } catch {}
  try {
    const dirs = fs.readdirSync(NOVIDADES).filter((d) => /^\d+$/.test(d)).map(Number).sort((a, b) => b - a);
    const d = dirs.find((n) => fs.existsSync(path.join(NOVIDADES, String(n), 'motion.mp4')));
    if (d && (ensaio || d > (est.novidade || 0))) itens.push({ tipo: 'novidade', arq: path.join(NOVIDADES, String(d), 'motion.mp4'), id: d });
  } catch {}
  return itens;
}

function iniciar({ client, MessageMedia, log, marcarEnvio, enviadasPeloRobo }) {
  let rodando = false;
  async function mandarPara(id, itens, n) {
    const env = async (conteudo, opc) => { marcarEnvio && marcarEnvio(id); const m = await client.sendMessage(id, conteudo, opc); enviadasPeloRobo && enviadasPeloRobo.add(m.id._serialized); };
    await env(sorteia(ABERTURAS, n));
    for (const it of itens) {
      await espera(2500);
      await env(MessageMedia.fromFilePath(it.arq), { caption: sorteia(it.tipo === 'tabela' ? TXT_TABELA : TXT_NOVIDADE, n) });
    }
    await espera(1500);
    await env(RODAPE);
  }
  async function rodada(forcar) {
    if (rodando || fs.existsSync(ARQ('lista.off'))) return;
    const est = lerJ(ESTADO, { dia: '', novidade: 0, enviados: {} });
    const ensaio = fs.existsSync(ARQ('lista.ensaio'));
    if (!forcar && ensaio) return;   // no ensaio só manda quando o senhor pede (lista-agora.on)
    if (!forcar && (est.dia === hoje() || hora() < HORA_ENVIO || hora() >= HORA_FIM)) return;
    const itens = conteudo(est, ensaio);
    if (!itens.length) { if (!forcar) { est.dia = hoje(); gravarJ(ESTADO, est); } log('lista dos revendedores: nada novo hoje (tabela e novidades sem arquivo)'); return; }
    rodando = true;
    try {
      const n = Math.floor(Date.now() / 864e5);
      let alvos;
      if (ensaio) { const w = await client.getNumberId(DONO); alvos = w ? [w._serialized] : []; }
      else alvos = membros();
      log(`lista dos revendedores: ${ensaio ? 'ENSAIO (só o senhor)' : alvos.length + ' revendedores'}, ${itens.map((i) => i.tipo).join(' + ')}`);
      if (!ensaio) { est.dia = hoje(); const nv = itens.find((i) => i.tipo === 'novidade'); if (nv) est.novidade = nv.id; gravarJ(ESTADO, est); }
      let ok = 0;
      for (const id of alvos) {
        if (fs.existsSync(ARQ('lista.off'))) break;
        if (!ensaio && hora() >= HORA_FIM) { log('lista: passou das 21h, o resto fica para amanhã'); break; }
        try { await mandarPara(id, itens, n); ok++; } catch (e) { log(`lista: falhou para ${id}: ${e.message}`); }
        if (alvos.length > 1) await espera((ESPACO_MIN + Math.random() * (ESPACO_MAX - ESPACO_MIN)) * 1000);
      }
      est.enviados = est.enviados || {}; est.enviados[hoje() + (ensaio ? '-ensaio' : '')] = ok; gravarJ(ESTADO, est);
      log(`lista dos revendedores: enviado para ${ok} de ${alvos.length}`);
    } finally { rodando = false; }
  }
  setInterval(() => {
    const agora = ARQ('lista-agora.on');
    if (fs.existsSync(agora)) { try { fs.unlinkSync(agora); } catch {} rodada(true).catch((e) => log('lista: ' + e.message)); }
    else rodada(false).catch((e) => log('lista: ' + e.message));
  }, 60000);
  log('lista dos revendedores ligada' + (fs.existsSync(ARQ('lista.ensaio')) ? ' (ENSAIO: só o senhor)' : '') + `: ${membros().length} na lista`);
}

// "sair" de um revendedor: tira da lista e confirma. Devolve true se tratou a mensagem.
function pedidoSair(chatId, texto) {
  if (!/^\s*(sair|parar|n[aã]o quero (mais )?receber)\s*[.!]?\s*$/i.test(String(texto || ''))) return false;
  if (!membros().includes(chatId)) return false;
  const s = lerJ(ARQ('lista-saidos.json'), []); s.push(chatId); gravarJ(ARQ('lista-saidos.json'), [...new Set(s)]);
  return true;
}

module.exports = { iniciar, pedidoSair, membros };
