// lacunas.mjs — registro de lacunas de conhecimento do robô da revenda (08/11/2026).
// "Lacuna" = o cliente perguntou algo que o robô não sabia ou não entendeu. Aqui ela é registrada, deduplicada,
// investigada (aprender-lacuna.mjs), vira regra aprendida (ou fica para o senhor aprovar) e o cliente recebe o retorno.
//
// Uso no bot (CommonJS, Node 24 carrega ESM com require): const lac = require('./lacunas.mjs');
// Tudo é SÍNCRONO e seguro entre processos (bot, servidor de relatórios e o agente): trava por arquivo + gravação atômica.
// Privacidade: o chat do cliente (id do WhatsApp) só existe em lacunas\aguardando.json e em respostas-pendentes.json,
// que servem para o bot responder. Todo o resto guarda só o primeiro nome. Telefone, e-mail e senha são mascarados.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
export const PASTA = AQUI;
export const DIR = process.env.LACUNAS_DIR || path.join(AQUI, 'lacunas');   // LACUNAS_DIR só para testes
const REL = process.env.LACUNAS_REL || path.join(AQUI, 'relatorios');
export const ARQ = {
  jsonl: path.join(DIR, 'lacunas.jsonl'), estado: path.join(DIR, 'estado.json'), aguardando: path.join(DIR, 'aguardando.json'),
  retornos: path.join(DIR, 'respostas-pendentes.json'), regras: path.join(DIR, 'regras-lacunas.json'), eventos: path.join(DIR, 'eventos-lacunas.jsonl'),
  trava: path.join(DIR, '.estado.trava'), investigando: path.join(DIR, '.investigando'),
  aprendizadosJson: path.join(REL, 'aprendizados.json'), aprendizadosMd: path.join(REL, 'aprendizados.md'), base: path.join(AQUI, 'base.md'),
};
export const CFG = { limiar_parecida: 0.6, max_regras_lacuna: 10, max_linhas_aprendizados: 25, max_por_dia: Number(process.env.LACUNAS_MAX_DIA) || 6, max_tentativas: 2, retorno_hora_ini: 9, retorno_hora_fim: 20, retorno_intervalo_min: 4, retorno_validade_h: 72, investigando_vence_min: 20, jsonl_max_bytes: 2_000_000 };
export const STATUS = ['nova', 'investigando', 'aprendida', 'precisa_senhor', 'descartada'];
export const MOTIVOS = ['sem_informacao_no_base', 'nao_entendeu', 'fora_do_roteiro', 'avisar_sem_motivo_claro', 'resposta_contradiz_base'];

// ---------------------------------------------------------------- utilidades
fs.mkdirSync(DIR, { recursive: true });
const agoraIso = () => new Date().toISOString();
const dorme = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch {} };
const lerJson = (arq, padrao) => { try { return JSON.parse(fs.readFileSync(arq, 'utf8').replace(/^﻿/, '')); } catch { return padrao; } };
const gravar = (arq, obj) => { const t = arq + '.' + process.pid + '.tmp'; fs.writeFileSync(t, JSON.stringify(obj, null, 1)); for (let i = 0; i < 8; i++) { try { fs.renameSync(t, arq); return; } catch (e) { if (i === 7) throw e; dorme(30); } } };
export const ehId = (id) => typeof id === 'string' && /^L\d{1,6}$/.test(id);
const refDe = (chat) => crypto.createHash('sha1').update(String(chat)).digest('hex').slice(0, 8);

// máscara: senha, e-mail, telefone (qualquer sequência longa de dígitos)
export function mascarar(t) {
  return String(t == null ? '' : t)
    .replace(/(senha|password|pass)\s*[:=]\s*\S+/gi, '$1: [oculta]').replace(/(senha)\s+(?=\S*\d)\S+/gi, '$1 [oculta]')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[e-mail]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[número]').replace(/\b\d{9,}\b/g, '[número]');
}
const curto = (t, n) => { t = String(t == null ? '' : t).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const primeiro = (n) => (String(n || '').trim().split(/\s+/)[0] || '').replace(/[^\p{L}'-]/gu, '').slice(0, 24) || 'cliente';
const semEmoji = (t) => String(t == null ? '' : t).replace(/[\u{1F000}-\u{1FFFF}☀-➿️‍]/gu, '').replace(/[*`]/g, '').replace(/^#+s*/, '').replace(/(^|\s)_+([^_\s][^_]*)_+(?=\s|$)/g, '$1$2').replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------- similaridade entre perguntas
const STOP = new Set(('a o as os um uma uns umas de do da dos das em no na nos nas por para pra pro com sem e ou que se me te nos mais mas ja so ao aos ele ela eles elas isso isto esse essa esses essas este esta eu voce vcs vc tu seu sua seus suas meu minha qual quais como quando onde porque pq tem ter tenho temos tinha foi ser sao estao esta mesmo mesma ha ai la aqui entao tambem muito bem ok ola oi boa bom dia tarde noite mestre senhor favor gostaria queria quero saber pode podem posso fazer existe existem funciona funcionam ai viu entender diz dizer informacao informacoes sobre cliente perguntou perguntaram pergunta duvida se tipo coisa algo alguma algum possivel preciso precisa sabe sera nao sim ainda tambem so apenas').split(/\s+/));
const SINONIMOS = [[/pre[\s-]?pago/g, ' prepago '], [/pos[\s-]?pago/g, ' pospago '], [/sub[\s-]?revend\w*/g, ' subrevenda '], [/sem custo|de gra[cç]a|gr[aá]tis|gratuit\w*/g, ' gratuito '], [/antecipad\w*|adiantad\w*/g, ' prepago '], [/revenda\w*|revendedor\w*|revender/g, ' revend '], [/cr[eé]ditos?/g, ' credito '], [/\bativos?\b/g, ' credito '], [/pagar|pagamento|pago\b/g, ' pag '], [/pre[cç]os?|valor(?:es)?|custa\w*|custo\w*|quanto\w*|mensalidade/g, ' preco ']];
export function normalizar(texto) {
  let t = String(texto || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  for (const [rx, rep] of SINONIMOS) t = t.replace(rx, rep);
  const toks = t.replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w));
  const radical = (w) => { if (w.length > 4) w = w.replace(/s$/, ''); if (w.length > 5) w = w.replace(/(ando|endo|indo|ado|ido|acao|acoes|ar|er|ir|ou)$/, ''); if (w.length > 4) w = w.replace(/[aeo]$/, ''); return w; };
  return [...new Set(toks.map(radical).filter((w) => w.length > 1))];
}
export function similaridade(a, b) {
  const A = new Set(Array.isArray(a) ? a : normalizar(a)), B = new Set(Array.isArray(b) ? b : normalizar(b));
  if (!A.size || !B.size) return 0;
  let i = 0; for (const w of A) if (B.has(w)) i++;
  const jac = i / (A.size + B.size - i), min = Math.min(A.size, B.size), max = Math.max(A.size, B.size);
  const cont = i / min;
  const contVale = (min >= 2 && cont >= 0.8) || (min === 1 && max <= 3 && cont === 1);
  return Math.max(jac, contVale ? 0.85 * cont : 0);
}

// ---------------------------------------------------------------- estado (com trava entre processos)
const estadoVazio = () => ({ versao: 1, seq: 0, itens: {}, rodadas_importadas: [], investigacoes: {}, ultimo_retorno_em: null });
function pegarTrava() {
  const fim = Date.now() + 8000;
  while (true) {
    try { const fd = fs.openSync(ARQ.trava, 'wx'); fs.writeSync(fd, String(Date.now())); fs.closeSync(fd); return; }
    catch {
      try { if (Date.now() - fs.statSync(ARQ.trava).mtimeMs > 10000) fs.unlinkSync(ARQ.trava); } catch {}
      if (Date.now() > fim) { try { fs.unlinkSync(ARQ.trava); } catch {} }
      dorme(25);
    }
  }
}
function transacao(fn) {
  pegarTrava();
  try { const e = Object.assign(estadoVazio(), lerJson(ARQ.estado, {})); const r = fn(e); gravar(ARQ.estado, e); return r; }
  finally { try { fs.unlinkSync(ARQ.trava); } catch {} }
}
const lerEstado = () => Object.assign(estadoVazio(), lerJson(ARQ.estado, {}));

function evento(tipo, id, extra = {}) {
  try {
    const e = { t: agoraIso(), tipo, lacuna: id || null, ...JSON.parse(mascarar(JSON.stringify(extra))) };
    try { if (fs.statSync(ARQ.eventos).size > CFG.jsonl_max_bytes) fs.renameSync(ARQ.eventos, ARQ.eventos + '.1'); } catch {}
    fs.appendFileSync(ARQ.eventos, JSON.stringify(e) + '\n');
  } catch {}
}
export const eventosLacunas = (n = 200) => { try { return fs.readFileSync(ARQ.eventos, 'utf8').split('\n').filter(Boolean).slice(-n).map((l) => JSON.parse(l)); } catch { return []; } };

// ---------------------------------------------------------------- registrar
// registrarLacuna({chat, nome1, pergunta, contexto, motivo, origem}) -> { id, nova, ocorrencias, status, investigar }
export function registrarLacuna({ chat, nome1, pergunta, contexto, motivo, origem } = {}) {
  const perg = curto(mascarar(pergunta), 300);
  if (perg.length < 3) return { id: null, ignorada: 'pergunta vazia' };
  const mot = MOTIVOS.includes(motivo) ? motivo : 'sem_informacao_no_base';
  const ctx = (Array.isArray(contexto) ? contexto : String(contexto || '').split('\n')).slice(-6).map((l) => curto(mascarar(l), 220)).filter(Boolean);
  const quem = primeiro(nome1), ref = chat ? refDe(chat) : null, tokens = normalizar(perg);
  let saida;
  transacao((e) => {
    // procura lacuna parecida (qualquer status, menos descartada)
    let alvo = null, melhor = 0;
    for (const it of Object.values(e.itens)) {
      if (it.status === 'descartada') continue;
      const s = Math.max(similaridade(tokens, it.tokens || []), similaridade(tokens, normalizar(it.pergunta_canonica || '')));
      if (s >= CFG.limiar_parecida && s > melhor) { alvo = it; melhor = s; }
    }
    const nova = !alvo;
    if (nova) {
      const id = 'L' + (++e.seq);
      alvo = e.itens[id] = { id, criado_em: agoraIso(), atualizado_em: agoraIso(), pergunta: perg, pergunta_canonica: perg, tokens, motivos: [mot], origem: origem || 'bot', status: 'nova', ocorrencias: 0, clientes: [], contexto: ctx, tentativas: 0, resultado: null, resolvido_em: null, reincidencias: 0 };
    }
    alvo.ocorrencias++; alvo.atualizado_em = agoraIso();
    if (!alvo.motivos.includes(mot)) alvo.motivos.push(mot);
    if (ctx.length && !(alvo.contexto || []).length) alvo.contexto = ctx;
    if (ref) {
      const ja = alvo.clientes.find((c) => c.ref === ref);
      if (ja) { ja.quando = agoraIso(); ja.pergunta = perg; if (ja.atendido) { ja.atendido = false; ja.retorno = null; } }
      else alvo.clientes.push({ ref, nome1: quem, quando: agoraIso(), pergunta: perg, atendido: false, retorno: null });
      const ag = lerJson(ARQ.aguardando, {}); ag[ref] = chat; gravar(ARQ.aguardando, ag);
    }
    // pergunta repetida depois de aprendida = a regra não resolveu
    if (alvo.status === 'aprendida' && !nova) { alvo.reincidencias = (alvo.reincidencias || 0) + 1; if (alvo.reincidencias >= 3) { alvo.status = 'precisa_senhor'; alvo.resultado = { ...(alvo.resultado || {}), motivo_precisa_senhor: 'A regra aprendida não resolveu: a pergunta voltou ' + alvo.reincidencias + ' vezes.' }; evento('lacuna_reaberta', alvo.id, { reincidencias: alvo.reincidencias }); } }
    try { fs.appendFileSync(ARQ.jsonl, JSON.stringify({ t: agoraIso(), id: alvo.id, nova, nome1: quem, ref, pergunta: perg, contexto: ctx, motivo: mot, origem: origem || 'bot' }) + '\n'); } catch {}
    evento(nova ? 'lacuna_registrada' : 'lacuna_repetida', alvo.id, { motivo: mot, ocorrencias: alvo.ocorrencias });
    saida = { id: alvo.id, nova, ocorrencias: alvo.ocorrencias, status: alvo.status, investigar: alvo.status === 'nova' };
  });
  return saida;
}

// ---------------------------------------------------------------- consultas
const publico = (it) => { const { tokens, ...r } = it; return r; };
export function obter(id) { const it = lerEstado().itens[id]; return it ? publico(it) : null; }
export function listar({ status, limite = 200 } = {}) {
  let v = Object.values(lerEstado().itens);
  if (status) { const s = [].concat(status); v = v.filter((x) => s.includes(x.status)); }
  return v.sort((a, b) => Date.parse(b.criado_em) - Date.parse(a.criado_em)).slice(0, limite).map(publico);
}
export function pendentesParaResposta(id) { const it = lerEstado().itens[id]; return it ? it.clientes.filter((c) => !c.atendido).map((c) => ({ ref: c.ref, nome1: c.nome1, quando: c.quando, pergunta: c.pergunta })) : []; }

const CAMPOS_RESULTADO = ['pergunta_canonica', 'resposta_sugerida', 'fatos_do_painel', 'confianca', 'tipo', 'regra_para_base', 'motivo_precisa_senhor', 'custo_usd', 'modelo', 'painel_erro', 'aprovada_por', 'investigada_em', 'fontes_painel'];
export function marcar(id, status, dados = {}) {
  if (!ehId(id)) throw new Error('id inválido');
  if (!STATUS.includes(status)) throw new Error('status inválido: ' + status);
  return transacao((e) => {
    const it = e.itens[id]; if (!it) throw new Error('lacuna não existe: ' + id);
    const ant = it.status; it.status = status; it.atualizado_em = agoraIso(); if (status === 'investigando') it.ultima_tentativa = agoraIso();
    if (status === 'aprendida' || status === 'descartada') it.resolvido_em = agoraIso(); else if (status === 'nova') it.resolvido_em = null;
    const r = { ...(it.resultado || {}) };
    for (const k of CAMPOS_RESULTADO) if (dados[k] !== undefined) r[k] = typeof dados[k] === 'string' ? (/^(investigada_em|modelo|aprovada_por)$/.test(k) ? dados[k].slice(0, 40) : curto(mascarar(dados[k]), 600)) : dados[k];
    if (dados.tentativas != null) it.tentativas = dados.tentativas;
    if (dados.pergunta_canonica) { it.pergunta_canonica = curto(mascarar(dados.pergunta_canonica), 200); it.tokens = normalizar(it.pergunta + ' ' + it.pergunta_canonica); }
    it.resultado = r;
    evento('lacuna_' + status, id, { de: ant, confianca: r.confianca, tipo: r.tipo, custo_usd: dados.custo_usd });
    return publico(it);
  });
}

// ---------------------------------------------------------------- regras aprendidas -> aprendizados.md
const regrasLer = () => lerJson(ARQ.regras, []);
export function regrasAtivas() { return regrasLer().filter((r) => r.ativa !== false); }
function adicionarRegra(id, texto, auto) {
  const t = curto(semEmoji(mascarar(texto)), 260); if (!t) return null;
  const rs = regrasLer().filter((r) => r.lacuna !== id);
  rs.unshift({ lacuna: id, regra: t, desde: agoraIso(), auto: !!auto, ativa: true });
  rs.forEach((r, i) => { if (i >= CFG.max_regras_lacuna) r.ativa = false; });     // as mais velhas saem do prompt, ficam no arquivo
  gravar(ARQ.regras, rs); return t;
}
// Junta as regras das lacunas ao aprendizados.json/.md (mantendo no máximo 25 linhas no total, as das lacunas sempre dentro).
// Idempotente: o bot pode chamar a cada minuto (sai logo se nada mudou). Deve rodar também depois de cada aprender.mjs.
export function sincronizarAprendizados() {
  const lac = regrasAtivas().slice(0, CFG.max_regras_lacuna);
  const hist = lerJson(ARQ.aprendizadosJson, { rodadas: [], regras_ativas: [] });
  const outras = (hist.regras_ativas || []).filter((r) => !r.origem || r.origem !== 'lacuna');
  const vagas = Math.max(0, CFG.max_linhas_aprendizados - lac.length);
  const novas = [...lac.map((r) => ({ regra: `[lacuna ${r.lacuna.slice(1)}] ${r.regra}`, desde: r.desde, origem: 'lacuna', lacuna: r.lacuna })), ...outras.slice(0, vagas)];
  const igual = JSON.stringify((hist.regras_ativas || []).map((r) => r.regra)) === JSON.stringify(novas.map((r) => r.regra));
  let md = ''; try { md = fs.readFileSync(ARQ.aprendizadosMd, 'utf8'); } catch {}
  const linhasMd = md.split('\n').filter((l) => /^- /.test(l)).map((l) => l.slice(2));
  if (igual && JSON.stringify(linhasMd) === JSON.stringify(novas.map((r) => r.regra))) return { mudou: false, linhas: novas.length };
  hist.regras_ativas = novas; fs.mkdirSync(REL, { recursive: true }); gravar(ARQ.aprendizadosJson, hist);
  fs.writeFileSync(ARQ.aprendizadosMd, `# Aprendizados do atendimento (gerado sozinho, a cada leitura de 2 h e pelas lacunas de conhecimento)\nRegras de comportamento aprovadas pelo filtro. Sem preço, prazo ou link novos. O robô lê este arquivo junto com o base.md.\n\n${novas.map((a) => '- ' + a.regra).join('\n')}\n`);
  return { mudou: true, linhas: novas.length };
}

// ---------------------------------------------------------------- guarda: nada de dinheiro, prazo, política ou link novo entra sozinho
const baseTexto = () => { let t = ''; try { t += fs.readFileSync(ARQ.base, 'utf8'); } catch {} try { t += '\n' + fs.readFileSync(ARQ.aprendizadosMd, 'utf8'); } catch {} return t; };
const numNorm = (s) => String(s).toLowerCase().replace(/\s+/g, '').replace(/r\$/g, 'r$').replace(/,00\b/, '');
export function itensSensiveis(texto) {
  const t = String(texto || ''), achados = [];
  for (const m of t.matchAll(/R\$\s*[\d.,]+/gi)) achados.push({ tipo: 'dinheiro', valor: m[0] });
  for (const m of t.matchAll(/https?:\/\/[^\s)"']+|(?:www\.)[^\s)"']+|\b[\w-]+\.(?:com|net|site|me|space|one|men|lat)\b(?:\/[^\s)"']*)?/gi)) achados.push({ tipo: 'link', valor: m[0].replace(/[.,;]+$/, '') });
  for (const m of t.matchAll(/\b\d+\s*(?:dias?|horas?|h\b|semanas?|mes(?:es)?|meses|%|por cento|reais|cr[eé]ditos?)/gi)) achados.push({ tipo: 'numero', valor: m[0] });
  for (const m of t.matchAll(/\b(?:dia\s+\d{1,2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/gi)) achados.push({ tipo: 'data', valor: m[0] });
  if (/\b(desconto|promo[cç][aã]o|cupom|brinde|b[oô]nus|reembolsw*|garantw*|prometw*|devolvw*|devoluw*|dinheiro de volta|multa|juros|isen[cç][aã]o|gr[aá]tis para sempre|de gra[cç]a)\b/i.test(t)) achados.push({ tipo: 'politica', valor: (t.match(/\b(desconto|promo[cç][aã]o|cupom|brinde|b[oô]nus|reembols\w*|garant\w*|prometo|prometemos|devolv\w*|multa|juros|isen[cç][aã]o)\b/i) || [''])[0] });
  return achados;
}
// Devolve a lista de itens sensíveis que NÃO estão no base.md nem nas regras já aprovadas (= novos). Política conta sempre.
export function sensiveisNovos(texto, extraBase = '') {
  const base = (baseTexto() + '\n' + extraBase).toLowerCase().replace(/\s+/g, '');
  return itensSensiveis(texto).filter((x) => x.tipo === 'politica' || !base.includes(numNorm(x.valor)));
}

// ---------------------------------------------------------------- concluir: aprendida (automática ou aprovada pelo senhor)
export function concluirAprendida(id, { resposta, regra, auto = true, dados = {} } = {}) {
  const resp = curto(semEmoji(mascarar(resposta || '')), 500);
  const it = obter(id); if (!it) throw new Error('lacuna não existe: ' + id);
  const textoRegra = regra && String(regra).trim() ? regra : `Se perguntarem "${curto(it.pergunta_canonica, 90)}", responda: ${resp}`;
  const reg = adicionarRegra(id, textoRegra, auto);
  marcar(id, 'aprendida', { ...dados, resposta_sugerida: resp, regra_para_base: reg || '', aprovada_por: auto ? 'automatico' : 'senhor' });
  sincronizarAprendizados();
  const n = gerarRetornos(id);
  return { id, regra: reg, retornos: n };
}
export function aprovar(id, { resposta, regra } = {}) {
  const it = obter(id); if (!it) throw new Error('lacuna não existe: ' + id);
  if (it.status === 'descartada') throw new Error('lacuna descartada');
  const resp = (resposta && String(resposta).trim()) || it.resultado?.resposta_sugerida;
  if (!resp) throw new Error('sem resposta para aprovar');
  return concluirAprendida(id, { resposta: resp, regra: regra || (resposta ? '' : it.resultado?.regra_para_base), auto: false });
}
export function descartar(id) {
  const it = obter(id); if (!it) throw new Error('lacuna não existe: ' + id);
  transacao((e) => { for (const c of e.itens[id].clientes) if (!c.atendido) { c.atendido = true; c.retorno = 'descartada'; } });
  cancelarRetornosDaLacuna(id);
  return marcar(id, 'descartada', {});
}
export function reinvestigar(id) {
  const it = obter(id); if (!it) throw new Error('lacuna não existe: ' + id);
  transacao((e) => { e.itens[id].tentativas = 0; e.itens[id].reincidencias = 0; });
  return marcar(id, 'nova', { motivo_precisa_senhor: '' });
}

// ---------------------------------------------------------------- retornos ao cliente (o bot é quem envia)
const retornosLer = () => lerJson(ARQ.retornos, []);
function frases(t) { return String(t || '').split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean); }
export function montarRetorno(it, resposta) {
  const bruto = String(it.pergunta_canonica || it.pergunta).replace(/\[(?:número|e-mail)\]/g, '').replace(/\s+/g, ' ').trim();
  const tema = curto((bruto.match(/^[^?.!]{6,}/) || [bruto])[0].toLowerCase().trim(), 80);
  const corpo = frases(resposta).slice(0, 3).map((f) => curto(semEmoji(f), 160));
  return [`Mestre, voltei com a resposta da sua dúvida: ${tema}.`, ...corpo].slice(0, 4);
}
// Cria um retorno por cliente que ainda espera. Não envia nada.
export function gerarRetornos(id) {
  const it = obter(id); if (!it || it.status !== 'aprendida') return 0;
  const resposta = it.resultado?.resposta_sugerida; if (!resposta) return 0;
  const ag = lerJson(ARQ.aguardando, {}); const lista = retornosLer(); let n = 0;
  transacao((e) => {
    for (const c of e.itens[id].clientes) {
      if (c.atendido || !ag[c.ref] || lista.some((r) => r.lacuna === id && r.ref === c.ref)) continue;
      lista.push({ id: `${id}-${c.ref}`, lacuna: id, ref: c.ref, nome1: c.nome1, chat: ag[c.ref], mensagens: montarRetorno(it, resposta), criado_em: agoraIso(), ate: new Date(Date.now() + CFG.retorno_validade_h * 3600e3).toISOString(), status: 'pendente' });
      c.retorno = 'pendente'; n++;
    }
  });
  if (n) { gravar(ARQ.retornos, lista); evento('retornos_gerados', id, { n }); }
  return n;
}
const dentroDoHorario = (d) => d.getHours() >= CFG.retorno_hora_ini && d.getHours() < CFG.retorno_hora_fim;
// Retornos que o bot pode mandar AGORA: só entre 9h e 20h, no máximo `max` por chamada, com intervalo entre envios.
export function proximosRetornos({ agora = new Date(), max = 1 } = {}) {
  if (!dentroDoHorario(agora)) return [];
  const e = lerEstado();
  if (e.ultimo_retorno_em && agora - Date.parse(e.ultimo_retorno_em) < CFG.retorno_intervalo_min * 60e3) return [];
  const lista = retornosLer(); let mudou = false;
  for (const r of lista) if (r.status === 'pendente' && Date.parse(r.ate) < agora.getTime()) { r.status = 'expirado'; mudou = true; }
  if (mudou) gravar(ARQ.retornos, lista);
  return lista.filter((r) => r.status === 'pendente').slice(0, max);
}
export function confirmarRetorno(rid, { enviado = true, erro } = {}) {
  const lista = retornosLer(); const r = lista.find((x) => x.id === rid); if (!r) return false;
  r.status = enviado ? 'enviado' : 'falhou'; r.em = agoraIso(); if (erro) r.erro = curto(String(erro), 120); gravar(ARQ.retornos, lista);
  transacao((e) => { const c = e.itens[r.lacuna]?.clientes.find((x) => x.ref === r.ref); if (c && enviado) { c.atendido = true; c.retorno = 'enviado'; } if (enviado) e.ultimo_retorno_em = agoraIso(); });
  evento(enviado ? 'retorno_enviado' : 'retorno_falhou', r.lacuna, { ref: r.ref });
  return true;
}
// O senhor (ou o robô por outro caminho) já respondeu essa pessoa: cancela retornos e tira da lista de espera.
export function cancelarRetornos(chat) {
  const ref = refDe(chat); const lista = retornosLer(); let n = 0;
  for (const r of lista) if (r.ref === ref && r.status === 'pendente') { r.status = 'cancelado'; n++; }
  if (n) gravar(ARQ.retornos, lista);
  transacao((e) => { for (const it of Object.values(e.itens)) for (const c of it.clientes) if (c.ref === ref && !c.atendido) { c.atendido = true; c.retorno = 'senhor respondeu'; } });
  return n;
}
function cancelarRetornosDaLacuna(id) { const lista = retornosLer(); let n = 0; for (const r of lista) if (r.lacuna === id && r.status === 'pendente') { r.status = 'cancelado'; n++; } if (n) gravar(ARQ.retornos, lista); }

// ---------------------------------------------------------------- resumo para a API (GET /api/lacunas)
const ORDEM = { precisa_senhor: 0, nova: 1, investigando: 2, aprendida: 3, descartada: 4 };
export function resumoLacunas({ limite = 100 } = {}) {
  const e = lerEstado(), todas = Object.values(e.itens);
  const resumo = { novas: 0, investigando: 0, aprendidas: 0, precisa_senhor: 0, descartadas: 0, ocorrencias_total: 0 };
  const chave = { nova: 'novas', investigando: 'investigando', aprendida: 'aprendidas', precisa_senhor: 'precisa_senhor', descartada: 'descartadas' };
  for (const it of todas) { resumo[chave[it.status]]++; resumo.ocorrencias_total += it.ocorrencias; }
  resumo.custo_usd_total = Math.round(todas.reduce((s, it) => s + (it.resultado?.custo_usd || 0), 0) * 10000) / 10000;
  const itens = todas.sort((a, b) => ORDEM[a.status] - ORDEM[b.status] || Date.parse(b.atualizado_em) - Date.parse(a.atualizado_em)).slice(0, limite).map((it) => ({
    id: it.id, quando: it.criado_em, pergunta: it.pergunta_canonica || it.pergunta, ocorrencias: it.ocorrencias,
    clientes_aguardando: it.clientes.filter((c) => !c.atendido).length, motivo: it.motivos[0], status: it.status,
    resposta_sugerida: it.resultado?.resposta_sugerida || '', fatos_do_painel: it.resultado?.fatos_do_painel || [], confianca: it.resultado?.confianca ?? null,
    tipo: it.resultado?.tipo || null, regra_para_base: it.resultado?.regra_para_base || '', motivo_precisa_senhor: it.resultado?.motivo_precisa_senhor || '', resolvido_em: it.resolvido_em,
  }));
  return { gerado_em: agoraIso(), resumo, itens };
}

// ---------------------------------------------------------------- investigação em segundo plano (fila de 1 por vez)
const AGENTE = path.join(AQUI, 'aprender-lacuna.mjs');
export function investigacaoOcupada() {
  try { return Date.now() - fs.statSync(ARQ.investigando).mtimeMs < CFG.investigando_vence_min * 60e3; } catch { return false; }
}
export function proximaParaInvestigar() {
  const hoje = new Date().toISOString().slice(0, 10), e = lerEstado();
  if ((e.investigacoes[hoje] || 0) >= CFG.max_por_dia) return null;
  const quando = Date.now(), parada = (x) => x.status === 'investigando' && quando - Date.parse(x.atualizado_em) > CFG.investigando_vence_min * 60e3;
  const v = Object.values(e.itens).filter((x) => (x.status === 'nova' || parada(x)) && (x.tentativas || 0) < CFG.max_tentativas && !(x.ultima_tentativa && quando - Date.parse(x.ultima_tentativa) < 10 * 60e3))
    .sort((a, b) => b.ocorrencias - a.ocorrencias || Date.parse(a.criado_em) - Date.parse(b.criado_em));
  return v[0]?.id || null;
}
// Dispara o agente em segundo plano (não bloqueia a conversa). Nunca duas ao mesmo tempo (a trava fica no próprio agente).
export function dispararInvestigacao(id, extra = []) {
  if (!ehId(id) || investigacaoOcupada()) return false;
  try { const p = spawn(process.execPath, [AGENTE, id, ...extra], { cwd: AQUI, detached: true, stdio: 'ignore', windowsHide: true }); p.unref(); return true; } catch { return false; }
}
// O bot chama de minuto em minuto (e logo depois de registrar): sincroniza as regras, libera a fila e começa a próxima investigação.
export function drenarFila({ avisar = true } = {}) {
  try { sincronizarAprendizados(); } catch {}
  if (investigacaoOcupada()) return { disparou: null, motivo: 'ocupado' };
  const id = proximaParaInvestigar(); if (!id) return { disparou: null, motivo: 'fila vazia' };
  return { disparou: dispararInvestigacao(id, avisar ? ['--avisar'] : []) ? id : null };
}

// ---------------------------------------------------------------- detecção a partir da resposta do Haiku (usada no bot)
const RX_ROTINA = /recarga|comprovante|brav|reclama|t[eé]cnic|n[aã]o consegue criar|foto|arquivo|equipe|interno|\bilha\b|sess[aã]o|rob[oô]|teste n[aã]o gerado|pagou|pagamento feito|cobran[cç]a errada|bloquead/i;
const RX_NAO_SEI = /n[aã]o tenho (essa|a|esta) informa|n[aã]o tenho essa|n[aã]o sei (te )?(dizer|informar|responder)|vou (confirmar|verificar) (com|isso)|n[aã]o est[aá] aqui|n[aã]o tenho como confirmar/i;
export function ehAvisoDeRotina(motivo) { return RX_ROTINA.test(String(motivo || '')); }
export function classificarMotivo(motivoAviso) {
  const m = String(motivoAviso || '');
  if (!m.trim()) return 'avisar_sem_motivo_claro';
  if (/n[aã]o entend/i.test(m)) return 'nao_entendeu';
  if (/fora d|outro assunto|n[aã]o [eé] (da )?revenda|assunto/i.test(m)) return 'fora_do_roteiro';
  if (/contradiz|inconsist|errad/i.test(m)) return 'resposta_contradiz_base';
  if (/n[aã]o est[aá] aqui|n[aã]o tenho|n[aã]o sei|n[aã]o cobre|sem informa|perguntou algo/i.test(m)) return 'sem_informacao_no_base';
  return 'avisar_sem_motivo_claro';
}
// r = JSON do Haiku; mensagens = o que o robô vai mandar; ultimaMensagem = última fala do cliente. Devolve null ou { pergunta, motivo }.
export function detectarLacuna({ r, mensagens = [], ultimaMensagem = '' } = {}) {
  if (!r) return null;
  if (r.avisar && ehAvisoDeRotina(r.motivo)) return null;
  const ultima = curto(mascarar(ultimaMensagem), 300);
  const lac = typeof r.lacuna === 'string' ? r.lacuna.trim() : '';
  if (lac.length >= 3) return { pergunta: lac, motivo: r.avisar ? classificarMotivo(r.motivo) === 'avisar_sem_motivo_claro' ? 'sem_informacao_no_base' : classificarMotivo(r.motivo) : 'sem_informacao_no_base' };
  if (r.avisar) return ultima ? { pergunta: ultima, motivo: classificarMotivo(r.motivo) } : null;
  if (RX_NAO_SEI.test((mensagens || []).join(' ')) && ultima) return { pergunta: ultima, motivo: 'sem_informacao_no_base' };
  return null;
}

// ---------------------------------------------------------------- importar das leituras de 2 h (aprender.mjs)
export function importarDeAprendizados() {
  const hist = lerJson(ARQ.aprendizadosJson, { rodadas: [] }); const e0 = lerEstado(); let n = 0;
  for (const rod of hist.rodadas || []) {
    if (e0.rodadas_importadas.includes(rod.id)) continue;
    for (const q of rod.perguntas_nao_cobertas || []) if (q.pergunta) { const r = registrarLacuna({ chat: null, nome1: '', pergunta: q.pergunta.replace(/\s*\([^)]*\)\s*$/, ''), contexto: [], motivo: 'sem_informacao_no_base', origem: 'aprender' }); if (r.id) n++; }
    for (const x of rod.inconsistencias || []) if (/contradi/i.test(x.tipo || '') && x.titulo) { const r = registrarLacuna({ chat: null, nome1: '', pergunta: x.titulo, contexto: [x.exemplo || ''], motivo: 'resposta_contradiz_base', origem: 'aprender' }); if (r.id) n++; }
    transacao((e) => { e.rodadas_importadas.push(rod.id); e.rodadas_importadas = e.rodadas_importadas.slice(-300); });
  }
  return n;
}

export const contarInvestigacao = () => transacao((e) => { const h = new Date().toISOString().slice(0, 10); e.investigacoes = { [h]: (e.investigacoes[h] || 0) + 1 }; return e.investigacoes[h]; });

export const investigacoesHoje = () => lerEstado().investigacoes[new Date().toISOString().slice(0, 10)] || 0;

// ---------------------------------------------------------------- decisão sobre o que o modelo devolveu (usada pelo agente e pelos testes)
const limpaTxt = (t, n) => curto(mascarar(semEmoji(t)), n);
const numerosDe = (t) => (String(t).match(/\d+(?:[.,]\d+)?/g) || []).map((x) => x.replace(',', '.'));
export function decidirResultado(r, { painelTexto = '', fontesOk = [] } = {}) {
  const resposta = limpaTxt(r.resposta_sugerida, 500), regra = limpaTxt(r.regra_para_base, 240), canonica = limpaTxt(r.pergunta_canonica, 100);
  const conf = Math.max(0, Math.min(1, Number(r.confianca) || 0));
  const universo = (painelTexto + '\n' + baseTexto()).replace(/(\d),(?=\d)/g, '$1.');
  // fatos: só com fonte conhecida e com números que existem de fato no dossiê (anti-invenção)
  const fatos = (Array.isArray(r.fatos_do_painel) ? r.fatos_do_painel : []).slice(0, 8).map((f) => ({ fato: limpaTxt(f?.fato, 260), fonte: limpaTxt(f?.fonte, 80) }))
    .filter((f) => f.fato && fontesOk.includes(f.fonte) && numerosDe(f.fato).every((n) => universo.includes(n)));
  const motivos = [];
  if (r.tipo !== 'regra_segura') motivos.push(limpaTxt(r.motivo_precisa_senhor, 300) || 'O agente marcou como sugestão para o senhor aprovar.');
  if (!resposta || !regra) motivos.push('Sem resposta ou sem regra utilizável.');
  if (conf < 0.8) motivos.push('Confiança ' + conf.toFixed(2) + ' abaixo de 0,80.');
  if (r.contradiz_base === true) motivos.push('A resposta contradiz o base.md.');
  if (!fatos.length && r.confirmado_no_base !== true) motivos.push('Nenhum fato do painel ou do base.md confirma a resposta.');
  const novos = sensiveisNovos(resposta + ' ' + regra);
  if (novos.length) motivos.push('Envolve dinheiro, prazo, política ou link que não está no base.md: ' + [...new Set(novos.map((x) => x.valor))].slice(0, 5).join('; '));
  return { tipo: motivos.length === 0 ? 'regra_segura' : 'precisa_senhor', resposta, regra, canonica, confianca: conf, fatos, motivos, novos };
}
