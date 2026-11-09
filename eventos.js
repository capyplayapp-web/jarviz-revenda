// Registro de eventos do robô da revenda (08/11/2026).
// Uma linha JSON por evento em eventos.jsonl: { t, chat, nome, tipo, ...dados }.
// Tipos: mensagem_cliente, resposta_robo, followup, cliente_respondeu_followup, passou_ao_senhor,
//        teste_gerado, painel_fechado, senhor_escreveu, repeticao_bloqueada, erro, conversa_nova.
// Senhas nunca entram aqui: tudo passa por redigir() antes de gravar.
'use strict';
const fs = require('fs');
const path = require('path');

const ARQ = path.join(__dirname, 'eventos.jsonl');
const ARQ_HIST = path.join(__dirname, 'eventos-historico.jsonl');

function redigir(t) {
  return String(t == null ? '' : t)
    .replace(/(senha|password|pass)\s*[:=]\s*\S+/gi, '$1: [oculta]')
    .replace(/(senha)\s+(?=\S*\d)\S+/gi, '$1 [oculta]');
}
function limpa(v, prof = 0) {
  if (typeof v === 'string') return redigir(v).slice(0, 600);
  if (prof > 3 || v == null) return v;
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => limpa(x, prof + 1));
  if (typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = limpa(x, prof + 1); return o; }
  return v;
}

function evento(tipo, chat, nome, dados = {}) {
  try {
    const { t, ...resto } = dados || {};
    const e = { t: t || new Date().toISOString(), chat: chat || null, nome: nome || null, tipo, ...limpa(resto) };
    fs.appendFileSync(ARQ, JSON.stringify(e) + '\n');
    return e;
  } catch { return null; }
}

// Lê os eventos gravados nas últimas `ms` milissegundos (arquivos vivo e histórico), para retomar o estado depois de um reinício.
function recentes(ms) {
  const desde = Date.now() - ms, saida = [];
  for (const arq of [ARQ_HIST, ARQ]) {
    let txt = ''; try { txt = fs.readFileSync(arq, 'utf8'); } catch { continue; }
    for (const l of txt.split('\n')) {
      if (!l) continue;
      try { const e = JSON.parse(l); if (Date.parse(e.t) >= desde) saida.push(e); } catch {}
    }
  }
  return saida.sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
}

module.exports = { evento, redigir, recentes, ARQ, ARQ_HIST };
