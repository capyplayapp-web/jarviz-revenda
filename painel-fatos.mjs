// painel-fatos.mjs — fatos do painel (SOMENTE LEITURA) para o agente das lacunas, e o mapa do painel.
//   node painel-fatos.mjs --mapear     abre as páginas do mapa por URL (GET), grava lacunas\mapa-do-painel.json
//   node painel-fatos.mjs --fatos      lê as fontes e mostra só um resumo (grava lacunas\painel-cache.json)
// Cada fonte é UM GET em /api/*; o resumo sai em linhas curtas, sem dados pessoais (ver painel-leitura.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sessao, get, PASTA_LAC, primeiroNome } from './painel-leitura.mjs';

const PAINEL = 'https://painel.capyplay.site/';
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const semEmoji = (t) => String(t == null ? '' : t).replace(/[\u{1F000}-\u{1FFFF}☀-➿️‍]/gu, '').replace(/\s+/g, ' ').trim();
const reais = (c) => (c == null ? '?' : 'R$ ' + (Number(c) / 100).toFixed(2).replace('.', ','));
const html2txt = (h) => semEmoji(String(h || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\+?\d[\d\s().-]{8,}\d/g, '[telefone]').replace(/\b\d{9,}\b/g, '[número]')).slice(0, 420);
const dados = (j) => (Array.isArray(j?.data) ? j.data : []);
const ROTULO_PLANO = { PER_ACTIVE_CUSTOMER: 'por cliente ativo' };
const SEGREDO_VAR = /pass|senha|token|secret|key|url|template|message|html|script|api|smtp|mail|logo|color|css|ip/i;

export const CATALOGO = [
  { id: 'mensalista', rota: '/api/membershipplans', titulo: 'Planos mensalistas (cobrança do acerto, dia 5)', palavras: /mensal|acerto|vence|dia 5|cobran|pag|pos|pre|ativo|cr[eé]dito|pre[cç]o|valor|desconto|faixa/i,
    resumir: (j) => dados(j).map((p) => `${semEmoji(p.name)}: ${reais(p.plan_price)} ${ROTULO_PLANO[p.plan_type] || p.plan_type}; mínimo ${p.minimum_active_count} e máximo ${p.maximum_active_count} ativos; ${p.status}`) },
  { id: 'link_cadastro', rota: '/api/referral-links', titulo: 'Link de cadastro de revendedor (o que o painel novo recebe)', palavras: /painel|cadastr|link|abrir|cr[eé]dito|500|inicial|pos|pre|mensal|taxa|m[ií]nimo/i,
    resumir: (j) => dados(j).map((l) => `modelo ${l.membership_plan_type}; ${reais(l.membership_cost)} por cliente ativo; recorrência ${l.membership_days_recurrency} dias; créditos iniciais ${l.membership_inital_credits_to_recharge}; zera créditos no vencimento: ${l.membership_reset_credits_on_expiry_date}; mínimo de clientes para cobrar: ${l.membership_min_customers_to_charge}; cadastros pelo link: ${l.registrations_count} de ${l.views_count} visitas`) },
  { id: 'preco_creditos', rota: '/api/creditpackages/price', titulo: 'Compra de créditos avulsos no painel (preço por faixa)', palavras: /cr[eé]dito|comprar|pre|recarga|pre[cç]o|valor|pix|qr|faixa|desconto|volume/i,
    resumir: (j) => dados(j).filter((x) => x.status === 'ACTIVE').map((x) => `pacote de ${x.credits} créditos: ${reais(x.price_per_unit)} cada (moeda ${x.currency})`) },
  { id: 'faixas', rota: '/api/creditranges/catalog', titulo: 'Faixas de preço de créditos', palavras: /faixa|volume|desconto|cr[eé]dito|pre[cç]o|valor/i,
    resumir: (j) => (j?.data?.default_ranges || []).map((r) => `de ${r.min_credits} a ${r.max_credits ?? 'sem limite'} créditos: ${reais(r.price_per_unit)} por crédito`) },
  { id: 'pedidos', rota: '/api/creditorders', titulo: 'Pedidos de compra de créditos (só totais)', palavras: /pre|recarga|comprar|pagamento|pix|qr|cr[eé]dito|pago|mercado/i,
    resumir: (j) => { const d = dados(j); if (!d.length) return ['sem pedidos']; const por = {}; for (const x of d) por[x.status] = (por[x.status] || 0) + 1; return [`${d.length} pedidos recentes: ${Object.entries(por).map(([s, n]) => s + ' ' + n).join(', ')}`, 'formas de pagamento: ' + [...new Set(d.map((x) => semEmoji(x.payment_method)).filter(Boolean))].join(', ')]; } },
  { id: 'pacotes', rota: '/api/packages', titulo: 'Pacotes (o que cada crédito compra) e testes', palavras: /pacote|plano|teste|gr[aá]tis|adulto|m[eê]s|meses|dura|tela|conex|cr[eé]dito|trial/i,
    resumir: (j) => dados(j).map((p) => `${semEmoji(p.name)}: ${p.credits} crédito(s); duração ${p.duration} ${p.duration_in}; ${p.is_trial === 'YES' ? 'é TESTE' : 'pago'}; ${p.connections} conexão(ões); ${p.status}`) },
  { id: 'avisos', rota: '/api/notices', titulo: 'Avisos que o painel mostra aos revendedores', palavras: /aviso|golpe|suporte|renov|link|pix|contato|oficial/i,
    resumir: (j) => dados(j).map((n) => `${semEmoji(n.title)} (vale de ${String(n.display_from).slice(0, 10)} a ${String(n.display_to).slice(0, 10)}): ${html2txt(n.description)}`) },
  { id: 'config_revendas', rota: '/api/settings/resellers', titulo: 'Regras do painel para revendedores', palavras: /revend|sub|login|teste|cr[eé]dito|zero|m[ií]nimo|criar|migra|senha|trial/i,
    resumir: (j) => dados(j).filter((s) => !SEGREDO_VAR.test(s.variable) && s.value !== '' && s.value != null).map((s) => `${s.variable} = ${String(s.value).slice(0, 60)}`) },
  { id: 'config_clientes', rota: '/api/settings/customers', titulo: 'Regras do painel para clientes finais', palavras: /cliente|vence|expira|teste|usu[aá]rio|senha|cortesia|apaga|dias|migra/i,
    resumir: (j) => dados(j).filter((s) => !SEGREDO_VAR.test(s.variable) && s.value !== '' && s.value != null).map((s) => `${s.variable} = ${String(s.value).slice(0, 60)}`) },
  { id: 'servidores', rota: '/api/servers', titulo: 'Servidores', palavras: /servidor|dns|url|lista|ativo|fora|trava|conex/i,
    resumir: (j) => dados(j).map((s) => `servidor ${semEmoji(s.name)}: tipo ${s.type}, ${s.status}, ${(s.packages || []).length} pacotes`) },
  { id: 'lista_padrao', rota: '/api/default-playlist-templates', titulo: 'Modelo de lista/servidor padrão', palavras: /servidor|dns|url|lista|app|entrar|login/i,
    resumir: (j) => dados(j).map((t) => `${semEmoji(t.name)}: servidor/DNS ${t.dns}; tipo ${t.connection_type}`) },
  { id: 'integracoes', rota: '/api/integrations', titulo: 'Integrações disponíveis no painel', palavras: /whats|bot|integra|mensagem|autom|pagamento|mercado|pix/i,
    resumir: (j) => dados(j).map((x) => semEmoji(x.display_title || x.title) + ' (' + semEmoji(x.category_label || x.category) + ')') },
  { id: 'revendedores_total', rota: '/api/resellers?per_page=1', titulo: 'Quantos revendedores existem (só o total)', palavras: /quantos|revend|confian|cliente|tamanho|empresa|seguro/i,
    resumir: (j) => [`total de revendedores cadastrados: ${j?.meta?.total ?? '?'}`] },
  { id: 'publico', rota: '/api/settings/public', titulo: 'Configuração pública do painel', palavras: /moeda|real|suporte|ticket|m[ií]nimo|criar|nome/i,
    resumir: (j) => dados(j).filter((s) => /^(site_name|currency|locale|server_timezone|minimum_credits_to_create_reseller|enable_support_ticket|username_format)$/.test(s.variable)).map((s) => `${s.variable} = ${s.value}`) },
];

const CACHE_FATOS = path.join(PASTA_LAC, 'painel-cache.json');

// Devolve { ok, obtido_em, do_cache, fatos:[{id, fonte, titulo, linhas}], erro }. Uma sessão do Chrome para todas as fontes.
export async function fatosDoPainel({ cacheMin = 180, forcar = false } = {}) {
  try {
    const c = JSON.parse(fs.readFileSync(CACHE_FATOS, 'utf8'));
    if (!forcar && c.fatos?.length && Date.now() - Date.parse(c.obtido_em) < cacheMin * 60e3) return { ...c, do_cache: true };
  } catch {}
  let s;
  try { s = await sessao(); } catch (e) { return { ok: false, obtido_em: new Date().toISOString(), fatos: [], erro: String(e.message || e).slice(0, 300) }; }
  try {
    const fatos = [];
    const res = await Promise.all(CATALOGO.map((f) => get(s.page, f.rota).then((r) => ({ f, r })).catch((e) => ({ f, r: { status: 0, json: null, texto: String(e.message) } }))));
    for (const { f, r } of res) {
      const fonte = f.rota.replace(/\?.*/, '');
      if (r.status !== 200 || !r.json) { fatos.push({ id: f.id, fonte, titulo: f.titulo, linhas: [], erro: 'HTTP ' + r.status }); continue; }
      let linhas = []; try { linhas = f.resumir(r.json).map((l) => String(l).slice(0, 500)).slice(0, 40); } catch {}
      fatos.push({ id: f.id, fonte, titulo: f.titulo, linhas });
    }
    const out = { ok: fatos.some((x) => x.linhas.length), obtido_em: new Date().toISOString(), do_cache: false, fatos, escritas_bloqueadas: s.bloqueados.filter((b) => !/cdn-cgi/.test(b)).length };
    if (out.ok) fs.writeFileSync(CACHE_FATOS, JSON.stringify(out, null, 1));
    return out;
  } finally { await s.fechar(); }
}

// Escolhe as fontes relevantes à pergunta (as de núcleo sempre vão) para o dossiê ficar curto.
const NUCLEO = ['mensalista', 'link_cadastro', 'preco_creditos', 'pacotes'];
export function fatosRelevantes(fatos, pergunta, maxChars = 9000) {
  const q = String(pergunta || '');
  const por = new Map(CATALOGO.map((c) => [c.id, c]));
  const esc = fatos.filter((f) => f.linhas?.length && (NUCLEO.includes(f.id) || por.get(f.id)?.palavras.test(q)));
  let txt = ''; const usados = [];
  for (const f of esc) { const bloco = `### ${f.titulo} [fonte: ${f.fonte}]\n${f.linhas.map((l) => '- ' + l).join('\n')}\n\n`; if (txt.length + bloco.length > maxChars) break; txt += bloco; usados.push(f.id); }
  return { texto: txt.trim(), usados };
}

// ---------- mapa do painel ----------
// Só abre páginas da lista por URL (GET). Páginas com dados pessoais ou que alteram o painel NÃO são abertas.
const ROTAS = [
  ['dashboard', 'Dashboard', 'Resumo do dia: usuários online, vencimento, atalhos'], ['feed', 'Feed', 'Movimento do dia (novos clientes, testes, créditos)'],
  ['notices', 'Avisos', 'Avisos publicados para os revendedores'], ['system/notices', 'Avisos (cadastro)', 'Lista dos avisos com período de exibição'],
  ['credit-purchase', 'Comprar Créditos', 'Pacotes de crédito e preço por faixa para compra avulsa'], ['system/packages', 'Planos', 'Pacotes (1, 3, 6 meses, testes) e créditos que cada um custa'],
  ['system/packages-price', 'Planos (Preço)', 'Preço de cada pacote'], ['system/credit-packages', 'Pacote de Créditos', 'Pacotes de crédito à venda'],
  ['system/credit-packages-price', 'Pacote de Créditos (Preço)', 'Preço por unidade de cada pacote de crédito'], ['system/membership-plans', 'Planos Mensalista', 'Planos de cobrança mensal por cliente ativo (dia 5)'],
  ['customers/coupons', 'Cupons de Desconto', 'Cupons dos clientes finais'], ['resellers/referral-link', 'Link de Indicação', 'Link de cadastro de revendedor: modelo de cobrança, créditos iniciais, visitas e cadastros'],
  ['resellers/dns', 'DNS dos revendas', 'DNS/servidor por revenda'], ['settings/resellers', 'Configurações · Revendas', 'Regras gerais para revendedores'], ['settings/customers', 'Configurações · Clientes', 'Regras gerais para clientes finais'],
  ['settings/general', 'Configurações · Geral', 'Nome, moeda, fuso, idioma'], ['automation/botbot-automatic-test', 'Teste Automático', 'Teste automático pelo BotBot'], ['content', 'Novos Conteúdos', 'Catálogo de conteúdos novos (sem API de listagem)'],
  ['server-statistics', 'Estatísticas dos Servidores', 'Clientes por servidor'], ['changelog', 'Novidades', 'Versões do painel'], ['billing/credit-orders', 'Vendas de Créditos', 'Pedidos de compra de crédito (nomes não lidos)'],
  ['messaging', 'Central de Mensagens', 'Fila de mensagens do BotBot'], ['chatbot', 'ChatBot', 'Chatbot do painel'], ['integrations', 'Integrações', 'BotBot e outras'],
  ['system/default-playlist-template', 'Template de Playlist Padrão', 'Servidor/DNS e texto de boas-vindas padrão'], ['resellers/content-requests', 'Solicitações de conteúdo', 'Pedidos de filmes e séries dos revendedores'],
];
const NAO_LIDAS = [
  ['customers', 'Clientes', 'lista de clientes finais com usuário, vencimento e contato'], ['resellers', 'Revendas', 'lista de revendedores com contato'],
  ['resellers/credit-transactions', 'Transações de Créditos', 'movimentos por usuário'], ['resellers/sign-in-logs', 'Histórico de Logins', 'IPs e horários'],
  ['active-sessions', 'Sessões Ativas', 'dispositivos logados'], ['account-security', 'Segurança da Conta', 'dados da conta do senhor'], ['account-settings', 'Perfil', 'dados da conta do senhor'],
  ['customers/audit', 'Auditoria Clientes', 'dados pessoais'], ['resellers/audit', 'Auditoria Revendas', 'dados pessoais'], ['system/audit', 'Auditoria do Sistema', 'dados pessoais'],
  ['customers/deleted', 'Clientes excluídos', 'dados pessoais'], ['resellers/deleted', 'Revendas excluídas', 'dados pessoais'], ['customers/live-connections', 'Conexões ao vivo', 'IPs'],
  ['unban-ip-address', 'Desbloquear IP', 'altera o painel'], ['customers/add', 'Adicionar cliente', 'cria cliente (gasta crédito)'], ['sign-out', 'Sair', 'encerra a sessão'], ['notifications', 'Notificações', 'marca como lida'],
];

export async function mapearPainel() {
  const s = await sessao();
  try {
    const rotas = []; let atual = null; const vistos = new Map();
    s.page.on('response', (r) => { try { const rq = r.request(); const u = new URL(r.url()); if (atual && u.pathname.startsWith('/api/') && rq.method() === 'GET') vistos.get(atual).add(u.pathname.replace(/\/[A-Za-z0-9]{10}(?=\/|$)/g, '/{id}')); } catch {} });
    const usadas = new Set(CATALOGO.map((c) => c.rota.replace(/\?.*/, '')));
    for (const [rota, titulo, mostra] of ROTAS) {
      atual = rota; vistos.set(rota, new Set());
      await s.page.goto(PAINEL + '#/' + rota, { waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {});
      await espera(1200);
      const api = [...vistos.get(rota)].filter((p) => !/\/(auth\/me|settings\/public)$/.test(p)).sort();
      rotas.push({ pagina: '#/' + rota, titulo, mostra, api_de_leitura: api, lida_pelo_agente: api.some((p) => usadas.has(p)) });
    }
    for (const [rota, titulo, motivo] of NAO_LIDAS) rotas.push({ pagina: '#/' + rota, titulo, mostra: motivo, api_de_leitura: [], lida_pelo_agente: false, nao_aberta: true, motivo: 'dados pessoais ou altera o painel' });
    const mapa = {
      gerado_em: new Date().toISOString(), painel: 'painel.capyplay.site (Sigma)', conta: 'conta mestre, só leitura',
      como_le: 'GET em /api/* pela sessão do Chrome do robô (cópia mínima do perfil); POST/PUT/PATCH/DELETE são abortados no navegador',
      escritas_bloqueadas: s.bloqueados.filter((b) => !/cdn-cgi/.test(b)),
      fontes_do_agente: CATALOGO.map((c) => ({ id: c.id, rota: c.rota.replace(/\?.*/, ''), titulo: c.titulo })), rotas,
    };
    fs.writeFileSync(path.join(PASTA_LAC, 'mapa-do-painel.json'), JSON.stringify(mapa, null, 1));
    return mapa;
  } finally { await s.fechar(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv[2];
  if (a === '--mapear') mapearPainel().then((m) => { console.log(JSON.stringify({ ok: true, paginas: m.rotas.length, abertas: m.rotas.filter((r) => !r.nao_aberta).length, escritas_bloqueadas: m.escritas_bloqueadas.length })); process.exit(0); }).catch((e) => { console.log(JSON.stringify({ ok: false, erro: String(e.message || e) })); process.exit(1); });
  else if (a === '--fatos') fatosDoPainel({ forcar: true }).then((r) => { console.log(JSON.stringify({ ok: r.ok, fontes: (r.fatos || []).map((f) => f.id + ':' + f.linhas.length), erro: r.erro || null })); process.exit(0); });
  else console.log('uso: node painel-fatos.mjs --mapear | --fatos');
}
