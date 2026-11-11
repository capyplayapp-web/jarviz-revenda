// Aba Sigma (09/11/2026): o painel painel.capyplay.site (Sigma) resumido numa tela só, dentro do dashboard do robô.
// Lê SOMENTE com GET, pela cópia mínima do login (painel-leitura.mjs: trava entre processos, POST/PUT/DELETE abortados).
// O perfil do bot (perfil-painel) nunca é aberto aqui, então não briga com o teste grátis.
// Cache em sigma-cache.json (fica só no PC; está no .gitignore e NÃO vai para a nuvem). Senhas, M3U e links de renovação não são guardados.
import fs from 'node:fs';
import path from 'node:path';
import { PASTA, lerJson, lerRevendedoresLista } from './lib.mjs';
import { sessao, get } from '../painel-leitura.mjs';

const CACHE = path.join(PASTA, 'sigma-cache.json');
const VALIDADE_MS = 10 * 60e3;        // lido há mais de 10 min: a tela pede uma leitura nova sozinha
const DIA = 86400e3;
const LINK_CRIAR = 'https://painel.capyplay.site/#/rs/RvWGlK01e3/bQELo6e1gr';   // o mesmo do base.md

let rodando = null, ultimoErro = null;

async function todasAsPaginas(page, rota, limite = 80) {
  const itens = []; let total = null;
  for (let p = 1; p <= limite; p++) {
    const r = await get(page, `${rota}${rota.includes('?') ? '&' : '?'}per_page=100&page=${p}`);
    if (r.status === 401 || r.status === 419) throw new Error('sem_sessao: o painel pediu login de novo');
    if (r.status !== 200) throw new Error(`${rota} HTTP ${r.status}`);
    const lista = r.json?.data || [];
    itens.push(...lista); total = r.json?.meta?.total ?? total;
    if (!lista.length || !r.json?.meta || p >= (r.json.meta.last_page || 1)) break;
  }
  return { itens, total };
}

const soDigitos = (t) => String(t || '').replace(/\D/g, '');
const ms = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? t : null; };

// Traduz os eventos do feed do Sigma para uma linha curta. Transferência aparece uma vez só (o lado de quem enviou).
function evento(e) {
  const r = e.reseller || '', c = e.counterpart || '';
  switch (e.kind) {
    case 'transfer': return e.direction === 'out' ? { tipo: 'credito', titulo: 'Créditos enviados', quem: r, para: c } : null;
    case 'customer_created': return { tipo: 'cliente', titulo: 'Cliente novo', quem: r };
    case 'customer_renewed': return { tipo: 'renovou', titulo: 'Cliente renovado', quem: r };
    case 'trial_created': return { tipo: 'teste', titulo: 'Teste grátis', quem: r };
    case 'connections_changed': return { tipo: 'telas', titulo: 'Mudou as telas', quem: r };
    case 'membership': return { tipo: 'acerto', titulo: e.status === 'paid' ? 'Acerto pago' : 'Acerto gerado', quem: r };
    default: return { tipo: 'outro', titulo: String(e.kind || 'Movimento').replace(/_/g, ' '), quem: r };
  }
}

async function ler() {
  const s = await sessao();
  try {
    const feedR = await get(s.page, '/api/feed/stream');
    if (feedR.status !== 200) throw new Error('feed HTTP ' + feedR.status);
    const feed = feedR.json?.data || {};
    const revs = await todasAsPaginas(s.page, '/api/resellers');
    const clis = await todasAsPaginas(s.page, '/api/customers');
    const link = (await get(s.page, '/api/referral-links')).json?.data?.[0] || null;
    return { feed, revs: revs.itens, clis: clis.itens, link };
  } finally { await s.fechar(); }
}

function montar({ feed, revs, clis, link }) {
  const agora = Date.now();
  const doRobo = lerRevendedoresLista();
  const roboPorId = new Map(doRobo.filter((x) => x.painel_id).map((x) => [String(x.painel_id), x]));
  const roboPorUser = new Map(doRobo.filter((x) => x.usuario_painel).map((x) => [x.usuario_painel.toLowerCase(), x]));

  // clientes por revendedor (o campo reseller do cliente é o usuário do revendedor)
  const porRev = new Map();
  let ativos = 0, testesAgora = 0, vencem7 = 0, vencidos7 = 0;
  const vencendo = [];
  for (const c of clis) {
    const exp = ms(c.expires_at), trial = c.is_trial === 'YES', ok = c.status === 'ACTIVE' && exp && exp > agora;
    const k = String(c.reseller || '').toLowerCase();
    const o = porRev.get(k) || { ativos: 0, testes: 0, vencem: 0, total: 0 };
    o.total++;
    if (ok && trial) { testesAgora++; o.testes++; }
    if (ok && !trial) {
      ativos++; o.ativos++;
      if (exp - agora <= 7 * DIA) { vencem7++; o.vencem++; vencendo.push({ revenda: c.reseller || '', vence_em: c.expires_at, pacote: c.package || '' }); }
    }
    if (!trial && exp && exp <= agora && agora - exp <= 7 * DIA) vencidos7++;
    porRev.set(k, o);
  }

  const revendedores = revs.map((r) => {
    const user = String(r.username || ''), cl = porRev.get(user.toLowerCase()) || { ativos: 0, testes: 0, vencem: 0, total: 0 };
    const robo = roboPorId.get(String(r.id)) || roboPorUser.get(user.toLowerCase()) || (r.email && roboPorUser.get(String(r.email).toLowerCase())) || null;
    const login = ms(r.last_login_at), criado = ms(r.created_at);
    return {
      id: r.id, usuario: user, nome: r.name || user, whatsapp: soDigitos(r.whatsapp) || soDigitos(robo?.telefone) || null,
      status: r.status || null, creditos: Number.isFinite(Number(r.credits)) ? Number(r.credits) : null,
      clientes: cl.ativos, testes: cl.testes, vencem: cl.vencem, clientes_total: cl.total,
      ultimo_login: r.last_login_at || null, ultima_recarga: r.last_recharge_at || null, criado_em: r.created_at || null,
      dias_sem_entrar: login ? Math.floor((agora - login) / DIA) : null, dias_de_casa: criado ? Math.floor((agora - criado) / DIA) : null,
      acerto_vence: r.membership_expiry_date || null, do_robo: !!robo,
    };
  });

  // "Precisa de mim": o que pede ação hoje, do mais urgente ao menos
  const ativo = (r) => r.status === 'ACTIVE';
  const precisa = [];
  for (const r of revendedores.filter((x) => ativo(x) && x.vencem > 0).sort((a, b) => b.vencem - a.vencem))
    precisa.push({ tipo: 'vencendo', revendedor: r.id, texto: `${r.vencem} ${r.vencem === 1 ? 'cliente vence' : 'clientes vencem'} em até 7 dias` });
  for (const r of revendedores.filter((x) => ativo(x) && x.creditos != null && x.creditos < 10 && x.clientes_total > 0))
    precisa.push({ tipo: 'credito', revendedor: r.id, texto: r.creditos <= 0 ? 'Sem créditos, não consegue criar cliente' : `Só ${r.creditos} créditos` });
  for (const r of revendedores.filter((x) => ativo(x) && x.clientes_total === 0 && x.dias_de_casa != null && x.dias_de_casa >= 2 && x.dias_de_casa <= 30).sort((a, b) => a.dias_de_casa - b.dias_de_casa))
    precisa.push({ tipo: 'parado', revendedor: r.id, texto: `Abriu o painel há ${r.dias_de_casa} dias e ainda não criou cliente` });
  for (const r of revendedores.filter((x) => ativo(x) && x.clientes_total > 0 && x.dias_sem_entrar != null && x.dias_sem_entrar >= 7).sort((a, b) => b.clientes - a.clientes))
    precisa.push({ tipo: 'sumiu', revendedor: r.id, texto: `Não entra no painel há ${r.dias_sem_entrar} dias` });

  const hoje = feed.today || {}, m30 = feed.last_30_days || {};
  const eventos = (feed.events || []).map((e) => { const t = evento(e); return t ? { ...t, em: e.occurred_at } : null; }).filter(Boolean).slice(0, 60);
  const entraram7 = revendedores.filter((r) => r.dias_sem_entrar != null && r.dias_sem_entrar < 7).length;

  return {
    lido_em: new Date(agora).toISOString(),
    numeros: {
      revendedores: revendedores.length, revendedores_ativos_7d: entraram7,
      novos_revendedores_7d: revendedores.filter((r) => r.dias_de_casa != null && r.dias_de_casa < 7).length,
      clientes_ativos: ativos, testes_agora: testesAgora, vencem_7d: vencem7, venceram_7d: vencidos7,
      hoje: { clientes: hoje.customers?.new_customers || 0, testes: hoje.customers?.new_trials || 0, renovacoes: hoje.customers?.renewals || 0, conversoes: hoje.customers?.trial_conversions || 0, recargas: hoje.credits?.in?.count || 0 },
      mes: { clientes: m30.customers?.new_customers || 0, testes: m30.customers?.new_trials || 0, renovacoes: m30.customers?.renewals || 0 },
    },
    precisa, revendedores, eventos,
    vencendo: vencendo.sort((a, b) => ms(a.vence_em) - ms(b.vence_em)).slice(0, 40),
    link: link ? { url: LINK_CRIAR, visitas: link.views_count || 0, cadastros: link.registrations_count || 0, creditos_iniciais: link.membership_inital_credits_to_recharge ?? null, dia_acerto: link.membership_renewal_day ?? null } : null,
  };
}

export function atualizarSigma() {
  if (rodando) return rodando;
  rodando = (async () => {
    const t0 = Date.now();
    try {
      const d = montar(await ler());
      d.levou_s = Math.round((Date.now() - t0) / 100) / 10;
      fs.writeFileSync(CACHE + '.tmp', JSON.stringify(d)); fs.renameSync(CACHE + '.tmp', CACHE);
      ultimoErro = null;
      return { ok: true };
    } catch (e) {
      const m = String(e?.message || e);
      ultimoErro = { em: new Date().toISOString(), motivo: m.startsWith('sem_sessao') ? 'login' : m.startsWith('painel_ocupado') ? 'ocupado' : 'falha', texto: m.slice(0, 240) };
      return { ok: false, ...ultimoErro };
    }
  })().finally(() => { rodando = null; });
  return rodando;
}

// GET /api/sigma: devolve o que já foi lido e, se estiver velho, dispara uma leitura nova em segundo plano.
export function resumoSigma() {
  const d = lerJson(CACHE, null);
  const idade = d ? Date.now() - Date.parse(d.lido_em) : Infinity;
  const recenteErro = ultimoErro && Date.now() - Date.parse(ultimoErro.em) < 3 * 60e3;   // depois de falhar, espera 3 min para tentar de novo
  if (idade > VALIDADE_MS && !rodando && !recenteErro) atualizarSigma();
  return { dados: d, lendo: !!rodando, erro: ultimoErro, velho: idade > VALIDADE_MS };
}
