'use strict';
// Núcleo da estratégia de funil (08/11/2026). Só funções puras: estados do lead, próximo passo, cadência de dias,
// jornada do revendedor, portão dos envios proativos, A/B, filtro contra invenção e etiquetas.
// Testado em funil\testar-funil.mjs (sem WhatsApp e sem Haiku de verdade). O motor (funil\motor.js) usa isto.
const crypto = require('crypto');

const LIM = Object.freeze({
  janela_ini: 9, janela_fim: 20,           // proativos (cadência, jornada, atrasado, retomada, retorno de lacuna) só das 9h às 20h
  vivo_ini: 8, vivo_fim: 21,               // escada ao vivo (7/20/60/180 min): regra antiga do senhor, 8h-21h
  teto_total: 120,                         // TOTAL de proativos por dia (ao vivo + atrasado + cadência + jornada + retomada + lacuna)
  reserva_ao_vivo: 15,                     // os outros param em 105 para sobrar espaço para a escada ao vivo
  min_gap_s: 60,                           // nunca dois proativos a menos de 60 s
  jitter: 0.3,
  plano_max_s: 360,                        // ritmo uniforme dos de baixa prioridade: no máximo 6 min entre um e outro
  max_toques_21d: 5,                       // toques de dias (atrasado + cadência) por lead em 21 dias
  dias: [1, 3, 7, 14],                     // D+1 ajuda, D+3 prova, D+7 benefício, D+14 porta aberta
  gaps_h: [20, 44, 72, 144],               // distância mínima do toque anterior
  reativacao_dias: 30, reativacao_ligada: false,
  responder_min: 3, responder_max_h: 48,   // vigia responde conversa com a última palavra do cliente (3 min a 48 h)
  lembrete_h: 2, lembrete_intervalo_h: 2, lembrete_ini: 9, lembrete_fim: 21,
  retomada_h: 24,                          // senhor não pegou em 24 h: o robô retoma
  senhor_manual_h: 48, senhor_ultimo_h: 72,
  alerta_min: 60,                          // KPI "sem próximo passo" > 0 por mais de 1 h: alerta no Telegram
  travado_min: { responder: 20, cadencia: 180, jornada: 180, atrasado: 240, retomada: 180 },
  ab_min: 30, ab_janela_h: 48,
  jornada_dias: [1, 3, 7], jornada_ciclo_dias: [7, 10], jornada_min_dias: 7,
  fech_vendas: [25, 27], fech_pagamento: [3, 4], dia_acerto: 5,
  sem_uso_dias: 2, risco_dias: 5, sem_login_risco_dias: 7, bom_uso: 5,
});

// Prioridade da fila única (menor = antes). Respostas a clientes não passam pelo portão (não são proativas).
const PRIORIDADE = { ao_vivo: 0, retomada: 1, lacuna: 2, cadencia: 3, jornada: 4, atrasado: 5 };
const TIPOS_PROATIVOS = ['followup', 'followup_backlog', 'toque_cadencia', 'toque_jornada', 'retomada_senhor', 'retorno_lacuna'];
const ANGULOS = ['ajuda', 'prova', 'beneficio', 'porta'];
// Mesma regra do relatorios\lib.mjs (ENCERRA): o cliente só agradeceu ou concordou = conversa encerrada.
const ENCERRA = /^\s*(ok|okay|blz|beleza|valeu|vlw|obrigad[oa]?|brigad[oa]?|show|certo|top|tmj|entendi|combinado|fechou|perfeito|isso|de nada|tudo bem|tranquilo|bom dia|boa tarde|boa noite|👍|🙏)[\s.!,👍🙏😊]*$/i;
const PEDIU_PARAR = /(para(r)? de (me )?(mandar|enviar|chamar)|n[aã]o (me )?(mande|mandem|chame|envie)|n[aã]o tenho (mais )?interesse|n[aã]o quero (mais|nada|saber)|sem interesse|me (tira|tire|remove|remova) (da|dessa|desta|do|desse) (lista|grupo|contato|conversa)|me (tira|tire) daqui|sai(r)? da lista|pare de|desisti|n[aã]o vou (querer|fazer|revender)|vou bloquear|chega de mensagem)/i;
const ETAPAS_FECHOU = ['painel_criado', 'cliente_ativo'];
const CAT_FORA = ['suporte', 'equipe_ou_parceiro', 'irrelevante'];

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const digitos = (s) => String(s || '').replace(/\D/g, '');
const refDe = (id) => crypto.createHash('sha1').update(String(id)).digest('hex').slice(0, 10);
const mascarar = (t) => { const d = digitos(t); return d ? '•••• ' + d.slice(-4) : ''; };
const H = 3600e3, D = 86400e3;

// ---------- janela ----------
function naJanela(ms, ini = LIM.janela_ini, fim = LIM.janela_fim) { const h = new Date(ms).getHours(); return h >= ini && h < fim; }
// Leva um horário para dentro da janela (se cair fora, vai para o início da próxima janela).
function paraJanela(ms, ini = LIM.janela_ini, fim = LIM.janela_fim) {
  const d = new Date(ms);
  if (d.getHours() < ini) { d.setHours(ini, 0, 0, 0); return d.getTime(); }
  if (d.getHours() >= fim) { d.setDate(d.getDate() + 1); d.setHours(ini, 0, 0, 0); return d.getTime(); }
  return ms;
}
const mesmoDia = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

// ---------- portão dos proativos (fila única) ----------
function contarProativosHoje(eventos, agora) {
  let n = 0, ultimo = 0;
  for (const e of eventos || []) {
    const t = Date.parse(e.t);
    const pro = TIPOS_PROATIVOS.includes(e.tipo) || (e.tipo === 'resposta_robo' && e.retorno === true);
    if (!pro) continue;
    if (mesmoDia(t, agora)) n++;
    if (t > ultimo) ultimo = t;
  }
  return { hoje: n, ultimo };
}
// Ritmo uniforme dos de baixa prioridade: o tempo que resta na janela dividido pelo que falta, entre 60 s e 6 min.
function planoRitmo({ agora, pendentes, lim = LIM }) {
  if (!pendentes) return lim.min_gap_s * 1000;
  const fim = new Date(agora); fim.setHours(lim.janela_fim, 0, 0, 0);
  const resta = Math.max(0, fim.getTime() - agora);
  return Math.max(lim.min_gap_s * 1000, Math.min(lim.plano_max_s * 1000, Math.round(resta / pendentes)));
}
// Decide se um envio proativo do tipo `tipo` pode sair agora.
// demandas: { tipo: quantos estão vencidos agora }; ocupado: há resposta a cliente em andamento (fila/atendendo/pendentes).
function portao({ tipo, agora, hoje, ultimo, proximoLivre = 0, demandas = {}, ocupado = false, pausado = false, lim = LIM }) {
  const no = (motivo, ate) => ({ ok: false, motivo, ate: ate || null });
  if (pausado) return no('pausado');
  if (!(tipo in PRIORIDADE)) return no('tipo desconhecido');
  if (tipo === 'ao_vivo') { if (!naJanela(agora, lim.vivo_ini, lim.vivo_fim)) return no('fora_da_janela'); }
  else if (!naJanela(agora)) return no('fora_da_janela', paraJanela(agora));
  const teto = tipo === 'ao_vivo' ? lim.teto_total : lim.teto_total - lim.reserva_ao_vivo;
  if (hoje >= teto) return no('teto_diario');
  if (ultimo && agora - ultimo < lim.min_gap_s * 1000) return no('menos_de_60s', ultimo + lim.min_gap_s * 1000);
  if (tipo === 'ao_vivo') return { ok: true };
  if (ocupado) return no('respondendo_cliente');
  for (const [t, n] of Object.entries(demandas)) if (n > 0 && PRIORIDADE[t] < PRIORIDADE[tipo]) return no('prioridade_' + t);
  if (proximoLivre && agora < proximoLivre) return no('ritmo', proximoLivre);
  return { ok: true };
}

// ---------- texto: filtro contra invenção e repetição ----------
const PROIBIDAS = [
  /relat[oó]rio (do|de|para o) revend/i, /programa (de|top)/i, /top revend/i, /ranking/i, /descont/i, /promo[cç]/i, /cupo[mn]/i, /b[oô]nus/i, /brinde/i,
  /cashback/i, /garanti/i, /reembols/i, /vagas?/i, /[uú]ltima chance/i, /s[oó] hoje/i, /urgente/i, /\bcorra\b/i, /imperd[ií]vel/i, /\bpromessa/i, /exclusiv/i,
  /depoimento/i, /\bcaso de sucesso/i, /\bfaturou\b/i, /\blucr(o|ou|ar)\b.*\d/i, /\bganh(a|ou|ar)\b.*R\$/i, /%/, /\bsorteio/i, /\bpr[eê]mio/i, /isen[cç]/i,
  /fidelidade/i, /\bmulta/i, /\bjuros/i, /reajust/i, /aumento/i, /pre[cç]o especial/i, /condi[cç][aã]o especial/i, /\bVIP\b/i, /\bgerente\b/i,
];
const numerosDe = (t) => (String(t).match(/\d+(?:[.,]\d+)*/g) || []).map((x) => x.replace(/[.,]+$/, ''));
function numerosDaBase(baseMd) { return new Set(numerosDe(baseMd).concat(numerosDe(baseMd).map((x) => x.replace(',', '.')))); }
function trigramas(t) { const p = norm(t).replace(/[^a-z0-9 ]/g, ' ').split(' ').filter(Boolean); const s = new Set(); for (let i = 0; i + 2 < p.length; i++) s.add(p.slice(i, i + 3).join(' ')); if (!s.size && p.length) s.add(p.join(' ')); return s; }
function similaridade(a, b) { const A = trigramas(a), B = trigramas(b); if (!A.size || !B.size) return 0; let i = 0; for (const x of A) if (B.has(x)) i++; return i / Math.min(A.size, B.size); }
const abertura = (t) => norm(t).replace(/[^a-z0-9 ]/g, ' ').split(' ').filter(Boolean).slice(0, 3).join(' ');
const PALAVRAS_COMUNS = new Set(['mestre', 'painel', 'iptv', 'box', 'revenda', 'capyplay', 'capy', 'oficial', 'suporte', 'teste', 'lead', 'dos', 'das', 'cliente', 'clientes', 'loja', 'store', 'whatsapp', 'app', 'apps', 'tvs', 'the', 'and']);

// ok=false com o motivo quando o texto inventa, repete, usa nome, tem link fora do base.md etc.
function filtrarTexto(texto, { baseMd = '', nomes = [], anteriores = [], aberturasRecentes = [], maxChars = 320, maxFrases = 3 } = {}) {
  const t = String(texto || '').trim();
  const no = (motivo) => ({ ok: false, motivo });
  if (t.length < 15) return no('curto demais');
  if (t.length > maxChars) return no('longo demais');
  if (/[\p{Extended_Pictographic}]/u.test(t)) return no('tem emoji');
  if (/[*_~`#]/.test(t.replace(/https?:\/\/\S+/g, ''))) return no('tem formatação');
  if ((t.match(/[.!?](\s|$)/g) || []).length > maxFrases) return no('frases demais');
  if ((t.match(/\?/g) || []).length > 2) return no('perguntas demais');
  if (!/\bmestre\b/i.test(t)) return no('não chama de mestre');
  const nt = norm(t);
  for (const n of nomes) for (const p of norm(n).split(/[^a-z0-9]+/).filter((x) => x.length >= 3 && !PALAVRAS_COMUNS.has(x))) if (new RegExp('(^|[^a-z0-9])' + p + '([^a-z0-9]|$)').test(nt)) return no('usa o nome da pessoa');
  if (/senha|usuario:/.test(nt)) return no('fala de senha ou usuário');
  for (const rx of PROIBIDAS) if (rx.test(t)) return no('afirmação proibida (' + rx.source.slice(0, 30) + ')');
  for (const u of t.match(/https?:\/\/[^\s]+|t\.me\/[^\s]+/g) || []) if (!baseMd.includes(u.replace(/[.,;!?)]+$/, ''))) return no('link que não está no base.md');
  if (/\d{8,}/.test(t.replace(/(\d)[\s.-](?=\d)/g, '$1'))) return no('tem número de telefone');
  const nb = numerosDaBase(baseMd);
  for (const x of numerosDe(t.replace(/https?:\/\/\S+|t\.me\/\S+/g, ''))) if (!nb.has(x) && !nb.has(x.replace(',', '.'))) return no('número que não está no base.md (' + x + ')');
  if (/R\$/.test(t) && !/R\$ ?(3,50|35|70|50|5,00)\b/.test(t)) return no('valor em R$ fora do base.md');
  for (const a of anteriores) { if (!a) continue; if (norm(a) === nt) return no('igual a um texto anterior'); if (similaridade(a, t) >= 0.6) return no('parecido demais com um texto anterior'); }
  if (aberturasRecentes.includes(abertura(t))) return no('começa igual a outro envio recente');
  return { ok: true };
}

// ---------- A/B ----------
function varianteDe(id, degrau) { return parseInt(crypto.createHash('sha1').update(String(id) + '|' + degrau).digest('hex').slice(0, 8), 16) % 2 === 0 ? 'A' : 'B'; }
function wilson(k, n, z = 1.96) {
  if (!n) return { taxa: 0, ic: [0, 0] };
  const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return { taxa: p, ic: [Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)] };
}
// Compara duas variantes (respostas em 48 h). Só declara diferença com amostra mínima e IC da diferença (Newcombe) sem cruzar o zero.
function compararAB(a, b, min = LIM.ab_min) {
  const wa = wilson(a.k, a.n), wb = wilson(b.k, b.n);
  const out = { A: { ...a, ...wa }, B: { ...b, ...wb }, amostra_minima: min };
  if (a.n < min || b.n < min) return { ...out, decisao: 'amostra_pequena', texto: `Amostra pequena (A ${a.n}, B ${b.n}; mínimo ${min} cada). Sem vencedor.` };
  const dif = wa.taxa - wb.taxa;
  const lo = dif - Math.sqrt((wa.taxa - wa.ic[0]) ** 2 + (wb.ic[1] - wb.taxa) ** 2);
  const hi = dif + Math.sqrt((wa.ic[1] - wa.taxa) ** 2 + (wb.taxa - wb.ic[0]) ** 2);
  out.diferenca = { valor: dif, ic: [lo, hi] };
  if (lo > 0) return { ...out, decisao: 'A', pior: 'B', texto: 'A responde mais (IC 95% da diferença acima de zero).' };
  if (hi < 0) return { ...out, decisao: 'B', pior: 'A', texto: 'B responde mais (IC 95% da diferença abaixo de zero).' };
  return { ...out, decisao: 'empate', texto: 'Diferença dentro do acaso (IC 95% cruza o zero). Continua testando.' };
}

// ---------- cadência de dias ----------
// toques: toques de dias já feitos no silêncio atual [{t, angulo}] (atrasado conta como 'ajuda'). t0 = quando esfriou.
function proximaCadencia({ t0, toques = [], toques21 = 0, agora, lim = LIM }) {
  const i = toques.length;
  if (toques21 >= lim.max_toques_21d) return { fim: true, motivo: 'chegou a ' + lim.max_toques_21d + ' toques em 21 dias' };
  if (i >= lim.dias.length) {
    if (!lim.reativacao_ligada) return { fim: true, motivo: 'cadência completa (adormecido)' };
    const ult = Date.parse(toques[i - 1].t);
    return { indice: i, angulo: 'reativacao', quando: paraJanela(ult + lim.reativacao_dias * D) };
  }
  const ult = i ? Date.parse(toques[i - 1].t) : 0;
  const quando = Math.max(t0 + lim.dias[i] * D, ult ? ult + lim.gaps_h[i] * H : 0);
  return { indice: i, angulo: ANGULOS[i], dia: lim.dias[i], quando: paraJanela(quando) };
}

// Sinal da conversa (escolhe o conteúdo do toque): preço, sumiu depois do link, testando, sem aparelho, pergunta aberta.
function sinalDoLead({ textosCliente = [], recebeuLink = false, teste = false, aparelhos = null, ultimaCliente = '', categoria = '' }) {
  const tc = textosCliente.join(' ');
  if (/\?/.test(ultimaCliente) && categoria === 'sem_resposta_nossa') return 'pergunta_aberta';
  if (teste || categoria === 'testando') return 'testando';
  if (/pre[cç]o|valor|quanto|caro|m[ií]nimo|taxa|cobra|custa|pagar|pagamento/i.test(tc)) return 'preco';
  if (recebeuLink) return 'sumiu_depois_do_link';
  if (!aparelhos || !aparelhos.length) return 'sem_aparelho';
  return 'geral';
}

// ---------- estado do lead e próximo passo ----------
// d: { id, agora, fechou, fora (categoria fora do funil), pediuParar, ultimoQuem ('cliente'|'robo'|'senhor'|'automatico'), ultimoTs,
//      ultimaCliente (texto), ultimaClienteTs, primeiroTs, passouPendente ({t, motivo}|null), senhorTs, aoVivo ({n, desde}|null),
//      atrasado ({status, quando}|null), toques [{t, angulo}], toques21, t0, quieto, categoria, sinal }
function estadoLead(d, lim = LIM) {
  const agora = d.agora;
  const r = (estado, proximo, extra = {}) => ({ estado, vivo: ['novo', 'em_conversa', 'aguardando_cliente', 'aguardando_nos', 'esfriando'].includes(estado), proximo, ...extra });
  if (d.fechou) return r('fechou', { tipo: 'jornada', quando: null, detalhe: 'segue na jornada do revendedor' });
  if (d.fora) return r('fora_do_funil', null, { motivo: d.fora });
  if (d.pediuParar) return r('nao_incomodar', null, { motivo: 'pediu para parar ou disse que não quer' });
  if (d.passouPendente) {
    const p = d.passouPendente, t = Date.parse(p.t);
    const lembrete = t + lim.lembrete_h * H, retoma = t + lim.retomada_h * H;
    if (agora < lembrete) return r('aguardando_nos', { tipo: 'senhor', quando: lembrete, detalhe: 'passou ao senhor; lembrete em ' + lim.lembrete_h + ' h se ele não pegar' });
    if (agora < retoma) return r('aguardando_nos', { tipo: 'senhor', quando: retoma, detalhe: 'senhor avisado; o robô retoma em 24 h se ninguém pegar' });
    return r('aguardando_nos', { tipo: 'retomada', quando: paraJanela(Math.max(retoma, agora)), detalhe: 'ninguém pegou em 24 h: o robô retoma' });
  }
  const recente = d.ultimoTs && agora - d.ultimoTs < 30 * 60e3;
  if (d.ultimoQuem === 'cliente') {
    if (d.ultimaCliente && ENCERRA.test(d.ultimaCliente)) return r('encerrada', null, { motivo: 'o cliente encerrou com ok/obrigado' });
    if (agora - d.ultimaClienteTs <= lim.responder_max_h * H) return r(recente ? 'em_conversa' : 'aguardando_nos', { tipo: 'responder', quando: d.ultimaClienteTs + lim.responder_min * 60e3, detalhe: 'última palavra é do cliente: o robô responde' });
    if (d.atrasado && d.atrasado.status === 'na_fila') return r('aguardando_nos', { tipo: 'atrasado', quando: d.atrasado.quando, detalhe: 'na fila do atrasado (responde a mensagem antiga)' });
    // mensagem antiga sem resposta: a cadência responde no próximo toque
  }
  // o senhor respondeu por último (há menos de 72 h): o robô não toca. Mais antigo que isso (conversas de antes do robô), a cadência retoma.
  if (d.ultimoQuem === 'senhor' && agora - (d.ultimoTs || 0) < lim.senhor_ultimo_h * H) return r(recente ? 'em_conversa' : 'aguardando_cliente', { tipo: 'com_o_senhor', quando: d.ultimoTs + lim.senhor_ultimo_h * H, detalhe: 'o senhor respondeu por último; o robô não toca por 72 h' });
  if (d.encerrada || (d.ultimaCliente && ENCERRA.test(d.ultimaCliente) && d.ultimoQuem !== 'cliente')) return r('encerrada', null, { motivo: 'o cliente encerrou com ok/obrigado' });
  if (d.senhorTs && agora - d.senhorTs < lim.senhor_manual_h * H) return r('aguardando_cliente', { tipo: 'com_o_senhor', quando: d.senhorTs + lim.senhor_manual_h * H, detalhe: 'o senhor atendeu na mão nas últimas 48 h' });
  if (d.quieto && d.quieto > agora) return r('aguardando_cliente', { tipo: 'quieto', quando: d.quieto, detalhe: 'conversa em silêncio por pedido' });
  if (d.atrasado && d.atrasado.status === 'na_fila') return r('esfriando', { tipo: 'atrasado', quando: d.atrasado.quando, detalhe: 'na fila do atrasado' });
  if (recente && d.ultimoQuem !== 'cliente') {
    const cr = proximaCadencia({ t0: d.t0 || agora, toques: d.toques || [], toques21: d.toques21 || 0, agora, lim });
    const est_ = d.primeiroTs && agora - d.primeiroTs < 60 * 60e3 ? 'novo' : 'em_conversa';
    if (d.aoVivo) return r(est_, { tipo: 'ao_vivo', quando: d.aoVivo.quando, detalhe: 'follow-up ' + d.aoVivo.n + ' da escada' });
    if (cr.fim) return r(est_, { tipo: 'aguardar', quando: null, detalhe: 'conversa acontecendo agora' });
    // nunca vence enquanto a conversa está acontecendo: no mínimo 20 h depois da última mensagem
    return r(est_, { tipo: 'cadencia', quando: paraJanela(Math.max(cr.quando, (d.ultimoTs || agora) + lim.gaps_h[0] * H)), angulo: cr.angulo, indice: cr.indice, detalhe: (cr.dia ? 'D+' + cr.dia + ' · ' : '') + cr.angulo + ' se ele não voltar' });
  }
  if (d.aoVivo && d.aoVivo.quando) return r('aguardando_cliente', { tipo: 'ao_vivo', quando: d.aoVivo.quando, detalhe: 'follow-up ' + d.aoVivo.n + ' da escada (' + d.aoVivo.min + ' min)' });
  const c = proximaCadencia({ t0: d.t0 || d.ultimoTs || agora, toques: d.toques || [], toques21: d.toques21 || 0, agora, lim });
  if (c.fim) return r('perdido_definitivo', null, { motivo: c.motivo });
  const ultimoTs = d.ultimoTs || agora;
  return r(agora - ultimoTs < 24 * H ? 'aguardando_cliente' : 'esfriando', { tipo: 'cadencia', quando: c.quando, angulo: c.angulo, indice: c.indice, detalhe: (c.dia ? 'D+' + c.dia + ' · ' : '') + c.angulo });
}
// Passo travado: vencido há tempo demais (conta no KPI "sem próximo passo").
function passoTravado(prox, agora, lim = LIM, contexto = {}) {
  if (!prox) return true;
  if (!prox.quando) return false;
  const lim_ = lim.travado_min[prox.tipo];
  if (!lim_) return false;
  if (prox.tipo !== 'responder' && (!naJanela(agora) || contexto.teto)) return false;
  return agora - prox.quando > lim_ * 60e3;
}

// ---------- etiquetas do WhatsApp ----------
const ETIQUETAS = [
  { chave: 'revendedor', nome: 'Revendedor', cor: 'verde' }, { chave: 'lead', nome: 'Lead', cor: 'azul' }, { chave: 'teste', nome: 'Teste', cor: 'roxo' },
  { chave: 'esfriou', nome: 'Esfriou', cor: 'cinza' }, { chave: 'suporte', nome: 'Suporte', cor: 'laranja' }, { chave: 'senhor', nome: 'Precisa do senhor', cor: 'vermelho' },
  { chave: 'atrasado', nome: 'Atrasado', cor: 'amarelo' },
];
function etiquetaPara(st, { categoria, testando } = {}) {
  if (!st) return null;
  if (st.estado === 'fechou') return 'revendedor';
  if (st.estado === 'fora_do_funil') return categoria === 'suporte' ? 'suporte' : null;
  if (st.estado === 'nao_incomodar') return null;
  if (st.proximo && (st.proximo.tipo === 'senhor' || st.proximo.tipo === 'retomada')) return 'senhor';
  if (st.proximo && st.proximo.tipo === 'atrasado') return 'atrasado';
  if (testando) return 'teste';
  if (['esfriando', 'perdido_definitivo', 'encerrada'].includes(st.estado)) return 'esfriou';
  return 'lead';
}

// ---------- jornada do revendedor ----------
function primeiroAcerto(fechouMs, lim = LIM) { const d = new Date(fechouMs); return new Date(d.getFullYear(), d.getMonth() + 1, lim.dia_acerto, 12).getTime(); }
// Próxima janela de fechamento a partir de `desde`: vendas (25-27) e pagamento (3-4).
function janelasFechamento(fechouMs, desde, lim = LIM) {
  const out = [], pa = primeiroAcerto(fechouMs, lim);
  const d0 = new Date(desde);
  for (let m = 0; m < 3; m++) {
    const v = new Date(d0.getFullYear(), d0.getMonth() + m, lim.fech_vendas[0], 10).getTime();
    const vFim = new Date(d0.getFullYear(), d0.getMonth() + m, lim.fech_vendas[1], 19).getTime();
    const acertoSeguinte = new Date(d0.getFullYear(), d0.getMonth() + m + 1, lim.dia_acerto, 12).getTime();
    if (vFim >= desde && v - fechouMs >= lim.jornada_min_dias * D && acertoSeguinte >= pa) out.push({ tipo: 'fechamento_vendas', ini: v, fim: vFim });
    const p = new Date(d0.getFullYear(), d0.getMonth() + m, lim.fech_pagamento[0], 10).getTime();
    const pFim = new Date(d0.getFullYear(), d0.getMonth() + m, lim.fech_pagamento[1], 19).getTime();
    const acertoMes = new Date(d0.getFullYear(), d0.getMonth() + m, lim.dia_acerto, 12).getTime();
    if (pFim >= desde && acertoMes >= pa && p > fechouMs) out.push({ tipo: 'fechamento_pagamento', ini: p, fim: pFim });
  }
  return out.sort((a, b) => a.ini - b.ini);
}
// Status do revendedor para o Dashboard.
function statusRevendedor({ fechouMs, agora, uso, resposta, passouPendente, lim = LIM }) {
  if (passouPendente) return 'passou_ao_senhor';
  if (resposta && resposta.classe === 'duvida_pagamento' && agora - Date.parse(resposta.t) < 10 * D) return 'duvida_pagamento';
  if (resposta && resposta.classe === 'problema' && agora - Date.parse(resposta.t) < 7 * D) return 'em_risco';
  const dias = (agora - fechouMs) / D;
  const usados = uso && Number.isFinite(uso.usados) ? uso.usados : null;
  const semLogin = uso && uso.ultimo_login ? (agora - Date.parse(uso.ultimo_login)) / D : null;
  if (usados === 0 && dias >= lim.risco_dias) return 'em_risco';
  if (semLogin != null && semLogin >= lim.sem_login_risco_dias) return 'em_risco';
  if (usados === 0 && dias >= lim.sem_uso_dias) return 'sem_uso';
  return 'saudavel';
}
// Próximo toque da jornada. toques: [{t, tipo}] (só os proativos da jornada). pausaAte: depois de "tudo certo".
function proximoJornada({ id, fechouMs, agora, toques = [], uso, pausaAte = 0, status, lim = LIM }) {
  const ult = toques.length ? Math.max(...toques.map((x) => Date.parse(x.t))) : 0;
  const feitos = new Set(toques.map((x) => x.tipo));
  const jan = janelasFechamento(fechouMs, Math.max(agora - 3 * D, fechouMs), lim);
  // janela de fechamento ainda não feita (exceção à regra de 1 por 7 dias): vale quando já começou ou quando chega antes do toque comum
  const win = jan.find((j) => j.fim >= agora && !toques.some((x) => x.tipo === j.tipo && Date.parse(x.t) >= j.ini - 2 * D && Date.parse(x.t) <= j.fim + D));
  const toqueJanela = win ? { tipo: win.tipo, quando: paraJanela(Math.max(win.ini, agora)), janela: win, regular: false } : null;
  if (toqueJanela && win.ini <= agora) return toqueJanela;
  const usados = uso && Number.isFinite(uso.usados) ? uso.usados : null;
  const conteudo = (base) => (base !== 'checkin_d1' && (status === 'sem_uso' || status === 'em_risco') ? 'ajuda_sem_uso' : base !== 'checkin_d1' && usados != null && usados >= lim.bom_uso ? 'reconhecimento' : base);
  let tipo, quando;
  const nReg = toques.filter((x) => x.regular !== false && !/^fechamento/.test(x.tipo)).length;
  if (nReg < lim.jornada_dias.length) {
    const nomes = ['checkin_d1', 'checkin_d3', 'checkin_d7'];
    tipo = nomes[nReg];
    quando = fechouMs + lim.jornada_dias[nReg] * D;
    if (nReg > 0 && ult) quando = Math.max(quando, ult + (lim.jornada_dias[nReg] - lim.jornada_dias[nReg - 1]) * D * 0.8);
  } else {
    const [a, b] = lim.jornada_ciclo_dias;
    const ciclo = a + (parseInt(refDe(id + nReg), 16) % (b - a + 1));
    tipo = 'checkin'; quando = (ult || fechouMs) + ciclo * D;
  }
  quando = Math.max(quando, ult ? ult + (nReg >= lim.jornada_dias.length ? lim.jornada_min_dias : 1.5) * D : 0, pausaAte || 0);
  // a janela chega antes do toque comum, ou o check-in comum cairia a menos de 4 dias dela: vale a janela
  if (toqueJanela && (win.ini <= quando || (tipo === 'checkin' && quando > win.ini - 4 * D))) return toqueJanela;
  return { tipo: conteudo(tipo), base: tipo, quando: paraJanela(Math.max(quando, agora - 1)), regular: true };
}
function classificarResposta(texto) {
  const t = norm(texto);
  if (!t) return 'outro';
  if (/comprovante|paguei|pix|boleto|cobran|pagamento|pagar|acerto|vencimento|vence|link de pag|quanto (vou|vai) pagar|taxa|minimo/.test(t)) return 'duvida_pagamento';
  if (/nao (funciona|abre|carrega|consigo|conecta)|travando|erro|problema|caiu|parou|reclam|ruim|lento/.test(t)) return 'problema';
  if (/(ainda )?(nao|nenhum[a]?) (vendi|consegui vender|fiz venda|tenho cliente)|sem (venda|cliente)|nada ainda|ainda nao|devagar|parado/.test(t)) return 'sem_vendas';
  if (/vendi|\d+ (clientes?|vendas?)|ja (tenho|cadastrei|fiz)|consegui|fechei|vendendo|cliente(s)? novo/.test(t)) return 'vendeu';
  if (/tudo (certo|bem|ok|tranquilo|otimo|joia)|esta (indo )?bem|ta (indo )?bem|de boa|tranquilo|beleza|blz|ok|show/.test(t)) return 'tudo_certo';
  return 'outro';
}

module.exports = {
  LIM, PRIORIDADE, TIPOS_PROATIVOS, ANGULOS, ENCERRA, PEDIU_PARAR, ETAPAS_FECHOU, CAT_FORA, ETIQUETAS,
  norm, digitos, refDe, mascarar, naJanela, paraJanela, mesmoDia, contarProativosHoje, planoRitmo, portao,
  filtrarTexto, similaridade, abertura, numerosDaBase, varianteDe, wilson, compararAB, proximaCadencia, sinalDoLead,
  estadoLead, passoTravado, etiquetaPara, primeiroAcerto, janelasFechamento, statusRevendedor, proximoJornada, classificarResposta,
};
