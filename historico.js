// Histórico permanente de revendedores (diretriz de 10/11/2026): ao apagar desativados no painel, o histórico não se perde.
// Todo dia (e ao ligar, se faltar o do dia) grava historico\AAAA-MM-DD.json com os dados dos revendedores. Nunca grava senha, token nem M3U.
// Antes de apagar qualquer painel, revendedor ou cliente: node historico.js --antes-de-apagar
'use strict';
const fs = require('fs');
const path = require('path');
const PASTA = path.join(__dirname, 'historico');
const hoje = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
function ler(f) { try { return JSON.parse(fs.readFileSync(path.join(__dirname, f), 'utf8')); } catch { return null; } }
function snapshot(motivo = 'diario') {
  fs.mkdirSync(PASTA, { recursive: true });
  const rev = ler('revendedores.json') || {};
  const sig = ler('sigma-cache.json') || {};
  const dados = {
    gerado_em: new Date().toISOString(), motivo,
    robo: Object.entries(rev).map(([chat, v]) => ({ chat, nome: v.nome, telefone: v.telefone || null, usuario_painel: v.usuario_painel || null, painel_id: v.painel_id ?? null, painel_numero: v.painel_numero ?? null, fechou_em: v.fechou_em || null, origem: v.origem || null, uso: v.uso || null })),
    painel: (sig.revendedores || []).map((r) => ({ id: r.id, usuario: r.usuario, nome: r.nome, whatsapp: r.whatsapp, status: r.status, creditos: r.creditos, clientes: r.clientes, clientes_total: r.clientes_total, ultimo_login: r.ultimo_login })),
    painel_lido_em: sig.lido_em || null,
  };
  const nome = path.join(PASTA, `${hoje()}${motivo === 'diario' ? '' : '-' + motivo}.json`);
  fs.writeFileSync(nome, JSON.stringify(dados));
  return { arquivo: nome, robo: dados.robo.length, painel: dados.painel.length };
}
function garantirDoDia() { if (!fs.existsSync(path.join(PASTA, `${hoje()}.json`))) return snapshot('diario'); return null; }
module.exports = { snapshot, garantirDoDia };
if (require.main === module) { const r = snapshot(process.argv.includes('--antes-de-apagar') ? 'antes-de-apagar' : 'diario'); console.log(JSON.stringify(r)); }
