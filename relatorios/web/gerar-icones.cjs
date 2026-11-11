// Gera os ícones PNG do app (180, 192, 512) com o Chrome invisível. Uso: node gerar-icones.cjs
const puppeteer = require('C:/Users/gusta/Scripts/robo-revenda/node_modules/puppeteer-core');
const fs = require('fs'), path = require('path');
const pasta = path.join(__dirname, 'icones'); fs.mkdirSync(pasta, { recursive: true });
// Balão de conversa com três barras subindo: atendimento + relatório. Símbolo ocupa 60% do quadrado (zona segura de ícone mascarado).
const svg = (n) => `<svg xmlns="http://www.w3.org/2000/svg" width="${n}" height="${n}" viewBox="0 0 512 512">
<defs>
  <radialGradient id="brilho" cx="50%" cy="26%" r="75%"><stop offset="0" stop-color="#5be7ff" stop-opacity=".2"/><stop offset="1" stop-color="#5be7ff" stop-opacity="0"/></radialGradient>
  <linearGradient id="ciano" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7aedff"/><stop offset="1" stop-color="#00c7ff"/></linearGradient>
</defs>
<rect width="512" height="512" fill="#121214"/><rect width="512" height="512" fill="url(#brilho)"/>
<g transform="translate(256 256) scale(1.25) translate(-256 -256)" fill="none" stroke="url(#ciano)" stroke-linecap="round" stroke-linejoin="round">
  <path stroke-width="24" d="M188 136H324A56 56 0 0 1 380 192V268A56 56 0 0 1 324 324H252L196 376V324H188A56 56 0 0 1 132 268V192A56 56 0 0 1 188 136Z"/>
  <path stroke-width="24" d="M206 272V244M256 272V216M306 272V188"/>
</g></svg>`;
(async () => {
  const b = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new' });
  for (const n of [180, 192, 512]) {
    const p = await b.newPage(); await p.setViewport({ width: n, height: n, deviceScaleFactor: 1 });
    await p.setContent(`<body style="margin:0;background:#121214">${svg(n)}</body>`);
    await p.screenshot({ path: path.join(pasta, `icone-${n}.png`), clip: { x: 0, y: 0, width: n, height: n } });
    await p.close();
  }
  fs.writeFileSync(path.join(pasta, 'icone.svg'), svg(512));
  await b.close(); console.log('ícones gerados em', pasta);
})();
