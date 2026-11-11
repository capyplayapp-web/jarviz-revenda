// Testes do mapa do conhecimento.
//   node relatorios\testar-grafo.mjs          -> contrato, ligações, privacidade, tempo, tamanho, escala (dados reais + mock)
//   node relatorios\testar-grafo.mjs --tela   -> também abre o mapa no Chrome invisível e salva prints em web\prints\mapa-*.png
// Prints só da página (Chrome headless), nunca do monitor.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const PASTA = path.resolve(AQUI, '..');
const WEB = path.join(AQUI, 'web');
let falhas = 0, ok = 0;
const conferir = (cond, msg, extra) => { if (cond) ok++; else { falhas++; console.log('  FALHOU:', msg, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); } };
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const TIPOS_NO = new Set(['etapa', 'conhecimento', 'regra_aprendida', 'inconsistencia', 'recurso', 'cliente', 'revendedor']);
const TIPOS_LIG = new Set(['fluxo', 'usa', 'aprendeu', 'corrige', 'cliente_em', 'acontece_em', 'revendedor_em']); // acontece_em = extra (erro -> etapa)

function validarContrato(g, nome) {
  conferir(g && typeof g === 'object', `${nome}: é objeto`);
  conferir(ISO.test(g.gerado_em), `${nome}: gerado_em ISO`, g.gerado_em);
  conferir(Array.isArray(g.nos) && Array.isArray(g.ligacoes) && Array.isArray(g.evolucao), `${nome}: nos/ligacoes/evolucao são listas`);
  const ids = new Set();
  for (const n of g.nos) {
    for (const k of ['id', 'tipo', 'rotulo', 'peso', 'desde', 'grupo', 'detalhe']) conferir(k in n, `${nome}: nó tem "${k}"`, n.id);
    conferir(typeof n.id === 'string' && n.id && !ids.has(n.id), `${nome}: id único`, n.id); ids.add(n.id);
    conferir(TIPOS_NO.has(n.tipo), `${nome}: tipo de nó conhecido`, n.tipo);
    conferir(typeof n.rotulo === 'string' && n.rotulo.length > 0, `${nome}: rótulo`, n.id);
    conferir(typeof n.peso === 'number' && n.peso > 0 && Number.isFinite(n.peso), `${nome}: peso > 0`, [n.id, n.peso]);
    conferir(n.desde === null || ISO.test(n.desde), `${nome}: desde ISO ou null`, [n.id, n.desde]);
    conferir(typeof n.grupo === 'string', `${nome}: grupo texto`, n.id);
    conferir(typeof n.detalhe === 'string', `${nome}: detalhe texto`, n.id);
  }
  for (const l of g.ligacoes) {
    for (const k of ['de', 'para', 'tipo', 'peso']) conferir(k in l, `${nome}: ligação tem "${k}"`, l);
    conferir(ids.has(l.de) && ids.has(l.para), `${nome}: ligação aponta para nós que existem`, l);
    conferir(TIPOS_LIG.has(l.tipo), `${nome}: tipo de ligação conhecido`, l.tipo);
    conferir(typeof l.peso === 'number' && l.peso > 0, `${nome}: peso da ligação > 0`, l);
  }
  for (const p of g.evolucao) {
    for (const k of ['quando', 'nos', 'ligacoes', 'regras_aprendidas', 'conhecimento', 'taxa_painel', 'clientes']) conferir(k in p, `${nome}: evolução tem "${k}"`, p);
    conferir(ISO.test(p.quando), `${nome}: evolução quando ISO`, p.quando);
    conferir(p.taxa_painel >= 0 && p.taxa_painel <= 1, `${nome}: taxa entre 0 e 1`, p.taxa_painel);
  }
  for (let i = 1; i < g.evolucao.length; i++) conferir(Date.parse(g.evolucao[i].quando) >= Date.parse(g.evolucao[i - 1].quando), `${nome}: evolução em ordem`, i);
  conferir(g.nos.length <= 400, `${nome}: no máximo 400 nós`, g.nos.length);
  const bytes = Buffer.byteLength(JSON.stringify(g));
  conferir(bytes < 600 * 1024, `${nome}: JSON < 600 KB`, bytes);
  return bytes;
}

function validarPrivacidade(g, nome, fichas, revs) {
  const txt = JSON.stringify(g);
  conferir(!/\d{8,}/.test(txt), `${nome}: nenhum número com 8+ dígitos (telefone/id)`, (txt.match(/.{30}\d{8,}.{10}/) || [])[0]);
  conferir(!/\(?\d{2}\)?\s?\d{4,5}-\d{4}/.test(txt), `${nome}: nenhum telefone formatado`, (txt.match(/.{20}\(?\d{2}\)?\s?\d{4,5}-\d{4}/) || [])[0]);
  conferir(!/[\w.+-]+@[\w-]+\.[a-z]{2,}/i.test(txt), `${nome}: nenhum e-mail`, (txt.match(/.{20}[\w.+-]+@[\w-]+\.[a-z]{2,}/i) || [])[0]);
  conferir(!/senha\s*[:=]\s*(?!\[oculta)/i.test(txt), `${nome}: nenhuma senha`);
  const segredos = new Set();
  for (const [chat, f] of Object.entries(fichas || {})) {
    for (const v of [chat.split('@')[0], f.telefone, f.telefone_real, f.usuario_painel, f.teste && f.teste.usuario, f.teste && f.teste.senha]) if (v && String(v).length >= 5) segredos.add(String(v));
  }
  for (const [chat, r] of Object.entries(revs || {})) for (const v of [chat.split('@')[0], r.telefone, r.telefone_lid, r.usuario_painel, r.painel_id]) if (v && String(v).length >= 5) segredos.add(String(v));
  const vazou = [...segredos].filter((s) => txt.includes(s));
  conferir(vazou.length === 0, `${nome}: nada de telefone, usuário do painel ou id das fichas no JSON`, vazou.map((s) => s.slice(0, 3) + '…'));
  for (const n of g.nos.filter((x) => x.tipo === 'cliente' && x.id !== 'cli:outros')) conferir(n.rotulo === 'Sem nome' || !/\s/.test(n.rotulo), `${nome}: cliente só com o primeiro nome`, n.rotulo);
}

async function testarDados() {
  const lerJ = (a) => { try { return JSON.parse(fs.readFileSync(a, 'utf8').replace(/^\uFEFF/, '')); } catch { return {}; } };
  const fichas = lerJ(path.join(PASTA, 'clientes.json')), revs = lerJ(path.join(PASTA, 'revendedores.json'));
  const t0 = performance.now();
  const { grafo } = await import(pathToFileURL(path.join(AQUI, 'grafo.mjs')).href);
  const tImport = performance.now() - t0;
  const tempos = [];
  let g;
  for (let i = 0; i < 5; i++) { const t = performance.now(); g = await grafo(); tempos.push(performance.now() - t); }
  console.log(`dados reais: ${g.nos.length} nós, ${g.ligacoes.length} ligações, ${g.evolucao.length} pontos de evolução`);
  const porTipo = {}; for (const n of g.nos) porTipo[n.tipo] = (porTipo[n.tipo] || 0) + 1;
  const porLig = {}; for (const l of g.ligacoes) porLig[l.tipo] = (porLig[l.tipo] || 0) + 1;
  console.log('  nós por tipo:', JSON.stringify(porTipo));
  console.log('  ligações por tipo:', JSON.stringify(porLig));
  console.log(`  tempo: 1ª chamada ${tempos[0].toFixed(0)} ms (import ${tImport.toFixed(0)} ms), depois ${Math.max(...tempos.slice(1)).toFixed(0)} ms no pior caso`);
  console.log(`  totais: ${JSON.stringify(g.totais)}`);
  conferir(tempos[0] + tImport < 300 && Math.max(...tempos) < 300, 'dados reais: < 300 ms', tempos.map(Math.round));
  const bytes = validarContrato(g, 'real');
  console.log(`  tamanho: ${(bytes / 1024).toFixed(1)} KB`);
  validarPrivacidade(g, 'real', fichas, revs);
  for (const t of ['etapa', 'conhecimento', 'regra_aprendida', 'inconsistencia', 'recurso']) conferir(porTipo[t] > 0, `real: tem nós do tipo ${t}`);
  for (const id of ['etapa:contato', 'etapa:soube', 'etapa:link', 'etapa:criou', 'etapa:senhor', 'etapa:sumiu']) conferir(g.nos.some((n) => n.id === id), `real: etapa ${id}`);
  conferir(g.ligacoes.some((l) => l.tipo === 'fluxo' && l.de === 'etapa:contato' && l.para === 'etapa:soube'), 'real: fluxo contato → soube');
  const g1 = await grafo({ dias: 1 });
  validarContrato(g1, 'dias=1'); conferir(g1.periodo && g1.periodo.dias === 1, 'dias=1: período informado', g1.periodo);

  // mock da tela
  const mock = lerJ(path.join(WEB, 'mock', 'grafo.json'));
  validarContrato(mock, 'mock'); validarPrivacidade(mock, 'mock', fichas, revs);
  const nomesReais = new Set(Object.values(fichas).map((f) => String(f.nome || '').split(/\s+/)[0].toLowerCase()).filter((s) => s.length > 2));
  const reaisNoMock = mock.nos.filter((n) => n.tipo === 'cliente' && nomesReais.has(n.rotulo.toLowerCase())).map((n) => n.rotulo);
  conferir(reaisNoMock.length === 0, 'mock: nenhum nome de cliente real', reaisNoMock);

  // escala: 900 clientes e 20 mil eventos sintéticos numa pasta temporária
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'grafo-escala-'));
  for (const f of fs.readdirSync(PASTA).filter((f) => /^(base\.md|videos\.json|base\.md\.(antes|com)-.*)$/.test(f))) fs.copyFileSync(path.join(PASTA, f), path.join(tmp, f));
  const fic = {}, ev = [], base = Date.now() - 20 * 86400e3;
  for (let i = 0; i < 900; i++) {
    const chat = `9${String(i).padStart(13, '0')}@lid`, t = base + i * 1800e3;
    fic[chat] = { criado_em: new Date(t).toISOString(), ultimo_contato: new Date(t + 3600e3).toISOString(), nome: `Teste${i} Sobrenome`, telefone: chat.split('@')[0], telefone_real: '55119' + String(i).padStart(8, '0'), mensagens: 1 + (i % 20), etapa: ['explicando', 'duvidas', 'criando_painel', 'painel_criado'][i % 4], resumo: `Teste${i} Sobrenome quer revender.` };
    for (let j = 0; j < 22; j++) ev.push(JSON.stringify({ t: new Date(t + j * 60e3).toISOString(), chat, nome: 'x', tipo: j % 2 ? 'resposta_robo' : 'mensagem_cliente', texto: j === 3 ? 'pós-pago R$ 3,50' : j === 5 ? 'https://painel.capyplay.site/#/rs/x' : 'oi' }));
  }
  fs.writeFileSync(path.join(tmp, 'clientes.json'), JSON.stringify(fic));
  fs.writeFileSync(path.join(tmp, 'eventos.jsonl'), ev.join('\n') + '\n');
  fs.writeFileSync(path.join(tmp, 'revendedores.json'), '{}');
  process.env.GRAFO_PASTA = tmp;
  const mod2 = await import(pathToFileURL(path.join(AQUI, 'grafo.mjs')).href + '?escala');
  const te = performance.now(); const ge = await mod2.grafo(); const tEscala = performance.now() - te;
  delete process.env.GRAFO_PASTA;
  console.log(`escala (900 clientes, ${ev.length} eventos): ${ge.nos.length} nós, ${ge.ligacoes.length} ligações em ${tEscala.toFixed(0)} ms`);
  validarContrato(ge, 'escala'); validarPrivacidade(ge, 'escala', fic, {});
  conferir(ge.nos.some((n) => n.id === 'cli:outros' && /Outros clientes \(\d+\)/.test(n.rotulo)), 'escala: clientes antigos agrupados em "Outros clientes (n)"');
  conferir(tEscala < 1500, 'escala: < 1,5 s com 20 mil eventos', Math.round(tEscala));
  fs.rmSync(tmp, { recursive: true, force: true });
  return g;
}

// ---------- tela (Chrome invisível) ----------
async function testarTela() {
  const require = createRequire(import.meta.url);
  const puppeteer = require(path.join(PASTA, 'node_modules', 'puppeteer-core'));
  const { grafo } = await import(pathToFileURL(path.join(AQUI, 'grafo.mjs')).href);
  const tipos = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml' };
  const srv = http.createServer(async (q, r) => {
    const url = new URL(q.url, 'http://x');
    if (url.pathname === '/api/grafo') { const g = await grafo({ dias: url.searchParams.get('dias') || undefined }); r.writeHead(200, { 'Content-Type': 'application/json' }); return r.end(JSON.stringify(g)); }
    const f = path.join(WEB, decodeURIComponent(url.pathname).replace(/^\/$/, '/mapa-teste.html'));
    if (!f.startsWith(WEB)) { r.writeHead(403); return r.end(); }
    fs.readFile(f, (e, b) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'Content-Type': tipos[path.extname(f)] || 'application/octet-stream' }); r.end(b); } });
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${srv.address().port}/mapa-teste.html`;
  const b = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new' });
  const erros = [];
  const dir = path.join(WEB, 'prints'); fs.mkdirSync(dir, { recursive: true });
  const tamanhos = [['3440x1440', 3440, 1440, 1], ['1920x1080', 1920, 1080, 1], ['390x844', 390, 844, 2]];
  const esperarParado = (p) => p.waitForFunction(() => window.mapa && window.mapa.dados.nos > 0 && window.mapa.dados.parado, { timeout: 15000 }).catch(() => 'nao parou');
  const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

  async function abrir(nome, w, h, dpr, query, reduzido) {
    const p = await b.newPage();
    await p.setViewport({ width: w, height: h, deviceScaleFactor: dpr, isMobile: w < 600, hasTouch: w < 900 });
    if (reduzido) await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    p.on('pageerror', (e) => erros.push(`${nome}${query}: ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') erros.push(`${nome}${query}: ${m.text()}`); });
    p.on('requestfailed', (r) => erros.push(`${nome}${query} falhou: ${r.url()}`));
    await p.goto(base + query, { waitUntil: 'networkidle0' });
    return p;
  }
  async function medidas(p) {
    return p.evaluate(() => ({ rola: document.documentElement.scrollHeight > innerHeight + 1, estoura: document.documentElement.scrollWidth > innerWidth, dados: window.mapa ? window.mapa.dados : null }));
  }
  const foto = (p, arq) => p.screenshot({ path: path.join(dir, arq) });

  for (const [nome, w, h, dpr] of tamanhos) {
    // 1. dados reais
    let p = await abrir(nome, w, h, dpr, '');
    const tParou = Date.now(); const r = await esperarParado(p);
    await pausa(150);
    const m = await medidas(p);
    console.log(`${nome} real: ${m.dados.nos} nós, ${m.dados.ligacoes} ligações; física parou: ${r === 'nao parou' ? 'NÃO' : 'sim (' + (Date.now() - tParou) + ' ms)'}; ${m.rola ? 'ROLA' : 'sem rolagem'}${m.estoura ? ' ESTOURA LARGURA' : ''}`);
    conferir(r !== 'nao parou', `${nome}: a física para sozinha (rAF desliga)`);
    conferir(!m.rola && !m.estoura, `${nome}: sem rolagem`);
    await foto(p, `mapa-${nome}.png`);
    // 2. detalhe aberto
    await p.evaluate(() => window.mapa.selecionar('etapa:criou'));
    await pausa(700); await foto(p, `mapa-detalhe-${nome}.png`);
    const det = await p.evaluate(() => { const d = document.querySelector('.mapa-detalhe'); const r = d.getBoundingClientRect(); return { aberto: !d.hidden, titulo: d.querySelector('.mapa-titulo')?.textContent, h: Math.round(r.height), w: Math.round(r.width), ligs: d.querySelectorAll('.mapa-lig').length }; });
    conferir(det.aberto && det.titulo === 'Criou o painel' && det.ligs > 0, `${nome}: painel de detalhe abre com ligações`, det);
    // 3. busca
    await p.evaluate(() => { document.querySelector('.mapa-fechar').click(); });
    await pausa(300);
    await p.type('.mapa-busca input', 'link');
    await pausa(250); await foto(p, `mapa-busca-${nome}.png`);
    const nRes = await p.evaluate(() => document.querySelectorAll('.mapa-res').length);
    conferir(nRes > 0, `${nome}: busca acha resultados`, nRes);
    await p.evaluate(() => { const i = document.querySelector('.mapa-busca input'); i.value = ''; i.dispatchEvent(new Event('input')); });
    // 4. filtros: só Aprendizado + Fluxo
    await p.evaluate(() => { for (const k of ['conhecimento', 'memoria']) document.querySelector(`.mapa-pilula[data-camada="${k}"]`).click(); });
    await esperarParado(p); await pausa(200); await foto(p, `mapa-filtro-${nome}.png`);
    await p.evaluate(() => { for (const k of ['conhecimento', 'memoria']) document.querySelector(`.mapa-pilula[data-camada="${k}"]`).click(); });
    await esperarParado(p);
    // 5. linha do tempo no meio e reprodução
    await p.evaluate(() => { const s = document.querySelector('.mapa-trilho input'); s.value = '55'; s.dispatchEvent(new Event('input')); });
    await pausa(700); await foto(p, `mapa-tempo-${nome}.png`);
    const tempo = await p.evaluate(() => ({ data: document.querySelector('[data-q="data"]').textContent, marco: document.querySelector('[data-q="marco"]').textContent, nos: document.querySelector('[data-n="nos"]').textContent }));
    console.log(`  linha do tempo em 5,5%: ${tempo.data} · ${tempo.marco} · ${tempo.nos} bolinhas`);
    if (nome === '1920x1080') {
      // fps durante a reprodução da evolução
      const fps = await p.evaluate(() => new Promise((ok) => {
        document.querySelector('.mapa-play').click();
        let n = 0, pior = 0, ant = performance.now(); const t0 = ant;
        const f = (t) => { n++; pior = Math.max(pior, t - ant); ant = t; if (t - t0 < 2500) requestAnimationFrame(f); else ok({ fps: Math.round(n / ((t - t0) / 1000)), pior: Math.round(pior) }); };
        requestAnimationFrame(f);
      }));
      console.log(`  reprodução da evolução: ${fps.fps} fps, pior quadro ${fps.pior} ms`);
      await pausa(300); await foto(p, `mapa-evolucao-${nome}.png`);
    }
    await p.close();

    // 6. mock (150 clientes fictícios)
    p = await abrir(nome, w, h, dpr, '?mock=1');
    await esperarParado(p); await pausa(150);
    await foto(p, `mapa-mock-${nome}.png`);
    if (nome === '390x844') { await p.evaluate(() => window.mapa.selecionar('con:links')); await pausa(700); await foto(p, `mapa-mock-detalhe-${nome}.png`); }
    await p.close();
  }

  // estado vazio e erro
  for (const [nome, w, h, dpr] of [tamanhos[1], tamanhos[2]]) {
    for (const q of ['?vazio=1', '?erro=1']) {
      const p = await abrir(nome, w, h, dpr, q);
      await pausa(400);
      await foto(p, `mapa-${q.slice(1, -2)}-${nome}.png`);
      const t = await p.evaluate(() => document.querySelector('.mapa-aviso')?.innerText || '');
      conferir(t.length > 10, `${nome} ${q}: mensagem humana na tela`, t);
      await p.close();
    }
  }

  // movimento reduzido: layout estático, sem rAF depois de montar
  {
    const p = await abrir('1920x1080', 1920, 1080, 1, '?mock=1', true);
    await pausa(500);
    const d = await p.evaluate(() => window.mapa.dados);
    conferir(d.parado, 'movimento reduzido: nada animando depois de montar', d);
    await foto(p, 'mapa-reduzido-1920x1080.png');
    await p.close();
  }

  // estresse: 400 nós e 700 ligações sintéticos, mede fps com a física rodando
  {
    const p = await abrir('1920x1080', 1920, 1080, 1, '?mock=1');
    await esperarParado(p);
    const r = await p.evaluate(() => new Promise((ok) => {
      const nos = [], ligacoes = [], tipos = ['etapa', 'conhecimento', 'regra_aprendida', 'inconsistencia', 'recurso', 'cliente'];
      for (let i = 0; i < 400; i++) { const t = i < 6 ? 'etapa' : tipos[1 + (i % 5)]; nos.push({ id: 'n' + i, tipo: t, rotulo: 'Item ' + i, peso: 1 + (i % 9), desde: null, grupo: t === 'regra_aprendida' ? 'aprovada' : 'x', detalhe: '' }); }
      for (let i = 6; i < 400; i++) { ligacoes.push({ de: 'n' + i, para: 'n' + (i % 6), tipo: 'cliente_em', peso: 1 }); if (i % 4 === 0) ligacoes.push({ de: 'n' + i, para: 'n' + ((i * 7) % 400), tipo: 'usa', peso: 2 }); }
      const box = document.createElement('div'); box.style.cssText = 'position:fixed;inset:0;z-index:9'; document.body.appendChild(box);
      const m = window.montarMapa(box, { buscar: () => Promise.resolve({ gerado_em: new Date().toISOString(), nos, ligacoes, evolucao: [] }) });
      setTimeout(() => {
        // reaquece a física (como ao arrastar) e mede
        box.querySelector('.mapa-pilula[data-camada="memoria"]').click(); box.querySelector('.mapa-pilula[data-camada="memoria"]').click();
        let n = 0, pior = 0, ant = performance.now(); const t0 = ant;
        const f = (t) => { n++; pior = Math.max(pior, t - ant); ant = t; if (t - t0 < 2000) requestAnimationFrame(f); else ok({ fps: Math.round(n / ((t - t0) / 1000)), pior: Math.round(pior), nos: m.dados.nos, ligacoes: m.dados.ligacoes }); };
        requestAnimationFrame(f);
      }, 600);
    }));
    console.log(`estresse ${r.nos} nós / ${r.ligacoes} ligações com a física rodando: ${r.fps} fps, pior quadro ${r.pior} ms`);
    conferir(r.fps >= 50, 'estresse: >= 50 fps com 400 nós', r);
    await foto(p, 'mapa-estresse-1920x1080.png');
    await p.close();
  }

  await b.close(); srv.close();
  const relevantes = erros.filter((e) => !/favicon/.test(e));
  conferir(relevantes.length === 0, 'console limpo', relevantes);
  console.log(relevantes.length ? 'ERROS NO CONSOLE:\n' + relevantes.join('\n') : 'console limpo');
}

await testarDados();
if (process.argv.includes('--tela')) await testarTela();
console.log(`\n${ok} conferências passaram, ${falhas} falharam.`);
process.exit(falhas ? 1 : 0);
