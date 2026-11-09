// Sincronização PC -> nuvem dos relatórios (só saída por HTTPS; nenhuma porta aberta).
// Config em nuvem.local.json: { "url": "https://rv-xxxx.copythief.men", "token_sync": "..." } (fora do git).
// A cada 30 s confere se há o que enviar; a cada 12 s consulta comandos da fila. Limites de escrita no KV (plano grátis: 1.000/dia):
// conteúdo novo no mínimo a cada 75 s, "estou vivo" a cada 150 s, teto de 800 escritas por dia UTC (depois, 1 por 15 min).
// Envia os dados de todas as abas (EXTRAS + tráfego + grafo + pendentes + revendedores). Nunca o conversas.log.
// Botões da nuvem chegam como comando 'acao' (lista ACOES) e o PC repete o POST na API local. Cada comando roda UMA vez só.
import path from 'node:path';
import crypto from 'node:crypto';
import { AQUI, PASTA, lerJson, resumo, lerRevendedoresLista } from './lib.mjs';
import { resumoTrafego } from './trafego-lib.mjs';

const CONFIG = path.join(AQUI, 'nuvem.local.json');
const LOCAL = 'http://127.0.0.1:' + Number(process.env.RELATORIOS_PORTA || 8811);
// 09/11/2026: todas as abas do PC também na nuvem. Chave do snapshot -> rota local (GET).
export const EXTRAS = {
  resumo1: '/api/resumo?dias=1', resumo7: '/api/resumo?dias=7',            // pela API local: inclui funil_estrategia
  escritorio1: '/api/escritorio?dias=1', escritorio7: '/api/escritorio?dias=7',
  funil1: '/api/funil?dias=1', funil7: '/api/funil?dias=7', jornada: '/api/jornada', etiquetas: '/api/etiquetas',
  followups1: '/api/followups?dias=1', followups7: '/api/followups?dias=7', backlog: '/api/backlog',
  uso1: '/api/uso?dias=1', uso7: '/api/uso?dias=7', lacunas: '/api/lacunas', releitura: '/api/releitura',
  versoes: '/api/versoes', voz: '/api/voz',
};
// Botões que a nuvem pode pedir ao PC (o PC repete o POST na API local). Mesma lista no worker.
export const ACOES = ['/api/funil/pausar', '/api/funil/retomar', '/api/funil/reaquecer', '/api/funil/jogadas',
  '/api/jornada/pausar', '/api/jornada/retomar', '/api/jornada/tocar', '/api/releitura', '/api/voz',
  '/api/backlog/mapear', '/api/backlog/pausar', '/api/backlog/retomar'];
async function local(rota, metodo = 'GET', corpo) {
  const r = await fetch(LOCAL + rota, { method: metodo, headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo), signal: AbortSignal.timeout(metodo === 'GET' ? 30000 : 280000) });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = { ok: false, erro: 'resposta inválida do PC' }; }
  if (metodo === 'GET' && !r.ok) throw new Error(`${rota} local respondeu ${r.status}`);
  return metodo === 'GET' ? j : { status: r.status, ...(j && typeof j === 'object' && !Array.isArray(j) ? j : { valor: j }) };
}
const TICK_MS = 30000, CMD_MS = 12000;
const MIN_MUDOU_MS = 75000, MIN_VIVO_MS = 150000, MIN_VIVO_TETO_MS = 900000, TETO_DIA = 800;

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const log = (...a) => console.log('[nuvem]', ...a);

// tira o que muda sozinho a cada leitura (relógios) para só contar mudança de verdade
function normalizar(d) {
  const c = JSON.parse(JSON.stringify(d));
  const limpa = (o, ks) => { for (const k of ks) delete o[k]; };
  limpa(c.resumo1, ['gerado_em']); if (c.resumo1.periodo) delete c.resumo1.periodo.fim;
  limpa(c.resumo7, ['gerado_em']); if (c.resumo7.periodo) delete c.resumo7.periodo.fim;
  limpa(c.revendedores, ['gerado_em']);
  for (const k of ['grafo1', 'grafo7']) if (c[k]) {              // o grafo carimba a hora atual no último ponto da evolução
    const g = c[k], agoraG = g.gerado_em; limpa(g, ['gerado_em']); if (g.periodo) delete g.periodo.fim;
    for (const p of g.evolucao || []) if (p && p.quando === agoraG) delete p.quando;
  }
  for (const k of ['trafego1', 'trafego7', 'trafego30']) if (c[k]) { limpa(c[k], ['gerado_em']); delete c[k].periodo; }
  for (const k of Object.keys(EXTRAS)) if (c[k] && typeof c[k] === 'object') limpa(c[k], ['gerado_em']);
  if (c.voz) limpa(c.voz, ['agora', 'historico']);                // CPU e temperatura mudam a cada leitura
  // o vigia carimba a hora dele a cada 2 min: para o hash, conta só de 10 em 10 min (a tela ainda vê o horário real)
  const vigias = new Set();
  const andar = (o) => { if (!o || typeof o !== 'object') return; if (Array.isArray(o)) { o.forEach(andar); return; }
    for (const k of ['vigia_em', 'leads_em']) if (typeof o[k] === 'string') { vigias.add(o[k]); o[k] = o[k].slice(0, 15); }
    for (const v of Object.values(o)) andar(v); };
  andar(c);
  const tiraQuando = (o) => { if (!o || typeof o !== 'object') return; if (Array.isArray(o)) { o.forEach(tiraQuando); return; }
    if (typeof o.quando === 'string' && vigias.has(o.quando)) delete o.quando; for (const v of Object.values(o)) tiraQuando(v); };
  tiraQuando(c);
  limpa(c.pendentes, ['quando']); for (const i of c.pendentes.itens || []) delete i.desde_min;
  return c;
}
// trava de privacidade: nenhum campo de senha vai para a nuvem
const TEM_SENHA = /"(senha|senha_[a-z_]*|password|passwd|token|secret|api_?key)"\s*:/i;

export function iniciarSync({ reanalisar, aprender, carregarGrafo }) {
  const estado = { ultimoEnvio: 0, ultimoHash: '', escritasDia: 0, dia: '', forcar: false, andamento: new Set(), feitos: new Map(), resultados: [], ultimos: {}, ultimoErro: '', semConfig: false };

  const config = () => { const c = lerJson(CONFIG, null); return c && c.url && c.token_sync ? c : null; };
  // snapshot: vai cru (o corpo é só os dados; hash e forcar em cabeçalho) para o Worker não precisar ler o JSON de ~800 KB
  async function chamar(cfg, metodo, rota, corpo, cru) {
    const headers = { Authorization: 'Bearer ' + cfg.token_sync, 'Content-Type': 'application/json' };
    if (cru !== undefined) { headers['X-Hash'] = corpo.hash; if (corpo.forcar) headers['X-Forcar'] = '1'; }
    const r = await fetch(cfg.url.replace(/\/$/, '') + rota, {
      method: metodo, headers,
      body: cru !== undefined ? cru : corpo === undefined ? undefined : JSON.stringify(corpo), signal: AbortSignal.timeout(20000),
    });
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
    if (!r.ok) throw new Error(`${rota} respondeu ${r.status}`);
    return j;
  }
  const falhou = (e) => { const m = String(e && e.message || e); if (m !== estado.ultimoErro) { estado.ultimoErro = m; log('erro:', m); } };
  const deuCerto = () => { if (estado.ultimoErro) { log('voltou a enviar'); estado.ultimoErro = ''; } };

  async function coletar() {
    const lista = lerRevendedoresLista();
    const d = {
      resumo1: await resumo({ dias: 1 }), resumo7: await resumo({ dias: 7 }),
      pendentes: lerJson(path.join(PASTA, 'pendentes.json'), { total: 0, itens: [], quando: null }),
      revendedores: { gerado_em: new Date().toISOString(), total: lista.length, revendedores: lista },
    };
    // se uma aba falhar nesta volta, vai a última boa (a nuvem grava o snapshot inteiro, sem juntar com o antigo)
    await Promise.all(Object.entries(EXTRAS).map(async ([k, rota]) => { try { d[k] = await local(rota); estado.ultimos[k] = d[k]; } catch (e) { falhou(e); if (estado.ultimos[k] !== undefined) d[k] = estado.ultimos[k]; } }));
    try { d.trafego1 = resumoTrafego({ dias: 1 }); d.trafego7 = resumoTrafego({ dias: 7 }); d.trafego30 = resumoTrafego({ dias: 30 }); } catch (e) { falhou(e); }   // aba Tráfego
    try {                                                          // grafo é opcional: só entra se relatorios/grafo.mjs existir e funcionar
      const g = carregarGrafo ? await carregarGrafo() : null;
      if (g) { d.grafo1 = await g({ dias: 1 }); d.grafo7 = await g({ dias: 7 }); estado.ultimos.grafo1 = d.grafo1; estado.ultimos.grafo7 = d.grafo7; }
    } catch (e) { falhou(e); for (const k of ['grafo1', 'grafo7']) if (d[k] === undefined && estado.ultimos[k] !== undefined) d[k] = estado.ultimos[k]; }
    return d;
  }

  async function tick() {
    const cfg = config();
    if (!cfg) { if (!estado.semConfig) { estado.semConfig = true; log('desligado: falta relatorios\nuvem.local.json'); } return; }
    estado.semConfig = false;
    const hoje = new Date().toISOString().slice(0, 10);
    if (estado.dia !== hoje) { estado.dia = hoje; estado.escritasDia = 0; }
    const agora = Date.now();
    const vivoMs = estado.escritasDia >= TETO_DIA ? MIN_VIVO_TETO_MS : MIN_VIVO_MS;
    const mudouMs = estado.escritasDia >= TETO_DIA ? MIN_VIVO_TETO_MS : MIN_MUDOU_MS;
    const desde = agora - estado.ultimoEnvio;
    if (!estado.forcar && desde < mudouMs) return;
    const dados = await coletar();
    const corpo = JSON.stringify(dados);
    if (TEM_SENHA.test(corpo)) { falhou(new Error('campo de senha nos dados: envio bloqueado')); return; }
    const hash = sha(JSON.stringify(normalizar(dados)));
    if (!estado.forcar && hash === estado.ultimoHash && desde < vivoMs) return;   // nada mudou e ainda não é hora do "estou vivo"
    const r = await chamar(cfg, 'PUT', '/sync/snapshot', { hash, dados, forcar: estado.forcar }, corpo);
    deuCerto();
    if (r && r.gravou) { estado.ultimoEnvio = agora; estado.escritasDia++; estado.ultimoHash = hash; estado.forcar = false; }
    else if (r && r.motivo === 'limite') estado.ultimoEnvio = agora - Math.max(0, mudouMs - 30000);  // tenta de novo em ~30 s
  }

  async function executar(cfg, c) {
    let resultado;
    try {
      if (c.tipo === 'ping') resultado = { ok: true, eco: c.eco || '', pc_em: new Date().toISOString() };
      else if (c.tipo === 'reanalisar') resultado = await reanalisar();
      else if (c.tipo === 'aprender') {
        resultado = await aprender();
        if (resultado && resultado.ultima_rodada && JSON.stringify(resultado).length > 30000) delete resultado.ultima_rodada;
      } else if (c.tipo === 'acao' && ACOES.includes(c.rota)) {
        resultado = await local(c.rota, 'POST', c.corpo && typeof c.corpo === 'object' ? c.corpo : {});
        if (JSON.stringify(resultado).length > 30000) resultado = { ok: resultado.ok !== false, status: resultado.status, resumido: true };
      } else resultado = { ok: false, motivo: 'comando desconhecido' };
    } catch (e) { resultado = { ok: false, motivo: String(e && e.message || e) }; }
    estado.feitos.set(c.id, Date.now());                          // já rodou: nunca roda de novo, mesmo se a resposta não chegar à nuvem
    estado.andamento.delete(c.id);
    estado.resultados.push({ id: c.id, tipo: c.tipo, chave: c.chave, resultado, tentativas: 0 });
    log('comando', c.tipo, c.rota || '', 'feito');
    await entregar(cfg);
  }
  async function entregar(cfg) {                                   // devolve os resultados; o que falhar tenta de novo no próximo ciclo
    while (estado.resultados.length) {
      const r = estado.resultados[0];
      try { await chamar(cfg, 'POST', '/sync/resultado', { id: r.id, tipo: r.tipo, chave: r.chave, resultado: r.resultado }); estado.resultados.shift(); estado.forcar = true; }
      catch (e) { falhou(e); if (++r.tentativas >= 50) estado.resultados.shift(); return; }
    }
  }

  async function comandos() {
    const cfg = config(); if (!cfg) return;
    if (estado.resultados.length) await entregar(cfg);
    const r = await chamar(cfg, 'GET', '/sync/comandos');
    deuCerto();
    for (const c of (r && r.comandos) || []) {
      if (estado.andamento.has(c.id) || estado.feitos.has(c.id)) continue;
      estado.andamento.add(c.id);
      log('comando', c.tipo, 'recebido');
      executar(cfg, c);                                            // não espera: o ciclo de 12 s segue
    }
    for (const [id, em] of estado.feitos) if (Date.now() - em > 60 * 60e3) estado.feitos.delete(id);   // a nuvem expira pedido em 10 min
  }

  const rodar = (fn) => { let ocupado = false; return async () => { if (ocupado) return; ocupado = true; try { await fn(); } catch (e) { falhou(e); } finally { ocupado = false; } }; };
  const t1 = rodar(tick), t2 = rodar(comandos);
  setTimeout(t1, 3000); setInterval(t1, TICK_MS);
  setTimeout(t2, 5000); setInterval(t2, CMD_MS);
  log('sincronização iniciada');
}
