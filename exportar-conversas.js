// Só LÊ: exporta as conversas individuais do WhatsApp da revenda para analise/conversas.json.
// Marca o que foi o robô (pelo conversas.log) e o que foi o senhor na mão. Não envia nada.
// Rodar com o robô DESLIGADO (usa a mesma sessão).
const fs = require('fs');
const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');

const PASTA = __dirname;
const SAIDA = path.join(PASTA, 'analise', 'conversas.json');
const LIMITE = Number(process.argv[2] || 400); // mensagens por conversa

// textos que o robô mandou (para separar do senhor)
const doRobo = new Set();
try {
  for (const l of fs.readFileSync(path.join(PASTA, 'conversas.log'), 'utf8').split('\n')) {
    const m = l.match(/robô -> [^:]+: (.+)$/);
    if (m) doRobo.add(m[1].trim());
  }
} catch {}
const fixosRobo = ['tudo bem?', 'em que posso ajudar?', 'Certo, já vou passar para o responsável. Ele te responde em instantes.'];
fixosRobo.forEach((t) => doRobo.add(t));

const client = new Client({
  authStrategy: new LocalAuth({ clientId: 'revenda', dataPath: path.join(PASTA, 'sessao') }),
  puppeteer: { headless: true, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', args: ['--no-sandbox'] },
});

client.on('ready', async () => {
  const chats = (await client.getChats()).filter((c) => !c.isGroup && /@(c\.us|lid)$/.test(c.id._serialized));
  console.log('conversas individuais:', chats.length);
  const out = [];
  let n = 0;
  for (const c of chats) {
    let msgs = [];
    try { msgs = await c.fetchMessages({ limit: LIMITE }); } catch (e) { console.log('falhou', c.id.user, e.message); continue; }
    const linhas = msgs
      .filter((m) => ['chat', 'ptt', 'audio', 'image', 'video', 'document'].includes(m.type))
      .map((m) => ({
        quem: !m.fromMe ? 'cliente' : (m.body && doRobo.has(m.body.trim()) ? 'robo' : 'senhor'),
        quando: new Date(m.timestamp * 1000).toISOString(),
        tipo: m.type,
        texto: m.type === 'chat' ? m.body : (m.body ? `[${m.type}] ${m.body}` : `[${m.type}]`),
      }));
    if (!linhas.length) continue;
    out.push({ contato: c.name || c.id.user, id: c.id._serialized, total: linhas.length, mensagens: linhas });
    if (++n % 20 === 0) console.log('lidas', n);
  }
  fs.mkdirSync(path.dirname(SAIDA), { recursive: true });
  fs.writeFileSync(SAIDA, JSON.stringify(out, null, 1));
  const tot = out.reduce((a, c) => a + c.total, 0);
  const sen = out.reduce((a, c) => a + c.mensagens.filter((m) => m.quem === 'senhor').length, 0);
  const datas = out.flatMap((c) => c.mensagens.map((m) => m.quando)).sort();
  console.log(JSON.stringify({ conversas: out.length, mensagens: tot, do_senhor: sen, de: datas[0], ate: datas[datas.length - 1] }));
  await client.destroy();
  process.exit(0);
});
client.on('auth_failure', (m) => { console.log('falha de login', m); process.exit(1); });
client.on('qr', () => { console.log('sessão caiu: precisa de QR'); process.exit(1); });
client.initialize();
setTimeout(() => { console.log('tempo esgotado'); process.exit(1); }, 15 * 60e3);
