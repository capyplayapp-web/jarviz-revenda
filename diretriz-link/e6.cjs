const puppeteer = require('C:/Users/gusta/Scripts/robo-revenda/node_modules/puppeteer');
const esp = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await puppeteer.launch({ headless: false, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    userDataDir: 'C:/Users/gusta/Scripts/robo-revenda/perfil-painel', args: ['--window-position=-2400,-2400','--window-size=1280,1000'],
    ignoreDefaultArgs: ['--enable-automation'], defaultViewport: { width: 1280, height: 1000 } });
  const p = (await b.pages())[0] || await b.newPage();
  await p.goto('https://painel.capyplay.site/#/settings/resellers',{waitUntil:'networkidle2',timeout:60000}).catch(()=>{});await esp(5000);
  await p.evaluate(() => { for (const e of document.querySelectorAll('button')) if (/Não mostrar novamente/.test(e.innerText)) { e.click(); break; } });await esp(500);
  const r=await p.evaluate(()=>{const els=[...document.querySelectorAll('*')].filter(e=>e.children.length===0&&/^Cobrar 0,033/.test((e.innerText||'').trim()));return els.map(e=>e.className+'|'+e.parentElement.className).join(' ## ');});
  console.log(r);
  await p.evaluate(()=>{const e=[...document.querySelectorAll('*')].filter(e=>e.children.length===0&&/^Cobrar 0,033/.test((e.innerText||'').trim()))[0];const c=e.closest('.ss-main,.multiselect,.form-select,[class*=select]')||e.parentElement;c.scrollIntoView({block:'center'});c.click();});
  await esp(1000);
  console.log(await p.evaluate(()=>[...document.querySelectorAll('[class*=option],[role=option],[class*=dropdown]')].map(e=>e.innerText.replace(/\s+/g,' ')).filter(t=>/Cobrar|Bloquear|Permitir|Não/.test(t)).slice(0,6).join(' || ')));
  await p.screenshot({path:'D:/CAPY/PDFs/diretriz-link/config-revendas-bloquear-migracao-opcoes.png'});
  await p.keyboard.press('Escape');
  await b.close();
})();
