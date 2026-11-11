const puppeteer = require('C:/Users/gusta/Scripts/robo-revenda/node_modules/puppeteer-core');
(async () => {
  const b = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new' });
  const p = await b.newPage(); await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true });
  const erros = [], falhas = [];
  p.on('console', m => { if (m.type() === 'error') erros.push(m.text().slice(0, 200)); });
  p.on('pageerror', e => erros.push('PAGEERROR ' + String(e).slice(0, 300)));
  p.on('requestfailed', r => falhas.push(r.url().slice(-80) + ' ' + (r.failure() || {}).errorText));
  p.on('response', r => { if (r.status() >= 400) falhas.push(r.status() + ' ' + r.url().slice(-80)); });
  const t0 = Date.now();
  await p.goto('https://bridgehire90.capyapp.net/k7q2x9mf/', { waitUntil: 'load', timeout: 60000 }).catch(e => erros.push('goto ' + e.message));
  console.log('load ms', Date.now() - t0);
  await new Promise(r => setTimeout(r, 4000));
  console.log('erros', JSON.stringify(erros)); console.log('falhas', JSON.stringify(falhas));
  console.log('body h', await p.evaluate(() => [document.body.scrollHeight, getComputedStyle(document.body).overflow, document.documentElement.className, document.body.className, (document.body.innerText || '').slice(0, 120)]));
  await p.screenshot({ path: 'ap-mobile.png' });
  await b.close();
})();
