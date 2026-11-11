const puppeteer = require('C:/Users/gusta/Scripts/robo-revenda/node_modules/puppeteer-core');
(async () => {
  const b = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', args: ['--allow-file-access-from-files'] });
  const p = await b.newPage(); await p.setViewport({ width: 1400, height: 760, deviceScaleFactor: 1.5 });
  await p.goto('file:///D:/CAPY/PDFs/grafico/index.html'); await new Promise(r => setTimeout(r, 800));
  await p.screenshot({ path: 'D:/CAPY/PDFs/grafico-evolucao-robo-revenda.png' });
  await b.close();
})();
