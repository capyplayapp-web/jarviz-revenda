const puppeteer = require('C:/Users/gusta/Scripts/robo-revenda/node_modules/puppeteer');
const fs=require('fs');
const esp = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await puppeteer.launch({ headless: false, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    userDataDir: 'C:/Users/gusta/Scripts/robo-revenda/perfil-painel', args: ['--window-position=-2400,-2400','--window-size=1280,1000'],
    ignoreDefaultArgs: ['--enable-automation'], defaultViewport: { width: 1280, height: 1000 } });
  const p = (await b.pages())[0] || await b.newPage();
  const go=async(r)=>{await p.goto('https://painel.capyplay.site/#/'+r,{waitUntil:'networkidle2',timeout:60000}).catch(()=>{});await esp(4000);
    await p.evaluate(() => { for (const e of document.querySelectorAll('button')) if (/Não mostrar novamente/.test(e.innerText)) { e.click(); break; } });await esp(500);};
  await go('settings/resellers');
  // opcoes Bloquear Migracao
  const op=await p.evaluate(()=>{const el=[...document.querySelectorAll('div,span')].find(e=>e.children.length===0&&/^Cobrar 0,033/.test(e.innerText||''));if(!el)return 'nao achou';el.click();return 'clicou';});
  await esp(1000);
  console.log(op, await p.evaluate(()=>[...document.querySelectorAll('[role=listbox],[role=option],.select2-results,.dropdown-menu.show,.choices__list--dropdown')].map(e=>e.innerText.replace(/\s+/g,' ')).slice(0,3).join(' || ')));
  await p.keyboard.press('Escape');
  // topo da pagina sem overlay: Login e seguranca
  console.log(await p.evaluate(()=>{const m=document.querySelector('main,#kt_app_main,.app-main')||document.body;return [...document.querySelectorAll('input')].map(i=>(i.closest('.row,.form-group,div')?.innerText||'').replace(/\s+/g,' ').slice(0,70)+' = '+(i.type==='checkbox'?i.checked:i.value)).join('\n')}));
  // historico de logins
  await go('resellers/sign-in-logs');
  const rows=[];
  for(let i=0;i<60;i++){
    const r=await p.evaluate(()=>[...document.querySelectorAll('tbody tr')].map(tr=>[...tr.querySelectorAll('td')].map(td=>td.innerText.replace(/\s+/g,' ').trim())));
    rows.push(...r);
    const ok=await p.evaluate(()=>{const l=[...document.querySelectorAll('.pagination')][0];if(!l)return false;const items=[...l.querySelectorAll('li')];const nx=items[items.length-2];if(!nx||/disabled/.test(nx.className))return false;(nx.querySelector('a,button')||nx).click();return true;});
    if(!ok)break; await esp(1800);
  }
  fs.writeFileSync('log-rows.json',JSON.stringify(rows));
  console.log(rows.length, JSON.stringify(rows[0]));
  await b.close();
})();
