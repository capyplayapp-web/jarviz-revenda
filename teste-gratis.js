// teste-gratis.js — gera TESTE GRÁTIS (Teste Rápido de 6 h) no painel CapyPlay, sem a API paga.
//
// Uso no robô:
//   const { criarTeste } = require('./teste-gratis');
//   const r = await criarTeste({ nome: 'Fulano', telefone: '5511999999999' });
//   // r = { ok, usuario, senha, validade, extras, erro }
//
// Como funciona:
//  - Abre o Chrome instalado com o perfil PRÓPRIO do robô (pasta perfil-painel), janela fora
//    da tela (o Cloudflare barra headless). A sessão do painel fica guardada nesse perfil.
//  - Dentro da página logada, faz as mesmas chamadas que o botão "Teste Rápido" do Dashboard faz:
//      GET  /api/servers                       → acha o pacote de teste (is_trial=YES, credits=0)
//      POST /api/customers {server_id, package_id, trial_hours, connections:1}
//      GET  /api/customers/{id}                → usuário, senha, vencimento, M3U, link de renovação
//      GET  /api/customers/{id}/playlist       → mensagem de boas-vindas (apps, códigos, webplayer)
//    Autenticação = o token de sessão que o próprio painel guarda no localStorage.
//  - Recusa pacote que custe crédito. Fila: um teste por vez. Trava: 1 teste por telefone / 30 dias.
//
// Login (uma vez, ou quando a sessão cair):  node teste-gratis.js --login
// Diagnóstico (só leitura):                   node teste-gratis.js --diag
//
// Ajustes por variável de ambiente:
//   TESTE_OPCAO       nome do pacote de teste (padrão "TESTE COMPLETO SEM ADULTO")
//   TESTE_DIAS_ENTRE  dias entre testes do mesmo número (padrão 30; 0 desliga)
// Nunca imprime senha do painel nem token.

'use strict';
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const PAINEL = 'https://painel.capyplay.site/';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PERFIL = path.join(__dirname, 'perfil-painel');
const REGISTRO = path.join(__dirname, 'testes-gerados.json');
const OPCAO = process.env.TESTE_OPCAO || 'TESTE COMPLETO SEM ADULTO';
// 08/11/2026 (pedido do senhor): quem já teve teste que venceu pode pedir outro. O teste dura 6 h; intervalo mínimo de 12 h entre testes do mesmo número e no máximo 3 testes a cada 30 dias.
const DIAS_ENTRE = Number(process.env.TESTE_DIAS_ENTRE ?? 0.5);
const MAX_TESTES_30D = Number(process.env.TESTE_MAX_30D ?? 3);
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- fila (um navegador por vez) ----------
let fila = Promise.resolve();
function naFila(fn) {
  const p = fila.then(fn, fn);
  fila = p.catch(() => {});
  return p;
}

// ---------- registro por telefone ----------
const soDigitos = (t) => String(t || '').replace(/\D/g, '');
function lerRegistro() { try { return JSON.parse(fs.readFileSync(REGISTRO, 'utf8')); } catch { return {}; } }
function gravarRegistro(r) { try { fs.writeFileSync(REGISTRO, JSON.stringify(r, null, 2)); } catch {} }

// ---------- navegador ----------
async function abrir({ visivel = false } = {}) {
  const args = visivel
    ? ['--window-size=1280,860']
    : ['--window-position=-2400,-2400', '--window-size=1280,860', '--start-minimized'];
  const browser = await puppeteer.launch({
    headless: false, executablePath: CHROME, userDataDir: PERFIL,
    args: [...args, '--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation'],
    defaultViewport: null,
  });
  const page = (await browser.pages())[0] || (await browser.newPage());
  page.setDefaultTimeout(30000);
  return { browser, page };
}

// abre o Dashboard e espera o Cloudflare + a sessão da SPA
async function irParaDashboard(page) {
  await page.goto(PAINEL + '#/dashboard', { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
  for (let i = 0; i < 40; i++) {
    const e = await page.evaluate(() => ({
      url: location.href, titulo: document.title,
      login: !!document.querySelector('input[name="password"]'),
      token: !!localStorage.getItem('token'),
    })).catch(() => null);
    if (e) {
      if (e.login || e.url.includes('/sign-in')) return 'login';
      if (e.token && e.url.includes('/dashboard') && !/momento|moment/i.test(e.titulo)) return 'ok';
    }
    await espera(1000);
  }
  return 'timeout';
}

// chamada à API interna do painel, de dentro da página logada
async function chamar(page, metodo, rota, corpo) {
  return page.evaluate(async (metodo, rota, corpo) => {
    const h = { Authorization: 'Bearer ' + localStorage.getItem('token'), Accept: 'application/json', Locale: 'pt' };
    if (corpo) h['Content-Type'] = 'application/json';
    const r = await fetch(rota, { method: metodo, headers: h, body: corpo ? JSON.stringify(corpo) : undefined });
    const t = await r.text();
    let json = null; try { json = JSON.parse(t); } catch {}
    return { status: r.status, json, texto: json ? null : t.slice(0, 300) };
  }, metodo, rota, corpo || null);
}

function acharCliente(o, prof = 0) {
  if (!o || typeof o !== 'object' || prof > 5) return null;
  if (typeof o.username === 'string' && 'password' in o) return o;
  for (const v of Object.values(o)) { const r = acharCliente(v, prof + 1); if (r) return r; }
  return null;
}

function msgErro(r) {
  const j = r.json || {};
  const campos = j.errors ? Object.entries(j.errors).map(([k, v]) => `${k}: ${[].concat(v).join(', ')}`).join('; ') : '';
  return `HTTP ${r.status}: ${campos || j.message || r.texto || ''}`.trim();
}

// escolhe o pacote de teste pelo nome (sem diferenciar maiúsculas/emoji) e confere que é grátis
async function acharPacote(page) {
  const r = await chamar(page, 'GET', '/api/servers');
  if (r.status !== 200) throw new Error('servidores: ' + msgErro(r));
  const pacotes = [];
  for (const s of r.json?.data || []) for (const p of s.packages || []) pacotes.push({ ...p, _server: s });
  const alvo = OPCAO.toLowerCase();
  const p = pacotes.find((x) => x.is_trial === 'YES' && x.status === 'ACTIVE' && String(x.name).toLowerCase().includes(alvo));
  if (!p) throw new Error(`sem_pacote_de_teste: não achei pacote de teste "${OPCAO}"`);
  if (Number(p.credits || 0) > 0) throw new Error(`pacote_custa_credito: "${p.name}" gasta ${p.credits} crédito(s); recusado`);
  return p;
}

function extrairDaMensagem(msg) {
  const linhas = (msg || '').split('\n');
  const apps = [];
  let app = null;
  for (const l of linhas) {
    const a = l.match(/(?:\bAPP\s*:|📺)\s*\*?([A-Z0-9][A-Z0-9 ]{2,})\*?\s*$/);
    if (a) { app = { app: a[1].trim() }; apps.push(app); continue; }
    const c = l.match(/C[ÓO]DIGO\*?:?\*?\s*\*?(\d{4,})/i);
    if (c && app && !app.codigo) app.codigo = c[1];
  }
  const links = [...new Set((msg || '').match(/https?:\/\/[^\s*)<>"']+/g) || [])];
  return { apps, links, webplayer: links.find((l) => /webplayer/i.test(l)) || null };
}

async function gerar({ nome, telefone }) {
  const fone = soDigitos(telefone);
  const vazio = { ok: false, usuario: null, senha: null, validade: null, extras: {} };

  if (DIAS_ENTRE > 0 && fone) {
    const ultimo = lerRegistro()[fone];
    if (ultimo && Date.now() - Date.parse(ultimo.criado_em) < DIAS_ENTRE * 864e5) {
      return { ...vazio, erro: `ja_teve_teste: este número já recebeu teste em ${ultimo.criado_em} (usuário ${ultimo.usuario})` };
    }
    const recentes = ((ultimo && ultimo.historico) || []).filter((t) => Date.now() - Date.parse(t) < 30 * 864e5);
    if (recentes.length >= MAX_TESTES_30D) {
      return { ...vazio, erro: `ja_teve_teste: este número já recebeu ${recentes.length} testes nos últimos 30 dias` };
    }
  }

  const inicio = Date.now();
  let browser;
  try {
    const n = await abrir();
    browser = n.browser; const page = n.page;
    const estado = await irParaDashboard(page);
    if (estado === 'login') return { ...vazio, erro: 'sem_sessao: o robô saiu do painel. Rode "node teste-gratis.js --login" e entre uma vez.' };
    if (estado !== 'ok') return { ...vazio, erro: 'painel_nao_carregou: Cloudflare ou painel fora do ar' };

    const pacote = await acharPacote(page);
    const horas = pacote.duration_in === 'HOURS' ? Number(pacote.duration) || 6 : 6;

    // mesmo corpo que o botão Teste Rápido envia
    const cr = await chamar(page, 'POST', '/api/customers', {
      server_id: pacote.server_id, package_id: pacote.id, trial_hours: horas, connections: 1,
    });
    if (cr.status !== 200 && cr.status !== 201) return { ...vazio, erro: 'falhou_criar: ' + msgErro(cr) };
    let c = acharCliente(cr.json) || cr.json?.data || cr.json || {};
    const id = c.id;
    if (id) {
      const det = await chamar(page, 'GET', `/api/customers/${id}`);
      const d = acharCliente(det.json);
      if (d) c = { ...c, ...d };
    }
    if (!c.username || !c.password) return { ...vazio, erro: 'falhou_ler: teste criado mas sem usuário/senha na resposta', extras: { id: id || null } };

    let mensagem = null;
    if (id) {
      const pl = await chamar(page, 'GET', `/api/customers/${id}/playlist`);
      const lista = Array.isArray(pl.json) ? pl.json : (pl.json?.data || []);
      const pt = lista.find((x) => /^pt/i.test(x.key)) || null;
      if (pt && pt.template && !/não configurou um template/i.test(pt.template)) mensagem = pt.template;
    }

    let dns = null;
    try { dns = c.m3u_url ? new URL(c.m3u_url).origin : null; } catch {}
    const doTexto = extrairDaMensagem(mensagem);

    const saida = {
      ok: true,
      usuario: c.username,
      senha: c.password,
      validade: c.expires_at || null,                 // UTC (ISO)
      extras: {
        id: id || null,
        validade_brasilia: c.expires_at_tz || null,   // horário do painel
        horas,
        pacote: c.package || pacote.name,
        servidor: c.server || pacote._server?.name || null,
        dns,
        m3u: c.m3u_url || null,
        m3u_curto: c.m3u_url_short || null,
        renovar: c.renew_url || null,
        apps: doTexto.apps,
        webplayer: doTexto.webplayer,
        links: doTexto.links,
        mensagem,                                     // boas-vindas pronta do painel (apps, códigos, webplayer)
        nome_informado: nome || null,
        telefone: fone || null,
        segundos: Math.round((Date.now() - inicio) / 1000),
      },
      erro: null,
    };

    if (fone) {
      const reg = lerRegistro();
      const antes = (reg[fone] && (reg[fone].historico || [reg[fone].criado_em])) || [];
      reg[fone] = { criado_em: new Date().toISOString(), usuario: saida.usuario, id: saida.extras.id, nome: nome || null, historico: [...antes, new Date().toISOString()].slice(-10) };
      gravarRegistro(reg);
    }
    return saida;
  } catch (e) {
    return { ...vazio, erro: 'falhou: ' + (e.message || String(e)) };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

function criarTeste(dados = {}) { return naFila(() => gerar(dados)); }

// login manual, uma vez: Chrome COMUM (sem controle de robô), só com o perfil do robô,
// porque o captcha do painel recusa navegador automatizado. O senhor entra e fecha a janela.
async function loginManual() {
  const { spawn } = require('child_process');
  console.log('Entre no painel na janela que abriu (marque "lembrar"). Depois de ver o Dashboard, feche a janela.');
  await new Promise((ok) => {
    const p = spawn(CHROME, [`--user-data-dir=${PERFIL}`, '--no-first-run', '--new-window', PAINEL + '#/dashboard'], { stdio: 'ignore' });
    p.on('exit', ok);
  });
  console.log('Janela fechada. Conferindo a sessão...');
  const d = await diagnostico();
  console.log(d.ok ? 'Login guardado no perfil do robô.' : 'Ainda sem sessão: ' + JSON.stringify(d));
  return d.ok;
}

// só LÊ: confere a sessão, o saldo e os pacotes de teste disponíveis
async function diagnostico() {
  return naFila(async () => {
    const { browser, page } = await abrir();
    try {
      const estado = await irParaDashboard(page);
      if (estado !== 'ok') return { ok: false, estado };
      const me = await chamar(page, 'GET', '/api/auth/me');
      const sv = await chamar(page, 'GET', '/api/servers');
      const testes = [];
      for (const s of sv.json?.data || []) for (const p of s.packages || []) {
        if (p.is_trial === 'YES') testes.push({ nome: p.name, servidor: s.name, creditos: p.credits, duracao: `${p.duration} ${p.duration_in}`, status: p.status });
      }
      const creditos = await page.evaluate(() => document.body.innerText.split('\n').map((l) => l.trim()).filter((l) => /cr[eé]ditos ilimitados|saldo/i.test(l)).slice(0, 3));
      return { ok: true, estado, conta: me.json?.username || null, creditos, pacotes_de_teste: testes };
    } finally { await browser.close().catch(() => {}); }
  });
}

module.exports = { criarTeste, diagnostico, loginManual, naFila, abrir, irParaDashboard, chamar };

if (require.main === module) {
  if (process.argv.includes('--login')) loginManual().then(() => process.exit(0));
  else if (process.argv.includes('--diag')) diagnostico().then((r) => { console.log(JSON.stringify(r, null, 2)); process.exit(0); });
}
