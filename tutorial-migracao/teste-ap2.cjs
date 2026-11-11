const puppeteer = require('C:/Users/gusta/Scripts/robo-revenda/node_modules/puppeteer-core');
(async () => {
  const b = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new' });
  for (const [nome, vp] of [['mobile', { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }], ['desktop', { width: 1440, height: 900 }]]) {
    const p = await b.newPage(); await p.setViewport(vp);
    const erros = []; p.on('pageerror', e => erros.push(String(e).slice(0, 200)));
    await p.goto('https://bridgehire90.capyapp.net/k7q2x9mf/', { waitUntil: 'load' });
    await new Promise(r => setTimeout(r, 2500));
    const marcas = [];
    for (let k = 0; k < 40; k++) {
      const h = await p.evaluate(() => location.hash);
      marcas.push(h);
      const ok = await p.evaluate(() => { const n = document.getElementById('prox'); if (!n) return false; n.click(); return true; });
      if (!ok) { marcas.push('SEM BOTAO prox'); break; }
      await new Promise(r => setTimeout(r, 700));
    }
    console.log(nome, 'hashes', marcas.join(' '), 'erros', JSON.stringify(erros));
    if (nome === 'mobile') { await p.screenshot({ path: 'ap-mobile-fim.png' }); }
    await p.close();
  }
  await b.close();
})();
