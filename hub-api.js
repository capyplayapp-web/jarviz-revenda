// Porta interna do Hub do senhor (10/11/2026): o Hub mostra as conversas do WhatsApp como no WhatsApp Web.
// Só escuta em 127.0.0.1:8871 e exige o cabeçalho X-Hub-Token (arquivo hub-token.txt), para nenhuma página da internet usar.
// Rotas: GET /msgs?chat=&n=  GET /midia?id=  GET /foto?chat=  GET /info?chats=a,b  POST /enviar {chat, texto}
// O que o senhor envia por aqui sai do WhatsApp dele e o robô trata como "o senhor escreveu" (não entra em enviadasPeloRobo).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

module.exports = function hubApi({ client, enviadasPeloRobo, log }) {
  const ARQ_TOKEN = path.join(__dirname, 'hub-token.txt');
  let token = '';
  try { token = fs.readFileSync(ARQ_TOKEN, 'utf8').trim(); } catch {}
  if (token.length < 32) { token = crypto.randomBytes(24).toString('hex'); fs.writeFileSync(ARQ_TOKEN, token); }
  const CACHE = path.join(__dirname, 'midia-cache');
  fs.mkdirSync(CACHE, { recursive: true });
  const vistas = new Map();          // id -> objeto Message (para baixar mídia sem procurar de novo)
  const lembra = (m) => { vistas.set(m.id._serialized, m); if (vistas.size > 3000) vistas.delete(vistas.keys().next().value); };
  const pronto = () => !!(client.info && client.info.wid);
  const json = (res, cod, obj) => { res.writeHead(cod, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
  const corpo = (req) => new Promise((ok) => { let s = ''; req.on('data', (d) => { s += d; if (s.length > 20000) req.destroy(); }); req.on('end', () => { try { ok(JSON.parse(s || '{}')); } catch { ok({}); } }); });
  const comLimite = (p, ms) => Promise.race([p, new Promise((_, n) => setTimeout(() => n(new Error('demorou')), ms))]);
  const valido = (id) => /^[\w.-]+@(c\.us|lid|g\.us|s\.whatsapp\.net)$/.test(String(id || ''));

  function resumo(m) {
    return {
      id: m.id._serialized, t: (m.timestamp || 0) * 1000, eu: !!m.fromMe, tipo: m.type, texto: m.body || '',
      midia: !!m.hasMedia, ack: m.ack, enc: !!m.isForwarded, dur: m.duration ? +m.duration : undefined,
      robo: m.fromMe ? enviadasPeloRobo.has(m.id._serialized) : undefined,
      cit: m.hasQuotedMsg && m._data && m._data.quotedMsg ? String(m._data.quotedMsg.body || m._data.quotedMsg.caption || '').slice(0, 200) : undefined,
      nomeArq: m._data && m._data.filename || undefined,
    };
  }

  async function rota(req, res) {
    const url = new URL(req.url, 'http://x');
    if (req.headers['x-hub-token'] !== token) return json(res, 403, { erro: 'sem token' });
    if (!pronto()) return json(res, 503, { erro: 'WhatsApp carregando' });
    const q = Object.fromEntries(url.searchParams);
    if (url.pathname === '/msgs' && req.method === 'GET') {
      if (!valido(q.chat)) return json(res, 400, { erro: 'chat inválido' });
      const chat = await comLimite(client.getChatById(q.chat), 15000);
      const msgs = await comLimite(chat.fetchMessages({ limit: Math.min(+q.n || 80, 200) }), 20000);
      msgs.forEach(lembra);
      return json(res, 200, { chat: q.chat, fixada: !!chat.pinned, naoLidas: chat.unreadCount || 0, msgs: msgs.filter((m) => !['e2e_notification', 'notification_template', 'protocol', 'ciphertext', 'revoked', 'gp2', 'call_log'].includes(m.type)).map(resumo) });
    }
    if (url.pathname === '/info' && req.method === 'GET') {
      const ids = String(q.chats || '').split(',').filter(valido).slice(0, 120);
      const out = {};
      for (const id of ids) { try { const c = await comLimite(client.getChatById(id), 5000); out[id] = { fixada: !!c.pinned, naoLidas: c.unreadCount || 0 }; } catch {} }
      return json(res, 200, out);
    }
    if (url.pathname === '/midia' && req.method === 'GET') {
      const id = String(q.id || '');
      if (!/^[\w@.:-]+$/.test(id) || id.length > 200) return json(res, 400, { erro: 'id inválido' });
      const arq = path.join(CACHE, crypto.createHash('sha1').update(id).digest('hex'));
      if (fs.existsSync(arq) && fs.existsSync(arq + '.tipo')) {
        res.writeHead(200, { 'Content-Type': fs.readFileSync(arq + '.tipo', 'utf8'), 'Cache-Control': 'private, max-age=86400' });
        return fs.createReadStream(arq).pipe(res);
      }
      const m = vistas.get(id) || await comLimite(client.getMessageById(id), 15000).catch(() => null);
      if (!m || !m.hasMedia) return json(res, 404, { erro: 'sem mídia' });
      const md = await comLimite(m.downloadMedia(), 60000).catch(() => null);
      if (!md || !md.data) return json(res, 404, { erro: 'mídia indisponível no aparelho' });
      const buf = Buffer.from(md.data, 'base64');
      fs.writeFileSync(arq, buf); fs.writeFileSync(arq + '.tipo', md.mimetype || 'application/octet-stream');
      res.writeHead(200, { 'Content-Type': md.mimetype || 'application/octet-stream', 'Cache-Control': 'private, max-age=86400' });
      return res.end(buf);
    }
    if (url.pathname === '/foto' && req.method === 'GET') {
      if (!valido(q.chat)) return json(res, 400, { erro: 'chat inválido' });
      const u = await comLimite(client.getProfilePicUrl(q.chat), 10000).catch(() => null);
      return json(res, 200, { url: u || null });
    }
    if (url.pathname === '/enviar' && req.method === 'POST') {
      const b = await corpo(req);
      const texto = String(b.texto || '').trim();
      if (!valido(b.chat) || !texto || texto.length > 4000) return json(res, 400, { erro: 'pedido inválido' });
      const chat = await comLimite(client.getChatById(b.chat), 15000);
      const m = await comLimite(chat.sendMessage(texto), 20000);
      lembra(m);
      log(`Hub: o senhor enviou mensagem para ${b.chat}`);
      return json(res, 200, { ok: true, msg: resumo(m) });
    }
    return json(res, 404, { erro: 'rota' });
  }

  const srv = http.createServer((req, res) => { rota(req, res).catch((e) => { try { json(res, 500, { erro: String(e && e.message || e).slice(0, 200) }); } catch {} }); });
  // Porta da variante (variante.json, 10/11/2026); sem o arquivo, a da revenda.
  let porta = 8871;
  try { porta = Number(JSON.parse(fs.readFileSync(path.join(__dirname, 'variante.json'), 'utf8')).porta_hub) || 8871; } catch {}
  srv.on('error', (e) => log(`porta do Hub (${porta}) não abriu: ` + e.message));
  srv.listen(porta, '127.0.0.1', () => log(`porta do Hub aberta em 127.0.0.1:${porta}`));
  // limpa mídia guardada há mais de 7 dias
  setInterval(() => { try { for (const f of fs.readdirSync(CACHE)) { const p = path.join(CACHE, f); if (Date.now() - fs.statSync(p).mtimeMs > 7 * 864e5) fs.unlinkSync(p); } } catch {} }, 6 * 3600e3);
};
