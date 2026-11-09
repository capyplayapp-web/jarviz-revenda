// Reconstrói os eventos de um dia a partir de conversas.log + clientes.json + revendedores.json.
//   node relatorios/historico.mjs            (hoje)      node relatorios/historico.mjs 2026-11-08
// Grava eventos-historico.jsonl (origem: "historico"). Pode rodar de novo à vontade: o arquivo é refeito.
// Só vale até o primeiro evento ao vivo (eventos.jsonl); depois dele o servidor ignora o histórico. Nada de senha.
import fs from 'node:fs';
import { ARQ, lerJson, lerConversas, lerRevendedoresLista, redigir } from './lib.mjs';

const dia = process.argv[2] || new Date().toLocaleDateString('sv-SE');
const [Y, M, D] = dia.split('-').map(Number);
const ini = new Date(Y, M - 1, D, 0, 0, 0).getTime(), fim = ini + 86400e3;

// corte: o primeiro evento ao vivo que não veio de varredura
let corte = Infinity;
try {
  for (const l of fs.readFileSync(ARQ.eventos, 'utf8').split('\n')) {
    if (!l) continue; try { const e = JSON.parse(l); if (!e.varredura) corte = Math.min(corte, Date.parse(e.t)); } catch {}
  }
} catch {}
const limite = Math.min(fim, corte);

const fichas = lerJson(ARQ.clientes, {});
const out = [];
const add = (t, tipo, chat, nome, dados = {}) => {
  const ms = t instanceof Date ? t.getTime() : Date.parse(t);
  if (ms < ini || ms >= limite) return;
  out.push({ t: new Date(ms).toISOString(), chat: chat || null, nome: nome || (chat && fichas[chat]?.nome) || null, tipo, origem: 'historico', ...dados });
};
const red = (t) => redigir(t).slice(0, 600);

const conv = lerConversas();
const bloqueadas = new Set();           // chat|texto bloqueados: a linha "robô ->" que vem junto não foi enviada
let ultimoCliente = null;               // último chat que falou (para "Haiku não respondeu")
const ultimoAudio = new Map();          // chat -> t da transcrição (a linha "[ptt]" logo depois é a mesma mensagem)
const fuUlt = new Map();                // chat -> { n, t } follow-up aguardando resposta

for (const c of conv) {
  const t = c.t;
  if (t.getTime() < ini || t.getTime() >= fim) continue;
  if (c.tipo === 'cliente') {
    const chat = c.chat;
    const partes = c.audio ? [c.texto] : c.texto.split(' | ');
    if (!c.audio && /^\[(ptt|audio|image|document|sticker|video)\]$/.test(c.texto.trim())) {
      if (chat && ultimoAudio.has(chat) && t - ultimoAudio.get(chat) < 3000) continue;      // mesma mensagem de áudio
    }
    if (c.audio && chat) ultimoAudio.set(chat, t);
    if (/^\[notification_template\]$/.test(c.texto.trim())) continue;
    ultimoCliente = chat || ultimoCliente;
    for (const p of partes) {
      const tp = p.trim();
      const msg_tipo = c.audio ? 'ptt' : (tp.match(/^\[(\w+)\]$/)?.[1] || 'chat');
      add(t, 'mensagem_cliente', chat, c.nome, { msg_tipo, texto: c.audio ? '(áudio) ' + red(tp) : red(tp) });
    }
    const fu = chat && fuUlt.get(chat);
    if (fu) { fuUlt.delete(chat); add(t, 'cliente_respondeu_followup', chat, c.nome, { n: fu.n, followup_t: fu.t, minutos_ate_resposta: Math.round((t - Date.parse(fu.t)) / 6000) / 10 }); }
  } else if (c.tipo === 'bloqueio') {
    bloqueadas.add(c.chat + '|' + c.texto);
    add(t, 'repeticao_bloqueada', c.chat, c.nome, { texto: red(c.texto) });
  } else if (c.tipo === 'robo') {
    const txt = c.texto;
    if (bloqueadas.has(c.chat + '|' + txt)) { bloqueadas.delete(c.chat + '|' + txt); continue; }
    let m;
    if ((m = txt.match(/^\[follow-up (?:(\d+) · )?(\d+) min\] ([\s\S]*)$/))) {
      const n = m[1] ? +m[1] : 1; const ev = { n, minutos: +m[2], texto: red(m[3]) };
      add(t, 'followup', c.chat, c.nome, ev);
      if (c.chat) fuUlt.set(c.chat, { n, t: t.toISOString() });
    } else if ((m = txt.match(/^\[teste (\S+) enviado\]/))) {
      add(t, 'teste_gerado', c.chat, c.nome, { usuario: m[1], horas: 6 });
    } else {
      const midia = /^\[(vídeo|guia|saudação|envio manual)/.test(txt);
      add(t, 'resposta_robo', c.chat, c.nome, { texto: red(txt.replace(/^\[envio manual\] /, '')), ...(midia && !/envio manual/.test(txt) ? { midia: true } : {}), ...(/^\[envio manual\]/.test(txt) ? { manual: true } : {}) });
      if (/passar (?:para|pro) o respons[aá]vel/i.test(txt)) add(t, 'passou_ao_senhor', c.chat, c.nome, { motivo: /comprovante|confer/i.test(txt) ? 'foto ou arquivo (talvez comprovante)' : 'o robô pediu a ajuda do senhor (motivo não registrado no log)' });
    }
  } else if (c.tipo === 'senhor') add(t, 'senhor_escreveu', c.chat, c.nome, {});
  else if (c.tipo === 'haiku') { add(t, 'passou_ao_senhor', ultimoCliente, null, { motivo: 'o robô não conseguiu responder (Haiku sem resposta)' }); add(t, 'erro', ultimoCliente, null, { onde: 'haiku_sem_resposta', mensagem: 'Haiku não respondeu' }); }
  else if (c.tipo === 'erro') add(t, 'erro', null, null, { onde: 'log', mensagem: red(c.texto).slice(0, 200) });
}

// Conversas novas (ficha criada no dia) e painéis fechados (revendedores.json)
for (const [id, f] of Object.entries(fichas)) if (f.criado_em) add(f.criado_em, 'conversa_nova', id, f.nome);
for (const p of lerRevendedoresLista()) add(p.quando, 'painel_fechado', p.contato_id, p.nome, { usuario_painel: p.usuario_painel || null, painel_id: p.painel_id ?? null, fonte: p.fonte, origem: 'historico' });
// Painéis fechados por etapa (painel_criado) que ainda não estão no revendedores.json: aparecem só depois que o robô os registra.

out.sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
// o arquivo guarda os dias já reconstruídos; refaz só o dia pedido
let antes = [];
try { antes = fs.readFileSync(ARQ.historico, 'utf8').split('\n').filter(Boolean).filter((l) => { try { const t = Date.parse(JSON.parse(l).t); return t < ini || t >= fim; } catch { return false; } }); } catch {}
fs.writeFileSync(ARQ.historico, antes.concat(out.map((e) => JSON.stringify(e))).join('\n') + '\n');
const cont = {}; for (const e of out) cont[e.tipo] = (cont[e.tipo] || 0) + 1;
console.log(JSON.stringify({ ok: true, dia, ate: corte === Infinity ? 'agora (sem eventos ao vivo ainda)' : new Date(corte).toISOString(), eventos: out.length, por_tipo: cont }));
