// Gasto de IA do robô (08/11/2026). Lê ../uso-ia.jsonl (gravado por uso-ia.js em cada chamada do claude -p).
// GET /api/uso?dias=1|7 -> totais e divisão em Responder / Gerenciar / Analisar.
import fs from 'node:fs';
import path from 'node:path';
import { PASTA } from './lib.mjs';

const ARQ = path.join(PASTA, 'uso-ia.jsonl');
const INICIO_CONTAGEM = Date.parse('2026-11-08T22:55:00-03:00'); // quando a contagem foi ligada
export const GRUPOS = {
  responder: { nome: 'Responder', areas: ['responder', 'followup'] },
  gerenciar: { nome: 'Gerenciar', areas: ['funil', 'backlog'] },
  analisar: { nome: 'Analisar', areas: ['releitura', 'aprender', 'lacunas', 'jogadas'] },
};
const NOME_AREA = { responder: 'Atendimento', followup: 'Follow-ups', funil: 'Funil e jornada', backlog: 'Atrasados', releitura: 'Releitura', aprender: 'Leitura de 2 h', lacunas: 'Lacunas', jogadas: 'Livro de jogadas' };
const grupoDe = (a) => Object.keys(GRUPOS).find((g) => GRUPOS[g].areas.includes(a)) || 'analisar';

function inicioDoPeriodo(dias) {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (dias - 1)); return d.getTime();
}
const vazio = () => ({ chamadas: 0, tokens: 0, entrada: 0, cache: 0, saida: 0, custo: 0 });
function somar(a, l) {
  const ent = (l.entrada || 0) + (l.cache_criada || 0);
  a.chamadas++; a.entrada += ent; a.cache += l.cache_lida || 0; a.saida += l.saida || 0;
  a.tokens += ent + (l.cache_lida || 0) + (l.saida || 0); a.custo += l.custo || 0;
}

export function resumoUso({ dias = 1 } = {}) {
  dias = Math.max(1, Math.min(31, Number(dias) || 1));
  const ini = inicioDoPeriodo(dias);
  const total = vazio(), grupos = {}, areas = {}, porHora = new Array(24).fill(0);
  for (const g of Object.keys(GRUPOS)) grupos[g] = { nome: GRUPOS[g].nome, ...vazio() };
  let desde = null;
  let linhas = [];
  try { linhas = fs.readFileSync(ARQ, 'utf8').split('\n'); } catch {}
  for (const s of linhas) {
    if (!s) continue;
    let l; try { l = JSON.parse(s); } catch { continue; }
    const t = Date.parse(l.t); if (!desde || t < desde) desde = t;
    if (!(t >= ini) || l.area === 'teste') continue;
    somar(total, l); somar(grupos[grupoDe(l.area)], l);
    (areas[l.area] = areas[l.area] || { nome: NOME_AREA[l.area] || l.area, grupo: grupoDe(l.area), ...vazio() }); somar(areas[l.area], l);
    porHora[new Date(t).getHours()] += (l.entrada || 0) + (l.cache_criada || 0) + (l.cache_lida || 0) + (l.saida || 0);
  }
  const resp = grupos.responder.chamadas;
  return {
    dias, desde: new Date(desde || INICIO_CONTAGEM).toISOString(), total, grupos,
    areas: Object.entries(areas).map(([k, v]) => ({ area: k, ...v })).sort((a, b) => b.tokens - a.tokens),
    por_resposta: resp ? Math.round(grupos.responder.tokens / resp) : 0,
    por_hora: dias === 1 ? porHora : null,
    nota: 'Custo em dólar é o equivalente de API informado pelo Claude; tokens contam entrada, cache e saída.',
  };
}
