const puppeteer = require('C:/Users/gusta/Scripts/robo-revenda/node_modules/puppeteer');
const esp = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await puppeteer.launch({ headless: false, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    userDataDir: 'C:/Users/gusta/Scripts/robo-revenda/perfil-painel', args: ['--window-position=-2400,-2400','--window-size=1280,860'],
    ignoreDefaultArgs: ['--enable-automation'], defaultViewport: { width: 1280, height: 860 } });
  const p = (await b.pages())[0] || await b.newPage();
  await p.goto('https://painel.capyplay.site/#/dashboard', { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
  await esp(5000);
  await p.evaluate(() => { for (const e of document.querySelectorAll('button')) if (/Não mostrar novamente/.test(e.innerText)) { e.click(); break; } });
  await esp(800);
  console.log(p.url());
  console.log(await p.evaluate(() => [...document.querySelectorAll('a')].map(a => (a.innerText||'').replace(/\s+/g,' ').trim()+' => '+a.getAttribute('href')).join('\n')));
  await b.close();
})();
