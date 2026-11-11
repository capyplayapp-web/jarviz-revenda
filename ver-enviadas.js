// Só LÊ: lista o que saiu deste WhatsApp desde as 17:20 de hoje. Não envia nada.
const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');
const desde = new Date('2026-11-07T17:20:00-03:00').getTime() / 1000;
const client = new Client({
  authStrategy: new LocalAuth({ clientId: 'revenda', dataPath: path.join(__dirname, 'sessao') }),
  puppeteer: { headless: true, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', args: ['--no-sandbox'] },
});
client.on('ready', async () => {
  const chats = await client.getChats();
  for (const c of chats.filter((c) => c.timestamp >= desde).slice(0, 40)) {
    let msgs = [];
    try { msgs = await c.fetchMessages({ limit: 20 }); } catch (e) { console.log('falhou', c.id._serialized, e.message); continue; }
    const novas = msgs.filter((m) => m.timestamp >= desde);
    if (!novas.length) continue;
    console.log(`\n=== ${c.name || c.id.user} (${c.id._serialized}) grupo=${c.isGroup}`);
    for (const m of novas) console.log(`${new Date(m.timestamp * 1000).toLocaleTimeString('pt-BR')} ${m.fromMe ? 'SAIU' : 'ENTROU'} [${m.type}] ${(m.body || '').slice(0, 200).replace(/\n/g, ' / ')}`);
  }
  await client.destroy(); process.exit(0);
});
client.initialize();
setTimeout(() => { console.log('tempo esgotado'); process.exit(1); }, 150000);
