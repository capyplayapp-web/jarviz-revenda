// Registro do gasto de IA do robô (08/11/2026, pedido do senhor: "quantos tokens o robô gasta para responder, gerenciar e analisar").
// Toda chamada do claude -p usa --output-format json; desembrulhar() grava os tokens em uso-ia.jsonl e devolve o texto da resposta.
// Áreas: responder (atendimento ao vivo), followup, funil (cadência/jornada/vigia), backlog, releitura, aprender, lacunas, jogadas.
const fs = require('fs');
const path = require('path');
const ARQ = path.join(__dirname, 'uso-ia.jsonl');

function registrar(area, env, modelo) {
  try {
    const u = (env && env.usage) || {};
    const linha = {
      t: new Date().toISOString(), area, modelo: modelo || null,
      entrada: u.input_tokens || 0, cache_lida: u.cache_read_input_tokens || 0, cache_criada: u.cache_creation_input_tokens || 0,
      saida: u.output_tokens || 0, custo: Number(env && env.total_cost_usd) || 0, ms: (env && env.duration_ms) || null,
    };
    fs.appendFileSync(ARQ, JSON.stringify(linha) + '\n');
  } catch {}
}

// out = stdout do claude -p. Se for o envelope JSON, registra e devolve env.result; senão devolve out como veio.
function desembrulhar(out, area, modelo) {
  const s = String(out || '').trim();
  if (!s.startsWith('{')) return s;
  let env; try { env = JSON.parse(s); } catch { return s; }
  if (!env || env.type !== 'result') return s;
  registrar(area, env, modelo);
  return typeof env.result === 'string' ? env.result : '';
}

module.exports = { registrar, desembrulhar, ARQ };
