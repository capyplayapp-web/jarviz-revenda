// Escritório do Jarvis (tela inicial do dashboard, 08/11/2026).
// GET /api/escritorio?dias=1|7 → quem está na sala (por etiqueta), os últimos acontecimentos e o estado do Jarvis.
// Só lê: funil\leads.json (etiqueta e estado de cada lead, gravado pelo motor) e eventos.jsonl (o que o bot faz).
// Nada de telefone, texto de mensagem ou id de conversa: só ref (sha1 curto do id, o mesmo do funil) e o primeiro nome.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PASTA, lerJson } from './lib.mjs';

const LEADS = path.join(PASTA, 'funil', 'leads.json');
const EVENTOS = path.join(PASTA, 'eventos.jsonl');
const ETIQUETAS = ['lead', 'teste', 'revendedor', 'suporte', 'esfriou', 'atrasado', 'senhor'];
const TIPOS = new Set(['mensagem_cliente', 'resposta_robo', 'followup', 'followup_backlog', 'toque_cadencia', 'toque_jornada', 'retomada_senhor', 'retorno_lacuna',
  'passou_ao_senhor', 'teste_gerado', 'painel_fechado', 'senhor_escreveu', 'conversa_nova', 'cliente_respondeu_followup']);
const ROTULO_ESTADO = { novo: 'Novo', em_conversa: 'Em conversa', aguardando_cliente: 'Aguardando o cliente', aguardando_nos: 'Aguardando nós', esfriando: 'Esfriando', fechou: 'Fechou painel', perdido_definitivo: 'Adormecido', nao_incomodar: 'Não incomodar', encerrada: 'Encerrou (ok/obrigado)', fora_do_funil: 'Fora do funil' };
const ROTULO_PASSO = { responder: 'Responder agora', ao_vivo: 'Follow-up da escada', cadencia: 'Toque da cadência', atrasado: 'Fila do atrasado', senhor: 'Com o senhor (lembrete)', retomada: 'Robô retoma', com_o_senhor: 'Senhor respondeu por último', quieto: 'Em silêncio', jornada: 'Jornada do revendedor' };
const refDe = (id) => crypto.createHash('sha1').update(String(id)).digest('hex').slice(0, 10);

// Primeiro nome, sem emoji, sem número de telefone no lugar do nome.
function nomeCurto(n) {
  const limpo = String(n || '').replace(/[^\p{L}\p{N} .'-]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!limpo || /^\d{6,}$/.test(limpo.replace(/\s/g, ''))) return 'Cliente';
  const p = limpo.split(' ')[0].replace(/[.@]+$/, '');
  return p.length > 12 ? p.slice(0, 11) + '…' : p.charAt(0).toUpperCase() + p.slice(1);
}

// Lê só o fim do arquivo de eventos (o arquivo cresce o dia todo).
function eventosRecentes(desde, max = 400) {
  let txt = '';
  try {
    const fd = fs.openSync(EVENTOS, 'r'), tam = fs.fstatSync(fd).size, ler = Math.min(tam, 600 * 1024);
    const buf = Buffer.alloc(ler); fs.readSync(fd, buf, 0, ler, tam - ler); fs.closeSync(fd);
    txt = buf.toString('utf8');
  } catch { return []; }
  const out = [];
  for (const linha of txt.split('\n')) {
    if (!linha.startsWith('{')) continue;
    let e; try { e = JSON.parse(linha); } catch { continue; }
    if (!e || !TIPOS.has(e.tipo) || !e.chat || e.varredura) continue;
    const t = Date.parse(e.t); if (!Number.isFinite(t) || t < desde) continue;
    out.push({ t: new Date(t).toISOString(), ref: refDe(e.chat), nome: nomeCurto(e.nome), tipo: e.tipo });
  }
  return out.slice(-max);
}

const inicioPeriodo = (dias) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (dias - 1)); return d.getTime(); };

export function resumoEscritorio({ dias = 1 } = {}) {
  dias = Math.min(Math.max(parseInt(dias, 10) || 1, 1), 7);
  const agora = Date.now(), ini = inicioPeriodo(dias);
  const L = lerJson(LEADS, { leads: [] });
  const todos = Array.isArray(L.leads) ? L.leads : [];
  const total = Object.fromEntries(ETIQUETAS.map((k) => [k, 0]));
  const pessoas = [];
  for (const l of todos) {
    if (!l || !ETIQUETAS.includes(l.etiqueta)) continue;
    total[l.etiqueta]++;
    const t = Date.parse(l.ultimo_contato);
    if (!Number.isFinite(t) || t < ini) continue;
    pessoas.push({
      ref: l.ref, nome: nomeCurto(l.nome), etiqueta: l.etiqueta, estado: ROTULO_ESTADO[l.estado] || l.estado || '',
      ultimo_contato: new Date(t).toISOString(), ultimo_quem: l.ultimo_quem || null,
      proximo: l.proximo ? { rotulo: ROTULO_PASSO[l.proximo.tipo] || l.proximo.rotulo || l.proximo.tipo || '', quando: l.proximo.quando || null } : null,
      toques: l.toques_21d ?? l.toques ?? 0,
    });
  }
  pessoas.sort((a, b) => Date.parse(b.ultimo_contato) - Date.parse(a.ultimo_contato));
  const eventos = eventosRecentes(Math.max(ini, agora - 6 * 3600e3));
  const ultResp = [...eventos].reverse().find((e) => e.tipo === 'resposta_robo' || e.tipo === 'followup');
  const ultMsg = [...eventos].reverse().find((e) => e.tipo === 'mensagem_cliente');
  return {
    gerado_em: new Date(agora).toISOString(), dias, leads_em: L.atualizado_em || null,
    total, pessoas: pessoas.slice(0, 160), eventos: eventos.slice(-80),
    jarvis: {
      digitando: !!(ultResp && agora - Date.parse(ultResp.t) < 25e3),
      com: ultResp && agora - Date.parse(ultResp.t) < 25e3 ? ultResp.ref : null,
      ultima_resposta: ultResp ? ultResp.t : null, ultima_mensagem: ultMsg ? ultMsg.t : null,
    },
  };
}
