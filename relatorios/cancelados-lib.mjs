// Painéis cancelados (09/11/2026, pedido do senhor): taxa de painéis cancelados no Sigma, o motivo de cada um e o botão
// "Corrigir erro", que chama o Opus para estudar as conversas daquele motivo e escrever como contornar. A regra entra no
// base.md (entre as marcas <!-- contornos:inicio/fim -->) e o Haiku já atende com ela na próxima mensagem (o bot refaz o
// prompt quando o base.md muda). Desfazer tira só a parte daquele motivo.
//   GET  /api/cancelados                      resumo (taxa, motivos, contornos, estado da leitura e do Opus)
//   POST /api/cancelados/ler                  pede ao robô a leitura das conversas (funil/comando.json → funil/cancelados.js)
//   POST /api/cancelados/corrigir {categoria} Opus estuda e grava o contorno
//   POST /api/cancelados/desfazer {categoria} tira o contorno do base.md
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { PASTA, lerJson } from './lib.mjs';

const require = createRequire(import.meta.url);
const DIR = path.join(PASTA, 'cancelados');
const SAIDA = process.env.CANCELADOS_SAIDA || DIR;   // só nos testes: grava contornos e base.md numa cópia
const ARQ = {
  sigma: path.join(PASTA, 'sigma-cache.json'), motivos: path.join(DIR, 'motivos.json'), conversas: path.join(DIR, 'conversas.json'),
  estado: path.join(DIR, 'estado.json'), contornos: path.join(SAIDA, 'contornos.json'), promptOpus: path.join(DIR, 'prompt-opus.md'),
  base: process.env.CANCELADOS_BASE || path.join(PASTA, 'base.md'), comando: path.join(PASTA, 'funil', 'comando.json'), eventos: path.join(PASTA, 'eventos.jsonl'),
};
const MODELO_OPUS = 'claude-opus-5-5';
const INICIO = '<!-- contornos:inicio -->', FIM = '<!-- contornos:fim -->';
const gravar = (arq, obj) => { fs.mkdirSync(path.dirname(arq), { recursive: true }); const t = arq + '.tmp'; fs.writeFileSync(t, JSON.stringify(obj, null, 1)); fs.renameSync(t, arq); };

export const CATEGORIAS = {
  nunca_comecou: 'Abriu o painel e nunca começou',
  nao_conseguiu_vender: 'Não conseguiu vender',
  instabilidade: 'Instabilidade ou app travando',
  dificuldade_tecnica: 'Não conseguiu instalar',
  preco_cobranca: 'Preço, mínimo ou cobrança',
  desconfianca: 'Desconfiança (achou golpe)',
  outro_fornecedor: 'Foi para outro fornecedor',
  sem_resposta_nossa: 'Ficou sem resposta nossa',
  sumiu_sem_dizer: 'Sumiu sem dizer o motivo',
  desativado_por_nos: 'Desativado por nós',
  outro: 'Outro motivo',
};
// O que o Opus não deve tentar "contornar" pelo atendimento (decisão da equipe).
const SEM_CONTORNO = new Set(['desativado_por_nos']);

// ---------- Resumo ----------
function pediramCancelar() {
  // alertas vermelhos dos últimos 30 dias que não foram resolvidos (o revendedor falou em cancelar e ninguém segurou)
  let txt = ''; try { txt = fs.readFileSync(ARQ.eventos, 'utf8'); } catch {}
  const desde = Date.now() - 30 * 864e5, aberto = new Map();
  for (const l of txt.split('\n')) {
    if (!l.includes('"alerta_')) continue;
    let e; try { e = JSON.parse(l); } catch { continue; }
    if (Date.parse(e.t) < desde) continue;
    if (e.tipo === 'alerta_vermelho') aberto.set(e.chat, { nome: e.nome || '', texto: e.texto || '', em: e.t });
    else if (e.tipo === 'alerta_resolvido') aberto.delete(e.chat);
  }
  return [...aberto.values()];
}

export function resumoCancelados() {
  const sg = lerJson(ARQ.sigma, null);
  const revs = (sg && Array.isArray(sg.revendedores)) ? sg.revendedores : [];
  const cancelados = revs.filter((r) => r.status && r.status !== 'ACTIVE');
  const motivos = lerJson(ARQ.motivos, { itens: {} }), itens = motivos.itens || {};
  const contornos = lerJson(ARQ.contornos, {}), estado = lerJson(ARQ.estado, null), opus = estadoOpus();
  const grupos = {};
  for (const r of cancelados) {
    const m = itens[r.id];
    const chave = m ? m.categoria : 'nao_lido';
    const g = grupos[chave] || (grupos[chave] = { chave, nome: CATEGORIAS[chave] || 'Ainda sem motivo lido', n: 0, evitaveis: 0, pessoas: [] });
    g.n++; if (m && m.evitavel) g.evitaveis++;
    g.pessoas.push({ id: r.id, nome: r.nome || r.usuario, whatsapp: r.whatsapp || null, criado_em: r.criado_em, clientes_total: r.clientes_total || 0,
      motivo: m ? m.motivo : null, citacao: m ? m.citacao : null, pediu_cancelar: !!(m && m.pediu_cancelar), tem_conversa: !!(m && m.tem_conversa), confianca: m ? m.confianca : 0 });
  }
  const total = revs.length, nCanc = cancelados.length;
  const lista = Object.values(grupos).sort((a, b) => (a.chave === 'nao_lido') - (b.chave === 'nao_lido') || b.n - a.n).map((g) => {
    g.pct = nCanc ? Math.round((g.n / nCanc) * 100) : 0;
    g.pessoas.sort((a, b) => (!!b.citacao - !!a.citacao) || b.confianca - a.confianca);
    const c = contornos[g.chave];
    g.contorno = c ? { em: c.em, regras: c.regras, diagnostico: c.diagnostico, exemplo: c.exemplo, para_o_senhor: c.para_o_senhor, rejeitadas: c.rejeitadas, custo: c.custo, casos: c.casos } : null;
    g.corrigivel = g.chave !== 'nao_lido' && !SEM_CONTORNO.has(g.chave);
    return g;
  });
  const lidos = cancelados.filter((r) => itens[r.id]).length;
  return {
    lido_sigma_em: sg ? sg.lido_em : null,
    total_paineis: total, cancelados: nCanc, taxa: total ? Math.round((nCanc / total) * 1000) / 10 : 0,
    do_robo: { total: revs.filter((r) => r.do_robo).length, cancelados: cancelados.filter((r) => r.do_robo).length },
    novos_30d: { total: revs.filter((r) => r.dias_de_casa != null && r.dias_de_casa <= 30).length, cancelados: cancelados.filter((r) => r.dias_de_casa != null && r.dias_de_casa <= 30).length },
    lidos, analisado_em: motivos.analisado_em || null,
    pediram_cancelar_conversa: cancelados.filter((r) => itens[r.id] && itens[r.id].pediu_cancelar).length,
    evitaveis: cancelados.filter((r) => itens[r.id] && itens[r.id].evitavel).length,
    pediram_cancelar: pediramCancelar(),
    motivos: lista,
    leitura: estado, opus,
  };
}

// ---------- Leitura das conversas (feita pelo robô) ----------
export function pedirLeitura({ so_novos = false } = {}) {
  const est = lerJson(ARQ.estado, null);
  if (est && est.rodando && Date.now() - Date.parse(est.pedido_em || 0) < 20 * 60e3) return { codigo: 409, corpo: { erro: 'a leitura já está rodando', leitura: est } };
  const sg = lerJson(ARQ.sigma, null);
  if (!sg || !Array.isArray(sg.revendedores)) return { codigo: 409, corpo: { erro: 'o Sigma ainda não foi lido; clique em Atualizar na aba Sigma' } };
  const itens = (lerJson(ARQ.motivos, { itens: {} }).itens) || {};
  const alvos = sg.revendedores.filter((r) => r.status && r.status !== 'ACTIVE' && (!so_novos || !itens[r.id])).map((r) => ({
    id: r.id, nome: r.nome || r.usuario, whatsapp: r.whatsapp || null,
    sinais: { dias_de_casa: r.dias_de_casa, clientes_total: r.clientes_total || 0, testes: r.testes || 0, dias_sem_entrar: r.dias_sem_entrar, creditos: r.creditos },
  }));
  if (!alvos.length) return { codigo: 200, corpo: { ok: true, nada: true } };
  const pedido_em = new Date().toISOString();
  const cmds = [].concat(lerJson(ARQ.comando, [])).filter(Boolean);
  cmds.push({ acao: 'cancelados', alvos, pedido_em });
  fs.writeFileSync(ARQ.comando, JSON.stringify(cmds));
  gravar(ARQ.estado, { rodando: true, etapa: 'na_fila', feitos: 0, total: alvos.length, pedido_em });
  return { codigo: 202, corpo: { ok: true, pedido_em, total: alvos.length } };
}

// ---------- Opus: estudar o motivo e escrever o contorno ----------
const PROMPT_OPUS = `Você é o melhor especialista em retenção e atendimento da CapyPlay. O Jarvis (robô de WhatsApp, modelo Haiku) atende revendedores seguindo as diretrizes do base.md, que você recebe inteiro. Alguns revendedores abriram o painel e desistiram (o painel foi desativado). Você recebe as conversas dos que desistiram por UM mesmo motivo.

Sua tarefa: entender por que eles desistiram, achar onde o atendimento falhou ou deixou de agir, e escrever regras CURTAS para o Jarvis contornar esse motivo daqui para frente (antes de a pessoa desistir e quando ela já estiver desistindo).

Regras das regras:
- De 2 a 5 regras, cada uma UMA frase no imperativo, dirigida ao Jarvis, até 240 caracteres, começando com "- ".
- Concretas: diga quando agir (o sinal na conversa) e o que fazer/dizer. Nada genérico como "seja empático".
- Não invente preço, prazo, desconto, bônus, crédito extra, reembolso, garantia, link ou política que não estejam no base.md. Pode usar o que já está lá.
- Não contradiga o base.md. Respeite o jeito dele: frases curtas, sem emoji, chama o cliente de "mestre".
- O que só a equipe resolve (estabilidade dos servidores, cobrança, decisão comercial) vai em "para_o_senhor", não em regra.

Responda SOMENTE com um JSON numa linha:
{"diagnostico":"2 ou 3 frases simples, para o dono ler, dizendo por que desistiram e onde o atendimento falhou","regras":["- ...","- ..."],"exemplo":{"cliente":"frase típica de quem está desistindo por esse motivo","jarvis":["mensagem 1","mensagem 2"]},"para_o_senhor":["o que a equipe precisa resolver, se houver"],"confianca":0.8}`;

let opusJob = null;
function estadoOpus() { return opusJob ? { rodando: true, categoria: opusJob.categoria, iniciado_em: opusJob.iniciado_em } : { rodando: false, ultimo: ultimoOpus }; }
let ultimoOpus = null;

function chamarOpus(entrada) {
  return new Promise((resolve) => {
    fs.mkdirSync(DIR, { recursive: true });
    if (!fs.existsSync(ARQ.promptOpus) || fs.readFileSync(ARQ.promptOpus, 'utf8') !== PROMPT_OPUS) fs.writeFileSync(ARQ.promptOpus, PROMPT_OPUS);
    const args = ['-p', '--model', MODELO_OPUS, '--setting-sources', '""', '--system-prompt-file', ARQ.promptOpus, '--tools', '""',
      '--no-session-persistence', '--strict-mcp-config', '--output-format', 'json'];
    const p = spawn('claude.cmd', args, { cwd: PASTA, shell: true, windowsHide: true });
    let out = '', err = ''; const t = setTimeout(() => { p.kill(); resolve({ erro: 'o Opus passou de 5 min' }); }, 300000);
    p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (err += d));
    p.on('close', () => {
      clearTimeout(t);
      let env = null; try { env = JSON.parse(out.trim()); } catch {}
      try { require('../uso-ia.js').registrar('cancelados_opus', env, MODELO_OPUS); } catch {}
      const txt = env && typeof env.result === 'string' ? env.result : out;
      const m = String(txt).match(/\{[\s\S]*\}/);
      let j = null; try { j = m ? JSON.parse(m[0]) : null; } catch {}
      resolve(j ? { j, custo: Number(env && env.total_cost_usd) || 0, ms: env && env.duration_ms } : { erro: (env && env.is_error && env.result) || err.slice(0, 200) || 'o Opus não devolveu o JSON' });
    });
    p.on('error', (e) => { clearTimeout(t); resolve({ erro: e.message }); });
    p.stdin.end(entrada);
  });
}

// Barra o que o Haiku não pode prometer: valor, link ou promessa que não existem no base.md.
function filtrar(regras, base) {
  const ok = [], fora = [];
  for (let r of regras) {
    r = String(r || '').replace(/\s+/g, ' ').trim(); if (!r) continue;
    if (!r.startsWith('- ')) r = '- ' + r.replace(/^[-•*]\s*/, '');
    if (r.length > 300) { fora.push({ regra: r, motivo: 'longa demais' }); continue; }
    const valores = r.match(/R\$\s?\d+(?:,\d{2})?/g) || [], links = r.match(/https?:\/\/\S+/g) || [];
    const novoValor = valores.find((v) => !base.includes(v.replace(/\s/, ' ')) && !base.includes(v.replace(/\s/, '')));
    const novoLink = links.find((l) => !base.includes(l.replace(/[).,;]+$/, '')));
    if (novoValor) { fora.push({ regra: r, motivo: `valor que não está nas diretrizes (${novoValor})` }); continue; }
    if (novoLink) { fora.push({ regra: r, motivo: 'link que não está nas diretrizes' }); continue; }
    if (/desconto|reembols|estorn|b[oô]nus|brinde|cr[eé]ditos? (extra|a mais|de presente)|garant[io]|devolv/i.test(r)) { fora.push({ regra: r, motivo: 'promessa comercial (só o senhor decide)' }); continue; }
    ok.push(r);
  }
  return { ok: ok.slice(0, 5), fora };
}

function blocoContornos(contornos) {
  const partes = Object.entries(contornos).filter(([, c]) => c && c.regras && c.regras.length)
    .map(([k, c]) => `## ${CATEGORIAS[k] || k} (${new Date(c.em).toLocaleDateString('pt-BR')})\n${c.regras.join('\n')}`);
  if (!partes.length) return '';
  return `${INICIO}\n# Como contornar desistências (aprendido com os painéis cancelados; o Opus estudou as conversas; vale quando não contradiz nada acima)\n${partes.join('\n\n')}\n${FIM}`;
}
function escreverNoBase(contornos) {
  let base = fs.readFileSync(ARQ.base, 'utf8');
  const copia = ARQ.base + '.antes-contornos'; if (!fs.existsSync(copia)) fs.writeFileSync(copia, base);
  const bloco = blocoContornos(contornos);
  const i = base.indexOf(INICIO), f = base.indexOf(FIM);
  // simétrico: entra "bloco\n\n" antes do "# Formato da sua saída"; ao desfazer o último, sai o bloco e o "\n\n" que veio junto
  if (i >= 0 && f > i) {
    let fimCorte = f + FIM.length;
    if (!bloco && base.slice(fimCorte, fimCorte + 2) === '\n\n') fimCorte += 2;
    base = base.slice(0, i) + bloco + base.slice(fimCorte);
  } else if (bloco) {
    const k = base.indexOf('# Formato da sua saída');
    base = k >= 0 ? base.slice(0, k) + bloco + '\n\n' + base.slice(k) : base.replace(/\n*$/, '\n\n') + bloco + '\n';
  }
  const t = ARQ.base + '.tmp'; fs.writeFileSync(t, base); fs.renameSync(t, ARQ.base);
}

export function corrigir(categoria, { aoTerminar } = {}) {
  if (!CATEGORIAS[categoria] || SEM_CONTORNO.has(categoria)) return { codigo: 400, corpo: { erro: 'motivo sem correção pelo atendimento' } };
  if (opusJob) return { codigo: 409, corpo: { erro: 'o Opus já está estudando outro motivo', opus: estadoOpus() } };
  const sg = lerJson(ARQ.sigma, { revendedores: [] }), itens = lerJson(ARQ.motivos, { itens: {} }).itens || {}, conversas = lerJson(ARQ.conversas, {});
  const casos = (sg.revendedores || []).filter((r) => itens[r.id] && itens[r.id].categoria === categoria);
  if (!casos.length) return { codigo: 409, corpo: { erro: 'nenhum painel com esse motivo; leia os motivos primeiro' } };
  const base = fs.readFileSync(ARQ.base, 'utf8');
  const blocos = casos.sort((a, b) => ((conversas[b.id] || {}).linhas || []).length - ((conversas[a.id] || {}).linhas || []).length).slice(0, 12).map((r, k) => {
    const m = itens[r.id], cv = conversas[r.id] || { linhas: [] };
    return `### Caso ${k + 1}\nPainel: ${r.dias_de_casa ?? '?'} dias de casa, ${r.clientes_total || 0} clientes criados, último acesso há ${r.dias_sem_entrar ?? '?'} dias.\nMotivo lido: ${m.motivo}\n` +
      (cv.linhas.length ? 'Conversa:\n' + cv.linhas.slice(-30).join('\n').replace(/\b\d{10,13}\b/g, '[número]') : 'Sem conversa no WhatsApp.');
  }).join('\n\n');
  const entrada = `MOTIVO DA DESISTÊNCIA: ${CATEGORIAS[categoria]} (${casos.length} painéis cancelados por isso)\n\n=== DIRETRIZES ATUAIS DO JARVIS (base.md) ===\n${base}\n=== FIM DAS DIRETRIZES ===\n\n=== CONVERSAS DE QUEM DESISTIU ===\n${blocos}`;
  opusJob = { categoria, iniciado_em: new Date().toISOString() };
  (async () => {
    const t0 = Date.now();
    try {
      const r = await chamarOpus(entrada);
      if (r.erro) { ultimoOpus = { categoria, ok: false, erro: String(r.erro).slice(0, 200), em: new Date().toISOString() }; return; }
      const j = r.j, f = filtrar(Array.isArray(j.regras) ? j.regras : [], base);
      if (!f.ok.length) { ultimoOpus = { categoria, ok: false, erro: 'o Opus não trouxe nenhuma regra segura', rejeitadas: f.fora, em: new Date().toISOString() }; return; }
      const contornos = lerJson(ARQ.contornos, {});
      contornos[categoria] = {
        em: new Date().toISOString(), regras: f.ok, rejeitadas: f.fora, diagnostico: String(j.diagnostico || '').slice(0, 600),
        exemplo: j.exemplo && typeof j.exemplo === 'object' ? { cliente: String(j.exemplo.cliente || '').slice(0, 200), jarvis: [].concat(j.exemplo.jarvis || []).map((x) => String(x).slice(0, 240)).slice(0, 4) } : null,
        para_o_senhor: [].concat(j.para_o_senhor || []).map((x) => String(x).slice(0, 240)).filter(Boolean).slice(0, 4),
        confianca: Number(j.confianca) || null, casos: casos.length, modelo: MODELO_OPUS, custo: r.custo, ms: r.ms || Date.now() - t0,
      };
      gravar(ARQ.contornos, contornos);
      escreverNoBase(contornos);
      ultimoOpus = { categoria, ok: true, em: new Date().toISOString(), custo: r.custo };
    } catch (e) { ultimoOpus = { categoria, ok: false, erro: String(e.message || e).slice(0, 200), em: new Date().toISOString() }; }
    finally { opusJob = null; if (aoTerminar) aoTerminar(ultimoOpus); }
  })();
  return { codigo: 202, corpo: { ok: true, opus: estadoOpus() } };
}

export function desfazer(categoria) {
  const contornos = lerJson(ARQ.contornos, {});
  if (!contornos[categoria]) return { codigo: 404, corpo: { erro: 'esse motivo não tem contorno' } };
  delete contornos[categoria];
  gravar(ARQ.contornos, contornos);
  escreverNoBase(contornos);
  return { codigo: 200, corpo: { ok: true } };
}

export async function tratarRotaCancelados({ metodo, rota, corpo, origem }) {
  if (rota === '/api/cancelados' && metodo === 'GET') return { codigo: 200, corpo: resumoCancelados() };
  if (metodo !== 'POST') return null;
  if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(String(origem || ''))) return { codigo: 403, corpo: { erro: 'só pelo dashboard do PC' } };
  if (rota === '/api/cancelados/ler') return pedirLeitura({ so_novos: !!corpo.so_novos });
  if (rota === '/api/cancelados/corrigir') return corrigir(String(corpo.categoria || ''));
  if (rota === '/api/cancelados/desfazer') return desfazer(String(corpo.categoria || ''));
  return null;
}
