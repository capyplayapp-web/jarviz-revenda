const puppeteer = require('C:/Users/gusta/Scripts/robo-revenda/node_modules/puppeteer');
const esp = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await puppeteer.launch({ headless: false, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    userDataDir: 'C:/Users/gusta/Scripts/robo-revenda/perfil-painel', args: ['--window-position=-2400,-2400','--window-size=1280,860'],
    ignoreDefaultArgs: ['--enable-automation'], defaultViewport: { width: 1280, height: 860 } });
  const p = (await b.pages())[0] || await b.newPage();
  await p.goto('https://painel.capyplay.site/#/dashboard', { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
  await esp(5000);
  await p.evaluate(() => { for (const e of document.querySelectorAll('button')) if (/Não mostrar novamente|Fechar/.test(e.innerText)) { e.click(); break; } });
  const out = 'C:/Users/gusta/Scripts/robo-revenda/tutorial-migracao/';
  const hrefs = await p.evaluate(() => [...document.querySelectorAll('a')].filter(a => /Migra|Mover/.test(a.innerText)).map(a => [a.innerText.trim(), a.getAttribute('href')]));
  console.log(JSON.stringify(hrefs));
  let n = 2;
  for (const [nome, h] of hrefs) {
    await p.goto('https://painel.capyplay.site/' + (h.startsWith('#') ? h : '#' + h), { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
    await esp(4000);
    await p.screenshot({ path: out + String(n).padStart(2, '0') + '-' + nome.replace(/\W+/g, '_') + '.png' });
    const txt = await p.evaluate(() => document.body.innerText.slice(0, 3500));
    console.log('=== ' + nome + ' ' + p.url() + '\n' + txt);
    n++;
  }
  await b.close();
})();
