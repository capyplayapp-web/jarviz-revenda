// API da estratégia de funil e da jornada do revendedor (08/11/2026). Lê o que o motor (funil\motor.js) grava e os eventos.
// GET /api/funil?dias=1|7 · GET /api/jornada · GET /api/etiquetas · POST /api/funil/pausar|retomar|jogadas · POST /api/jornada/pausar|retomar|tocar
// Telefones sempre mascarados; nenhuma rota devolve id de conversa (só ref).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { PASTA, lerJson, lerEventos, lerRevendedoresLista } from './lib.mjs';

const DIR = path.join(PASTA, 'funil');
const F = {
  leads: path.join(DIR, 'leads.json'), jornada: path.join(DIR, 'jornada.json'), ab: path.join(DIR, 'ab.json'), estado: path.join(DIR, 'estado.json'),
  etiquetas: path.join(DIR, 'etiquetas.json'), jogadas: path.join(DIR, 'jogadas.json'), diagnostico: path.join(DIR, 'diagnostico.json'), comando: path.join(DIR, 'comando.json'),
  pausado: path.join(DIR, 'pausado'), jornadaPausada: path.join(DIR, 'jornada-pausada'), etiquetasPausadas: path.join(DIR, 'etiquetas-pausadas'),
};
const ROTULO_ESTADO = { novo: 'Novo', em_conversa: 'Em conversa', aguardando_cliente: 'Aguardando o cliente', aguardando_nos: 'Aguardando nós', esfriando: 'Esfriando', fechou: 'Fechou painel', perdido_definitivo: 'Adormecido', nao_incomodar: 'Não incomodar', encerrada: 'Encerrou (ok/obrigado)', fora_do_funil: 'Fora do funil' };
const ROTULO_PASSO = { responder: 'Responder agora', ao_vivo: 'Follow-up da escada', cadencia: 'Toque da cadência', atrasado: 'Fila do atrasado', senhor: 'Com o senhor (lembrete)', retomada: 'Robô retoma', com_o_senhor: 'Senhor respondeu por último', quieto: 'Em silêncio', jornada: 'Jornada do revendedor' };
const ROTULO_ANGULO = { ajuda: 'D+1 · ajuda prática', prova: 'D+3 · prova com conta', beneficio: 'D+7 · benefício', porta: 'D+14 · porta aberta', reativacao: 'Reativação' };
const ROTULO_JOR = { checkin_d1: 'D+1 · primeiro cliente?', checkin_d3: 'D+3 · tudo certo?', checkin_d7: 'D+7 · como vão as vendas?', checkin: 'Check-in', ajuda_sem_uso: 'Ajuda (sem uso)', reconhecimento: 'Reconhecimento', fechamento_vendas: 'Fim do mês · vendas', fechamento_pagamento: 'Acerto · dúvida de pagamento' };
const PROATIVOS = { followup: 'ao_vivo', followup_backlog: 'atrasado', toque_cadencia: 'cadencia', toque_jornada: 'jornada', retomada_senhor: 'retomada', retorno_lacuna: 'lacuna' };
const r3 = (n) => Math.round(n * 1000) / 1000;
const inicioPeriodo = (dias) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (dias - 1)); return d.getTime(); };

function conversao(evs, paineis, ini) {
  const ev = evs.filter((e) => Date.parse(e.t) >= ini);
  const contato = new Set(ev.filter((e) => e.tipo === 'mensagem_cliente' && e.chat).map((e) => e.chat));
  const roboCom = (rx) => new Set(ev.filter((e) => (e.tipo === 'resposta_robo' || e.tipo in PROATIVOS) && rx.test(e.texto || '')).map((e) => e.chat));
  const soube = roboCom(/cr[eé]dito|p[oó]s-?pago|R\$ ?3,50/i), link = roboCom(/painel\.capyplay\.site\/#\/rs\//i);
  const criou = new Set(paineis.filter((p) => Date.parse(p.quando) >= ini).map((p) => p.contato_id));
  const etapas = [['Entrou em contato', contato.size], ['Soube como funciona', soube.size], ['Recebeu o link', link.size], ['Criou o painel', criou.size]];
  return etapas.map(([etapa, qtd], i) => ({ etapa, qtd, taxa_da_anterior: i && etapas[i - 1][1] ? r3(qtd / etapas[i - 1][1]) : null }));
}

export function resumoFunil({ dias = 1 } = {}) {
  dias = Math.min(Math.max(parseInt(dias, 10) || 1, 1), 31);
  const agora = Date.now(), ini = inicioPeriodo(dias);
  const L = lerJson(F.leads, { kpis: {}, leads: [], proximos_por_dia: {} });
  const ab = lerJson(F.ab, { decisoes: {} });
  const evs = lerEventos();
  const paineis = lerRevendedoresLista();
  // proativos do período por tipo + painéis por origem do último toque (até 72 h antes)
  const proPer = {}; const proHoje = {};
  const hoje0 = inicioPeriodo(1);
  for (const e of evs) if (e.tipo in PROATIVOS) { const t = Date.parse(e.t); if (t >= ini) proPer[PROATIVOS[e.tipo]] = (proPer[PROATIVOS[e.tipo]] || 0) + 1; if (t >= hoje0) proHoje[PROATIVOS[e.tipo]] = (proHoje[PROATIVOS[e.tipo]] || 0) + 1; }
  const origem = { ao_vivo: 0, atrasado: 0, cadencia: 0, retomada: 0, jornada: 0, lacuna: 0, conversa_direta: 0 };
  for (const p of paineis) {
    const t = Date.parse(p.quando); if (t < ini) continue;
    const ult = evs.filter((e) => e.chat === p.contato_id && e.tipo in PROATIVOS && Date.parse(e.t) < t && t - Date.parse(e.t) < 72 * 3600e3).pop();
    origem[ult ? PROATIVOS[ult.tipo] : 'conversa_direta']++;
  }
  // taxa de resposta e de painel por ângulo/variante
  const experimentos = Object.entries(ab.decisoes || {}).map(([degrau, d]) => ({
    degrau, rotulo: degrau.startsWith('vivo') ? 'Escada ao vivo · ' + ({ vivo1: '7 min', vivo2: '20 min', vivo3: '1 h', vivo4: '3 h' }[degrau] || degrau) : degrau.startsWith('cad_') ? 'Cadência · ' + (ROTULO_ANGULO[degrau.slice(4)] || degrau) : 'Jornada · ' + (ROTULO_JOR[degrau.slice(4)] || degrau.slice(4)),
    A: { enviados: d.A.n, responderam: d.A.k, taxa: r3(d.A.taxa || 0), ic: (d.A.ic || [0, 0]).map(r3), paineis: d.paineis?.A || 0, aguardando_48h: d.pendentes?.A || 0 },
    B: { enviados: d.B.n, responderam: d.B.k, taxa: r3(d.B.taxa || 0), ic: (d.B.ic || [0, 0]).map(r3), paineis: d.paineis?.B || 0, aguardando_48h: d.pendentes?.B || 0 },
    decisao: d.decisao, texto: d.texto, amostra_minima: d.amostra_minima,
  }));
  const leads = (L.leads || []);
  const vivos = leads.filter((l) => l.vivo);
  const pub = (l) => ({ ref: l.ref, nome: l.nome, telefone: l.telefone, estado: l.estado, estado_rotulo: ROTULO_ESTADO[l.estado] || l.estado, proximo: l.proximo ? { tipo: l.proximo.tipo, rotulo: l.proximo.tipo === 'cadencia' ? ROTULO_ANGULO[l.proximo.angulo] || 'Cadência' : ROTULO_PASSO[l.proximo.tipo] || l.proximo.tipo, quando: l.proximo.quando, detalhe: l.proximo.detalhe } : null, ultimo_contato: l.ultimo_contato, sinal: l.sinal, toques: l.toques, travado: !!l.travado, etiqueta: l.etiqueta });
  const proximos = vivos.filter((l) => l.proximo && l.proximo.quando && ['cadencia', 'retomada', 'atrasado', 'responder', 'ao_vivo'].includes(l.proximo.tipo)).sort((a, b) => Date.parse(a.proximo.quando) - Date.parse(b.proximo.quando)).slice(0, 20).map(pub);
  const risco = vivos.filter((l) => l.travado || (l.proximo && ['senhor', 'retomada'].includes(l.proximo.tipo)) || (l.estado === 'esfriando' && l.toques >= 2) || (l.estado === 'aguardando_nos')).slice(0, 20).map(pub);
  const porEstado = Object.entries(L.kpis?.por_estado || {}).map(([k, n]) => ({ estado: k, rotulo: ROTULO_ESTADO[k] || k, qtd: n, vivo: ['novo', 'em_conversa', 'aguardando_cliente', 'aguardando_nos', 'esfriando'].includes(k) })).sort((a, b) => b.qtd - a.qtd);
  const jog = lerJson(F.jogadas, { rodadas: [] });
  const ultJog = (jog.rodadas || []).slice(-5).reverse();
  const sugestoes = [];
  for (const r of ultJog) for (const s of r.sugestoes_para_o_senhor || []) if (!sugestoes.includes(s)) sugestoes.push(s);
  const lac = (() => { try { const e = lerJson(path.join(PASTA, 'lacunas', 'estado.json'), { itens: {} }); return Object.values(e.itens || {}).filter((x) => x.status === 'precisa_senhor').map((x) => 'Lacuna ' + x.id + ': ' + (x.pergunta_canonica || x.pergunta)); } catch { return []; } })();
  const et = lerJson(F.etiquetas, {});
  const contEt = {}; for (const l of leads) if (l.etiqueta) contEt[l.etiqueta] = (contEt[l.etiqueta] || 0) + 1;
  return {
    gerado_em: new Date(agora).toISOString(), vigia_em: L.atualizado_em || null, periodo_dias: dias,
    leads_sem_proximo_passo: L.kpis?.sem_proximo_passo ?? null, sem_proximo_passo_nomes: L.kpis?.sem_proximo_passo_nomes || [], alerta_desde: L.kpis?.alerta_desde || null,
    leads_vivos: vivos.length, leads_total: leads.length, por_estado: porEstado,
    conversao: { hoje: conversao(evs, paineis, inicioPeriodo(1)), sete_dias: conversao(evs, paineis, inicioPeriodo(7)) },
    proximos_por_dia: Object.entries(L.proximos_por_dia || {}).sort().map(([dia, qtd]) => ({ dia, qtd, jornada: (L.proximos_jornada_por_dia || {})[dia] || 0 })),
    proximos_toques: proximos, leads_em_risco: risco, experimentos,
    paineis_por_origem: origem, proativos_periodo: proPer, proativos_hoje: { ...proHoje, total: Object.values(proHoje).reduce((a, b) => a + b, 0), teto: 120 },
    devidos_agora: L.kpis?.devidos_agora || {}, esperando_senhor: L.kpis?.esperando_senhor || 0,
    jogadas: ultJog.map((r) => ({ gerado_em: r.gerado_em, modelo: r.modelo, custo_usd: r.custo_usd, padroes_que_fecharam: r.padroes_que_fecharam || [], objecoes: r.objecoes || [], perguntas_novas: r.perguntas_novas || [] })),
    sugestoes_para_o_senhor: sugestoes.slice(0, 10).concat(lac.slice(0, 5)),
    controles: { cadencia_pausada: fs.existsSync(F.pausado), jornada_pausada: fs.existsSync(F.jornadaPausada), etiquetas_pausadas: fs.existsSync(F.etiquetasPausadas) },
    frios: resumoFrios(L),
    etiquetas: { business: !!et.business, ativa: !!et.business && !fs.existsSync(F.etiquetasPausadas) && Object.keys(et.ids || {}).length > 0, existentes: (et.existentes || []).map((x) => x.nome), faltam: et.faltam || [], aplicadas: et.contagem_aplicadas || 0, por_etiqueta: contEt, teste_criacao: et.teste_criacao || null },
  };
}
// ---------- frios (pedido do senhor 08/11: ver se os leads que esfriaram estão na fila e "atender novamente todos") ----------
const JANELA = { ini: 9, fim: 20 };
function proximaJanelaFim(agora) { const d = new Date(agora); if (d.getHours() >= JANELA.fim) d.setDate(d.getDate() + 1); d.setHours(JANELA.fim, 0, 0, 0); return d.getTime(); }
// Leva um horário para dentro da janela; se passar do fim, continua no dia seguinte com o que sobrou.
function andarNaJanela(ms) {
  const d = new Date(ms);
  if (d.getHours() < JANELA.ini) { d.setHours(JANELA.ini, 0, 0, 0); return d.getTime(); }
  if (d.getHours() >= JANELA.fim) { const sobra = ms - new Date(d).setHours(JANELA.fim, 0, 0, 0); d.setDate(d.getDate() + 1); d.setHours(JANELA.ini, 0, 0, 0); return d.getTime() + sobra; }
  return ms;
}
export function resumoFrios(L = lerJson(F.leads, { leads: [] })) {
  const agora = Date.now();
  const fila = lerJson(path.join(PASTA, 'backlog-fila.json'), { itens: [] }).itens || [];
  const bEst = lerJson(path.join(PASTA, 'backlog-estado.json'), {});
  const bCfg = lerJson(path.join(PASTA, 'backlog-config.json'), {});
  const st = lerJson(F.estado, {});
  const acelAte = bCfg.acelerado_ate && Date.parse(bCfg.acelerado_ate) > agora ? bCfg.acelerado_ate : null;
  const pausada = fs.existsSync(path.join(PASTA, 'backlog-pausado')) || fs.existsSync(path.join(PASTA, 'pausado'));
  // ordem real da fila do atrasado: a mesma do backlog.js (conversa mais recente primeiro)
  const naFila = fila.filter((i) => i.status === 'na_fila').sort((a, b) => Date.parse(b.ultimo_contato) - Date.parse(a.ultimo_contato));
  const posFila = new Map(naFila.map((i, k) => [i.ref, k + 1]));
  const reaq = (L.leads || []).filter((l) => l.reaquecer).sort((a, b) => Date.parse(a.proximo?.quando || 0) - Date.parse(b.proximo?.quando || 0));
  const posReaq = new Map(reaq.map((l, k) => [l.ref, k + 1]));
  const passoS = acelAte ? 75 : Math.max(60, Number(bEst.intervalo_medio_s) || 900);
  const inicioFila = andarNaJanela(Math.max(agora, Date.parse(bEst.proximo_envio_em) || agora));
  const inicioReaq = andarNaJanela(Math.max(agora, Date.parse(reaq[0]?.proximo?.quando) || agora));
  const frios = (L.leads || []).filter((l) => ['esfriando', 'perdido_definitivo', 'encerrada'].includes(l.estado) || l.etiqueta === 'esfriou');
  const itens = frios.map((l) => {
    const m = String(l.motivo || '');
    const porque = /leitura da conversa/.test(m) ? 'a leitura da conversa não viu interesse claro' : /ok.obrigado/.test(m) ? 'encerrou com ok/obrigado' : /toques em 21 dias/.test(m) ? 'já recebeu 5 toques em 21 dias' : /cadência completa/.test(m) ? 'cadência completa, sem resposta' : (m || 'sem toque marcado');
    let fila_ = { situacao: 'fora', rotulo: 'Fora da fila', posicao: null, previsto: null, detalhe: porque };
    if (posFila.has(l.ref)) {
      const p = posFila.get(l.ref);
      fila_ = { situacao: 'na_fila', rotulo: 'Na fila', posicao: p, previsto: new Date(andarNaJanela(inicioFila + (p - 1) * passoS * 1000)).toISOString(), detalhe: 'fila do atrasado' };
    } else if (l.reaquecer) {
      const p = posReaq.get(l.ref);
      fila_ = { situacao: 'na_fila', rotulo: 'Na fila', posicao: p, previsto: new Date(andarNaJanela(inicioReaq + (p - 1) * 75e3)).toISOString(), detalhe: 'atender de novo (pedido do senhor)' };
    } else if (l.proximo && l.proximo.quando && l.vivo) {
      fila_ = { situacao: 'agendado', rotulo: 'Agendado', posicao: null, previsto: l.proximo.quando, detalhe: l.proximo.tipo === 'cadencia' ? (ROTULO_ANGULO[l.proximo.angulo] || 'cadência') : (ROTULO_PASSO[l.proximo.tipo] || l.proximo.tipo) };
    }
    if (fila_.situacao !== 'fora' && pausada) fila_.detalhe += ' · fila pausada';
    return { ref: l.ref, nome: l.nome, telefone: l.telefone, estado: l.estado, estado_rotulo: ROTULO_ESTADO[l.estado] || l.estado, ultimo_contato: l.ultimo_contato, toques: l.toques, sinal: l.sinal, fila: fila_ };
  });
  const ordem = { na_fila: 0, agendado: 1, fora: 2 };
  itens.sort((a, b) => ordem[a.fila.situacao] - ordem[b.fila.situacao] || (Date.parse(a.fila.previsto || 0) - Date.parse(b.fila.previsto || 0)) || (Date.parse(b.ultimo_contato) - Date.parse(a.ultimo_contato)));
  const cont = (s) => itens.filter((i) => i.fila.situacao === s).length;
  const podeVoltar = itens.filter((i) => i.fila.situacao === 'fora' && ['perdido_definitivo', 'encerrada'].includes(i.estado)).length;
  const prox = itens.find((i) => i.fila.previsto);
  return {
    total: itens.length, na_fila: cont('na_fila'), agendados: cont('agendado'), fora: cont('fora'), podem_voltar: podeVoltar,
    proximo_envio: prox ? prox.fila.previsto : null, ritmo_s: passoS, acelerado_ate: acelAte, pausada,
    pedido_em: st.reaquecer_pedido || null, janela: JANELA.ini + 'h às ' + JANELA.fim + 'h', itens,
  };
}
// Versão curta para o /api/resumo (campo funil_estrategia).
export function resumoFunilCurto({ dias = 1 } = {}) {
  const r = resumoFunil({ dias });
  return { leads_sem_proximo_passo: r.leads_sem_proximo_passo, leads_vivos: r.leads_vivos, por_estado: r.por_estado, conversao: dias > 1 ? r.conversao.sete_dias : r.conversao.hoje, proximos_por_dia: r.proximos_por_dia, paineis_por_origem: r.paineis_por_origem, proativos_hoje: r.proativos_hoje, experimentos: r.experimentos.map((x) => ({ degrau: x.degrau, rotulo: x.rotulo, A: x.A.taxa, B: x.B.taxa, nA: x.A.enviados, nB: x.B.enviados, decisao: x.decisao })), vigia_em: r.vigia_em };
}

// ---------- jornada ----------
function fasesDoMes(agora = new Date()) {
  const ano = agora.getFullYear(), mes = agora.getMonth(), dia = agora.getDate();
  const ultimo = new Date(ano, mes + 1, 0).getDate();
  const fases = [
    { chave: 'inicio', rotulo: 'Início do mês', de: 6, ate: 12, texto: 'D+1, D+3, D+7 para quem abriu agora; check-in leve' },
    { chave: 'meio', rotulo: 'Meio do mês', de: 13, ate: 24, texto: 'Check-in a cada 7 a 10 dias; ajuda para quem está sem uso' },
    { chave: 'fechamento', rotulo: 'Fechamento', de: 25, ate: 4, texto: 'Dia 25: conseguiu vender? Dia 3: dúvida no pagamento?' },
    { chave: 'acerto', rotulo: 'Acerto dia 5', de: 5, ate: 5, texto: 'Bot de cobrança manda o link com o valor dos créditos usados' },
  ];
  const atual = dia === 5 ? 'acerto' : dia >= 25 || dia <= 4 ? 'fechamento' : dia >= 13 ? 'meio' : 'inicio';
  return { hoje: dia, dias_no_mes: ultimo, atual, fases };
}
const ROT_STATUS = { saudavel: 'Saudável', sem_uso: 'Sem uso', em_risco: 'Em risco', duvida_pagamento: 'Dúvida de pagamento', passou_ao_senhor: 'Passou ao senhor' };
const ROT_RESP = { vendeu: 'Vendeu', sem_vendas: 'Sem vendas ainda', duvida_pagamento: 'Dúvida de pagamento', problema: 'Problema', tudo_certo: 'Tudo certo', outro: 'Respondeu' };
export function resumoJornada() {
  const J = lerJson(F.jornada, { revendedores: [] });
  const lista = (J.revendedores || []).map((r) => ({
    ref: r.ref, nome: r.nome, painel_numero: r.painel_numero, telefone: r.telefone, dias: r.dias, fechou_em: r.fechou_em,
    uso: r.uso, status: r.status, status_rotulo: ROT_STATUS[r.status] || r.status,
    ultimo_toque: r.ultimo_toque ? { ...r.ultimo_toque, rotulo: ROTULO_JOR[r.ultimo_toque.tipo] || r.ultimo_toque.tipo } : null,
    proximo: r.proximo ? { ...r.proximo, rotulo: ROTULO_JOR[r.proximo.tipo] || r.proximo.tipo } : null,
    bloqueio: r.bloqueio, resposta: r.resposta ? { quando: r.resposta.t, classe: r.resposta.classe, rotulo: ROT_RESP[r.resposta.classe] || r.resposta.classe, texto: r.resposta.texto } : null,
    toques: r.toques, tocar_agora: r.tocar_agora,
  })).sort((a, b) => (a.painel_numero ?? 9999) - (b.painel_numero ?? 9999));
  const tocados = lista.filter((r) => r.toques > 0);
  const responderam = lista.filter((r) => r.resposta);
  const em7 = Date.now() + 7 * 86400e3;
  return {
    gerado_em: new Date().toISOString(), vigia_em: J.atualizado_em || null, pausada: fs.existsSync(F.jornadaPausada), mes: fasesDoMes(),
    indicadores: {
      revendedores: lista.length, tocados: tocados.length,
      pct_respondeu: tocados.length ? r3(tocados.filter((r) => r.resposta).length / tocados.length) : null,
      pct_vendeu: responderam.length ? r3(responderam.filter((r) => r.resposta.classe === 'vendeu').length / responderam.length) : null,
      em_risco: lista.filter((r) => r.status === 'em_risco' || r.status === 'sem_uso').length,
      duvida_pagamento: lista.filter((r) => r.status === 'duvida_pagamento').length,
      passou_ao_senhor: lista.filter((r) => r.status === 'passou_ao_senhor').length,
      toques_7_dias: lista.filter((r) => r.proximo && !r.bloqueio && Date.parse(r.proximo.quando) <= em7).length,
    },
    revendedores: lista,
  };
}

// ---------- comandos ----------
function comando(obj) {
  const atual = lerJson(F.comando, []);
  fs.writeFileSync(F.comando, JSON.stringify([].concat(atual, obj)));
}
let jogando = null;
function rodarJogadas() {
  if (jogando) return jogando;
  jogando = new Promise((ok) => {
    const p = spawn(process.execPath, [path.join(DIR, 'jogadas.mjs'), '--agora'], { cwd: PASTA, windowsHide: true });
    let out = ''; const t = setTimeout(() => p.kill(), 240000);
    p.stdout.on('data', (d) => (out += d));
    p.on('close', () => { clearTimeout(t); try { ok(JSON.parse(out.trim().split('\n').pop())); } catch { ok({ ok: false, motivo: 'a leitura não terminou' }); } });
    p.on('error', (e) => ok({ ok: false, motivo: e.message }));
  }).finally(() => { jogando = null; });
  return jogando;
}
const REF = /^[0-9a-f]{10}$/;
// Devolve { codigo, corpo } ou null se a rota não é daqui.
export async function tratarRotaFunil({ metodo, rota, query = {}, corpo = {}, headers = {} }) {
  if (metodo === 'GET' && rota === '/api/funil') return { codigo: 200, corpo: resumoFunil({ dias: query.dias || 1 }) };
  if (metodo === 'GET' && rota === '/api/jornada') return { codigo: 200, corpo: resumoJornada() };
  if (metodo === 'GET' && rota === '/api/etiquetas') return { codigo: 200, corpo: resumoFunil().etiquetas };
  if (metodo !== 'POST' || !(rota.startsWith('/api/funil/') || rota.startsWith('/api/jornada/'))) return null;
  if (!/application\/json/i.test(String(headers['content-type'] || ''))) return { codigo: 415, corpo: { erro: 'use Content-Type: application/json' } };
  const ok = (extra = {}) => ({ codigo: 200, corpo: { ok: true, ...extra } });
  switch (rota) {
    case '/api/funil/pausar': fs.writeFileSync(F.pausado, 'pausada pelo Dashboard em ' + new Date().toISOString()); return ok({ cadencia_pausada: true });
    case '/api/funil/retomar': try { fs.unlinkSync(F.pausado); } catch {} return ok({ cadencia_pausada: false });
    case '/api/funil/jogadas': return { codigo: 200, corpo: await rodarJogadas() };
    case '/api/funil/vigia': comando({ acao: 'vigia' }); return ok();
    case '/api/funil/reaquecer': {
      if (corpo.confirmar !== true) return { codigo: 400, corpo: { erro: 'confirme com "confirmar": true' } };
      const arqCfg = path.join(PASTA, 'backlog-config.json');
      const ate = new Date(proximaJanelaFim(Date.now())).toISOString();
      fs.writeFileSync(arqCfg, JSON.stringify({ ...lerJson(arqCfg, {}), acelerado_ate: ate }, null, 1));
      comando({ acao: 'reaquecer' });
      const fr = resumoFrios();
      return ok({ acelerado_ate: ate, na_fila: fr.na_fila, voltam: fr.podem_voltar, aviso: 'Fila acelerada: 1 por minuto, das 9h às 20h, respeitando o teto de 120 por dia. Quem estava fora da fila volta com um toque cada.' });
    }
    case '/api/jornada/pausar': fs.writeFileSync(F.jornadaPausada, 'pausada pelo Dashboard em ' + new Date().toISOString()); return ok({ pausada: true });
    case '/api/jornada/retomar': try { fs.unlinkSync(F.jornadaPausada); } catch {} return ok({ pausada: false });
    case '/api/jornada/tocar':
      if (!REF.test(String(corpo.ref || ''))) return { codigo: 400, corpo: { erro: 'ref inválida' } };
      if (corpo.confirmar !== true) return { codigo: 400, corpo: { erro: 'confirme com "confirmar": true' } };
      comando({ acao: 'tocar', ref: corpo.ref }); return ok({ agendado: true, aviso: 'Sai no próximo horário livre (9h às 20h, respeitando o teto do dia e 60 s entre envios).' });
    default: return { codigo: 404, corpo: { erro: 'ação desconhecida' } };
  }
}
