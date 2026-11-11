// Lista negra de golpistas (diretriz de 10/11/2026): quem estiver aqui NÃO recebe resposta, link nem kit do robô, e o senhor é avisado.
// Entra só por decisão do senhor (nunca automático). Arquivo: lista-negra.json = { "<chave>": { nome, telefone, chat, usuario_painel, motivo, valor_devido, desde } }.
// A chave é o telefone só com dígitos (ou o id do chat). Uso na linha de comando:
//   node lista-negra.js add <telefone|chatId> "motivo" [valor] ["nome"]   |   node lista-negra.js remove <chave>   |   node lista-negra.js list
'use strict';
const fs = require('fs');
const path = require('path');
const ARQ = path.join(__dirname, 'lista-negra.json');
let lista = {}, marca = -1;
const digitos = (s) => String(s || '').replace(/\D/g, '');
function ler() {
  try { const m = fs.statSync(ARQ).mtimeMs; if (m !== marca) { lista = JSON.parse(fs.readFileSync(ARQ, 'utf8')); marca = m; } } catch { lista = {}; marca = -1; }
  return lista;
}
function gravar(l) { fs.writeFileSync(ARQ, JSON.stringify(l, null, 1)); marca = -1; }
// bloqueado({ chatId, telefone }): procura pelo telefone (dígitos) ou pelo id do chat.
function bloqueado({ chatId, telefone } = {}) {
  const l = ler();
  const t = digitos(telefone);
  if (chatId && l[chatId]) return l[chatId];
  const cid = digitos(String(chatId || '').split('@')[0]);
  for (const [k, v] of Object.entries(l)) {
    const kd = digitos(k);
    if (t && (kd === t || digitos(v.telefone) === t)) return v;
    if (cid && (kd === cid || digitos(v.chat).startsWith(cid) && cid.length > 8)) return v;
  }
  return null;
}
module.exports = { bloqueado, ler, gravar };
if (require.main === module) {
  const [cmd, a, b, c, d] = process.argv.slice(2);
  const l = ler();
  if (cmd === 'add' && a) {
    const chave = a.includes('@') ? a : digitos(a);
    l[chave] = { nome: d || '', telefone: a.includes('@') ? '' : digitos(a), chat: a.includes('@') ? a : '', motivo: b || '', valor_devido: c || '', desde: new Date().toISOString() };
    gravar(l); console.log('na lista negra:', chave);
  } else if (cmd === 'remove' && a) { delete l[a]; gravar(l); console.log('retirado:', a); }
  else console.log(JSON.stringify(l, null, 1));
}
