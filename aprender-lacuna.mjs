// aprender-lacuna.mjs — agente que investiga UMA lacuna de conhecimento do robô da revenda.
//   node aprender-lacuna.mjs L12                 investiga a lacuna L12 (painel em somente leitura + Sonnet)
//   node aprender-lacuna.mjs L12 --avisar        e avisa o senhor no Telegram quando virar "precisa_senhor"
//   node aprender-lacuna.mjs L12 --forcar        reabre mesmo resolvida / passa do limite diário
//   node aprender-lacuna.mjs L12 --dry           só monta o dossiê e imprime tamanho e custo estimado (nada é gravado)
//   testes: --stub arquivo.json (resposta do modelo simulada) e --painel-stub arquivo.json (fatos simulados) | --sem-painel
// Última linha do stdout: um JSON { ok, id, status, ... } (o servidor/bot lê isso). Nunca imprime senha, token ou telefone.
// Garantias: uma investigação por vez (trava lacunas\.investigando), no máximo 2 tentativas por lacuna, timeout geral de 6 min,
// idempotente (lacuna já resolvida não é refeita). Nada do que vem do modelo entra sozinho se mexer com dinheiro, prazo, política ou link novo.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const usoIA = createRequire(import.meta.url)('./uso-ia.js');
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as L from './lacunas.mjs';
import { fatosDoPainel, fatosRelevantes } from './painel-fatos.mjs';

process.noDeprecation = true;
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const id = args.find((a) => /^L\d+$/.test(a));
const tem = (f) => args.includes(f);
const valor = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const MODELO = process.env.LACUNA_MODELO || 'sonnet';
const PROMPT = path.join(AQUI, 'lacunas', 'prompt-lacuna.md');
const sai = (obj, codigo = 0) => { console.log(JSON.stringify(obj)); process.exit(codigo); };
const lerTxt = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };

if (!id) sai({ ok: false, motivo: 'uso: node aprender-lacuna.mjs L<número> [--avisar] [--forcar] [--dry]' }, 2);
const it = L.obter(id);
if (!it) sai({ ok: false, id, motivo: 'lacuna não existe' }, 2);

// ---------- idempotência e limites ----------
if (!tem('--forcar') && ['aprendida', 'descartada', 'precisa_senhor'].includes(it.status)) sai({ ok: true, id, ja_resolvida: true, status: it.status });
if (!tem('--forcar') && !tem('--dry') && (it.tentativas || 0) >= L.CFG.max_tentativas) {
  L.marcar(id, 'precisa_senhor', { motivo_precisa_senhor: `O agente tentou ${it.tentativas} vezes e não conseguiu uma resposta confiável.` });
  sai({ ok: true, id, status: 'precisa_senhor', motivo: 'limite de tentativas' });
}
const hoje = new Date().toISOString().slice(0, 10);
if (!tem('--forcar') && !tem('--dry') && L.investigacoesHoje() >= L.CFG.max_por_dia) sai({ ok: false, id, motivo: 'limite diário de investigações (' + L.CFG.max_por_dia + ')' });

// relevância: pergunta sem conteúdo não gasta modelo
const tokens = L.normalizar(it.pergunta_canonica || it.pergunta);
if (!tem('--forcar') && !tem('--dry') && tokens.join('').length < 5) {
  L.marcar(id, 'descartada', { motivo_precisa_senhor: 'Pergunta sem conteúdo suficiente para investigar.' });
  sai({ ok: true, id, status: 'descartada', motivo: 'pergunta sem conteúdo' });
}

// ---------- trava: uma investigação por vez ----------
if (!tem('--dry')) {
  try {
    try { if (Date.now() - fs.statSync(L.ARQ.investigando).mtimeMs > L.CFG.investigando_vence_min * 60e3) fs.unlinkSync(L.ARQ.investigando); } catch {}
    const fd = fs.openSync(L.ARQ.investigando, 'wx'); fs.writeSync(fd, JSON.stringify({ id, pid: process.pid, t: Date.now() })); fs.closeSync(fd);
  } catch { sai({ ok: false, id, motivo: 'ocupado: outra investigação em andamento' }); }
  const soltar = () => { try { fs.unlinkSync(L.ARQ.investigando); } catch {} };
  process.on('exit', soltar);
  setTimeout(() => { try { if (L.obter(id)?.status === 'investigando') L.marcar(id, 'nova', { painel_erro: 'tempo esgotado' }); } catch {} soltar(); sai({ ok: false, id, motivo: 'tempo esgotado (6 min)' }, 1); }, 6 * 60e3).unref();
}

// ---------- 1) dossiê ----------
const resumoClientes = () => {
  const e = L.listar({}).find((x) => x.id === id) || it;
  const nomes = [...new Set(e.clientes.map((c) => c.nome1))].slice(0, 8);
  const falas = [...new Set(e.clientes.map((c) => c.pergunta))].slice(0, 5);
  return { nomes, falas, aguardando: e.clientes.filter((c) => !c.atendido).length };
};
async function montarDossie() {
  const rc = resumoClientes();
  let painel, relev = { texto: '', usados: [] };
  if (tem('--sem-painel')) painel = { ok: false, fatos: [], erro: 'painel não consultado (modo de teste)' };
  else if (valor('--painel-stub')) painel = JSON.parse(lerTxt(valor('--painel-stub')));
  else painel = await fatosDoPainel({});
  if (painel.ok) relev = fatosRelevantes(painel.fatos, it.pergunta + ' ' + (it.pergunta_canonica || ''));
  const dossie = `# Lacuna ${id}
Pergunta do cliente: ${it.pergunta}
Outras formas como perguntaram: ${rc.falas.join(' | ') || '(só essa)'}
Motivo do registro: ${it.motivos.join(', ')}
Ocorrências: ${it.ocorrencias}; clientes esperando resposta: ${rc.aguardando} (${rc.nomes.join(', ') || 'sem nome'})
Contexto da conversa (últimas mensagens):
${(it.contexto || []).map((l) => '  ' + l).join('\n') || '  (sem contexto)'}

# base.md (regras atuais do robô)
${lerTxt(L.ARQ.base)}

# Regras já aprendidas (aprendizados.md)
${lerTxt(L.ARQ.aprendizadosMd) || '(nenhuma)'}

# Fatos lidos do painel (somente leitura${painel.obtido_em ? ', obtidos em ' + painel.obtido_em : ''}${painel.do_cache ? ', do cache' : ''})
${relev.texto || ('(nenhum fato do painel disponível' + (painel.erro ? ': ' + painel.erro : '') + ')')}

Responda no formato JSON pedido.`;
  return { dossie, painel, relev };
}

// ---------- 2) modelo ----------
function chamarModelo(texto) {
  const stub = valor('--stub') || process.env.LACUNA_STUB;
  if (stub) { try { return Promise.resolve({ json: JSON.parse(lerTxt(stub)), custo: 0, uso: null, simulado: true }); } catch { return Promise.resolve(null); } }
  return new Promise((ok) => {
    const a = ['-p', '--model', MODELO, '--output-format', 'json', '--setting-sources', '""', '--system-prompt-file', PROMPT, '--tools', '""', '--no-session-persistence', '--strict-mcp-config'];
    const p = spawn('claude.cmd', a, { cwd: AQUI, shell: true, windowsHide: true });
    let out = ''; const t = setTimeout(() => { p.kill(); ok(null); }, 180000);
    p.stdout.on('data', (d) => (out += d));
    p.on('close', () => {
      clearTimeout(t);
      try {
        const o = JSON.parse(out); usoIA.registrar('lacunas', o, MODELO); const m = String(o.result || '').match(/\{[\s\S]*\}/);
        ok(m ? { json: JSON.parse(m[0]), custo: Number(o.total_cost_usd) || 0, uso: { entrada: (o.usage?.input_tokens || 0) + (o.usage?.cache_creation_input_tokens || 0) + (o.usage?.cache_read_input_tokens || 0), saida: o.usage?.output_tokens || 0 } } : null);
      } catch { ok(null); }
    });
    p.stdin.end(texto);
  });
}

// ---------- 3) validação e decisão ----------
// ---------- 4) Telegram (só com --avisar) ----------
async function avisarTelegram(texto) {
  try {
    const env = fs.readFileSync('C:/Users/gusta/.claude/channels/telegram/.env', 'utf8');
    const tk = (env.match(/TELEGRAM_BOT_TOKEN\s*=\s*(.+)/) || [])[1]?.trim(); if (!tk) return false;
    const r = await fetch(`https://api.telegram.org/bot${tk}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: '8839889411', text: L.mascarar(texto).slice(0, 900) }) });
    return r.ok;
  } catch { return false; }
}

// ---------- execução ----------
const { dossie, painel, relev } = await montarDossie();
const entradaTok = Math.round((dossie.length + lerTxt(PROMPT).length) / 2.4 + 660);      // medido: ~2,4 caracteres por token em português + ~660 de base do CLI
const estimado = Math.round((entradaTok * 3.75e-6 + 600 * 15e-6) * 10000) / 10000;     // calibrado com a execução real da L1 (entrada ~US$ 3,75/M já com escrita de cache, saída US$ 15/M)
if (tem('--dry')) sai({ ok: true, id, dry: true, caracteres: dossie.length, tokens_entrada_estimados: entradaTok, custo_estimado_usd: estimado, fontes_painel: relev.usados, painel_ok: !!painel.ok, painel_erro: painel.erro || null });

const tent = (it.tentativas || 0) + 1;
L.marcar(id, 'investigando', { tentativas: tent, painel_erro: painel.erro || '' });
L.contarInvestigacao();
const resp = await chamarModelo(dossie);
if (!resp || !resp.json) {
  if (tent >= L.CFG.max_tentativas) { L.marcar(id, 'precisa_senhor', { motivo_precisa_senhor: 'O modelo não devolveu uma resposta utilizável em ' + tent + ' tentativas.', painel_erro: painel.erro || '' }); sai({ ok: false, id, status: 'precisa_senhor', motivo: 'modelo sem resposta' }, 1); }
  L.marcar(id, 'nova', { tentativas: tent, painel_erro: painel.erro || '' });
  sai({ ok: false, id, status: 'nova', motivo: 'modelo sem resposta; nova tentativa depois', tentativas: tent }, 1);
}

const painelTexto = relev.texto;
const fontesOk = (painel.fatos || []).filter((f) => relev.usados.includes(f.id)).map((f) => f.fonte).concat(['base.md', 'aprendizados.md']);
const d = L.decidirResultado(resp.json, { painelTexto, fontesOk });
const base = { pergunta_canonica: d.canonica || undefined, resposta_sugerida: d.resposta, fatos_do_painel: d.fatos, confianca: d.confianca, tipo: d.tipo, regra_para_base: d.regra, custo_usd: Math.round(resp.custo * 10000) / 10000, modelo: resp.simulado ? 'simulado' : MODELO, investigada_em: new Date().toISOString(), painel_erro: painel.erro || '', fontes_painel: relev.usados };
let saida;
if (d.tipo === 'regra_segura') {
  const c = L.concluirAprendida(id, { resposta: d.resposta, regra: d.regra, auto: true, dados: base });
  saida = { ok: true, id, status: 'aprendida', tipo: d.tipo, confianca: d.confianca, retornos_gerados: c.retornos, regra: c.regra };
} else {
  L.marcar(id, 'precisa_senhor', { ...base, motivo_precisa_senhor: d.motivos.join(' ') });
  saida = { ok: true, id, status: 'precisa_senhor', tipo: d.tipo, confianca: d.confianca, motivos: d.motivos };
  if (tem('--avisar')) { const rc = resumoClientes(); saida.avisado = await avisarTelegram(`Revenda: nova dúvida para o senhor aprovar (${id}, ${it.ocorrencias}x, ${rc.aguardando} esperando): "${it.pergunta_canonica || it.pergunta}". Sugestão do robô: ${d.resposta || '(sem sugestão)'} Motivo: ${d.motivos[0] || ''}`); }
}
saida.custo_usd = base.custo_usd; saida.custo_estimado_usd = estimado; saida.uso = resp.uso || null; saida.fatos_do_painel = d.fatos.length; saida.painel = painel.ok ? (painel.do_cache ? 'cache' : 'lido agora') : 'indisponível';
sai(saida);
