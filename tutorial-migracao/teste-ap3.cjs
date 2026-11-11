const puppeteer = require('C:/Users/gusta/Scripts/robo-revenda/node_modules/puppeteer-core');
(async () => {
  const b = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new' });
  for (const [nome, vp] of [['m', { width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true }], ['mh', { width: 844, height: 390, deviceScaleFactor: 1, isMobile: true, hasTouch: true }], ['d', { width: 1440, height: 900 }]]) {
    const p = await b.newPage(); await p.setViewport(vp);
    await p.goto('https://bridgehire90.capyapp.net/k7q2x9mf/', { waitUntil: 'load' });
    await new Promise(r => setTimeout(r, 3500));
    const info = await p.evaluate(() => { const s = document.querySelector('.s.on'); return [!!s, s && getComputedStyle(s).visibility, document.getElementById('stage').style.transform, innerWidth, innerHeight]; });
    console.log(nome, JSON.stringify(info));
    await p.screenshot({ path: 'ap-' + nome + '.png' });
    await p.close();
  }
  await b.close();
})();
