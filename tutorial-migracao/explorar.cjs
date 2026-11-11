const puppeteer = require('C:/Users/gusta/Scripts/robo-revenda/node_modules/puppeteer');
const esp = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await puppeteer.launch({ headless: false, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    userDataDir: 'C:/Users/gusta/Scripts/robo-revenda/perfil-painel', args: ['--window-position=-2400,-2400','--window-size=1280,860'],
    ignoreDefaultArgs: ['--enable-automation'], defaultViewport: { width: 1280, height: 860 } });
  const p = (await b.pages())[0] || await b.newPage();
  await p.goto('https://painel.capyplay.site/#/dashboard', { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
  await esp(6000);
  const out = 'C:/Users/gusta/Scripts/robo-revenda/tutorial-migracao/';
  await p.screenshot({ path: out + '01-dashboard.png' });
  const itens = await p.evaluate(() => [...document.querySelectorAll('a,button,li,[role=menuitem]')].map(e => (e.innerText||'').trim().replace(/\s+/g,' ')).filter(t => t && t.length < 60));
  console.log(JSON.stringify([...new Set(itens)].slice(0, 120)));
  console.log('URL', p.url());
  await b.close();
})();
