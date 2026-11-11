const puppeteer = require('C:/Users/gusta/Scripts/robo-revenda/node_modules/puppeteer');
const fs=require('fs');
const esp = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT='D:/CAPY/PDFs/diretriz-link/';
const rotas=[
['resellers','revendas-lista'],['resellers/referral-link','link-indicacao'],['resellers/content-requests','solicitacoes'],
['settings/general','config-geral'],['settings/resellers','config-revendas'],['settings/customers','config-clientes'],
['resellers/move','mover-revendas'],['customers/migration','migracao-cliente'],['customers/move','mover-clientes'],
['resellers/audit','auditoria-revendas'],['resellers/credit-transactions','transacoes-creditos'],['resellers/sign-in-logs','historico-logins'],
['resellers/statistics','estatisticas-revendas'],['resellers/deleted','revendas-excluidas'],['system/audit','auditoria-sistema'],['server-statistics','estatisticas-servidores'],['dashboard','dashboard']];
(async () => {
  const b = await puppeteer.launch({ headless: false, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    userDataDir: 'C:/Users/gusta/Scripts/robo-revenda/perfil-painel', args: ['--window-position=-2400,-2400','--window-size=1280,1000'],
    ignoreDefaultArgs: ['--enable-automation'], defaultViewport: { width: 1280, height: 1000 } });
  const p = (await b.pages())[0] || await b.newPage();
  let first=true;
  for (const [r,n] of rotas){
    await p.goto('https://painel.capyplay.site/#/'+r, { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
    await esp(first?5000:3500); first=false;
    await p.evaluate(() => { for (const e of document.querySelectorAll('button')) if (/Não mostrar novamente/.test(e.innerText)) { e.click(); break; } });
    await esp(600);
    await p.screenshot({ path: OUT+n+'.png', fullPage:true });
    const t=await p.evaluate(()=>document.body.innerText);
    fs.writeFileSync('C:/Users/gusta/Scripts/robo-revenda/diretriz-link/txt-'+n+'.txt', t);
    console.log('ok',n,p.url(),t.length);
  }
  await b.close();
})();
