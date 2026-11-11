const puppeteer = require('C:/Users/gusta/Scripts/robo-revenda/node_modules/puppeteer');
const fs=require('fs');
const esp = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT='D:/CAPY/PDFs/diretriz-link/';
(async () => {
  const b = await puppeteer.launch({ headless: false, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    userDataDir: 'C:/Users/gusta/Scripts/robo-revenda/perfil-painel', args: ['--window-position=-2400,-2400','--window-size=1280,1000'],
    ignoreDefaultArgs: ['--enable-automation'], defaultViewport: { width: 1280, height: 1000 } });
  const p = (await b.pages())[0] || await b.newPage();
  const go=async(r)=>{await p.goto('https://painel.capyplay.site/#/'+r,{waitUntil:'networkidle2',timeout:60000}).catch(()=>{});await esp(4000);
    await p.evaluate(() => { for (const e of document.querySelectorAll('button')) if (/Não mostrar novamente/.test(e.innerText)) { e.click(); break; } });await esp(500);};
  await go('resellers/referral-link');
  // Criar link (abre só para ler)
  await p.evaluate(()=>{for(const e of document.querySelectorAll('button,a'))if(/Criar link/.test(e.innerText)){e.click();break;}});
  await esp(2000);
  console.log('CRIAR>>',await p.evaluate(()=>[...document.querySelectorAll('[role=dialog],.modal,.modal-content,.offcanvas')].map(x=>x.innerText.replace(/\s+/g,' ')).join('\n')));
  await p.screenshot({path:OUT+'link-indicacao-criar-link-form.png'});
  await p.keyboard.press('Escape'); await esp(800);
  console.log('url',p.url());
  // lapis edit
  const btns=await p.evaluate(()=>[...document.querySelectorAll('table button,table a')].map(e=>[e.innerText.trim(),e.getAttribute('title'),e.getAttribute('href'),e.className.slice(0,40),Math.round(e.getBoundingClientRect().x),Math.round(e.getBoundingClientRect().y)]));
  console.log(JSON.stringify(btns));
  await b.close();
})();
