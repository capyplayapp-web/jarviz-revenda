// painel-leitura.mjs — leitura (SOMENTE GET) do painel painel.capyplay.site para o agente das lacunas.
//
// Por que existe: painel-revendedores.js e teste-gratis.js abrem o Chrome com o perfil `perfil-painel`, que o bot usa
// (teste grátis, sincronizar painéis). Duas instâncias do Chrome no mesmo perfil brigam e o teste de um cliente pode falhar.
// Então o agente trabalha numa CÓPIA mínima do perfil (só login/sessão): `lacunas\perfil-copia`. O perfil do bot nunca é aberto.
//
// Regras: só GET; nunca clica em botão; nunca imprime nem grava token/senha; dados de cliente viram primeiro nome.
// O painel é do tipo SPA (Vue/Laravel): a sessão está no localStorage ("token") e a API fica em /api/*.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
export const PERFIL_ORIG = path.join(AQUI, 'perfil-painel');
export const PASTA_LAC = path.join(AQUI, 'lacunas');
export const PERFIL_COPIA = path.join(PASTA_LAC, 'perfil-copia');
const TRAVA = path.join(PASTA_LAC, '.painel.trava');
const PAINEL = 'https://painel.capyplay.site/';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- limpeza: nada de senha, token, telefone, e-mail ----------
const CHAVES_SECRETAS = /pass(word)?|senha|token|secret|authorization|api[_-]?key|m3u|playlist_url|renew_url|whatsapp|phone|telefone|e-?mail|cpf|document|^ip$|last_ip/i;
export function limpar(v, prof = 0) {
  if (prof > 8) return null;
  if (Array.isArray(v)) return v.slice(0, 200).map((x) => limpar(x, prof + 1));
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) {
      if (CHAVES_SECRETAS.test(k)) continue;
      if (/^(username|customer_name|reseller_name|client_name)$/i.test(k) && typeof x === 'string') { o[k] = primeiroNome(x); continue; }
      o[k] = limpar(x, prof + 1);
    }
    return o;
  }
  if (typeof v === 'string') return v.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[e-mail]').replace(/\b\d{9,}\b/g, '[número]').slice(0, 2000);
  return v;
}
export const primeiroNome = (n) => String(n || '').trim().split(/\s+/)[0] || '';

// ---------- trava entre processos (uma leitura do painel por vez) ----------
export async function pegarTrava(maxEsperaMs = 120000) {
  fs.mkdirSync(PASTA_LAC, { recursive: true });
  const fim = Date.now() + maxEsperaMs;
  while (true) {
    try {
      const fd = fs.openSync(TRAVA, 'wx'); fs.writeSync(fd, JSON.stringify({ pid: process.pid, t: Date.now() })); fs.closeSync(fd);
      return () => { try { fs.unlinkSync(TRAVA); } catch {} };
    } catch {
      let velha = true;
      try { const d = JSON.parse(fs.readFileSync(TRAVA, 'utf8')); velha = Date.now() - d.t > 10 * 60e3; } catch {}
      if (velha) { try { fs.unlinkSync(TRAVA); } catch {} continue; }
      if (Date.now() > fim) throw new Error('painel_ocupado: outra leitura do painel está em andamento');
      await espera(2000);
    }
  }
}

// ---------- cópia mínima do perfil (sessão) ----------
export function copiarPerfil() {
  if (!fs.existsSync(PERFIL_ORIG)) throw new Error('sem_sessao: pasta perfil-painel não existe (rode node teste-gratis.js --login)');
  fs.rmSync(PERFIL_COPIA, { recursive: true, force: true });
  fs.mkdirSync(path.join(PERFIL_COPIA, 'Default'), { recursive: true });
  const falhas = [];
  const cp = (rel) => {
    const de = path.join(PERFIL_ORIG, rel), para = path.join(PERFIL_COPIA, rel);
    if (!fs.existsSync(de)) return;
    try { fs.cpSync(de, para, { recursive: true, filter: (s) => !/LOCK$|\.tmp$/i.test(s) }); } catch (e) { falhas.push(rel + ': ' + e.code); }
  };
  ['Local State', 'Default/Preferences', 'Default/Secure Preferences', 'Default/Local Storage', 'Default/Session Storage',
    'Default/Network', 'Default/IndexedDB', 'Default/WebStorage', 'Default/Storage'].forEach(cp);
  return falhas;
}

// ---------- navegador ----------
export async function abrir({ visivel = false } = {}) {
  const puppeteer = require('puppeteer');                  // do node_modules do robô
  const args = visivel ? ['--window-size=1280,860'] : ['--window-position=-2400,-2400', '--window-size=1280,860', '--start-minimized'];
  const browser = await puppeteer.launch({
    headless: false, executablePath: CHROME, userDataDir: PERFIL_COPIA,
    args: [...args, '--disable-blink-features=AutomationControlled'], ignoreDefaultArgs: ['--enable-automation'], defaultViewport: null,
  });
  const page = (await browser.pages())[0] || (await browser.newPage());
  page.setDefaultTimeout(30000);
  return { browser, page };
}

export async function irParaDashboard(page) {
  await page.goto(PAINEL + '#/dashboard', { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
  for (let i = 0; i < 40; i++) {
    const e = await page.evaluate(() => ({ url: location.href, titulo: document.title, login: !!document.querySelector('input[name="password"]'), token: !!localStorage.getItem('token') })).catch(() => null);
    if (e) {
      if (e.login || e.url.includes('/sign-in')) return 'login';
      if (e.token && e.url.includes('/dashboard') && !/momento|moment/i.test(e.titulo)) return 'ok';
    }
    await espera(1000);
  }
  return 'timeout';
}

// GET dentro da página logada. Qualquer outro método é recusado aqui (garantia de somente leitura).
export async function get(page, rota) {
  if (!/^\/api\/[\w\-./?=&%,:\[\]]*$/.test(rota) || rota.includes('..')) throw new Error('rota recusada: ' + rota);
  return page.evaluate(async (rota) => {
    const h = { Authorization: 'Bearer ' + localStorage.getItem('token'), Accept: 'application/json', Locale: 'pt' };
    const r = await fetch(rota, { method: 'GET', headers: h });
    const t = await r.text(); let json = null; try { json = JSON.parse(t); } catch {}
    return { status: r.status, json, texto: json ? null : t.slice(0, 300) };
  }, rota);
}

// Abre uma sessão de leitura: trava, copia o perfil, abre o Chrome, confere o login. Devolve { page, fechar }.
export async function sessao() {
  const soltar = await pegarTrava();
  let browser;
  try {
    const falhas = copiarPerfil();
    const n = await abrir(); browser = n.browser;
    const estado = await irParaDashboard(n.page);
    if (estado === 'login') throw new Error('sem_sessao: o painel pediu login. O senhor precisa rodar "node teste-gratis.js --login", entrar e fechar a janela.');
    if (estado !== 'ok') throw new Error('painel_nao_carregou: ' + estado + (falhas.length ? ' (cópia do perfil falhou em: ' + falhas.join(', ') + ')' : ''));
    // Trava dura de somente leitura: qualquer POST/PUT/PATCH/DELETE para o painel é abortado antes de sair do navegador.
    const bloqueados = [];
    await n.page.setRequestInterception(true);
    n.page.on('request', (rq) => {
      const m = rq.method();
      if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS' && /painel\.capyplay\.site/.test(rq.url())) { bloqueados.push(m + ' ' + new URL(rq.url()).pathname); return rq.abort('blockedbyclient').catch(() => {}); }
      rq.continue().catch(() => {});
    });
    return { page: n.page, bloqueados, fechar: async () => { await browser.close().catch(() => {}); await espera(500); try { fs.rmSync(PERFIL_COPIA, { recursive: true, force: true }); } catch {} soltar(); } };
  } catch (e) { if (browser) await browser.close().catch(() => {}); soltar(); throw e; }
}
