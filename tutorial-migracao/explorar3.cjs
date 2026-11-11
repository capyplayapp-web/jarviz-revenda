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
  await p.evaluate(() => { for (const e of document.querySelectorAll('button,a')) if (/^\s*Adicionar\s*$/.test(e.innerText)) { e.click(); break; } });
  await esp(3000);
  await p.screenshot({ path: out + '05-migracao-adicionar.png' });
  const txt = await p.evaluate(() => { const d = document.querySelector('[role=dialog],.modal,.v-dialog,main') || document.body; return d.innerText.slice(0, 3500); });
  console.log(p.url()); console.log(txt);
  const campos = await p.evaluate(() => [...document.querySelectorAll('input,select,textarea,label,button')].map(e => (e.tagName + ':' + (e.placeholder || e.innerText || e.name || e.type || '')).replace(/\s+/g,' ').slice(0,70)));
  console.log(JSON.stringify(campos.slice(0,60)));
  await b.close();
})();
