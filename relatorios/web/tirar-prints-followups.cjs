// Prints e conferências da área Follow-ups, só da página (Chrome invisível), nunca do monitor.
// Usa sempre ?mock=... (nenhum POST real). Uso: node tirar-prints-followups.cjs [mock]   (padrão: 1)
// Salva prints\followups-*.png, confere rolagem da página, alvos de toque (>= 44 px no celular), texto (>= 13 px no celular),
// "undefined"/"NaN" na tela, telefone inteiro na tela, senha na tela e console.
const puppeteer = require('C:/Users/gusta/Scripts/robo-revenda/node_modules/puppeteer-core');
const http = require('http'), fs = require('fs'), path = require('path');
const raiz = __dirname, MOCK = process.argv[2] || '1';
const tipos = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const posts = [];
const srv = http.createServer((q, r) => {
  if (q.method !== 'GET') posts.push(q.method + ' ' + q.url);
  const f = path.join(raiz, decodeURIComponent(q.url.split('?')[0]).replace(/^\/$/, '/index.html'));
  fs.readFile(f, (e, b) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'Content-Type': tipos[path.extname(f)] || 'application/octet-stream' }); r.end(b); } });
});
const espera = ms => new Promise(r => setTimeout(r, ms));
const erros = [], achados = [];
(async () => {
  await new Promise(ok => srv.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${srv.address().port}/`;
  const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new' });
  const abrir = async (nome, w, hh, query, { movel, reduzido } = {}) => {
    const p = await b.newPage();
    await p.setViewport({ width: w, height: hh, deviceScaleFactor: movel ? 2 : 1, isMobile: !!movel, hasTouch: !!movel });
    if (reduzido) await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    p.on('pageerror', e => erros.push(`${nome}: ${e.message}`));
    p.on('console', m => { if (m.type() === 'error') erros.push(`${nome}: ${m.text()}`); });
    p.on('requestfailed', r => erros.push(`${nome} falhou: ${r.url()}`));
    p.on('response', r => { if (r.status() >= 400 && !/favicon/.test(r.url())) erros.push(`${nome}: HTTP ${r.status()} ${r.url()}`); });
    await p.goto(base + query, { waitUntil: 'networkidle0' });
    await espera(1900);
    return p;
  };
  const foto = (p, nome, cheia) => p.screenshot({ path: path.join(raiz, 'prints', `followups-${nome}.png`), fullPage: !!cheia });
  const conferir = async (p, rotulo, movel) => {
    const r = await p.evaluate(movel => {
      const vis = el => { const r = el.getBoundingClientRect(), cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0'; };
      const fu = document.getElementById('fu');
      const pequenos = movel ? [...fu.querySelectorAll('button, a[href], input, [role=radio]')].filter(vis).map(el => { const r = el.getBoundingClientRect(); return { t: (el.textContent || el.placeholder || el.className).trim().slice(0, 26), h: Math.round(r.height) }; }).filter(x => x.h < 43.5) : [];
      const miudos = [];
      const w = document.createTreeWalker(fu, NodeFilter.SHOW_TEXT);
      for (let n; (n = w.nextNode());) { const t = n.textContent.trim(); if (!t) continue; const el = n.parentElement; if (!vis(el) || el.closest('.so-leitor')) continue; const fs = parseFloat(getComputedStyle(el).fontSize); if (movel && fs < 12.95) miudos.push(`${Math.round(fs * 10) / 10}px "${t.slice(0, 24)}"`); }
      const texto = fu.innerText;
      return {
        sw: document.documentElement.scrollWidth, cw: innerWidth, sh: document.documentElement.scrollHeight, ch: innerHeight, pequenos, miudos: [...new Set(miudos)],
        ruim: /undefined|NaN|\[object/.test(texto), telefoneInteiro: /\d{5}-?\d{4}|\+55 ?\d{2}/.test(texto), senha: /senha[^•\n]{0,3}\s*[:=]\s*\w/i.test(texto),
        clip: [...fu.querySelectorAll('.cartao')].filter(vis).map(c => ({ c: c.className.slice(0, 40), sh: c.scrollHeight, ch: c.clientHeight })).filter(x => x.sh > x.ch + 2),
      };
    }, movel);
    if (r.sw > r.cw) achados.push(`${rotulo}: ROLAGEM LATERAL (${r.sw} > ${r.cw})`);
    if (!movel && r.sh > r.ch + 1 && r.cw >= 1280 && r.ch >= 641) achados.push(`${rotulo}: a página ROLA (${r.sh} > ${r.ch})`);
    if (r.pequenos.length) achados.push(`${rotulo}: alvos < 44 px: ${JSON.stringify(r.pequenos)}`);
    if (r.miudos.length) achados.push(`${rotulo}: texto < 13 px: ${r.miudos.join(' | ')}`);
    if (r.ruim) achados.push(`${rotulo}: aparece undefined/NaN na tela`);
    if (r.telefoneInteiro) achados.push(`${rotulo}: TELEFONE inteiro na tela`);
    if (r.senha) achados.push(`${rotulo}: possível SENHA na tela`);
    if (!movel && r.clip.length) achados.push(`${rotulo}: conteúdo cortado em cartão (só informativo): ${JSON.stringify(r.clip)}`);
    return r;
  };

  // PC
  for (const [id, w, hh] of [['3440x1440', 3440, 1440], ['1920x1080', 1920, 1080], ['1366x768', 1366, 768]]) {
    const p = await abrir(id, w, hh, `?mock=${MOCK}&vista=followups`);
    await conferir(p, `pc ${id}`, false);
    await foto(p, id);
    if (id === '1920x1080' && (MOCK === '1' || MOCK === 'grande')) {
      // filtro, categoria, expandir um cartão
      await p.click('#fu-filtros [data-f="atrasado"]'); await espera(600); await foto(p, `${id}-atrasado`);
      await p.click('#fu-filtros [data-f="todos"]');
      await p.click('#fu-cats .fu-cat'); await espera(500);
      const cartao = await p.$('.fu-cli .fu-cli-bt'); if (cartao) { await cartao.click(); await espera(500); }
      await foto(p, `${id}-categoria-aberto`);
      await p.click('#fu-cat-chip button').catch(() => {});
      await p.type('#fu-busca', 'ca'); await espera(500); await foto(p, `${id}-busca`);
      // confirmação ao retomar (mock: não dispara POST real)
      await p.evaluate(() => { document.getElementById('fu-busca').value = ''; });
      const txt = await p.$eval('#fu-pausa', e => e.textContent);
      if (/Retomar/.test(txt)) { await p.click('#fu-pausa'); await espera(500); await foto(p, `${id}-confirmar`); const t = await p.$eval('.fu-folha', e => e.innerText); if (!/Liberar os envios do atrasado\?/.test(t) || !/máximo 120 por dia, entre 9h e 20h/.test(t)) achados.push('folha: texto de confirmação fora do combinado: ' + t.replace(/\n/g, ' | ')); }
    }
    await p.close();
  }
  // PC: áreas existentes continuam iguais
  for (const [id, w, hh, v] of [['1920x1080', 1920, 1080, ''], ['1920x1080', 1920, 1080, '&vista=mapa']]) {
    const p = await abrir('existente', w, hh, `?mock=${MOCK}${v}`);
    await foto(p, `existente${v ? '-mapa' : '-painel'}-${id}`); await p.close();
  }
  // celular
  for (const [id, w, hh] of [['390x844', 390, 844], ['430x932', 430, 932], ['820x1180', 820, 1180]]) {
    const p = await abrir(id, w, hh, `?mock=${MOCK}&aba=follow`, { movel: true });
    await conferir(p, `cel ${id}`, true);
    await foto(p, id);
    for (const [sel, nome] of [['.fu-degraus', 'degraus'], ['.fu-cats-card', 'categorias'], ['.fu-clientes', 'clientes']]) { await p.$eval(sel, e => e.scrollIntoView({ block: 'start' })); await p.evaluate(() => scrollBy(0, -70)); await espera(500); await foto(p, `${id}-${nome}`); }
    if (id === '390x844') {
      await p.evaluate(() => scrollTo(0, 99999)); await espera(300);
      const bt = await p.$('#fu-pausa'); const t = bt ? await p.$eval('#fu-pausa', e => e.textContent) : '';
      if (/Retomar/.test(t)) { await bt.evaluate(e => e.scrollIntoView({ block: 'center' })); await espera(300); await bt.tap(); await espera(700); await foto(p, `${id}-folha`); await conferir(p, 'cel folha', true); }
    }
    await p.close();
  }
  { // celular, movimento reduzido e aba trocada
    const p = await abrir('reduzido', 390, 844, `?mock=${MOCK}&aba=follow`, { movel: true, reduzido: true });
    await foto(p, '390x844-movimento-reduzido'); await p.close();
  }
  { const p = await abrir('abas', 390, 844, `?mock=${MOCK}&aba=resumo`, { movel: true }); await p.tap('.aba[data-aba-ir="follow"]'); await espera(1500); const vis = await p.$eval('#fu', e => getComputedStyle(e).display); if (vis === 'none') achados.push('aba Follow-ups não mostrou a área'); await p.close(); }
  await b.close(); srv.close();
  console.log(achados.length ? 'ACHADOS:\n' + achados.join('\n') : 'sem achados');
  console.log(posts.length ? 'REQUISIÇÕES NÃO-GET NO SERVIDOR DE TESTE: ' + posts.join(', ') : 'nenhum POST disparado');
  console.log(erros.length ? 'ERROS:\n' + erros.join('\n') : 'console limpo');
})();
