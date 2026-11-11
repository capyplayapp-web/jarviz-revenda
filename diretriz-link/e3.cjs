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
  await p.evaluate(()=>{document.querySelector('table button[title=Editar]').click();});
  await esp(2000);
  console.log('EDIT>>',await p.evaluate(()=>[...document.querySelectorAll('.modal.show')].map(x=>x.innerText.replace(/\s+/g,' ')).join('\n')));
  await p.screenshot({path:OUT+'link-indicacao-editar-form.png'});
  await p.keyboard.press('Escape'); await esp(800);
  // lista de revendas: paginar
  await go('resellers');
  const info=await p.evaluate(()=>({sel:[...document.querySelectorAll('select')].map(s=>[s.name,[...s.options].map(o=>o.text).join('|')]),pg:[...document.querySelectorAll('.pagination a,.pagination button,.page-link')].map(e=>e.innerText.trim()+'/'+(e.getAttribute('aria-label')||'')).slice(0,20)}));
  console.log(JSON.stringify(info));
  await b.close();
})();
