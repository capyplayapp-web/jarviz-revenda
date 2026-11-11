// Vista Campanha (10/11/2026, pedido do senhor): contador desde o início da campanha (06/11) e projeção de quantos painéis
// fecharemos até o fim do ciclo. GET /api/campanha, POST /api/campanha {meta} (só pelo dashboard do PC).
// Fontes, só leitura: sigma-cache.json (criado_em de TODOS os painéis do Sigma), revendedores.json (painéis do robô que o
// Sigma ainda não leu), eventos.jsonl (leads novos). Nada de telefone, usuário ou senha sai daqui.
// Regra de honestidade: projeção é estimativa; a tela mostra a faixa e quantos dias de dado sustentam a conta.
import fs from 'node:fs';
import path from 'node:path';
import { PASTA, lerJson, lerEventos, lerRevendedoresLista } from './lib.mjs';
import { resumoSigma, atualizarSigma } from './sigma-lib.mjs';

const CONFIG = path.join(PASTA, 'campanha.json');
const PADRAO = { nome: 'Campanha de novembro', inicio: '2026-11-06', fim: '2026-12-05', marco: '2026-11-30', meta: null };
const DIA = 86400e3;
const FUSO = 'America/Sao_Paulo';

const chaveDia = (t) => new Date(t).toLocaleDateString('sv-SE', { timeZone: FUSO });   // AAAA-MM-DD no horário de Brasília
const horaBR = (t) => Number(new Date(t).toLocaleString('en-US', { timeZone: FUSO, hour: 'numeric', hour12: false })) % 24;
const meiaNoite = (k) => Date.parse(`${k}T00:00:00-03:00`);
const r1 = (n) => (Number.isFinite(n) ? Math.round(n * 10) / 10 : null);
const r3 = (n) => (Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null);
const soma = (v) => v.reduce((a, b) => a + b, 0);

export function lerConfig() {
  const c = { ...PADRAO, ...lerJson(CONFIG, {}) };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.inicio)) c.inicio = PADRAO.inicio;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.fim) || c.fim < c.inicio) c.fim = PADRAO.fim;
  if (c.marco && (!/^\d{4}-\d{2}-\d{2}$/.test(c.marco) || c.marco < c.inicio || c.marco > c.fim)) c.marco = null;
  c.meta = Number.isFinite(+c.meta) && +c.meta > 0 ? Math.round(+c.meta) : null;
  return c;
}

export function salvarMeta(meta) {
  const c = lerJson(CONFIG, {});
  const n = meta == null || meta === '' ? null : Math.round(Number(meta));
  if (n != null && (!Number.isFinite(n) || n < 1 || n > 100000)) throw new Error('meta inválida');
  c.meta = n;
  fs.writeFileSync(CONFIG + '.tmp', JSON.stringify({ ...PADRAO, ...c }, null, 2)); fs.renameSync(CONFIG + '.tmp', CONFIG);
  return lerConfig();
}

// Quanto de um dia "típico" de vendas já passou até esta hora (pela distribuição real da hora em que os painéis nascem).
function fracaoDoDia(horas, agora) {
  const tot = soma(horas);
  const h = horaBR(agora), min = new Date(agora).getMinutes() / 60;
  if (tot < 20) return Math.min(1, (h + min) / 24);   // pouco dado: hora corrida
  return Math.min(1, (soma(horas.slice(0, h)) + horas[h] * min) / tot);
}

// Média com peso maior para os dias recentes (meia-vida de ~3 dias). Só dias completos.
function ritmoPonderado(valores) {
  if (!valores.length) return null;
  let s = 0, p = 0;
  valores.forEach((v, i) => { const w = Math.pow(0.8, valores.length - 1 - i); s += v * w; p += w; });
  return s / p;
}

let ultimaLeituraHora = 0, erroHora = null;   // modo 'hora' (envio para a nuvem): no máximo uma leitura do Sigma a cada 15 min, só se o cache passou de 1 h

export function resumoCampanha({ lerSigma = true } = {}) {
  const cfg = lerConfig();
  const agora = Date.now();
  if (lerSigma === 'hora') {
    const c = lerJson(path.join(PASTA, 'sigma-cache.json'), null);
    if ((!c || Date.now() - Date.parse(c.lido_em) > 3600e3) && Date.now() - ultimaLeituraHora > 15 * 60e3) { ultimaLeituraHora = Date.now(); atualizarSigma().then((r) => { erroHora = r && r.ok === false ? { motivo: r.motivo || 'falha' } : null; }).catch(() => {}); }
  }
  const sig = lerSigma === true ? resumoSigma()            // dispara leitura nova do Sigma se o cache tiver mais de 10 min
    : (() => { const d = lerJson(path.join(PASTA, 'sigma-cache.json'), null); return { dados: d, lendo: false, erro: lerSigma === 'hora' ? erroHora : null, velho: !d || Date.now() - Date.parse(d.lido_em) > 600e3 }; })();
  const dados = sig.dados;
  const t0 = meiaNoite(cfg.inicio), tFim = meiaNoite(cfg.fim) + DIA;   // fim é inclusivo (até 23h59 do último dia)
  const hojeK = chaveDia(agora);
  const totalDias = Math.round((tFim - t0) / DIA);
  const diaAtual = Math.min(totalDias, Math.max(0, Math.floor((agora - t0) / DIA) + 1));

  // ---------- Painéis: Sigma (todos) + robô que o Sigma ainda não leu ----------
  const paineis = [];
  const vistos = new Set();
  for (const r of dados?.revendedores || []) {
    const t = Date.parse(r.criado_em); if (!Number.isFinite(t)) continue;
    vistos.add(String(r.id));
    paineis.push({ t, robo: !!r.do_robo, ativo: r.status === 'ACTIVE', vendeu: (r.clientes_total || 0) > 0, clientes: r.clientes_total || 0, fonte: 'sigma' });
  }
  const lidoSigma = dados?.lido_em ? Date.parse(dados.lido_em) : 0;
  for (const p of lerRevendedoresLista()) {
    const t = Date.parse(p.quando);
    if (!Number.isFinite(t) || (p.painel_id && vistos.has(String(p.painel_id)))) continue;
    if (t <= lidoSigma) continue;                 // antes da leitura do Sigma e não está lá: não é painel novo (ou já foi apagado)
    paineis.push({ t, robo: true, ativo: true, vendeu: false, clientes: 0, fonte: 'robo' });
  }

  // Hora em que os painéis costumam nascer (todos os dados, para a fração do dia)
  const horas = Array(24).fill(0);
  for (const p of paineis) horas[horaBR(p.t)]++;

  const daCamp = paineis.filter((p) => p.t >= t0 && p.t < tFim);
  const antes = paineis.filter((p) => p.t < t0 && p.t >= t0 - 14 * DIA);

  // ---------- Leads novos por dia (o robô só mede desde que ligou) ----------
  const evs = lerEventos();
  const novaPor = new Map(); let cobertura = Infinity;
  for (const e of evs) {
    const t = Date.parse(e.t); if (!Number.isFinite(t)) continue;
    if (t < cobertura) cobertura = t;
    if (e.tipo === 'conversa_nova' && e.chat && !novaPor.has(e.chat)) novaPor.set(e.chat, t);
  }
  const leadsCamp = [...novaPor.values()].filter((t) => t >= t0 && t < tFim);

  // ---------- Série por dia, do início até hoje ----------
  const dias = [];
  for (let i = 0; i < totalDias; i++) {
    const ini = t0 + i * DIA, k = chaveDia(ini + 3 * 3600e3);
    if (ini > agora) break;
    const ps = daCamp.filter((p) => chaveDia(p.t) === k);
    const medido = Number.isFinite(cobertura) && ini + DIA > cobertura;
    dias.push({
      dia: k, n: i + 1, hoje: k === hojeK,
      paineis: ps.length, robo: ps.filter((p) => p.robo).length, fora: ps.filter((p) => !p.robo).length,
      ativos: ps.filter((p) => p.ativo).length, venderam: ps.filter((p) => p.vendeu).length,
      leads: medido ? leadsCamp.filter((t) => chaveDia(t) === k).length : null,
    });
  }

  // ---------- Ritmo e projeção ----------
  const completos = dias.filter((d) => !d.hoje);
  const hoje = dias.find((d) => d.hoje) || null;
  const fracHoje = hoje ? Math.round(fracaoDoDia(horas, agora) * 48) / 48 : 0;   // degraus de 1/48: a projeção muda de meia em meia hora, não a cada segundo (envio da nuvem)
  const total = daCamp.length;
  const diasCorridos = completos.length + fracHoje;          // dias "equivalentes" já vividos
  const ritmoCamp = diasCorridos > 0.25 ? total / diasCorridos : null;
  const ult3 = completos.slice(-3).map((d) => d.paineis);
  const ritmo3 = ult3.length ? soma(ult3) / ult3.length : null;
  const ritmoPond = ritmoPonderado(completos.map((d) => d.paineis));
  const melhor = completos.length ? Math.max(...completos.map((d) => d.paineis)) : null;

  const restanteAte = (kFim) => {
    const tLim = meiaNoite(kFim) + DIA;
    if (agora >= tLim) return 0;
    const diasInteiros = Math.max(0, Math.round((tLim - (meiaNoite(hojeK) + DIA)) / DIA));
    return diasInteiros + (hoje ? 1 - fracHoje : 0);
  };
  const cenario = (ritmo, kFim) => (ritmo == null ? null : Math.round(daCamp.filter((p) => p.t < meiaNoite(kFim) + DIA).length + ritmo * restanteAte(kFim)));

  // Provável = ritmo ponderado; faixa de 80% = incerteza do próprio ritmo (dias variam) + sorte do dia a dia (Poisson)
  const desvio = (() => {
    const v = completos.map((d) => d.paineis); if (v.length < 2) return null;
    const m = soma(v) / v.length; return Math.sqrt(soma(v.map((x) => (x - m) ** 2)) / (v.length - 1));
  })();
  const projetar = (kFim) => {
    const rest = restanteAte(kFim), jaFeito = daCamp.filter((p) => p.t < meiaNoite(kFim) + DIA).length;
    if (ritmoPond == null) return { data: kFim, ja: jaFeito, restam_dias: r1(rest), provavel: null, faixa: null };
    const esp = ritmoPond * rest;
    const ep = desvio != null && completos.length ? Math.sqrt((desvio ** 2 / completos.length) * rest * rest + esp) : Math.sqrt(esp);
    return {
      data: kFim, ja: jaFeito, restam_dias: r1(rest),
      provavel: Math.round(jaFeito + esp),
      faixa: [Math.max(jaFeito, Math.round(jaFeito + esp - 1.28 * ep)), Math.round(jaFeito + esp + 1.28 * ep)],
      cenarios: { campanha: cenario(ritmoCamp, kFim), recente: cenario(ritmo3, kFim), melhor_dia: cenario(melhor, kFim) },
    };
  };
  const projFim = projetar(cfg.fim);
  const projMarco = cfg.marco && cfg.marco !== cfg.fim ? projetar(cfg.marco) : null;

  // Meta: quanto precisa por dia daqui para frente
  const meta = cfg.meta ? {
    alvo: cfg.meta, faltam: Math.max(0, cfg.meta - total),
    por_dia: restanteAte(cfg.fim) > 0 ? r1(Math.max(0, cfg.meta - total) / restanteAte(cfg.fim)) : null,
    chance: projFim.provavel == null ? null : projFim.provavel >= cfg.meta ? 'no_ritmo' : projFim.faixa && projFim.faixa[1] >= cfg.meta ? 'possivel' : 'abaixo',
  } : null;

  // Curva acumulada (real + projeção dia a dia, para o gráfico)
  const curva = []; let acc = 0;
  for (let i = 0; i < totalDias; i++) {
    const k = chaveDia(t0 + i * DIA + 3 * 3600e3), d = dias[i];
    if (d) { acc += d.paineis; curva.push({ dia: k, real: acc, hoje: d.hoje }); }
    else curva.push({ dia: k, real: null });
  }
  if (ritmoPond != null) {
    let base = total;
    for (const c of curva) {
      if (c.real != null && !c.hoje) continue;
      if (c.hoje) { c.proj = Math.round((base + ritmoPond * (1 - fracHoje)) * 10) / 10; base = c.proj; continue; }
      base += ritmoPond; c.proj = Math.round(base * 10) / 10;
      const n = Math.round((meiaNoite(c.dia) - meiaNoite(hojeK)) / DIA) + (hoje ? 1 - fracHoje : 0), esp = ritmoPond * n;   // mesmo degrau de meia hora: o envio da nuvem não muda a cada leitura
      const ep = desvio != null && completos.length ? Math.sqrt((desvio ** 2 / completos.length) * n * n + esp) : Math.sqrt(esp);
      c.lo = Math.max(total, Math.round((total + esp - 1.28 * ep) * 10) / 10); c.hi = Math.round((total + esp + 1.28 * ep) * 10) / 10;
    }
  }

  // Qualidade do que fechou na campanha
  const dosLeads = leadsCamp.length;
  const roboCamp = daCamp.filter((p) => p.robo).length;
  const qualidade = {
    ativos: daCamp.filter((p) => p.ativo).length,
    venderam: daCamp.filter((p) => p.vendeu).length,
    clientes: soma(daCamp.map((p) => p.clientes)),
    robo: roboCamp, fora: total - roboCamp,
  };

  // Antes x durante (média por dia nos 14 dias antes do início)
  const diasAntes = new Set(antes.map((p) => chaveDia(p.t))).size ? 14 : 0;
  const comparacao = {
    antes_por_dia: diasAntes ? r1(antes.length / diasAntes) : null,
    antes_ativos_pct: antes.length ? r3(antes.filter((p) => p.ativo).length / antes.length) : null,
    durante_por_dia: r1(ritmoCamp),
    durante_ativos_pct: total ? r3(qualidade.ativos / total) : null,
  };

  const limites = [];
  if (completos.length < 7) limites.push(`A projeção usa ${completos.length} ${completos.length === 1 ? 'dia completo' : 'dias completos'} de campanha; com menos de 7 dias a faixa ainda é larga.`);
  limites.push('Os dias recentes pesam mais na projeção provável (o robô passou a atender em 08/11 e mudou o ritmo).');
  if (sig.velho) limites.push(`O Sigma foi lido ${lidoSigma ? 'às ' + new Date(lidoSigma).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: FUSO }) : 'nunca'}; painéis criados fora do robô depois disso ainda não entram.`);
  if (Number.isFinite(cobertura) && cobertura > t0) limites.push(`Leads só são contados desde ${new Date(cobertura).toLocaleDateString('pt-BR', { timeZone: FUSO })}, quando o robô começou a registrar.`);
  limites.push('Painel cancelado depois no Sigma continua contado no dia em que nasceu.');

  return {
    gerado_em: new Date(agora).toISOString(),
    config: cfg,
    contador: { dia: diaAtual, total_dias: totalDias, restam: Math.max(0, totalDias - diaAtual), desde: new Date(t0).toISOString(), ate: new Date(tFim - 1).toISOString(), fracao_hoje: r3(fracHoje) },
    total, hoje: hoje ? hoje.paineis : 0,
    ritmo: { campanha: r1(ritmoCamp), ultimos3: r1(ritmo3), ponderado: r1(ritmoPond), melhor_dia: melhor, desvio: r1(desvio), dias_completos: completos.length },
    projecao: projFim, projecao_marco: projMarco, meta,
    leads: { total: dosLeads, por_100: dosLeads ? r1((roboCamp / dosLeads) * 100) : null, desde: Number.isFinite(cobertura) ? new Date(cobertura).toISOString() : null },
    qualidade, comparacao, dias, curva,
    horas,
    sigma: { lido_em: dados?.lido_em || null, lendo: sig.lendo, velho: sig.velho, erro: sig.erro?.motivo || null },
    limites,
  };
}
