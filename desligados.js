// Conversas em que o robô fica desligado de vez (não responde, não faz follow-up, não manda nada).
// Lista em desligados.json: { "<chatId>": "nome / motivo" }. Lida de novo quando o arquivo muda.
const fs = require('fs');
const path = require('path');
const ARQ = path.join(__dirname, 'desligados.json');
let lista = {}, marca = -1;
function desligado(chatId) {
  try { const m = fs.statSync(ARQ).mtimeMs; if (m !== marca) { lista = JSON.parse(fs.readFileSync(ARQ, 'utf8')); marca = m; } } catch { lista = {}; marca = -1; }
  return !!chatId && Object.prototype.hasOwnProperty.call(lista, chatId);
}
module.exports = { desligado };
