// Servidor local dos relatórios do robô da revenda: http://127.0.0.1:8811/
// Serve a pasta web\ e a API: /api/resumo?dias=1|7, /api/revendedores, /api/ping, /api/versoes, POST /api/aprender, POST /api/reanalisar,
// e o backlog: GET /api/followups?dias=1|7, GET /api/backlog, POST /api/backlog/mapear|pausar|retomar (ver backlog-lib.mjs).
// Só escuta em 127.0.0.1. Lê tudo do disco a cada chamada. O bot liga este servidor (e religa se cair).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { iniciarSync } from './sync-nuvem.mjs';
import { AQUI, ARQ, PASTA, lerJson, resumo, lerRevendedoresLista, escreverNota } from './lib.mjs';
import { tratarRotaBacklog } from './backlog-lib.mjs';
import { tratarRotaFunil, resumoFunilCurto } from './funil-lib.mjs';
import { resumoEscritorio } from './escritorio-lib.mjs';
import { resumoTrafego } from './trafego-lib.mjs';   // aba Tráfego: leads até o painel fechado (09/11/2026)
import { resumoUso } from './uso-lib.mjs';
import { estadoVoz, mudarModo } from './voz-lib.mjs';   // voz do Jarvis: modo + CPU/temperatura (09/11/2026)   // gasto de tokens do robô (08/11/2026)   // escritório do Jarvis, tela inicial (08/11/2026)
import * as lac from '../lacunas.mjs';                                   // lacunas de conhecimento (LACUNAS.md)

const PORTA = Number(process.env.RELATORIOS_PORTA || 8811);
const WEB = path.join(AQUI, 'web');
const TIPOS = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8' };

const json = (res, codigo, obj) => { const b = JSON.stringify(obj); res.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(b) }); res.end(b); };

let aprendendo = null;
function rodarAprender() {
  if (aprendendo) return aprendendo;
  aprendendo = new Promise((ok) => {
    const p = spawn(process.execPath, [path.join(AQUI, 'aprender.mjs'), '--agora'], { cwd: PASTA, windowsHide: true });
    let out = ''; const t = setTimeout(() => { p.kill(); }, 150000);
    p.stdout.on('data', (d) => (out += d));
    p.on('close', () => { clearTimeout(t); const l = out.trim().split('\n').pop(); try { ok(JSON.parse(l)); } catch { ok({ ok: false, motivo: 'a leitura não terminou' }); } });
    p.on('error', (e) => ok({ ok: false, motivo: e.message }));
  }).finally(() => { aprendendo = null; });
  return aprendendo;
}

// Reanálise dos pendentes: pede ao robô (reanalisar.json) e espera ~60 s o resultado. Usada pela tela local e pelo sync da nuvem.
let reanalisando = null;
function executarReanalisar() {
  if (reanalisando) return reanalisando;
  reanalisando = (async () => {
    const pedido_em = new Date().toISOString(), arqRes = path.join(PASTA, 'reanalisar-resultado.json');
    try { fs.unlinkSync(arqRes); } catch {}
    fs.writeFileSync(path.join(PASTA, 'reanalisar.json'), JSON.stringify({ pedido_em }));
    for (let i = 0; i < 40; i++) {                                    // até ~60 s esperando o robô
      await new Promise((r) => setTimeout(r, 1500));
      const r = lerJson(arqRes, null);
      if (r && r.pedido_em === pedido_em) return { ok: !r.erro, ...r };
    }
    return { ok: false, motivo: 'o robô não respondeu a tempo' };
  })().finally(() => { reanalisando = null; });
  return reanalisando;
}
// Leitura de 2 h (aprender.mjs) com a última rodada junto. Usada pela tela local e pelo sync da nuvem.
async function executarAprender() {
  const r = await rodarAprender();
  const ap = lerJson(ARQ.aprendizados, { rodadas: [] });
  return { ...r, ultima_rodada: (ap.rodadas || []).slice(-1)[0] || null };
}

// Grafo (mapa de memória e fluxo): vem de grafo.mjs quando o arquivo existe; recarrega sozinho se o arquivo mudar.
async function carregarGrafo() {
  const f = path.join(AQUI, 'grafo.mjs');
  let st; try { st = fs.statSync(f); } catch { return null; }
  const m = await import(pathToFileURL(f).href + '?v=' + Math.round(st.mtimeMs));
  return typeof m.grafo === 'function' ? m.grafo : null;
}

function estatico(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const alvo = path.normalize(path.join(WEB, rel));
  if (!alvo.startsWith(WEB + path.sep) && alvo !== WEB) { res.writeHead(403); return res.end('proibido'); }
  fs.stat(alvo, (e, st) => {
    if (e || !st.isFile()) {
      if (rel === '/index.html') { res.writeHead(200, { 'Content-Type': TIPOS['.html'] }); return res.end('<!doctype html><meta charset="utf-8"><title>Relatórios</title><body style="font:16px system-ui;padding:32px">A tela de relatórios ainda não foi colocada em relatorios\\web. A API está no ar: <a href="/api/resumo">/api/resumo</a></body>'); }
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('não encontrado');
    }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(alvo).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Content-Length': st.size });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(alvo).pipe(res);
  });
}

const servidor = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    const rota = url.pathname;
    if (rota === '/api/ping') return json(res, 200, { ok: true, em: new Date().toISOString() });
    // Versões do robô (09/11/2026): lê ..ersoes.json a cada chamada (um revisor pode acrescentar "revisao" a qualquer momento).
    if (rota === '/api/versoes' && req.method === 'GET') {
      const v = lerJson(path.join(PASTA, 'versoes.json'), null);
      return json(res, 200, v && typeof v === 'object' ? { atual: v.atual ?? null, ...v, versoes: Array.isArray(v.versoes) ? v.versoes : [] } : { atual: null, versoes: [] });
    }
    if (rota === '/api/voz' && req.method === 'GET') return json(res, 200, await estadoVoz());
    if (rota === '/api/voz' && req.method === 'POST') {
      if (!/json/i.test(req.headers['content-type'] || '')) return json(res, 415, { erro: 'mande JSON' });
      let corpo = ''; for await (const c of req) { corpo += c; if (corpo.length > 2000) break; }
      try { const { modo } = JSON.parse(corpo || '{}'); mudarModo(modo); return json(res, 200, await estadoVoz()); }
      catch (e) { return json(res, 400, { erro: e.message }); }
    }
    if (rota === '/api/trafego' && req.method === 'GET') return json(res, 200, resumoTrafego({ dias: url.searchParams.get('dias') || 1 }));
    if (rota === '/api/uso' && req.method === 'GET') return json(res, 200, resumoUso({ dias: url.searchParams.get('dias') || 1 }));
    if (rota === '/api/escritorio' && req.method === 'GET') return json(res, 200, resumoEscritorio({ dias: url.searchParams.get('dias') || 1 }));
    if (rota === '/api/resumo' && req.method === 'GET') {
      const dias = url.searchParams.get('dias') || 1, r = await resumo({ dias });
      try { r.funil_estrategia = resumoFunilCurto({ dias }); } catch (e) { r.funil_estrategia = { erro: String(e.message || e) }; }
      return json(res, 200, r);
    }
    if (rota === '/api/funil' || rota === '/api/jornada' || rota === '/api/etiquetas' || rota.startsWith('/api/funil/') || rota.startsWith('/api/jornada/')) {
      let corpo = {};
      if (req.method === 'POST') {
        const partes = []; let tam = 0;
        for await (const p of req) { tam += p.length; if (tam > 4096) return json(res, 413, { erro: 'corpo grande demais' }); partes.push(p); }
        try { corpo = JSON.parse(Buffer.concat(partes).toString('utf8') || '{}'); } catch { return json(res, 400, { erro: 'JSON inválido' }); }
      }
      const r = await tratarRotaFunil({ metodo: req.method, rota, query: Object.fromEntries(url.searchParams), corpo, headers: req.headers });
      if (r) return json(res, r.codigo, r.corpo);
    }
    if (rota === '/api/lacunas' && req.method === 'GET') return json(res, 200, lac.resumoLacunas({ limite: 100 }));
    if (rota.startsWith('/api/lacunas/') && req.method === 'POST') {
      if (!/application\/json/i.test(String(req.headers['content-type'] || ''))) return json(res, 415, { erro: 'use Content-Type: application/json' });
      const partes = []; let tam = 0;
      for await (const p of req) { tam += p.length; if (tam > 4096) return json(res, 413, { erro: 'corpo grande demais' }); partes.push(p); }
      let corpo = {}; try { corpo = JSON.parse(Buffer.concat(partes).toString('utf8') || '{}'); } catch { return json(res, 400, { erro: 'JSON inválido' }); }
      const acao = rota.slice('/api/lacunas/'.length);
      if (!lac.ehId(corpo.id)) return json(res, 400, { erro: 'id inválido' });
      try {
        if (acao === 'aprovar') lac.aprovar(corpo.id, { resposta: typeof corpo.resposta === 'string' ? corpo.resposta.slice(0, 600) : undefined });
        else if (acao === 'descartar') lac.descartar(corpo.id);
        else if (acao === 'reinvestigar') { lac.reinvestigar(corpo.id); lac.drenarFila({ avisar: false }); }
        else return json(res, 404, { erro: 'ação desconhecida' });
        return json(res, 200, { ok: true, item: lac.obter(corpo.id) });
      } catch (e) { return json(res, 400, { erro: String(e.message || e) }); }
    }
    if (rota === '/api/revendedores' && req.method === 'GET') {
      const lista = lerRevendedoresLista();
      return json(res, 200, { gerado_em: new Date().toISOString(), total: lista.length, revendedores: lista });
    }
    if (rota === '/api/grafo' && req.method === 'GET') {
      const g = await carregarGrafo();
      if (!g) return json(res, 503, { erro: 'o grafo ainda não existe (arquivo grafo.mjs)' });
      return json(res, 200, await g({ dias: Number(url.searchParams.get('dias')) || 7 }));
    }
    if (rota === '/api/pendentes' && req.method === 'GET') return json(res, 200, lerJson(path.join(PASTA, 'pendentes.json'), { total: 0, itens: [], quando: null }));
    if (rota === '/api/reanalisar' && req.method === 'POST') return json(res, 200, await executarReanalisar());
    // Releitura (08/11/2026): o motor do funil lê o WhatsApp das últimas N horas, acha dúvida sem resposta e age (funil/releitura.js).
    if (rota === '/api/releitura' && req.method === 'GET') {
      const r = lerJson(path.join(PASTA, 'releitura-resultado.json'), null);
      const st = lerJson(path.join(PASTA, 'funil', 'releitura-estado.json'), {});
      return json(res, 200, { resultado: r, fila: (st.acoes || []).length });
    }
    if (rota === '/api/releitura' && req.method === 'POST') {
      if (!/application\/json/i.test(String(req.headers['content-type'] || ''))) return json(res, 415, { erro: 'use Content-Type: application/json' });
      const partes = []; let tam = 0;
      for await (const p of req) { tam += p.length; if (tam > 4096) return json(res, 413, { erro: 'corpo grande demais' }); partes.push(p); }
      let corpo = {}; try { corpo = JSON.parse(Buffer.concat(partes).toString('utf8') || '{}'); } catch { return json(res, 400, { erro: 'JSON inválido' }); }
      const atual = lerJson(path.join(PASTA, 'releitura-resultado.json'), null);
      if (atual && !atual.concluido_em && Date.now() - Date.parse(atual.iniciado_em || 0) < 15 * 60e3) return json(res, 409, { erro: 'a releitura já está rodando', resultado: atual });
      const pedido_em = new Date().toISOString(), arq = path.join(PASTA, 'funil', 'comando.json');
      const cmds = [].concat(lerJson(arq, [])).filter(Boolean);
      cmds.push({ acao: 'releitura', horas: Math.min(72, Math.max(1, Number(corpo.horas) || 12)), agir: corpo.agir !== false, pedido_em });
      fs.writeFileSync(arq, JSON.stringify(cmds));
      return json(res, 200, { ok: true, pedido_em });
    }
    if (rota === '/api/aprender' && req.method === 'POST') {
      const r = await executarAprender();
      return json(res, r.ok ? 200 : (r.motivo === 'já está rodando' ? 409 : 200), r);
    }
    if (rota === '/api/followups' || rota === '/api/backlog' || rota.startsWith('/api/backlog/')) {
      let corpo = {};
      if (req.method === 'POST') {
        const partes = []; let tam = 0;
        for await (const p of req) { tam += p.length; if (tam > 4096) return json(res, 413, { erro: 'corpo grande demais' }); partes.push(p); }
        try { corpo = JSON.parse(Buffer.concat(partes).toString('utf8') || '{}'); } catch { return json(res, 400, { erro: 'JSON inválido' }); }
      }
      const r = tratarRotaBacklog({ metodo: req.method, rota, query: Object.fromEntries(url.searchParams), headers: req.headers, corpo, pasta: process.env.BACKLOG_PASTA || PASTA });
      if (r) return json(res, r.codigo, r.corpo);
    }
    if (rota.startsWith('/api/')) return json(res, 404, { erro: 'rota desconhecida' });
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    estatico(req, res, url);
  } catch (e) { json(res, 500, { erro: String(e && e.message || e) }); }
});
servidor.on('error', (e) => { console.error('servidor de relatórios:', e.message); process.exit(1); });
servidor.listen(PORTA, '127.0.0.1', () => console.log(`relatórios em http://127.0.0.1:${PORTA}/`));

// Nota do cofre (revendedores): refaz quando o revendedores.json muda (confere a cada 60 s).
let marca = '';
function conferirNota() {
  try {
    const m = String(fs.statSync(ARQ.revendedores).mtimeMs);
    if (m !== marca) { marca = m; const r = escreverNota(); if (r.escrita) console.log('nota do cofre atualizada (' + r.total + ')'); }
  } catch {}
}
conferirNota();
setInterval(conferirNota, 60000);

// Sincronização com a nuvem (versão celular): só sai por HTTPS, se existir nuvem.local.json. Ver sync-nuvem.mjs.
try { iniciarSync({ reanalisar: executarReanalisar, aprender: executarAprender, carregarGrafo }); } catch (e) { console.error('sync nuvem:', e.message); }
