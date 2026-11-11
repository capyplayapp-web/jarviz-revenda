// Prints só da página (Chrome invisível), nunca do monitor. Uso: node tirar-prints.cjs [sufixo] [query] [url-base]
const puppeteer = require('C:/Users/gusta/Scripts/robo-revenda/node_modules/puppeteer-core');
const http = require('http'), fs = require('fs'), path = require('path');
const raiz = __dirname, sufixo = process.argv[2] || 'mock', query = process.argv[3] || '?mock=1';
const externa = process.argv[4];
const tipos = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const srv = http.createServer((q, r) => {
  const f = path.join(raiz, decodeURIComponent(q.url.split('?')[0]).replace(/^\/$/, '/index.html'));
  fs.readFile(f, (e, b) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'Content-Type': tipos[path.extname(f)] || 'application/octet-stream' }); r.end(b); } });
});
(async () => {
  await new Promise(ok => srv.listen(0, '127.0.0.1', ok));
  const base = externa || `http://127.0.0.1:${srv.address().port}/`;
  const b = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new' });
  const tamanhos = [['3440x1440', 3440, 1440, 1], ['1920x1080', 1920, 1080, 1], ['390x844', 390, 844, 2], ['820x1180', 820, 1180, 1]];
  const erros = [];
  for (const [nome, w, hgt, dpr] of tamanhos) {
    const p = await b.newPage();
    await p.setViewport({ width: w, height: hgt, deviceScaleFactor: dpr, isMobile: w < 600, hasTouch: w < 900 });
    p.on('pageerror', e => erros.push(nome + ': ' + e.message));
    p.on('console', m => { if (m.type() === 'error') erros.push(nome + ': ' + m.text()); });
    p.on('requestfailed', r => erros.push(nome + ' falhou: ' + r.url()));
    await p.goto(base + query, { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 1700));
    const m = await p.evaluate(() => ({ sh: document.documentElement.scrollHeight, ch: innerHeight, sw: document.documentElement.scrollWidth, cw: innerWidth }));
    console.log(nome, JSON.stringify(m), m.sh > m.ch + 1 ? 'ROLA' : 'sem rolagem', m.sw > m.cw ? 'ESTOURA LARGURA' : '');
    const arq = path.join(raiz, 'prints', `${sufixo}-${nome}.png`);
    await p.screenshot({ path: arq, fullPage: w < 1100 });
    await p.close();
  }
  await b.close(); srv.close();
  console.log(erros.length ? 'ERROS:\n' + erros.join('\n') : 'console limpo');
})();
