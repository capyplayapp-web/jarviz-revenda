// Testes dos relatórios: valida o contrato de /api/resumo com os dados reais e confere que não há senha nos arquivos novos.
//   node relatorios/testar.mjs
// Sobe uma cópia do servidor numa porta de teste (8813), não mexe no servidor em uso, e não imprime nenhuma senha.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { AQUI, PASTA, ARQ, NOTA_COFRE } from './lib.mjs';

const PORTA = 8813;
let falhas = 0, total = 0;
const ok = (cond, nome, detalhe = '') => { total++; if (!cond) falhas++; console.log((cond ? 'OK     ' : 'FALHOU ') + nome + (detalhe ? '  [' + detalhe + ']' : '')); };
const tipo = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
const temChaves = (o, chaves, onde) => chaves.every((k) => k in (o || {})) || (console.log('   faltam em ' + onde + ': ' + chaves.filter((k) => !(k in (o || {}))).join(',')), false);
const iso = (s) => typeof s === 'string' && !Number.isNaN(Date.parse(s));

const srv = spawn(process.execPath, [path.join(AQUI, 'server.mjs')], { cwd: AQUI, env: { ...process.env, RELATORIOS_PORTA: String(PORTA) }, windowsHide: true, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const get = async (rota, opts) => { const r = await fetch(`http://127.0.0.1:${PORTA}${rota}`, opts); return { status: r.status, json: await r.json().catch(() => null) }; };

try {
  const ping = await get('/api/ping'); ok(ping.status === 200 && ping.json?.ok, 'GET /api/ping');
  for (const dias of [1, 7]) {
    const { status, json: j } = await get('/api/resumo?dias=' + dias);
    ok(status === 200 && !!j, `GET /api/resumo?dias=${dias} responde 200`);
    if (!j) continue;
    ok(iso(j.gerado_em) && iso(j.periodo?.inicio) && iso(j.periodo?.fim), 'gerado_em e periodo em ISO');
    const k = j.kpis || {};
    const kn = ['conversas_novas', 'mensagens_recebidas', 'respostas_robo', 'paineis_fechados', 'testes_gerados', 'passados_ao_senhor', 'followups_enviados', 'followups_respondidos', 'taxa_resposta_followup', 'tempo_medio_primeira_resposta_s'];
    ok(temChaves(k, kn, 'kpis') && kn.every((n) => typeof k[n] === 'number' && Number.isFinite(k[n]) && k[n] >= 0), 'kpis: 10 campos numéricos');
    ok(k.taxa_resposta_followup <= 1 && k.followups_respondidos <= k.followups_enviados, 'taxa de follow-up entre 0 e 1 e respondidos <= enviados');
    ok(Array.isArray(j.followups?.por_etapa) && j.followups.por_etapa.length === 4 && j.followups.por_etapa.every((e) => temChaves(e, ['n', 'minutos', 'enviados', 'respondidos', 'taxa', 'paineis_depois'], 'por_etapa')), 'followups.por_etapa (4 etapas)');
    ok(Array.isArray(j.followups?.recentes) && j.followups.recentes.every((r) => temChaves(r, ['quando', 'nome', 'n', 'texto', 'respondeu', 'minutos_ate_resposta'], 'recentes') && typeof r.respondeu === 'boolean'), 'followups.recentes');
    ok(Array.isArray(j.funil) && j.funil.length === 4 && j.funil.every((f) => typeof f.etapa === 'string' && Number.isInteger(f.qtd)), 'funil (4 etapas)');
    ok(Array.isArray(j.paineis) && j.paineis.every((p) => temChaves(p, ['quando', 'nome', 'telefone', 'usuario_painel', 'painel_id', 'origem'], 'paineis') && ['robo', 'senhor', 'historico'].includes(p.origem)), 'paineis', j.paineis?.length + ' no período');
    ok(j.kpis.paineis_fechados === j.paineis.length, 'kpis.paineis_fechados == paineis.length');
    ok(Array.isArray(j.conversas_ativas) && j.conversas_ativas.every((c) => temChaves(c, ['nome', 'telefone', 'etapa', 'ultimo_contato', 'followups_enviados', 'quieto_ate', 'precisa_do_senhor'], 'conversas_ativas')), 'conversas_ativas', j.conversas_ativas?.length + ' conversas');
    const u = j.ultimas_2h || {};
    ok(temChaves(u, ['gerado_em', 'resumo', 'funcionou', 'deu_errado', 'regras_novas', 'sugestoes_para_o_senhor', 'inconsistencias'], 'ultimas_2h') && Array.isArray(u.inconsistencias), 'ultimas_2h (com inconsistencias)', u.gerado_em ? 'gerado ' + u.gerado_em : 'ainda sem leitura');
    ok(Array.isArray(j.horas) && j.horas.length === 24 && j.horas.every((h) => /^\d\dh$/.test(h.hora) && Number.isInteger(h.mensagens) && Number.isInteger(h.respostas)), 'horas (24 faixas)');
    ok(temChaves(j.saude, ['robo_ligado', 'processos_bot', 'ultimo_evento', 'repeticoes_bloqueadas', 'erros'], 'saude') && typeof j.saude.robo_ligado === 'boolean', 'saude', `processos_bot=${j.saude?.processos_bot}`);
    if (dias === 1) {
      console.log('   hoje: ' + JSON.stringify(j.kpis));
      console.log('   follow-up por etapa: ' + j.followups.por_etapa.map((e) => `${e.n}º(${e.minutos}min) ${e.respondidos}/${e.enviados}`).join(' | '));
    }
  }
  const rv = await get('/api/revendedores');
  ok(rv.status === 200 && Array.isArray(rv.json?.revendedores) && rv.json.total === rv.json.revendedores.length, 'GET /api/revendedores', rv.json?.total + ' revendedores');
  const web = await fetch(`http://127.0.0.1:${PORTA}/`); ok(web.status === 200, 'GET / (página)', 'HTTP ' + web.status);
  const trav = await fetch(`http://127.0.0.1:${PORTA}/..%2f..%2fclientes.json`); ok(trav.status !== 200, 'bloqueia caminho fora de web\\', 'HTTP ' + trav.status);
} finally { srv.kill(); }

// ---------- sem senha nos arquivos novos ----------
const log = fs.readFileSync(ARQ.log, 'utf8');
const senhas = new Set();
for (const m of log.matchAll(/Senha:\s*(\S+)/gi)) if (m[1].length >= 4 && !/oculta/.test(m[1])) senhas.add(m[1]);
for (const m of log.matchAll(/\bsenha\s+(\S*\d\S*)/gi)) if (m[1].length >= 4) senhas.add(m[1].replace(/[.,;]+$/, ''));
const alvos = [ARQ.eventos, ARQ.historico, ARQ.revendedores, ARQ.painelSync, ARQ.aprendizados, ARQ.aprendizadosMd, path.join(AQUI, 'LEIAME.md'), path.join(PASTA, 'prompt-haiku.tmp.md'), NOTA_COFRE, path.join(AQUI, 'prompt-aprender.md'), path.join(AQUI, 'aprender-estado.json')];
for (const f of fs.readdirSync(AQUI)) if (/\.(mjs|json|md)$/.test(f)) alvos.push(path.join(AQUI, f));
let vazou = 0, lidos = 0, padrao = 0;
for (const f of new Set(alvos)) {
  let t; try { t = fs.readFileSync(f, 'utf8'); } catch { continue; } lidos++;
  for (const s of senhas) if (t.includes(s)) { vazou++; console.log('   senha encontrada em ' + path.basename(f) + ' (valor não exibido)'); }
  if (/\.(json|jsonl|md)$/.test(f) && /(senha|password)\s*[:=]\s*(?!\[oculta\])\S+/i.test(t.replace(/Usuário\/Senha|"Senha"/g, ''))) { padrao++; console.log('   padrão "senha: valor" em ' + path.basename(f)); }
}
ok(senhas.size > 0, 'achou senhas reais no conversas.log para conferir', senhas.size + ' senhas distintas (valores não exibidos)');
ok(vazou === 0, 'nenhuma senha do log aparece nos arquivos novos', lidos + ' arquivos lidos');
ok(padrao === 0, 'nenhum padrão "senha: valor" nos arquivos de dados');
try { const tk = fs.readFileSync('D:/Projetos/_segredos/painel-capyplay-api-token.txt', 'utf8').trim(); let achou = 0; for (const f of new Set(alvos)) { try { if (tk && fs.readFileSync(f, 'utf8').includes(tk)) achou++; } catch {} } ok(achou === 0, 'token do painel não aparece nos arquivos novos'); } catch { /* sem token: nada a conferir */ }

console.log(`\n${total - falhas}/${total} verificações passaram`);
process.exit(falhas ? 1 : 0);
