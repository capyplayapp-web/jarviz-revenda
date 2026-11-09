// Relatórios do robô da revenda CapyPlay (versão celular), em subdomínio escondido de copythief.men.
// O PC do senhor só ENVIA (sem porta aberta): PUT /sync/snapshot, POST /sync/vivo, GET /sync/comandos, POST /sync/resultado.
// O celular entra com senha (cookie assinado) e lê o último snapshot; botões viram comandos na fila (KV).
// Segredos (wrangler secret): SENHA, SESSAO_SEGREDO, SYNC_TOKEN. KV: RELATORIOS. Contrato: CONTRATO.md.

const DIA = 86400;
const SESSAO_DIAS = 30;
const ATRASO_SNAPSHOT_MS = 5 * 60 * 1000;      // acima disso o snapshot é "desatualizado"
const MIN_ENTRE_ESCRITAS_MS = 60 * 1000;       // proteção da cota do KV (escrita normal; o PC já respeita 75 s)
const MIN_ENTRE_ESCRITAS_FORCADO_MS = 30 * 1000; // logo depois de um comando executado
const CMD_TIPOS = ['reanalisar', 'aprender', 'ping'];
const CMD_REPETE_MS = 5 * 60 * 1000;           // comando pendente há mais que isso pode ser refeito
const CMD_EXPIRA_MS = 10 * 60 * 1000;          // pendente há mais que isso aparece como expirado
// 09/11/2026: todas as abas do PC. Chaves aceitas no snapshot e botões que viram pedido na fila (mesma lista em sync-nuvem.mjs).
const CHAVES = ['resumo1', 'resumo7', 'pendentes', 'revendedores', 'grafo1', 'grafo7', 'trafego1', 'trafego7', 'trafego30',
  'escritorio1', 'escritorio7', 'funil1', 'funil7', 'jornada', 'etiquetas', 'followups1', 'followups7', 'backlog',
  'uso1', 'uso7', 'lacunas', 'releitura', 'versoes', 'voz'];
const ACOES = ['/api/funil/pausar', '/api/funil/retomar', '/api/funil/reaquecer', '/api/funil/jogadas',
  '/api/jornada/pausar', '/api/jornada/retomar', '/api/jornada/tocar', '/api/releitura', '/api/voz',
  '/api/backlog/mapear', '/api/backlog/pausar', '/api/backlog/retomar'];
const UM_OU_SETE = { '/api/escritorio': 'escritorio', '/api/funil': 'funil', '/api/followups': 'followups', '/api/uso': 'uso' };
const DIRETOS = { '/api/jornada': 'jornada', '/api/etiquetas': 'etiquetas', '/api/backlog': 'backlog', '/api/lacunas': 'lacunas', '/api/releitura': 'releitura', '/api/versoes': 'versoes', '/api/voz': 'voz' };
const PUBLICOS_PREFIXOS =['/fontes/', '/icones/', '/icons/'];
const PUBLICOS_EXATOS = ['/manifest.webmanifest', '/manifest.json', '/sw.js', '/favicon.ico', '/apple-touch-icon.png'];

const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

function seguranca(res, { dados = false, cache = null } = {}) {
  const h = new Headers(res.headers);
  h.set('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
  h.set('Content-Security-Policy', CSP);
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('X-Frame-Options', 'DENY');
  h.set('Referrer-Policy', 'no-referrer');
  h.set('Strict-Transport-Security', 'max-age=31536000');
  h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (dados) h.set('Cache-Control', (h.get('content-type') || '').startsWith('text/html') ? 'no-store, no-transform' : 'no-store');   // no-transform: o Cloudflare não injeta o script de analytics (a CSP já o bloquearia)
  else if (cache) h.set('Cache-Control', cache);
  else if (!h.has('Cache-Control')) h.set('Cache-Control', 'private, no-cache');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}
const json = (obj, status = 200, extra = {}) => seguranca(new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...extra } }), { dados: true });

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function sha256(s) { return new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s))); }
async function iguais(a, b) {                                      // tempo constante (compara os hashes)
  const [x, y] = await Promise.all([sha256(String(a)), sha256(String(b))]);
  let d = 0; for (let i = 0; i < 32; i++) d |= x[i] ^ y[i];
  return d === 0;
}
async function hmac(chave, msg) {
  const k = await crypto.subtle.importKey('raw', enc.encode(chave), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, enc.encode(msg)));
}
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const ip = (req) => req.headers.get('CF-Connecting-IP') || 'desconhecido';
const normalizaSenha = (s) => String(s || '').replace(/\s+/g, '');

// O no-transform (que impede o Cloudflare de injetar script de analytics) também desliga a compressão automática dele.
// No Workers, declarar Content-Encoding num corpo puro faz o próprio runtime comprimir (encodeBody automático): não comprimir à mão (daria codificação dupla).
function gz(req, res) {
  const ae = (req.cf && req.cf.clientAcceptEncoding) || '';
  const enc = ae.includes('gzip') ? 'gzip' : '';   // o runtime só codifica corpo declarado como gzip; o edge não comprime com no-transform
  if (!enc || !res.body || res.headers.has('Content-Encoding') || req.method === 'HEAD') return res;
  const h = new Headers(res.headers); h.set('Content-Encoding', enc); h.delete('Content-Length'); h.append('Vary', 'Accept-Encoding');
  return new Response(res.body, { status: res.status, headers: h });
}

// ---------- sessão ----------
async function assinar(env, exp, nonce) { return hmac(env.SESSAO_SEGREDO, `v1.${exp}.${nonce}.${env.SENHA}`); } // trocar a senha derruba as sessões
async function criarCookie(env) {
  const exp = Math.floor(Date.now() / 1000) + SESSAO_DIAS * DIA;
  const nonce = hex(crypto.getRandomValues(new Uint8Array(12)));
  const sig = await assinar(env, exp, nonce);
  return `__Host-rv=${exp}.${nonce}.${sig}; Max-Age=${SESSAO_DIAS * DIA}; Path=/; HttpOnly; Secure; SameSite=Strict`;
}
const COOKIE_LIMPO = '__Host-rv=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict';
async function sessaoValida(req, env) {
  const c = (req.headers.get('Cookie') || '').split(/;\s*/).find((x) => x.startsWith('__Host-rv='));
  if (!c) return false;
  const [exp, nonce, sig] = c.slice(10).split('.');
  if (!exp || !nonce || !sig || !/^\d+$/.test(exp) || Number(exp) < Date.now() / 1000) return false;
  return iguais(await assinar(env, exp, nonce), sig);
}
function origemOk(req) {                                           // defesa extra além do SameSite=Strict
  const o = req.headers.get('Origin');
  const s = req.headers.get('Sec-Fetch-Site');
  // Com Referrer-Policy: no-referrer o Safari/Chrome mandam "Origin: null" no POST do formulário (mesma origem).
  // Nesse caso vale o Sec-Fetch-Site; sem ele, o cookie SameSite=Strict já barra o pedido de outro site.
  if (o && o !== 'null') { try { return new URL(o).host === new URL(req.url).host; } catch { return false; } }
  return !s || s === 'same-origin' || s === 'none';
}

// ---------- KV ----------
const kvGet = (env, k) => env.RELATORIOS.get(k, 'json');
const kvPut = (env, k, v, opc) => env.RELATORIOS.put(k, JSON.stringify(v), opc);

// ---------- login ----------
function paginaLogin(erro = '', status = 200, extra = {}) {
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="color-scheme" content="dark"><meta name="theme-color" content="#121214"><meta name="robots" content="noindex,nofollow,noarchive"><title>Entrar</title>
<link rel="preload" href="/fontes/inter.woff2" as="font" type="font/woff2" crossorigin>
<style>
@font-face{font-family:Inter;src:url(/fontes/inter.woff2) format("woff2");font-weight:100 900;font-display:swap}
:root{--fundo:#121214;--painel:#1c1c1f;--linha:rgba(255,255,255,.1);--texto:#f5f5f7;--suave:#a1a1a6;--ciano:#5be7ff;--azul:#00c7ff;--erro:#ff7a70}
*{box-sizing:border-box}html,body{height:100%;margin:0}
body{background:var(--fundo);color:var(--texto);font:16px/1.4 Inter,-apple-system,system-ui,sans-serif;display:grid;place-items:center;padding:max(16px,env(safe-area-inset-top)) 16px max(16px,env(safe-area-inset-bottom));-webkit-font-smoothing:antialiased}
main{width:100%;max-width:360px}
.marca{width:44px;height:44px;border-radius:12px;background:#0b0b0c;display:grid;place-items:center;margin:0 0 20px;box-shadow:inset 0 0 0 1px var(--linha)}
h1{font-size:26px;line-height:1.15;letter-spacing:-.02em;margin:0 0 6px;font-weight:650}
p{margin:0 0 22px;color:var(--suave);font-size:15px}
label{display:block;font-size:13px;color:var(--suave);margin:0 0 8px}
input{width:100%;height:52px;border-radius:14px;border:1px solid var(--linha);background:var(--painel);color:var(--texto);font:inherit;font-size:17px;padding:0 16px;outline:none;transition:border-color .2s,box-shadow .2s}
input:focus{border-color:var(--ciano);box-shadow:0 0 0 4px rgba(91,231,255,.18)}
button{margin-top:14px;width:100%;height:52px;border:0;border-radius:14px;font:inherit;font-size:17px;font-weight:600;color:#06222a;background:linear-gradient(180deg,var(--ciano),var(--azul));cursor:pointer;transition:transform .15s,filter .15s}
button:active{transform:scale(.98);filter:brightness(.94)}
.erro{margin:14px 0 0;color:var(--erro);font-size:14px;min-height:20px}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
</style></head><body><main>
<div class="marca" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 32 32" fill="none" stroke="#5be7ff" stroke-width="2.6" stroke-linecap="round"><path d="M7 22V15m6 7V9m6 13v-9m6 9V12"/></svg></div>
<h1>Atendimento da revenda</h1><p>Entre com a senha para ver os relatórios.</p>
<form method="post" action="/login" autocomplete="on">
<label for="s">Senha</label>
<input id="s" name="senha" type="password" autocomplete="current-password" autocapitalize="off" autocorrect="off" spellcheck="false" required autofocus>
<button type="submit">Entrar</button>
<div class="erro" role="alert">${erro}</div>
</form></main></body></html>`;
  return seguranca(new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...extra } }), { dados: true });
}

async function fazerLogin(req, env) {
  if (!origemOk(req)) return paginaLogin('Pedido recusado.', 403);
  const quem = ip(req);
  const rl = await env.RL.limit({ key: 'login:' + quem });
  if (!rl.success) return paginaLogin('Muitas tentativas. Espere um minuto.', 429);
  const chaveRl = 'rl:' + quem;
  const reg = (await kvGet(env, chaveRl)) || { n: 0, ate: 0 };
  const agora = Date.now();
  if (reg.ate > agora) {
    const s = Math.ceil((reg.ate - agora) / 1000);
    return paginaLogin(`Muitas tentativas. Tente de novo em ${s < 90 ? s + ' s' : Math.ceil(s / 60) + ' min'}.`, 429, { 'Retry-After': String(s) });
  }
  let senha = '';
  try { senha = normalizaSenha((await req.formData()).get('senha')); } catch {}
  const certa = senha.length > 0 && senha.length < 200 && (await iguais(senha, normalizaSenha(env.SENHA)));
  if (!certa) {
    await dormir(700);
    const n = reg.n + 1;
    const espera = n >= 3 ? Math.min(3600, 30 * 2 ** (n - 3)) : 0;  // 3ª falha 30 s, depois 60, 120... até 1 h
    await kvPut(env, chaveRl, { n, ate: espera ? agora + espera * 1000 : 0 }, { expirationTtl: DIA });
    return paginaLogin(espera ? `Senha incorreta. Tente de novo em ${espera < 90 ? espera + ' s' : Math.ceil(espera / 60) + ' min'}.` : 'Senha incorreta.', 401);
  }
  if (reg.n) await env.RELATORIOS.delete(chaveRl);
  return seguranca(new Response(null, { status: 303, headers: { Location: '/', 'Set-Cookie': await criarCookie(env), 'Cache-Control': 'no-store' } }), { dados: true });
}

// ---------- sync do PC ----------
async function bearerOk(req, env) {
  const rl = await (env.RL_SYNC || env.RL).limit({ key: 'sync:' + ip(req) });   // limite próprio do PC (fila a cada 12 s + snapshot + resultados)
  if (!rl.success) return false;
  const m = (req.headers.get('Authorization') || '').match(/^Bearer (.+)$/);
  return !!m && (await iguais(m[1], env.SYNC_TOKEN));
}
async function lerCorpo(req, max) {
  const t = await req.text();
  if (t.length > max) throw new Error('grande');
  return JSON.parse(t);
}
const idade = (em) => (em ? Math.max(0, Math.round((Date.now() - em) / 1000)) : null);
async function estadoVivo(env) {
  const [snap, vivo] = await Promise.all([kvGet(env, 'snap'), kvGet(env, 'vivo')]);
  const em = Math.max(snap?.snapshot_em || 0, vivo?.em || 0) || null;
  const ultimaEscrita = Math.max(snap?.escrita_em || 0, vivo?.escrita_em || 0) || 0;
  return { snap, vivo, em, ultimaEscrita };
}

async function sync(req, env, rota) {
  if (!(await bearerOk(req, env))) return json({ erro: 'não autorizado' }, 401);
  try {
    if (rota === '/sync/snapshot' && req.method === 'PUT') {
      // Formato novo (09/11/2026): corpo = só os dados, cru; hash em X-Hash, X-Forcar: 1. O Worker não lê nem junta o JSON de ~800 KB
      // (cabe nos 10 ms de CPU do plano grátis); o PC já manda o snapshot inteiro. Hash e hora ficam nos metadados da chave.
      const cru = await req.text();
      if (cru.length > 3000000) throw new Error('grande');
      let hash, forcar, dadosTxt;
      const hashH = req.headers.get('X-Hash');
      if (hashH) {
        if (!/^[a-f0-9]{16,128}$/i.test(hashH) || !/^\s*\{[\s\S]*\}\s*$/.test(cru)) return json({ erro: 'corpo inválido' }, 400);
        hash = hashH; forcar = req.headers.get('X-Forcar') === '1'; dadosTxt = cru;
      } else {                                                      // formato antigo {hash, dados, forcar}
        const b = JSON.parse(cru);
        if (!b || typeof b.hash !== 'string' || !b.dados || typeof b.dados !== 'object') return json({ erro: 'corpo inválido' }, 400);
        const d = {}; for (const k of CHAVES) if (b.dados[k] !== undefined) d[k] = b.dados[k];
        hash = b.hash; forcar = !!b.forcar; dadosTxt = JSON.stringify(d);
      }
      const [atual, vivo] = await Promise.all([env.RELATORIOS.getWithMetadata('snap', 'stream'), kvGet(env, 'vivo')]);
      try { atual.value && atual.value.cancel(); } catch {}
      const meta = atual.metadata || {};
      const ultimaEscrita = Math.max(meta.escrita_em || 0, vivo?.escrita_em || 0);
      const agora = Date.now();
      const minimo = forcar ? MIN_ENTRE_ESCRITAS_FORCADO_MS : MIN_ENTRE_ESCRITAS_MS;
      if (agora - ultimaEscrita < minimo) return json({ ok: true, gravou: false, motivo: 'limite' });
      if (meta.hash === hash) {                                    // nada mudou: só marca que o PC está vivo
        await kvPut(env, 'vivo', { em: agora, escrita_em: agora });
        return json({ ok: true, gravou: true, tipo: 'vivo' });
      }
      await env.RELATORIOS.put('snap', `{"hash":${JSON.stringify(hash)},"snapshot_em":${agora},"escrita_em":${agora},"dados":${dadosTxt}}`, { metadata: { hash, escrita_em: agora } });
      return json({ ok: true, gravou: true, tipo: 'snapshot' });
    }
    if (rota === '/sync/vivo' && req.method === 'POST') {
      const { ultimaEscrita } = await estadoVivo(env);
      const agora = Date.now();
      if (agora - ultimaEscrita < MIN_ENTRE_ESCRITAS_MS) return json({ ok: true, gravou: false, motivo: 'limite' });
      await kvPut(env, 'vivo', { em: agora, escrita_em: agora });
      return json({ ok: true, gravou: true, tipo: 'vivo' });
    }
    if (rota === '/sync/comandos' && req.method === 'GET') {
      const cmds = (await kvGet(env, 'cmds')) || {};
      const lista = Object.values(cmds).filter((c) => c && c.estado === 'pendente' && Date.now() - c.pedido_ms < CMD_EXPIRA_MS)
        .map((c) => ({ id: c.id, tipo: c.tipo, chave: c.chave, pedido_em: c.pedido_em, eco: c.eco, rota: c.rota, corpo: c.corpo }));
      return json({ comandos: lista, agora: new Date().toISOString() });
    }
    if (rota === '/sync/resultado' && req.method === 'POST') {
      const b = await lerCorpo(req, 40000);
      const cmds = (await kvGet(env, 'cmds')) || {};
      const ch = typeof b.chave === 'string' && b.chave ? b.chave : b.tipo;
      const c = cmds[ch];
      if (!c || c.id !== b.id) return json({ ok: true, ignorado: true });   // comando já foi substituído
      if (c.estado === 'feito') return json({ ok: true, ignorado: true });
      cmds[ch] = { ...c, estado: 'feito', feito_em: new Date().toISOString(), resultado: b.resultado ?? null };
      await kvPut(env, 'cmds', cmds);
      return json({ ok: true });
    }
  } catch (e) {
    return json({ erro: e.message === 'grande' ? 'corpo grande demais' : 'corpo inválido' }, e.message === 'grande' ? 413 : 400);
  }
  return json({ erro: 'rota desconhecida' }, 404);
}

// ---------- API do celular (com sessão) ----------
async function comArquivo(env, chave, dias) {
  const { snap, em } = await estadoVivo(env);
  if (!snap || !snap.dados || snap.dados[chave] === undefined) return json({ erro: 'sem dados ainda: o PC ainda não enviou', desatualizado: true, snapshot_em: null }, 503);
  const id = idade(em);
  return json({ ...snap.dados[chave], nuvem: true, snapshot_em: em ? new Date(em).toISOString() : null, idade_s: id, desatualizado: id === null || id * 1000 > ATRASO_SNAPSHOT_MS });
}
async function enfileirar(env, tipo, extra = {}, chave = tipo) {
  const cmds = (await kvGet(env, 'cmds')) || {};
  for (const [k, v] of Object.entries(cmds)) if (v && v.tipo === 'acao' && Date.now() - (v.pedido_ms || 0) > DIA * 1000) delete cmds[k];   // limpa botões antigos
  const atual = cmds[chave];
  if (atual && atual.estado === 'pendente' && Date.now() - atual.pedido_ms < CMD_REPETE_MS) return { ok: true, enfileirado: true, ja_pendente: true, id: atual.id, pedido_em: atual.pedido_em };
  const id = hex(crypto.getRandomValues(new Uint8Array(8)));
  const c = { id, tipo, chave, estado: 'pendente', pedido_em: new Date().toISOString(), pedido_ms: Date.now(), ...extra };
  cmds[chave] = c;
  await kvPut(env, 'cmds', cmds);
  return { ok: true, enfileirado: true, id, pedido_em: c.pedido_em };
}
async function api(req, env, url, rota) {
  const post = req.method === 'POST';
  if (post && !origemOk(req)) return json({ erro: 'pedido recusado' }, 403);
  if (rota === '/api/resumo' && req.method === 'GET') {
    const d = Number(url.searchParams.get('dias') || 1);
    if (d !== 1 && d !== 7) return json({ erro: 'dias deve ser 1 ou 7' }, 400);
    return comArquivo(env, d === 7 ? 'resumo7' : 'resumo1');
  }
  if (rota === '/api/revendedores' && req.method === 'GET') return comArquivo(env, 'revendedores');
  if (rota === '/api/pendentes' && req.method === 'GET') return comArquivo(env, 'pendentes');
  if (rota === '/api/grafo' && req.method === 'GET') return comArquivo(env, Number(url.searchParams.get('dias')) === 1 ? 'grafo1' : 'grafo7');
  if (rota === '/api/trafego' && req.method === 'GET') {            // aba Tráfego (09/11/2026)
    const d = Number(url.searchParams.get('dias') || 1);
    if (![1, 7, 30].includes(d)) return json({ erro: 'dias deve ser 1, 7 ou 30' }, 400);
    return comArquivo(env, 'trafego' + d);
  }
  if (req.method === 'GET' && UM_OU_SETE[rota]) return comArquivo(env, UM_OU_SETE[rota] + (Number(url.searchParams.get('dias')) === 7 ? '7' : '1'));
  if (rota === '/api/voz' && req.method === 'GET') {               // pedido de voz ainda na fila: mostra o modo pedido (senão o seletor "volta sozinho")
    const r = await comArquivo(env, 'voz');
    const cmds = (await kvGet(env, 'cmds')) || {};
    const pend = Object.values(cmds).filter((c) => c && c.tipo === 'acao' && c.rota === '/api/voz' && c.estado === 'pendente' && Date.now() - c.pedido_ms < CMD_EXPIRA_MS)
      .sort((a, b) => b.pedido_ms - a.pedido_ms)[0];
    if (!pend || r.status !== 200 || typeof pend.corpo?.modo !== 'string') return r;
    return json({ ...(await r.json()), modo: pend.corpo.modo, pedido_pendente: true });
  }
  if (req.method === 'GET' && DIRETOS[rota]) return comArquivo(env, DIRETOS[rota]);
  if (post && ACOES.includes(rota)) {                               // botão das abas novas: vira pedido na fila do PC
    let corpo = {}; try { corpo = await lerCorpo(req, 4000); } catch {}
    if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) corpo = {};
    const chave = 'acao:' + rota + ':' + hex(await sha256(JSON.stringify(corpo))).slice(0, 12);
    const r = await enfileirar(env, 'acao', { rota, corpo }, chave);
    if (rota === '/api/voz') {                                      // a tela da voz repinta com o que voltar: devolve o estado com o modo pedido
      const { snap } = await estadoVivo(env);
      return json({ ...(snap?.dados?.voz || {}), modo: typeof corpo.modo === 'string' ? corpo.modo : snap?.dados?.voz?.modo, ...r });
    }
    return json(rota === '/api/releitura' ? { ...r, ok: true } : r);
  }
  if (rota === '/api/ping' && req.method === 'GET') {
    const { em } = await estadoVivo(env); const id = idade(em);
    return json({ ok: true, nuvem: true, em: new Date().toISOString(), snapshot_em: em ? new Date(em).toISOString() : null, idade_s: id, desatualizado: id === null || id * 1000 > ATRASO_SNAPSHOT_MS });
  }
  if (rota === '/api/reanalisar' && post) return json(await enfileirar(env, 'reanalisar'));
  if (rota === '/api/aprender' && post) return json(await enfileirar(env, 'aprender'));
  if (rota === '/api/ping' && post) {
    let eco = ''; try { eco = String((await lerCorpo(req, 2000)).eco ?? '').slice(0, 200); } catch {}
    return json(await enfileirar(env, 'ping', { eco }));
  }
  if (rota === '/api/comando' && req.method === 'GET') {
    const tipo = url.searchParams.get('tipo');
    if (!CMD_TIPOS.includes(tipo)) return json({ erro: 'tipo desconhecido' }, 400);
    const [cmds, { em }] = await Promise.all([kvGet(env, 'cmds'), estadoVivo(env)]);
    const c = (cmds || {})[tipo];
    const pcVivo = em ? Date.now() - em <= ATRASO_SNAPSHOT_MS : false;
    if (!c) return json({ estado: 'nenhum', tipo, pc_vivo: pcVivo });
    const base = { tipo, id: c.id, pedido_em: c.pedido_em, pc_vivo: pcVivo };
    if (c.estado === 'feito') {
      const r = c.resultado && typeof c.resultado === 'object' ? c.resultado : { valor: c.resultado };
      return json({ ...r, ...base, estado: 'feito', feito_em: c.feito_em });
    }
    return json({ ...base, estado: Date.now() - c.pedido_ms > CMD_EXPIRA_MS ? 'expirado' : 'pendente' });
  }
  return json({ erro: 'rota desconhecida' }, 404);
}

// ---------- entrada ----------
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const rota = url.pathname;
    if (url.protocol === 'http:') { url.protocol = 'https:'; return new Response(null, { status: 301, headers: { Location: url.toString(), 'X-Robots-Tag': 'noindex, nofollow' } }); }
    if (!env.SENHA || !env.SESSAO_SEGREDO || !env.SYNC_TOKEN) return json({ erro: 'não configurado' }, 503);

    if (rota === '/favicon.ico') return seguranca(new Response(null, { status: 204 }), { cache: 'public, max-age=604800' });   // login não declara ícone: sem 404 no console
    if (rota === '/robots.txt') return seguranca(new Response('User-agent: *\nDisallow: /\n', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }));
    if (rota.startsWith('/sync/')) return sync(req, env, rota);
    if (rota === '/login') {
      if (req.method === 'POST') return fazerLogin(req, env);
      if (req.method === 'GET' || req.method === 'HEAD') return (await sessaoValida(req, env)) ? seguranca(new Response(null, { status: 302, headers: { Location: '/' } })) : gz(req, paginaLogin());
      return json({ erro: 'método' }, 405);
    }
    if (rota === '/logout' && req.method === 'POST') {
      if (!origemOk(req)) return json({ erro: 'pedido recusado' }, 403);
      return seguranca(new Response(null, { status: 303, headers: { Location: '/login', 'Set-Cookie': COOKIE_LIMPO } }), { dados: true });
    }

    const logado = await sessaoValida(req, env);
    if (rota.startsWith('/api/')) return logado ? api(req, env, url, rota) : json({ erro: 'login necessário' }, 401, { 'WWW-Authenticate': 'Cookie realm="rv"' });

    const publico = PUBLICOS_EXATOS.includes(rota) || PUBLICOS_PREFIXOS.some((p) => rota.startsWith(p));
    if (!logado && !publico) return seguranca(new Response(null, { status: 302, headers: { Location: '/login', 'Cache-Control': 'no-store' } }), { dados: true });
    if (req.method !== 'GET' && req.method !== 'HEAD') return json({ erro: 'método' }, 405);
    const semAE = new Headers(req.headers); semAE.delete('Accept-Encoding');          // sem compressão vinda do ASSETS: quem comprime o HTML é gz() (evita gzip duplo)
    const r = await env.ASSETS.fetch(new Request(req, { headers: semAE }));
    // fonte e ícones quase nunca mudam: cache longo; o resto (app.js, css) é do app autenticado: privado, revalida por ETag
    const cache = rota.startsWith('/fontes/') ? 'public, max-age=31536000, immutable' : rota.startsWith('/icones/') || rota.startsWith('/icons/') ? 'public, max-age=604800' : 'private, no-cache';
    const dadosHtml = rota.endsWith('.html') || rota === '/' || rota === '/sw.js';
    let base = r;
    if (dadosHtml && r.ok) { const h = new Headers(r.headers); h.delete('Content-Encoding'); h.delete('Content-Length'); base = new Response(await r.text(), { status: r.status, headers: h }); }  // texto puro: quem comprime é gz()
    const saida = seguranca(base, { dados: dadosHtml, cache });
    return dadosHtml ? gz(req, saida) : saida;
  },
};
