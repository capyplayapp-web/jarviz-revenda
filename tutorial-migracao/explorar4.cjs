const puppeteer = require('C:/Users/gusta/Scripts/robo-revenda/node_modules/puppeteer');
const esp = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await puppeteer.launch({ headless: false, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    userDataDir: 'C:/Users/gusta/Scripts/robo-revenda/perfil-painel', args: ['--window-position=-2400,-2400','--window-size=1280,860'],
    ignoreDefaultArgs: ['--enable-automation'], defaultViewport: { width: 1280, height: 860 } });
  const p = (await b.pages())[0] || await b.newPage();
  const out = 'C:/Users/gusta/Scripts/robo-revenda/tutorial-migracao/';
  await p.goto('https://painel.capyplay.site/#/customers/migration', { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
  await esp(5000);
  await p.evaluate(() => { for (const e of document.querySelectorAll('button')) if (/Não mostrar novamente/.test(e.innerText)) { e.click(); break; } });
  await esp(800);
  const bt = await p.evaluate(() => [...document.querySelectorAll('button,a')].filter(e => /^\s*Adicionar\s*$/.test(e.innerText)).map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height), e.closest('[role=dialog],.modal,form') ? 'modal' : 'pagina']; }));
  console.log(JSON.stringify(bt));
  await p.screenshot({ path: out + '04-lista-migracao.png' });
  const alvo = bt.find(x => x[4] === 'pagina' && x[2] > 0);
  if (alvo) { await p.mouse.click(alvo[0] + alvo[2] / 2, alvo[1] + alvo[3] / 2); await esp(3000); }
  await p.screenshot({ path: out + '05-migracao-adicionar.png' });
  console.log(p.url());
  console.log(await p.evaluate(() => { const d = [...document.querySelectorAll('[role=dialog],.modal,form')].map(x => x.innerText.replace(/\s+/g,' ').slice(0,900)); return JSON.stringify(d); }));
  await b.close();
})();
