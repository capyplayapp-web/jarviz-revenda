// API do backlog de follow-ups (08/11/2026): /api/followups, /api/backlog e os POST de mapear, pausar e retomar.
// Lê os arquivos do robô (backlog.json, backlog-fila.json, backlog-estado.json, backlog-config.json, eventos.jsonl...).
// Telefone SEMPRE mascarado (só os 4 últimos dígitos) e sem o id da conversa. Senha nunca passa por aqui.
// Todas as funções aceitam { pasta, agora } para os testes usarem dados simulados.
import fs from 'node:fs';
import path from 'node:path';
import { PASTA, lerJson, FOLLOWUP_MIN } from './lib.mjs';

export const TETO_DIA = 120;
export const JANELA = { ini: 9, fim: 20 };

const arq = (pasta, n) => path.join(pasta, n);
const iso = (ms) => new Date(ms).toISOString();
const digitos = (s) => String(s || '').replace(/\D/g, '');
export const mascararTelefone = (t) => { const d = digitos(t); return d ? '•••• ' + d.slice(-4) : ''; };
const mesmoDia = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
const r3 = (n) => Math.round(n * 1000) / 1000;

function lerJsonl(file) {
  let txt = ''; try { txt = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const saida = [];
  for (const l of txt.split('\n')) { if (!l) continue; try { const e = JSON.parse(l); if (e && e.t && e.tipo) saida.push(e); } catch {} }
  return saida;
}
function lerEventosDe(pasta) {
  const vivo = lerJsonl(arq(pasta, 'eventos.jsonl')), hist = lerJsonl(arq(pasta, 'eventos-historico.jsonl'));
  const proprios = vivo.filter((e) => !e.varredura).map((e) => Date.parse(e.t)).filter(Number.isFinite);
  const corte = proprios.length ? Math.min(...proprios) : Infinity;
  return hist.filter((e) => Date.parse(e.t) < corte).concat(vivo).sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
}

// Próximo horário válido (janela 9-20h) a partir de `ms`.
function naJanela(ms) {
  const d = new Date(ms), h = d.getHours();
  if (h >= JANELA.ini && h < JANELA.fim) return ms;
  const x = new Date(ms);
  if (h >= JANELA.fim) x.setDate(x.getDate() + 1);
  x.setHours(JANELA.ini, 0, 0, 0);
  return x.getTime();
}

function estadoDoMotor(pasta, agora, fila) {
  const e = lerJson(arq(pasta, 'backlog-estado.json'), {});
  const cfg = lerJson(arq(pasta, 'backlog-config.json'), {});
  const pausado = fs.existsSync(arq(pasta, 'backlog-pausado'));
  let enviados_hoje = 0;
  for (const it of fila) for (const f of it.followups || []) if (mesmoDia(Date.parse(f.quando), agora)) enviados_hoje++;
  return {
    pausado, modo: cfg.modo === 'completo' ? 'completo' : 'piloto', parado_por_erros: !!e.parado_por_erros, erros_seguidos: e.erros_seguidos || 0,
    proximo_envio_em: !pausado && !e.parado_por_erros && e.proximo_envio_em ? e.proximo_envio_em : null, intervalo_medio_s: e.intervalo_medio_s ?? null, motivo_espera: e.motivo_espera || null,
    ultimo_envio_em: e.ultimo_envio_em || null, enviados_hoje, teto_dia: TETO_DIA, mapeamento: e.mapeamento || null, atualizado_em: e.atualizado_em || null,
  };
}

const ROTULO_ETAPA = { primeiro_contato: 'Primeiro contato', explicando: 'Explicando', duvidas: 'Com dúvidas', criando_painel: 'Criando o painel', painel_criado: 'Painel criado', testando: 'Testando', cliente_ativo: 'Cliente ativo', parado: 'Parado', encerrado: 'Encerrado' };
const CATEGORIAS = ['painel_criado', 'testando', 'interessado_sem_painel', 'duvida_aberta', 'sem_resposta_nossa', 'esfriou', 'sem_interesse', 'suporte', 'equipe_ou_parceiro', 'irrelevante'];

function mascararItemMapa(it) {
  return {
    ref: it.ref, nome: it.nome || '', telefone_mascarado: mascararTelefone(it.telefone), categoria: it.categoria, etapa: it.etapa, ultimo_contato: it.ultimo_contato, ultimo_a_falar: it.ultimo_a_falar,
    resumo: it.resumo || '', elegivel: !!it.elegivel, motivo: it.motivo || '', followup_sugerido: it.followup_sugerido || null, pergunta_aberta: !!it.pergunta_aberta,
    renomeio: it.renomeio ? { status: it.renomeio.status, de: it.renomeio.de || null, para: it.renomeio.para || null, motivo: it.renomeio.motivo || null } : null, ficha_nova: !!it.ficha_nova,
  };
}
function mascararItemFila(it, pos) {
  return {
    ref: it.ref, posicao: pos, nome: it.nome || '', telefone_mascarado: mascararTelefone(it.telefone), categoria: it.categoria, etapa: it.etapa, ultimo_contato: it.ultimo_contato, resumo: it.resumo || '',
    texto: it.texto || null, texto2: it.texto2 || null, status: it.status, piloto: !!it.piloto, followups: (it.followups || []).map((f) => ({ n: f.n, quando: f.quando, texto: f.texto })),
    respondeu_em: it.respondeu_em || null, minutos_ate_resposta: it.minutos_ate_resposta ?? null, fechou_painel_em: it.fechou_painel_em || null, descartado_motivo: it.descartado_motivo || null, encerrado: !!it.encerrado,
  };
}

// Contagens do backlog (iguais para as duas rotas).
function resumoBacklog(mapa, fila) {
  const itens = mapa.itens || [];
  const c = (s) => fila.filter((f) => f.status === s).length;
  const por_categoria = CATEGORIAS.map((categoria) => ({ categoria, qtd: itens.filter((i) => i.categoria === categoria).length }));
  return {
    backlog_total: itens.length,
    backlog_mapeados: itens.filter((i) => !/leitura da conversa falhou/.test(i.motivo || '')).length,
    backlog_renomeados: itens.filter((i) => i.renomeio && i.renomeio.status === 'renomeado').length,
    backlog_na_fila: c('na_fila'), backlog_enviados: fila.filter((f) => (f.followups || []).length > 0).length,
    backlog_respondeu: c('respondeu'), backlog_fechou_painel: c('fechou_painel'), backlog_descartados: c('descartado'),
    por_categoria,
  };
}

function lerBacklog(pasta) {
  const mapa = lerJson(arq(pasta, 'backlog.json'), { itens: [] });
  const filaArq = lerJson(arq(pasta, 'backlog-fila.json'), { itens: [] });
  return { mapa, fila: filaArq.itens || [] };
}

export function montarBacklog({ pasta = PASTA, agora = Date.now() } = {}) {
  const { mapa, fila } = lerBacklog(pasta);
  const estado = estadoDoMotor(pasta, agora, fila);
  const naFila = fila.filter((f) => f.status === 'na_fila').sort((a, b) => Date.parse(b.ultimo_contato) - Date.parse(a.ultimo_contato));
  return {
    gerado_em: iso(agora), estado, resumo: resumoBacklog(mapa, fila),
    mapa: { gerado_em: mapa.gerado_em || null, dias: mapa.dias || null, duracao_s: mapa.duracao_s || null, conversas_no_whatsapp: mapa.conversas_no_whatsapp || null, custo: mapa.custo || null, renomeio: mapa.renomeio || null, contagens: mapa.contagens || null, itens: (mapa.itens || []).map(mascararItemMapa) },
    fila: fila.slice().sort((a, b) => Date.parse(b.ultimo_contato) - Date.parse(a.ultimo_contato)).map((f) => mascararItemFila(f, f.status === 'na_fila' ? naFila.indexOf(f) + 1 : null)),
  };
}

// /api/followups?dias=1|7: escada ao vivo (7/20/60/180 min) + backlog, no contrato combinado com a tela.
export function montarFollowups({ dias = 1, pasta = PASTA, agora = Date.now() } = {}) {
  dias = Math.min(Math.max(parseInt(dias, 10) || 1, 1), 31);
  const ini = new Date(agora); ini.setHours(0, 0, 0, 0); ini.setDate(ini.getDate() - (dias - 1));
  const T = (e) => Date.parse(e.t);
  const todos = lerEventosDe(pasta);
  const fichas = lerJson(arq(pasta, 'clientes.json'), {});
  const revs = lerJson(arq(pasta, 'revendedores.json'), {});
  const quieto = lerJson(arq(pasta, 'quieto.json'), {});
  const { mapa, fila } = lerBacklog(pasta);
  const estado = estadoDoMotor(pasta, agora, fila);

  // ----- escada ao vivo -----
  const fus = todos.filter((e) => e.tipo === 'followup' && T(e) >= ini.getTime());
  const resp = todos.filter((e) => e.tipo === 'cliente_respondeu_followup');
  const respondeu = (f) => resp.find((r) => r.chat === f.chat && (r.followup_t === f.t || (r.n === f.n && Date.parse(r.followup_t) === Date.parse(f.t))));
  const fechamentos = todos.filter((e) => e.tipo === 'painel_fechado' && T(e) >= ini.getTime());
  const degraus = FOLLOWUP_MIN.map((min, i) => {
    const n = i + 1, fe = fus.filter((f) => f.n === n), re = fe.filter((f) => respondeu(f));
    let paineis_depois = 0;
    for (const pf of fechamentos) {
      const antes = todos.filter((e) => e.tipo === 'followup' && e.chat === pf.chat && T(e) < T(pf) && T(pf) - T(e) < 12 * 3600e3).pop();
      if (antes && antes.n === n) paineis_depois++;
    }
    return { n, minutos: fe[0]?.minutos || min, enviados: fe.length, respondidos: re.length, taxa: fe.length ? r3(re.length / fe.length) : 0, paineis_depois };
  });
  const enviadosVivo = fus.length, respVivo = fus.filter((f) => respondeu(f)).length;
  const paineisDepoisVivo = degraus.reduce((a, d) => a + d.paineis_depois, 0);

  // clientes ao vivo (quem recebeu follow-up no período)
  const clientes = [];
  const porChat = new Map();
  for (const f of fus) (porChat.get(f.chat) || porChat.set(f.chat, []).get(f.chat)).push(f);
  let aguardandoVivo = 0;
  for (const [chat, lista] of porChat) {
    const ficha = fichas[chat] || {};
    const evCli = todos.filter((e) => e.chat === chat);
    const ultRobo = Math.max(0, ...evCli.filter((e) => e.tipo === 'resposta_robo' || e.tipo === 'followup').map(T));
    const ultCli = Math.max(0, ...evCli.filter((e) => e.tipo === 'mensagem_cliente').map(T));
    const ultSen = Math.max(0, ...evCli.filter((e) => e.tipo === 'senhor_escreveu').map(T));
    const fechou = !!revs[chat] || evCli.some((e) => e.tipo === 'painel_fechado');
    const fl = lista.map((f) => { const r = respondeu(f); return { n: f.n, quando: f.t, texto: f.texto || '', respondeu: !!r, minutos_ate_resposta: r ? (r.minutos_ate_resposta ?? null) : null }; });
    const ult = lista[lista.length - 1], ultResp = !!respondeu(ult);
    const n = lista.length;
    let status = 'aguardando';
    if (fechou) status = 'fechou_painel';
    else if (ultResp || ultCli > T(ult)) status = 'respondeu';
    else if (ultSen > T(ult) || (Number(quieto[chat] || 0) > agora)) status = 'nao_incomodar';
    else if (n >= FOLLOWUP_MIN.length) status = 'sem_resposta';
    const prox = status === 'aguardando' && n < FOLLOWUP_MIN.length ? { n: n + 1, em: iso(ultRobo + FOLLOWUP_MIN[n] * 60e3) } : null;
    if (status === 'aguardando') aguardandoVivo++;
    clientes.push({ nome: ficha.nome || ult.nome || '', telefone_mascarado: mascararTelefone(ficha.telefone_real), origem: 'ao_vivo', categoria: fechou ? 'painel_criado' : ficha.etapa === 'testando' ? 'testando' : (ultCli > ultRobo ? 'sem_resposta_nossa' : 'esfriou'),
      etapa: ROTULO_ETAPA[ficha.etapa] || ficha.etapa || 'Sem etapa', ultimo_contato: iso(Math.max(ultRobo, ultCli, T(ult))), followups: fl, proximo: prox, status });
  }

  // ----- backlog -----
  const cat = resumoBacklog(mapa, fila);
  const naFila = fila.filter((f) => f.status === 'na_fila').sort((a, b) => Date.parse(b.ultimo_contato) - Date.parse(a.ultimo_contato));
  const rodando = !estado.pausado && !estado.parado_por_erros;
  const base = estado.proximo_envio_em ? Date.parse(estado.proximo_envio_em) : null;
  const estimar = (pos) => (rodando && base ? iso(naJanela(base + pos * 90e3)) : null);
  const liberados = estado.modo === 'completo' ? naFila : naFila.filter((f) => f.piloto);
  const cliBack = fila.map((f) => {
    const fl = (f.followups || []).map((x, i, arr) => ({ n: x.n, quando: x.quando, texto: x.texto, respondeu: f.status === 'respondeu' && i === arr.length - 1, minutos_ate_resposta: f.status === 'respondeu' && i === arr.length - 1 ? (f.minutos_ate_resposta ?? null) : null }));
    let status, proximo = null;
    if (f.status === 'na_fila') { status = 'na_fila'; const pos = liberados.indexOf(f); proximo = { n: 1, em: pos >= 0 ? estimar(pos) : null }; }
    else if (f.status === 'respondeu') status = 'respondeu';
    else if (f.status === 'fechou_painel') status = 'fechou_painel';
    else if (f.status === 'descartado') status = 'nao_incomodar';
    else if (f.encerrado || (f.followups || []).length >= 2) status = 'sem_resposta';
    else { status = 'aguardando'; proximo = null; }   // 08/11 (funil): o 2º follow-up do atrasado foi desligado; a cadência de dias (aba Funil) assume
    const ultimaMov = Math.max(Date.parse(f.ultimo_contato) || 0, ...(f.followups || []).map((x) => Date.parse(x.quando)));
    return { nome: f.nome || '', telefone_mascarado: mascararTelefone(f.telefone), origem: 'backlog', categoria: f.categoria, etapa: ROTULO_ETAPA[f.etapa] || f.etapa || 'Sem etapa', ultimo_contato: iso(ultimaMov), followups: fl, proximo, status, ref: f.ref };
  });
  clientes.push(...cliBack);
  clientes.sort((a, b) => Date.parse(b.ultimo_contato) - Date.parse(a.ultimo_contato));

  return {
    gerado_em: iso(agora),
    resumo: {
      em_fila: cat.backlog_na_fila + aguardandoVivo, enviados: enviadosVivo, respondidos: respVivo, taxa: enviadosVivo ? r3(respVivo / enviadosVivo) : 0, paineis_depois: paineisDepoisVivo,
      backlog_total: cat.backlog_total, backlog_mapeados: cat.backlog_mapeados, backlog_renomeados: cat.backlog_renomeados, backlog_na_fila: cat.backlog_na_fila, backlog_enviados: cat.backlog_enviados,
      backlog_respondeu: cat.backlog_respondeu, backlog_fechou_painel: cat.backlog_fechou_painel, backlog_descartados: cat.backlog_descartados,
      pausado: estado.pausado || estado.parado_por_erros, proximo_envio_em: estado.proximo_envio_em, enviados_hoje: estado.enviados_hoje, teto_dia: TETO_DIA, intervalo_medio_s: estado.intervalo_medio_s,
      // extras (permitidos pelo contrato)
      modo: estado.modo, parado_por_erros: estado.parado_por_erros, motivo_espera: estado.motivo_espera, mapeamento: estado.mapeamento,
    },
    degraus, clientes: clientes.slice(0, 300), por_categoria: cat.por_categoria,
  };
}

// ---------- rotas ----------
// Devolve { codigo, corpo } ou null (rota que não é do backlog). Os POST exigem Content-Type JSON e Origin local:
// uma página qualquer do navegador não consegue liberar os envios por engano.
export function tratarRotaBacklog({ metodo, rota, query = {}, headers = {}, corpo = {}, pasta = PASTA, agora = Date.now() }) {
  const ehGet = metodo === 'GET';
  if (rota === '/api/followups' && ehGet) return { codigo: 200, corpo: montarFollowups({ dias: query.dias, pasta, agora }) };
  if (rota === '/api/backlog' && ehGet) return { codigo: 200, corpo: montarBacklog({ pasta, agora }) };
  if (!/^\/api\/backlog\/(mapear|pausar|retomar)$/.test(rota)) return null;
  if (metodo !== 'POST') return { codigo: 405, corpo: { erro: 'use POST' } };
  const ct = String(headers['content-type'] || ''), origem = String(headers.origin || '');
  if (!/^application\/json/i.test(ct)) return { codigo: 415, corpo: { erro: 'envie Content-Type: application/json' } };
  if (origem && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origem)) return { codigo: 403, corpo: { erro: 'origem não permitida' } };
  const acao = rota.split('/').pop();
  const A = { pausado: arq(pasta, 'backlog-pausado'), cfg: arq(pasta, 'backlog-config.json'), comando: arq(pasta, 'backlog-comando.json') };
  if (acao === 'pausar') { fs.writeFileSync(A.pausado, 'pausado pela API em ' + iso(agora)); return { codigo: 200, corpo: { ok: true, pausado: true } }; }
  if (acao === 'retomar') {
    const modo = corpo && corpo.modo === 'piloto' ? 'piloto' : 'completo';
    const cfg = lerJson(A.cfg, {}); cfg.modo = modo;
    fs.writeFileSync(A.cfg + '.tmp', JSON.stringify(cfg, null, 1)); fs.renameSync(A.cfg + '.tmp', A.cfg);
    try { fs.unlinkSync(A.pausado); } catch {}
    return { codigo: 200, corpo: { ok: true, pausado: false, modo } };
  }
  // mapear
  const est = lerJson(arq(pasta, 'backlog-estado.json'), {});
  if (est.mapeamento && est.mapeamento.em_andamento && Date.now() - Date.parse(est.atualizado_em || 0) < 15 * 60e3) return { codigo: 409, corpo: { ok: false, erro: 'já está mapeando', mapeamento: est.mapeamento } };
  const d = Math.min(Math.max(parseInt(corpo && corpo.dias, 10) || 14, 1), 60);
  fs.writeFileSync(A.comando, JSON.stringify({ acao: 'mapear', dias: d, pedido_em: iso(agora) }));
  return { codigo: 202, corpo: { ok: true, enfileirado: true, dias: d, aviso: 'o robô lê o pedido em até 10 s; acompanhe em /api/backlog (estado.mapeamento)' } };
}
