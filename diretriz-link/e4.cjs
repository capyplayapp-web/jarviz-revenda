const puppeteer = require('C:/Users/gusta/Scripts/robo-revenda/node_modules/puppeteer');
const fs=require('fs');
const esp = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await puppeteer.launch({ headless: false, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    userDataDir: 'C:/Users/gusta/Scripts/robo-revenda/perfil-painel', args: ['--window-position=-2400,-2400','--window-size=1280,1000'],
    ignoreDefaultArgs: ['--enable-automation'], defaultViewport: { width: 1280, height: 1000 } });
  const p = (await b.pages())[0] || await b.newPage();
  await p.goto('https://painel.capyplay.site/#/resellers',{waitUntil:'networkidle2',timeout:60000}).catch(()=>{});await esp(5000);
  await p.evaluate(() => { for (const e of document.querySelectorAll('button')) if (/Não mostrar novamente/.test(e.innerText)) { e.click(); break; } });
  const rows=[];
  for(let i=0;i<14;i++){
    const r=await p.evaluate(()=>[...document.querySelectorAll('tbody tr')].map(tr=>[...tr.querySelectorAll('td')].map(td=>td.innerText.replace(/\s+/g,' ').trim())));
    rows.push(...r);
    const ok=await p.evaluate(()=>{const l=[...document.querySelectorAll('.pagination')][0];if(!l)return false;const items=[...l.querySelectorAll('li')];const nx=items[items.length-2];if(!nx||/disabled/.test(nx.className))return false;(nx.querySelector('a,button')||nx).click();return true;});
    if(!ok)break; await esp(2500);
  }
  fs.writeFileSync('rev-rows.json',JSON.stringify(rows));
  console.log(rows.length, JSON.stringify(rows[0]).slice(0,600));
  await b.close();
})();
