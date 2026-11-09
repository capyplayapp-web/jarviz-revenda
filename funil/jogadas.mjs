// Livro de jogadas (aprendizado contínuo do funil). Uma chamada por dia ao Haiku (ou Sonnet com --sonnet), custo registrado.
//   node funil/jogadas.mjs --auto      roda uma vez por dia, a partir das 21h (o motor do funil chama)
//   node funil/jogadas.mjs --agora     roda já sobre as últimas 24 h (botão "Ler agora" / POST /api/funil/jogadas)
//   node funil/jogadas.mjs --simular   só monta o texto e mostra o tamanho e o custo estimado
// Grava funil/jogadas.json (rodadas) e funil/jogadas.md (livro). Regras de comportamento seguras entram em relatorios/aprendizados.md
// pelas MESMAS regras do aprender.mjs (sem preço, prazo, link ou política); o resto vira sugestão para o senhor.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const usoIA = createRequire(import.meta.url)('../uso-ia.js');
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { lerJson, gravarJson, lerEventos, mascarar, redigir, ARQ } from '../relatorios/lib.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const PASTA = path.resolve(AQUI, '..');
const ESTADO = path.join(AQUI, 'jogadas-estado.json'), SAIDA = path.join(AQUI, 'jogadas.json'), LIVRO = path.join(AQUI, 'jogadas.md'), LOCK = path.join(AQUI, '.jogando');
const args = new Set(process.argv.slice(2));
const MODELO = args.has('--sonnet') ? 'sonnet' : 'haiku';
const PRECO = { haiku: { in: 1, out: 5 }, sonnet: { in: 3, out: 15 } };      // US$ por milhão de tokens (estimativa)
const sai = (o, c = 0) => { console.log(JSON.stringify(o)); process.exit(c); };
const hoje = new Date().toISOString().slice(0, 10);
const est = lerJson(ESTADO, {});
if (args.has('--auto') && (est.dia === hoje || new Date().getHours() < 21)) sai({ ok: false, motivo: 'fora do horário ou já rodou hoje' });
try { if (fs.existsSync(LOCK) && Date.now() - fs.statSync(LOCK).mtimeMs < 10 * 60e3) sai({ ok: false, motivo: 'já está rodando' }); fs.writeFileSync(LOCK, String(process.pid)); } catch {}

const fim = Date.now(), ini = fim - 24 * 3600e3;
const evs = lerEventos().filter((e) => Date.parse(e.t) >= ini && Date.parse(e.t) <= fim);
const revs = lerJson(ARQ.revendedores, {});
const grupos = new Map();
for (const e of evs) {
  if (!e.chat) continue;
  const g = grupos.get(e.chat) || grupos.set(e.chat, { linhas: [], fechou: false }).get(e.chat);
  const hh = new Date(e.t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const tx = mascarar(e.texto || '').replace(/\s+/g, ' ').slice(0, 240);
  if (e.tipo === 'mensagem_cliente') g.linhas.push(`[${hh}] Cliente: ${tx}`);
  else if (e.tipo === 'resposta_robo') g.linhas.push(`[${hh}] Robô: ${tx}`);
  else if (['followup', 'followup_backlog', 'toque_cadencia', 'toque_jornada', 'retomada_senhor'].includes(e.tipo)) g.linhas.push(`[${hh}] Robô (${e.tipo === 'followup' ? 'follow-up ' + e.n : e.tipo === 'toque_cadencia' ? 'cadência ' + e.angulo : e.tipo === 'toque_jornada' ? 'jornada' : e.tipo === 'retomada_senhor' ? 'retomada' : 'atrasado'}${e.variante ? ' ' + e.variante : ''}): ${tx}`);
  else if (e.tipo === 'senhor_escreveu') g.linhas.push(`[${hh}] (o senhor escreveu)`);
  else if (e.tipo === 'passou_ao_senhor') g.linhas.push(`[${hh}] (passou ao senhor: ${redigir(e.motivo || '').slice(0, 80)})`);
  else if (e.tipo === 'painel_fechado') { g.fechou = true; g.linhas.push(`[${hh}] (CRIOU O PAINEL)`); }
}
for (const [id, g] of grupos) if (revs[id] && Date.parse(revs[id].fechou_em) >= ini) g.fechou = true;
const lista = [...grupos.values()].filter((g) => g.linhas.some((l) => l.includes('Cliente:')));
if (!lista.length) { try { fs.unlinkSync(LOCK); } catch {} sai({ ok: false, motivo: 'sem conversa nas últimas 24 h' }); }
let texto = lista.sort((a, b) => Number(b.fechou) - Number(a.fechou)).map((g, i) => `== Conversa ${i + 1} (${g.fechou ? 'CRIOU PAINEL' : 'não criou'}) ==\n${g.linhas.slice(-40).join('\n')}`).join('\n\n');
if (texto.length > 40000) texto = texto.slice(0, 40000) + '\n(cortado)';
const base = fs.readFileSync(ARQ.base, 'utf8');
const entrada = `# base.md\n${base}\n\n# Conversas das últimas 24 h (${lista.length}; ${lista.filter((g) => g.fechou).length} criaram painel)\n${texto}\n\nEscreva o livro de jogadas no JSON pedido.`;
const tokIn = Math.round((entrada.length + 2000) / 3.2), estimativa = (tokIn * PRECO[MODELO].in + 1500 * PRECO[MODELO].out) / 1e6;
if (args.has('--simular')) { try { fs.unlinkSync(LOCK); } catch {} sai({ ok: true, simulado: true, modelo: MODELO, caracteres: entrada.length, tokens_entrada_aprox: tokIn, custo_estimado_usd: Math.round(estimativa * 10000) / 10000 }); }

function modelo(txt) {
  return new Promise((ok) => {
    const a = ['-p', '--model', MODELO, '--setting-sources', '""', '--system-prompt-file', path.join(AQUI, 'prompt-jogadas.md'), '--tools', '""', '--no-session-persistence', '--strict-mcp-config', '--output-format', 'json'];
    const p = spawn('claude.cmd', a, { cwd: PASTA, shell: true, windowsHide: true });
    let out = ''; const t = setTimeout(() => { p.kill(); ok(null); }, 200000);
    p.stdout.on('data', (d) => (out += d));
    p.on('close', () => {
      clearTimeout(t);
      let env = null; try { env = JSON.parse(out); } catch {}
      if (env && env.type === 'result') usoIA.registrar('jogadas', env, MODELO);
      const corpo = env && typeof env.result === 'string' ? env.result : out;
      const m = corpo.match(/\{[\s\S]*\}/);
      let j = null; try { j = m ? JSON.parse(m[0]) : null; } catch {}
      ok(j ? { j, custo: env && Number.isFinite(env.total_cost_usd) ? env.total_cost_usd : null } : null);
    });
    p.stdin.end(txt);
  });
}
const r = await modelo(entrada);
try { fs.unlinkSync(LOCK); } catch {}
if (!r) sai({ ok: false, motivo: 'o modelo não respondeu' }, 1);
const RX_NEGOCIO = /R\$|\d+\s*(dias?|horas?|h\b|%|cr[eé]ditos?|reais)|https?:|www\.|\.com|\.net|\.site|\.me\/|t\.me|pre[cç]o|valor|pagament|pagar|prazo|desconto|taxa|mensalidade|cobran|pr[eé]-?pago|p[oó]s-?pago|pol[ií]tica|reembols|garantia|gr[aá]tis|gratuit|teste|cr[eé]dito|vence|dia 5|subrevend|promo/i;
const L = (v, n = 8) => (Array.isArray(v) ? v : []).map((x) => redigir(typeof x === 'string' ? x : JSON.stringify(x)).replace(/\s+/g, ' ').trim().slice(0, 240)).filter(Boolean).slice(0, n);
const j = r.j;
const regras = [], sugestoes = L(j.sugestoes_para_o_senhor);
for (const regra of L(j.regras_comportamento, 6)) { if (regra.length <= 160 && !RX_NEGOCIO.test(regra)) regras.push(regra); else if (!sugestoes.includes(regra)) sugestoes.push(regra); }
const perguntas = (Array.isArray(j.perguntas_novas) ? j.perguntas_novas : []).slice(0, 8).map((x) => ({ pergunta: mascarar(x?.pergunta || '').slice(0, 200), resposta_sugerida: redigir(x?.resposta_sugerida || '').slice(0, 300), precisa_aprovacao: x?.envolve_dinheiro_prazo_politica === true || RX_NEGOCIO.test(String(x?.resposta_sugerida || '')) })).filter((x) => x.pergunta);
for (const q of perguntas) sugestoes.push(`Pergunta nova: "${q.pergunta}" Sugestão${q.precisa_aprovacao ? ' (envolve preço, prazo ou política: só com a aprovação do senhor)' : ''}: ${q.resposta_sugerida}`);
const rodada = {
  gerado_em: new Date().toISOString(), modelo: MODELO, custo_usd: Math.round((r.custo ?? estimativa) * 10000) / 10000, custo_medido: r.custo != null, conversas: lista.length, criaram: lista.filter((g) => g.fechou).length,
  resumo: redigir(String(j.resumo || '')).slice(0, 400), padroes_que_fecharam: L(j.padroes_que_fecharam), padroes_que_esfriaram: L(j.padroes_que_esfriaram),
  objecoes: (Array.isArray(j.objecoes) ? j.objecoes : []).slice(0, 8).map((o) => ({ objecao: redigir(o?.objecao || '').slice(0, 160), melhor_resposta: redigir(o?.melhor_resposta || '').slice(0, 240), vezes: Number(o?.vezes) || 1 })),
  perguntas_novas: perguntas, regras_aprovadas: regras, sugestoes_para_o_senhor: sugestoes.slice(0, 12),
};
const hist = lerJson(SAIDA, { rodadas: [] }); hist.rodadas = [...(hist.rodadas || []), rodada].slice(-60); gravarJson(SAIDA, hist);
// regras seguras -> aprendizados.md (mesmo formato do aprender.mjs)
if (regras.length) {
  const ap = lerJson(ARQ.aprendizados, { rodadas: [], regras_ativas: [] });
  const nw = (t) => t.toLowerCase().replace(/[^a-zà-ú0-9 ]/g, '').split(/\s+/).filter((w) => w.length > 3);
  const parecida = (a, b) => { const A = new Set(nw(a)), B = new Set(nw(b)); if (!A.size || !B.size) return false; let i = 0; for (const w of A) if (B.has(w)) i++; return i / Math.min(A.size, B.size) > 0.7; };
  let ativas = ap.regras_ativas || [];
  for (const x of regras.slice(0, 3)) { ativas = ativas.filter((a) => !parecida(a.regra, x)); ativas.unshift({ regra: x, desde: rodada.gerado_em, origem: 'jogadas' }); }
  ap.regras_ativas = ativas.slice(0, 25); gravarJson(ARQ.aprendizados, ap);
  fs.writeFileSync(ARQ.aprendizadosMd, `# Aprendizados do atendimento (gerado sozinho, a cada leitura de 2 h)\nRegras de comportamento aprovadas pelo filtro. Sem preço, prazo ou link. O robô lê este arquivo junto com o base.md.\n\n${ap.regras_ativas.map((a) => '- ' + a.regra).join('\n')}\n`);
}
// livro em Markdown (as rodadas mais novas primeiro)
const sec = (r) => `## ${new Date(r.gerado_em).toLocaleString('pt-BR')} · ${r.conversas} conversas, ${r.criaram} criaram painel · ${r.modelo} US$ ${r.custo_usd}\n\n${r.resumo}\n\n**O que fechou**\n${r.padroes_que_fecharam.map((x) => '- ' + x).join('\n') || '- (nada claro)'}\n\n**O que esfriou**\n${r.padroes_que_esfriaram.map((x) => '- ' + x).join('\n') || '- (nada claro)'}\n\n**Objeções e a melhor resposta**\n${r.objecoes.map((o) => `- ${o.objecao} → ${o.melhor_resposta}`).join('\n') || '- (nenhuma)'}\n\n**Regras de jeito aprovadas pelo filtro**\n${r.regras_aprovadas.map((x) => '- ' + x).join('\n') || '- (nenhuma)'}\n\n**Para o senhor decidir**\n${r.sugestoes_para_o_senhor.map((x) => '- ' + x).join('\n') || '- (nada)'}\n`;
fs.writeFileSync(LIVRO, `# Livro de jogadas do funil (gerado sozinho toda noite)\n\nCada rodada lê as conversas de 24 h. Regras de jeito seguras entram no robô; preço, prazo, política e link novo ficam para o senhor.\n\n${hist.rodadas.slice().reverse().slice(0, 15).map(sec).join('\n')}`);
gravarJson(ESTADO, { dia: hoje, ultima: rodada.gerado_em, custo_usd: rodada.custo_usd });
sai({ ok: true, gerado_em: rodada.gerado_em, modelo: MODELO, custo_usd: rodada.custo_usd, conversas: lista.length, regras: regras.length, sugestoes: rodada.sugestoes_para_o_senhor.length });
