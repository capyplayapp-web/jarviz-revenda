// Aba Tráfego (09/11/2026): quantos leads chegaram até o fechamento do painel.
// GET /api/trafego?dias=1|7|30. Só leitura (eventos.jsonl + historico, revendedores.json). Nenhum telefone, id de conversa ou senha sai daqui.
// Regra de honestidade: só entra número que o robô mediu. O que não existe vem como null com o motivo em `limites`.
import { lerEventos, lerRevendedoresLista } from './lib.mjs';

const MIN_AMOSTRA = 30;                       // abaixo disso a comparação áudio x texto é só indício
const r1 = (n) => Math.round(n * 10) / 10;
const r3 = (n) => Math.round(n * 1000) / 1000;
const chaveDia = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const inicioPeriodo = (dias) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (dias - 1)); return d.getTime(); };
const ORIGENS = { facebook: 'Anúncio do Facebook', instagram: 'Anúncio do Instagram', anuncio: 'Anúncio (rede não identificada)', sem_registro: 'Sem origem registrada' };
const mediana = (v) => { if (!v.length) return null; const s = [...v].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

function etapasDe(leads) {
  // Três degraus em sequência. O teste grátis é um desvio (muita gente fecha painel sem pedir teste), por isso fica fora da escada.
  const n = leads.length, cont = (f) => leads.filter(f).length;
  const resp = cont((l) => l.respondeu), painel = cont((l) => l.painel);
  const base = [['Leads que chegaram', n], ['Responderam ao robô', resp], ['Fecharam painel', painel]];
  return base.map(([etapa, qtd], i) => ({
    etapa, qtd,
    taxa_da_anterior: i && base[i - 1][1] ? Math.min(1, qtd / base[i - 1][1]) : null,
    taxa_do_total: i && n ? qtd / n : null,
  }));
}

export function resumoTrafego({ dias = 1 } = {}) {
  dias = [1, 7, 30].includes(parseInt(dias, 10)) ? parseInt(dias, 10) : 1;
  const ini = inicioPeriodo(dias), agora = Date.now();
  const evs = lerEventos();
  const paineisLista = lerRevendedoresLista();

  // por conversa: 1º aparecimento, mensagens do cliente, respostas do robô, teste, painel, canal da 1ª resposta
  const por = new Map();
  const get = (c) => { let x = por.get(c); if (!x) por.set(c, x = { nova: null, msgs: [], resp: [], teste: null, painel: null, canal: null, senhor: false }); return x; };
  let primeiroEvento = Infinity;
  for (const e of evs) {
    if (!e.chat) continue;
    const t = Date.parse(e.t); if (!Number.isFinite(t)) continue;
    if (t < primeiroEvento) primeiroEvento = t;
    const x = get(e.chat);
    if (e.tipo === 'conversa_nova') { if (!x.nova || t < x.nova.t) x.nova = { t, origem: e.origem_anuncio || 'sem_registro', titulo: e.anuncio_titulo || null }; }
    else if (e.tipo === 'mensagem_cliente') x.msgs.push(t);
    else if (e.tipo === 'resposta_robo') x.resp.push(t);
    else if (e.tipo === 'teste_gerado') { if (!x.teste || t < x.teste) x.teste = t; }
    else if (e.tipo === 'painel_fechado') { if (!x.painel || t < x.painel) x.painel = t; }
    else if (e.tipo === 'primeira_resposta') x.canal = e.canal === 'audio' ? 'audio' : 'texto';
    else if (e.tipo === 'passou_ao_senhor') x.senhor = true;
  }
  for (const p of paineisLista) {               // revendedores.json também conta (painel fechado sem evento, ex.: casado pelo telefone)
    const t = Date.parse(p.quando), x = por.get(p.contato_id);
    if (x && Number.isFinite(t) && (!x.painel || t < x.painel)) x.painel = t;
  }

  const leads = [];
  for (const x of por.values()) {
    if (!x.nova || x.nova.t < ini) continue;
    const t0 = x.nova.t;
    const primeiraResp = x.resp.filter((t) => t >= t0).sort((a, b) => a - b)[0];
    const respondeu = primeiraResp != null && x.msgs.some((t) => t > primeiraResp);
    const teste = x.teste != null && x.teste >= t0 - 60e3, painel = x.painel != null && x.painel >= t0 - 60e3;
    leads.push({ t0, origem: x.nova.origem, respondeu, teste, painel, horas_ate_painel: painel ? Math.max(0, (x.painel - t0) / 36e5) : null, canal: x.canal, senhor: x.senhor });
  }

  // painéis fechados no período, de qualquer lead (inclui reativados do backlog)
  const paineisPeriodo = paineisLista.filter((p) => Date.parse(p.quando) >= ini);
  const deLeadsNovos = leads.filter((l) => l.painel).length;

  // por dia (leads novos x painéis fechados no dia)
  const dia = new Map();
  const ponto = (k) => { let v = dia.get(k); if (!v) dia.set(k, v = { dia: k, leads: 0, paineis: 0 }); return v; };
  for (const l of leads) ponto(chaveDia(l.t0)).leads++;
  for (const p of paineisPeriodo) ponto(chaveDia(p.quando)).paineis++;
  for (let i = 0; i < dias; i++) { const d = new Date(ini); d.setDate(d.getDate() + i); ponto(chaveDia(d)); }
  const porDiaBruto = [...dia.values()].sort((a, b) => a.dia.localeCompare(b.dia));
  const primeiroDia = Number.isFinite(primeiroEvento) ? chaveDia(primeiroEvento) : null;
  // dia antes do primeiro registro do robô = sem medição (null), nunca zero
  const por_dia = porDiaBruto.map((x) => (primeiroDia && x.dia < primeiroDia ? { dia: x.dia, leads: null, paineis: null, medido: false } : { ...x, medido: true }));

  // por hora do dia em que o lead chegou
  const por_hora = Array.from({ length: 24 }, (_, h) => ({ hora: h, leads: 0 }));
  for (const l of leads) por_hora[new Date(l.t0).getHours()].leads++;

  // por origem
  const origens = {};
  for (const l of leads) (origens[l.origem] ||= []).push(l);
  for (const k of ['facebook', 'instagram']) origens[k] ||= [];
  const por_origem = Object.entries(origens).map(([k, ls]) => ({
    origem: k, rotulo: ORIGENS[k] || k, leads: ls.length, paineis: ls.filter((l) => l.painel).length,
    taxa: ls.length ? ls.filter((l) => l.painel).length / ls.length : null,
  })).sort((a, b) => b.leads - a.leads);
  const origemMedida = leads.filter((l) => l.origem !== 'sem_registro').length;

  // áudio x texto
  const ab = ['audio', 'texto'].map((c) => {
    const ls = leads.filter((l) => l.canal === c), p = ls.filter((l) => l.painel).length, r = ls.filter((l) => l.respondeu).length;
    return { canal: c, rotulo: c === 'audio' ? 'Voz do robô (áudio)' : 'Texto', leads: ls.length, responderam: r, paineis: p, taxa: ls.length ? p / ls.length : null, taxa_respondeu: ls.length ? r / ls.length : null };
  });
  const semCanal = leads.filter((l) => !l.canal).length;
  const abSuficiente = ab.every((a) => a.leads >= MIN_AMOSTRA);

  const horas = leads.filter((l) => l.horas_ate_painel != null).map((l) => l.horas_ate_painel);
  const medHoras = horas.length ? horas.reduce((a, b) => a + b, 0) / horas.length : null;

  const n = leads.length;
  const limites = [];
  limites.push(`O robô só registra a chegada de leads desde ${new Date(primeiroEvento).toLocaleDateString('pt-BR')}; antes disso não há contagem de leads para comparar.`);
  if (origemMedida < n) limites.push(n ? `A origem do anúncio (Facebook ou Instagram) só é gravada para leads novos a partir de agora; ${n - origemMedida} de ${n} estão sem origem.` : 'A origem do anúncio só é gravada para leads novos a partir de agora.');
  limites.push('Os leads de 08/11 incluem conversas que o robô começou a atender nesse dia; parte pode ter chegado antes.');
  limites.push('Gasto de anúncio e custo por lead não estão ligados ao Gerenciador da Meta, então não aparecem aqui.');
  if (n && !abSuficiente) limites.push(`Áudio x texto: menos de ${MIN_AMOSTRA} leads em cada lado. Vale como indício, não como conclusão.`);
  if (paineisPeriodo.length > deLeadsNovos) limites.push(`${paineisPeriodo.length - deLeadsNovos} dos painéis do período vieram de conversas antigas (reativadas pelo follow-up), não de leads novos.`);

  return {
    gerado_em: new Date(agora).toISOString(),
    periodo: { dias, inicio: new Date(ini).toISOString() },
    cobertura_desde: Number.isFinite(primeiroEvento) ? new Date(primeiroEvento).toISOString() : null,
    leads: n,
    paineis_dos_leads: deLeadsNovos,
    paineis_no_periodo: paineisPeriodo.length,
    paineis_por_100_leads: n ? r1((deLeadsNovos / n) * 100) : null,
    passou_ao_senhor: leads.filter((l) => l.senhor).length,
    tempo_ate_painel_h: { media: medHoras == null ? null : r1(medHoras), mediana: horas.length ? r1(mediana(horas)) : null, amostra: horas.length },
    funil: etapasDe(leads),
    teste_gratis: { leads: leads.filter((l) => l.teste).length, fecharam: leads.filter((l) => l.teste && l.painel).length },
    fecharam_sem_responder: leads.filter((l) => l.painel && !l.respondeu).length,
    por_dia, por_hora, por_origem,
    origem_medida: { com: origemMedida, sem: n - origemMedida },
    audio_x_texto: { grupos: ab, sem_canal: semCanal, amostra_suficiente: abSuficiente, minimo: MIN_AMOSTRA },
    limites,
  };
}
