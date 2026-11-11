// Testes do celular, só da página (Chrome invisível), nunca do monitor. Uso: node tirar-prints-mobile.cjs [url-base]
// Salva prints\mobile-*.png, confere rolagem lateral, alvos de toque (>= 44 px), tamanho de texto (>= 13 px) e console.
const puppeteer = require('C:/Users/gusta/Scripts/robo-revenda/node_modules/puppeteer-core');
const http = require('http'), fs = require('fs'), path = require('path');
const raiz = __dirname;
const tipos = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const srv = http.createServer((q, r) => {
  const f = path.join(raiz, decodeURIComponent(q.url.split('?')[0]).replace(/^\/$/, '/index.html'));
  fs.readFile(f, (e, b) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'Content-Type': tipos[path.extname(f)] || 'application/octet-stream' }); r.end(b); } });
});
const espera = ms => new Promise(r => setTimeout(r, ms));
const erros = [], achados = [];
(async () => {
  await new Promise(ok => srv.listen(0, '127.0.0.1', ok));
  const base = process.argv[2] || `http://127.0.0.1:${srv.address().port}/`;
  const b = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new' });
  const abrir = async (nome, w, hgt, query, { reduzido } = {}) => {
    const p = await b.newPage();
    await p.setViewport({ width: w, height: hgt, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    if (reduzido) await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    p.on('pageerror', e => erros.push(`${nome}: ${e.message}`));
    p.on('console', m => { if (m.type() === 'error') erros.push(`${nome}: ${m.text()}`); });
    p.on('requestfailed', r => erros.push(`${nome} falhou: ${r.url()}`));
    await p.goto(base + query, { waitUntil: 'networkidle0' });
    await espera(1500);
    return p;
  };
  const foto = (p, nome) => p.screenshot({ path: path.join(raiz, 'prints', `mobile-${nome}.png`) });
  // confere a página atual
  const conferir = async (p, rotulo) => {
    const r = await p.evaluate(() => {
      const vis = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0'; };
      const pequenos = [...document.querySelectorAll('button, a[href], [role=radio]')].filter(vis).filter(el => !el.closest('[inert]')).map(el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return { t: (el.textContent || el.id || el.className).trim().slice(0, 28), h: Math.round(r.height), w: Math.round(r.width) }; }).filter(x => x.h < 43.5);
      const fontes = new Set(); const miudos = [];
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n; (n = w.nextNode());) { const t = n.textContent.trim(); if (!t) continue; const el = n.parentElement; if (!vis(el) || el.closest('script,style')) continue; const fs = parseFloat(getComputedStyle(el).fontSize); if (fs < 12.95) miudos.push(`${Math.round(fs * 10) / 10}px "${t.slice(0, 24)}"`); }
      return { sw: document.documentElement.scrollWidth, cw: innerWidth, sh: document.documentElement.scrollHeight, ch: innerHeight, pequenos, miudos: [...new Set(miudos)] };
    });
    if (r.sw > r.cw) achados.push(`${rotulo}: ROLAGEM LATERAL (${r.sw} > ${r.cw})`);
    if (r.pequenos.length) achados.push(`${rotulo}: alvos < 44 px: ${JSON.stringify(r.pequenos)}`);
    if (r.miudos.length) achados.push(`${rotulo}: texto < 13 px: ${r.miudos.join(' | ')}`);
    return r;
  };

  const telas = [['360', 360, 740], ['390', 390, 844], ['430', 430, 932], ['820', 820, 1180], ['844x390', 844, 390]];
  for (const [id, w, hh] of telas) {
    const abas = ['resumo', 'follow', 'paineis', 'conversas', 'leitura'];
    for (const a of abas) {
      const p = await abrir(id, w, hh, `?mock=1&aba=${a}`);
      await conferir(p, `${id} ${a}`);
      await foto(p, `${id}-${a}`);
      if (id === '390' && a === 'resumo') await p.screenshot({ path: path.join(raiz, 'prints', `mobile-${id}-resumo-pagina.png`), fullPage: true });
      await p.close();
    }
  }
  // fluxo local: FAB -> confirmar -> resultado
  {
    const p = await abrir('fluxo', 390, 844, '?mock=1&aba=follow');
    await conferir(p, 'fab (aba follow)'); await foto(p, '390-fab');
    await p.tap('#fab'); await espera(500); await foto(p, '390-folha-confirmar'); await conferir(p, 'folha confirmar');
    await p.evaluate(() => { [...document.querySelectorAll('.folha .btn')].find(b => /Responder/.test(b.textContent)).click(); });
    await espera(500); await foto(p, '390-folha-progresso');
    await espera(1800); await foto(p, '390-folha-resultado'); await conferir(p, 'folha resultado');
    await p.evaluate(() => document.querySelector('.folha .btn').click()); await espera(500);
    const aberta = await p.evaluate(() => !document.getElementById('folha').hidden);
    if (aberta) achados.push('folha não fechou');
    await p.close();
  }
  // fluxo nuvem: enfileirado + /api/comando
  {
    const p = await abrir('nuvem', 390, 844, '?mock=nuvem&aba=resumo');
    await p.tap('#m-pendentes'); await espera(500);
    await p.evaluate(() => { [...document.querySelectorAll('.folha .btn')].find(b => /Responder/.test(b.textContent)).click(); });
    await espera(2600); await foto(p, '390-nuvem-esperando');
    await espera(4500); await foto(p, '390-nuvem-resultado');
    const t = await p.evaluate(() => document.getElementById('folha-corpo').innerText);
    if (!/encontrou 3 conversas e já está respondendo/.test(t)) achados.push('nuvem: texto final inesperado: ' + t.replace(/\n/g, ' / '));
    await p.close();
  }
  // leitura (aprender) na nuvem
  {
    const p = await abrir('leitura', 390, 844, '?mock=nuvem&aba=leitura');
    await p.tap('#m-aprender'); await espera(500); await foto(p, '390-leitura-confirmar');
    await p.evaluate(() => { [...document.querySelectorAll('.folha .btn')].find(b => /Ler agora/.test(b.textContent)).click(); });
    await espera(7500); await foto(p, '390-leitura-resultado');
    await p.close();
  }
  // faixas e estados
  for (const [q, nome] of [['?mock=velho', 'velho'], ['?mock=sessao', 'sessao'], ['?mock=vazio', 'vazio']]) {
    const p = await abrir(nome, 390, 844, q);
    await conferir(p, nome); await foto(p, `390-${nome}`);
    if (nome === 'vazio') { for (const a of ['paineis', 'conversas']) { await p.evaluate(a => document.querySelector(`[data-aba-ir=${a}]`).click(), a); await espera(500); await foto(p, `390-vazio-${a}`); } }
    await p.close();
  }
  // troca de aba com toque e indicador
  {
    const p = await abrir('troca', 390, 844, '?mock=1');
    await p.tap('[data-aba-ir=paineis]'); await espera(120); await foto(p, '390-troca-meio'); await espera(500);
    const i = await p.evaluate(() => getComputedStyle(document.querySelector('.abas-in')).getPropertyValue('--i').trim());
    if (i !== '2') achados.push('indicador de aba não andou: ' + i);
    await p.close();
  }
  // movimento reduzido
  { const p = await abrir('reduzido', 390, 844, '?mock=1', { reduzido: true }); await conferir(p, 'reduzido'); await foto(p, '390-reduzido'); await p.close(); }
  // mapa (carrega só ao abrir)
  {
    const p = await abrir('mapa', 390, 844, '?mock=1&aba=mapa');
    await espera(1500); await foto(p, '390-mapa'); await conferir(p, '390 mapa'); await p.close();
  }
  await b.close(); srv.close();
  console.log(achados.length ? 'ACHADOS:\n' + achados.join('\n') : 'sem achados');
  console.log(erros.length ? 'ERROS:\n' + [...new Set(erros)].join('\n') : 'console limpo');
})();
