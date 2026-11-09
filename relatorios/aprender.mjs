// Leitura das últimas 2 horas de atendimento + aprendizado (uma chamada ao Haiku).
//   node relatorios/aprender.mjs --auto     só roda se passou o intervalo (2 h) e houve conversa nova (o bot chama a cada 10 min)
//   node relatorios/aprender.mjs --agora    roda já, sobre as últimas 2 h (botão da tela / POST /api/aprender)
//   node relatorios/aprender.mjs --simular  monta o texto e imprime o tamanho, sem chamar o Haiku
// Gera: aprendizados.json (histórico por rodada), aprendizados.md (regras aprovadas, até 25, as mais novas primeiro)
// Última linha da saída: um JSON { ok, ... } (o servidor lê isso).
import fs from 'node:fs';
import { createRequire } from 'node:module';
const usoIA = createRequire(import.meta.url)('../uso-ia.js');
import { spawn } from 'node:child_process';
import path from 'node:path';
import { ARQ, AQUI, PASTA, lerJson, gravarJson, lerEventos, lerConversas, mascarar, redigir } from './lib.mjs';

const CFG = { janela_horas: 2, intervalo_horas: 2, max_regras_ativas: 25, max_regras_por_rodada: 5, ...lerJson(path.join(AQUI, 'config.json'), {}) };
const args = new Set(process.argv.slice(2));
const LOCK = path.join(AQUI, '.aprendendo');
const sai = (obj, codigo = 0) => { console.log(JSON.stringify(obj)); process.exit(codigo); };

const agora = Date.now();
const estado = lerJson(ARQ.estadoAprender, {});
const ini = agora - CFG.janela_horas * 3600e3;

// 1) Dados da janela
const eventos = lerEventos().filter((e) => Date.parse(e.t) >= ini && Date.parse(e.t) <= agora);
const conv = lerConversas().filter((c) => c.t.getTime() >= ini && c.t.getTime() <= agora);
const clientes = conv.filter((c) => c.tipo === 'cliente');
if (!clientes.length) sai({ ok: false, motivo: 'sem conversa nas últimas ' + CFG.janela_horas + ' h' });
if (args.has('--auto')) {
  if (agora - (estado.ultima_execucao || 0) < CFG.intervalo_horas * 3600e3) sai({ ok: false, motivo: 'ainda não passou o intervalo' });
  const fimAnt = estado.fim_ultima_janela || 0;
  if (!clientes.some((c) => c.t.getTime() > fimAnt)) sai({ ok: false, motivo: 'sem conversa nova desde a última leitura' });
}
try { if (fs.existsSync(LOCK) && agora - fs.statSync(LOCK).mtimeMs < 10 * 60e3) sai({ ok: false, motivo: 'já está rodando' }); fs.writeFileSync(LOCK, String(process.pid)); } catch {}

// 2) Texto das conversas (sem senha, sem e-mail)
const hhmm = (d) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const grupos = new Map();
for (const c of conv) {
  if (!['cliente', 'robo', 'senhor', 'bloqueio', 'haiku'].includes(c.tipo)) continue;
  const chave = c.chat || c.nome || '?';
  if (!grupos.has(chave)) grupos.set(chave, { nome: c.nome || '', linhas: [] });
  const g = grupos.get(chave); if (!g.nome && c.nome) g.nome = c.nome;
  const tx = mascarar(c.texto || '').replace(/\s+/g, ' ').slice(0, 260);
  if (c.tipo === 'cliente') g.linhas.push(`[${hhmm(c.t)}] Cliente: ${tx}`);
  else if (c.tipo === 'robo') g.linhas.push(`[${hhmm(c.t)}] Robô${/\[follow-up/.test(tx) ? ' (follow-up)' : ''}: ${tx.replace(/^\[follow-up[^\]]*\]\s*/, '')}`);
  else if (c.tipo === 'senhor') g.linhas.push(`[${hhmm(c.t)}] (o senhor escreveu na conversa)`);
  else if (c.tipo === 'bloqueio') g.linhas.push(`[${hhmm(c.t)}] (repetição bloqueada: ${tx.slice(0, 80)})`);
  else if (c.tipo === 'haiku') g.linhas.push(`[${hhmm(c.t)}] (o robô não conseguiu responder)`);
}
let conversas = [...grupos.values()].filter((g) => g.linhas.length).map((g, i) => `== Conversa ${i + 1}: ${mascarar(g.nome || 'sem nome')} ==\n${g.linhas.join('\n')}`).join('\n\n');
if (conversas.length > 26000) conversas = '(início cortado)\n' + conversas.slice(-26000);
const n = (tipo) => eventos.filter((e) => e.tipo === tipo).length;
const metricas = { mensagens_cliente: clientes.length, respostas_robo: n('resposta_robo'), followups: n('followup'), followups_respondidos: n('cliente_respondeu_followup'), testes: n('teste_gerado'), paineis_fechados: n('painel_fechado'), passados_ao_senhor: n('passou_ao_senhor'), repeticoes_bloqueadas: n('repeticao_bloqueada'), erros: n('erro') };
const base = fs.readFileSync(ARQ.base, 'utf8');
const entrada = `# base.md (regras atuais do robô)\n${base}\n\n# Números do período (${hhmm(new Date(ini))} às ${hhmm(new Date(agora))})\n${JSON.stringify(metricas)}\n\n# Conversas\n${conversas}\n\nFaça a análise no formato JSON pedido.`;
if (args.has('--simular')) { try { fs.unlinkSync(LOCK); } catch {} sai({ ok: true, simulado: true, caracteres: entrada.length, conversas: grupos.size, metricas }); }

// 3) Haiku (igual ao perguntarHaiku do bot)
function haiku(texto) {
  return new Promise((ok) => {
    const a = ['-p', '--model', 'haiku', '--setting-sources', '""', '--system-prompt-file', path.join(AQUI, 'prompt-aprender.md'), '--tools', '""', '--no-session-persistence', '--strict-mcp-config', '--output-format', 'json'];
    const p = spawn('claude.cmd', a, { cwd: PASTA, shell: true, windowsHide: true });
    let out = ''; const t = setTimeout(() => { p.kill(); ok(null); }, 120000);
    p.stdout.on('data', (d) => (out += d));
    p.on('close', () => { clearTimeout(t); const m = usoIA.desembrulhar(out, 'aprender', 'haiku').match(/\{[\s\S]*\}/); try { ok(m ? JSON.parse(m[0]) : null); } catch { ok(null); } });
    p.stdin.end(texto);
  });
}
const r = await haiku(entrada);
try { fs.unlinkSync(LOCK); } catch {}
if (!r) sai({ ok: false, motivo: 'o Haiku não respondeu' }, 1);

// 4) Filtro das regras: só comportamento, curtas, sem preço/prazo/link, sem contradizer o base.md
const RX_NEGOCIO = /R\$|\d+\s*(dias?|horas?|h\b|%|cr[eé]ditos?|reais)|https?:|www\.|\.com|\.net|\.site|\.me\/|t\.me|pre[cç]o|valor|pagament|pagar|prazo|desconto|taxa|mensalidade|cobran|pr[eé]-?pago|p[oó]s-?pago|pol[ií]tica|reembols|garantia|gr[aá]tis|gratuit|teste|cr[eé]dito|vence|dia 5|subrevend|promo/i;
const lista = (v) => (Array.isArray(v) ? v : []).map((x) => redigir(typeof x === 'string' ? x : JSON.stringify(x)).replace(/\s+/g, ' ').trim()).filter(Boolean);
const regras = [], sugestoes = lista(r.sugestoes_para_o_senhor);
const inconsistencias = (Array.isArray(r.inconsistencias) ? r.inconsistencias : []).slice(0, 12).map((x) => ({
  tipo: redigir(x?.tipo || '').slice(0, 40), titulo: redigir(x?.titulo || '').slice(0, 120), exemplo: mascarar(x?.exemplo || '').slice(0, 400),
  causa: redigir(x?.causa || '').slice(0, 200), regra: redigir(x?.regra || '').slice(0, 200),
})).filter((x) => x.titulo || x.exemplo);
const perguntas = (Array.isArray(r.perguntas_nao_cobertas) ? r.perguntas_nao_cobertas : []).slice(0, 12).map((x) => ({
  pergunta: mascarar(x?.pergunta || '').slice(0, 200), resposta_sugerida: redigir(x?.resposta_sugerida || '').slice(0, 300),
  precisa_aprovacao: x?.envolve_dinheiro_prazo_politica === true || RX_NEGOCIO.test(String(x?.resposta_sugerida || '')),
})).filter((x) => x.pergunta);
for (const q of perguntas) { const t = `Pergunta sem resposta no base.md: "${q.pergunta}" Sugestão${q.precisa_aprovacao ? ' (envolve preço, prazo ou política, só com a aprovação do senhor)' : ''}: ${q.resposta_sugerida}`; if (!sugestoes.includes(t)) sugestoes.push(t); }
const candidatas = (Array.isArray(r.regras_novas) ? r.regras_novas : []).concat(inconsistencias.filter((x) => x.regra).map((x) => ({ regra: x.regra, tipo: 'comportamento', contradiz_base: false })));
for (const x of candidatas.slice(0, 20)) {
  const regra = redigir(typeof x === 'string' ? x : x?.regra).replace(/\s+/g, ' ').trim();
  if (!regra) continue;
  const tipoOk = (typeof x === 'string' ? 'comportamento' : x.tipo) === 'comportamento' && x.contradiz_base !== true;
  if (tipoOk && regra.length <= 160 && !RX_NEGOCIO.test(regra)) regras.push({ regra, status: 'aprovada' });
  else { regras.push({ regra, status: 'sugestao' }); if (!sugestoes.includes(regra)) sugestoes.push(regra); }
}
const aprovadas = [...new Map(regras.filter((x) => x.status === 'aprovada').map((x) => [x.regra, x])).values()].slice(0, CFG.max_regras_por_rodada);
regras.forEach((x) => { if (x.status === 'aprovada' && !aprovadas.includes(x)) x.status = 'descartada'; });

// 5) Grava a rodada e regera o aprendizados.md (até 25 regras, as mais novas primeiro, sem repetir)
const rodada = {
  id: new Date(agora).toISOString(), gerado_em: new Date(agora).toISOString(),
  janela: { inicio: new Date(ini).toISOString(), fim: new Date(agora).toISOString() },
  metricas, resumo: lista(Array.isArray(r.resumo) ? r.resumo : [r.resumo]).slice(0, 5).join('\n'),
  funcionou: lista(r.funcionou), deu_errado: lista(r.deu_errado),
  problemas: {
    respostas_repetidas: lista(r.problemas?.respostas_repetidas), perguntas_ja_respondidas: lista(r.problemas?.perguntas_ja_respondidas),
    cliente_sumiu: (Array.isArray(r.problemas?.cliente_sumiu) ? r.problemas.cliente_sumiu : []).slice(0, 10).map((x) => ({ nome: redigir(x?.nome || ''), depois_de: redigir(x?.depois_de || '').slice(0, 200) })),
    objecoes: lista(r.problemas?.objecoes), duvidas_nao_cobertas: lista(r.problemas?.duvidas_nao_cobertas),
  },
  inconsistencias, perguntas_nao_cobertas: perguntas, regras_novas: regras, sugestoes_para_o_senhor: sugestoes,
};
const hist = lerJson(ARQ.aprendizados, { rodadas: [], regras_ativas: [] });
hist.rodadas = [...(hist.rodadas || []), rodada].slice(-200);
const norm = (t) => t.toLowerCase().replace(/[^a-zà-ú0-9 ]/g, '').split(/\s+/).filter((w) => w.length > 3);
const parecida = (a, b) => { const A = new Set(norm(a)), B = new Set(norm(b)); if (!A.size || !B.size) return false; let i = 0; for (const w of A) if (B.has(w)) i++; return i / Math.min(A.size, B.size) > 0.7; };
let ativas = hist.regras_ativas || [];
for (const x of aprovadas) {
  ativas = ativas.filter((a) => !parecida(a.regra, x.regra));
  ativas.unshift({ regra: x.regra, desde: rodada.gerado_em });
}
hist.regras_ativas = ativas.slice(0, CFG.max_regras_ativas);
gravarJson(ARQ.aprendizados, hist);
fs.writeFileSync(ARQ.aprendizadosMd, `# Aprendizados do atendimento (gerado sozinho, a cada leitura de 2 h)\nRegras de comportamento aprovadas pelo filtro. Sem preço, prazo ou link. O robô lê este arquivo junto com o base.md.\n\n${hist.regras_ativas.map((a) => '- ' + a.regra).join('\n')}\n`);
gravarJson(ARQ.estadoAprender, { ultima_execucao: agora, fim_ultima_janela: agora });
sai({ ok: true, gerado_em: rodada.gerado_em, aprovadas: aprovadas.length, sugestoes: sugestoes.length, metricas });
