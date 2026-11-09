// atualizar.mjs - baixa filmes e séries do painel (API Xtream/XUI, SOMENTE LEITURA) e grava catalogo.json + catalogo-meta.json.
//
//   node catalogo/atualizar.mjs               baixa e grava (precisa de catalogo\credencial.json)
//   node catalogo/atualizar.mjs --se-velho    só baixa se o catálogo tiver mais de 12 h (para rodar em tarefa agendada)
//   node catalogo/atualizar.mjs --semente     grava catalogo-semente.json (títulos de exemplo, FICTÍCIO, só para testes)
//
// Credencial (nunca impressa, nunca gravada em log/saída): catalogo\credencial.json
//   { "servidores": ["http://capyplay.space", "http://capyplay.fun", "http://spar.lat"], "usuario": "...", "senha": "..." }
// Ou variáveis CATALOGO_USUARIO / CATALOGO_SENHA / CATALOGO_SERVIDORES (separados por vírgula).
// Usa só: player_api.php (login) e action=get_vod_categories|get_vod_streams|get_series_categories|get_series.
// Não abre stream, não cria nem altera nada no painel. Saída com código 2 = falta credencial; 1 = falha ao baixar.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const cat = require('./catalogo.js');
const PASTA = path.dirname(fileURLToPath(import.meta.url));
const SAIDA = process.env.CATALOGO_SAIDA || PASTA; // só os testes mudam isto
const ARQ = path.join(SAIDA, 'catalogo.json');
const META = path.join(SAIDA, 'catalogo-meta.json');
const LOCK = path.join(SAIDA, 'atualizar.lock');
const CRED = process.env.CATALOGO_CREDENCIAL_ARQUIVO || path.join(PASTA, 'credencial.json');
const DOZE_HORAS = 12 * 36e5;

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

export class SemCredencial extends Error {}

export const MENSAGEM_SEM_CREDENCIAL = `Falta a credencial de leitura do painel. O que o senhor precisa fazer:
  1. Criar no painel um usuário (linha) só para o catálogo, com validade longa e pacote que tenha filmes e séries, de preferência 1 conexão.
  2. Guardar em ${path.join(PASTA, 'credencial.json')} (fora de nuvem e de GitHub; a pasta já tem .gitignore) neste formato:
     { "servidores": ["http://capyplay.space", "http://capyplay.fun", "http://spar.lat"], "usuario": "USUARIO", "senha": "SENHA" }
  Sem isso o catálogo não é baixado e o robô responde "vou confirmar" para qualquer título.`;

function lerCredencial() {
  let c = {};
  try { c = JSON.parse(fs.readFileSync(CRED, 'utf8')); } catch { /* usa variáveis */ }
  const usuario = process.env.CATALOGO_USUARIO || c.usuario;
  const senha = process.env.CATALOGO_SENHA || c.senha;
  const servidores = (process.env.CATALOGO_SERVIDORES ? process.env.CATALOGO_SERVIDORES.split(',') : c.servidores || (c.servidor ? [c.servidor] : []))
    .map((s) => String(s).trim().replace(/\/+$/, '')).filter(Boolean).map((s) => (/^https?:\/\//i.test(s) ? s : 'http://' + s));
  if (!usuario || !senha || !servidores.length) throw new SemCredencial('sem_credencial');
  return { usuario, senha, servidores };
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function pegarJson(url, { tentativas = 3, timeoutMs = 15 * 60000, segredos = [] } = {}) {
  let ultimo;
  for (let i = 1; i <= tentativas; i++) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'CapyPlay-catalogo/1.0', Accept: 'application/json' } });
      if (!r.ok) throw new Error('http_' + r.status);
      return await r.json();
    } catch (e) {
      let msg = e.name === 'AbortError' ? 'timeout' : String(e.message || e);
      for (const s of segredos) if (s) msg = msg.split(s).join('***');
      ultimo = new Error(msg);
      if (i < tentativas) await esperar(2000 * i);
    } finally { clearTimeout(t); }
  }
  throw ultimo;
}

const nota = (v) => { let n = Number(v); if (!(n > 0)) return null; if (n > 10) n /= 10; return Math.round(n * 10) / 10; };
const anoDe = (...v) => { for (const x of v) { const m = String(x || '').match(/\b(19|20)\d{2}\b/); if (m) return m[0]; } return null; };
const http = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u.trim()) ? u.trim() : null);

/** Converte listas cruas da API Xtream no formato do catálogo (limpa títulos, tira adulto, junta versões repetidas). */
export function montarCatalogo({ vodCats = [], serCats = [], vod = [], series = [] }) {
  const nomeCat = (lista) => new Map((lista || []).map((c) => [String(c.category_id), String(c.category_name || '')]));
  const cv = nomeCat(vodCats), cs = nomeCat(serCats);
  let adultos = 0;
  const brutos = [];
  for (const v of Array.isArray(vod) ? vod : []) {
    const cl = cat.limparTitulo(v.name || v.title); if (!cl.titulo) continue;
    const categoria = cv.get(String(v.category_id)) || '';
    if (cat.ehAdulto(categoria, v.name)) { adultos++; continue; }
    brutos.push({ id: String(v.stream_id ?? v.num ?? ''), tipo: 'filme', titulo: cat.embelezar(cl.titulo), ano: cl.ano || anoDe(v.year, v.releasedate, v.release_date), categoria: limparCategoria(categoria), nota: nota(v.rating) ?? nota(Number(v.rating_5based) * 2), capa: http(v.stream_icon) });
  }
  for (const s of Array.isArray(series) ? series : []) {
    const cl = cat.limparTitulo(s.name || s.title); if (!cl.titulo) continue;
    const categoria = cs.get(String(s.category_id)) || '';
    if (cat.ehAdulto(categoria, s.name)) { adultos++; continue; }
    brutos.push({ id: String(s.series_id ?? s.num ?? ''), tipo: 'serie', titulo: cat.embelezar(cl.titulo), ano: cl.ano || anoDe(s.year, s.releaseDate, s.release_date), categoria: limparCategoria(categoria), nota: nota(s.rating) ?? nota(Number(s.rating_5based) * 2), capa: http(Array.isArray(s.cover) ? s.cover[0] : s.cover) });
  }
  // Junta versões do mesmo título (dublado/legendado/4K): fica a que tem capa e nota.
  const grupos = new Map();
  for (const it of brutos) {
    const n = cat.normalizar(it.titulo); if (!n) continue;
    const k = it.tipo + '|' + n;
    let g = grupos.get(k); if (!g) grupos.set(k, g = []);
    g.push(it);
  }
  const itens = [];
  for (const g of grupos.values()) {
    const porAno = new Map();
    for (const it of g) { const a = it.ano || ''; const l = porAno.get(a) || []; l.push(it); porAno.set(a, l); }
    const anos = [...porAno.keys()].filter(Boolean);
    if (porAno.has('') && anos.length === 1) { porAno.get(anos[0]).push(...porAno.get('')); porAno.delete(''); }
    for (const l of porAno.values()) {
      l.sort((a, b) => (!!b.capa - !!a.capa) || ((b.nota || 0) - (a.nota || 0)));
      const m = { ...l[0] }; if (!m.ano) m.ano = l.find((x) => x.ano)?.ano || null;
      if (!m.capa) m.capa = l.find((x) => x.capa)?.capa || null;
      itens.push(m);
    }
  }
  return { itens, adultos, brutos: brutos.length };
}
function limparCategoria(c) { const p = String(c || '').split('|').pop().trim().replace(/^[^\p{L}\p{N}]+/u, '').trim(); return p ? p[0].toUpperCase() + p.slice(1) : ''; }

function gravarAtomico(arq, texto) { fs.writeFileSync(arq + '.tmp', texto); fs.renameSync(arq + '.tmp', arq); }

function pegarTrava() {
  try { const st = fs.statSync(LOCK); if (Date.now() - st.mtimeMs < 30 * 60000) return false; } catch { /* livre */ }
  fs.writeFileSync(LOCK, String(process.pid)); return true;
}

export async function atualizar({ seVelho = false, log: lg = log } = {}) {
  if (seVelho) {
    try { const m = JSON.parse(fs.readFileSync(META, 'utf8')); if (!m.semente && Date.now() - Date.parse(m.atualizado_em) < DOZE_HORAS) return { ok: true, pulou: true, motivo: 'catálogo com menos de 12 h', meta: m }; } catch { /* segue */ }
  }
  const cred = lerCredencial();
  if (!pegarTrava()) return { ok: false, erro: 'outra_atualizacao_em_andamento' };
  const t0 = Date.now();
  try {
    const segredos = [cred.usuario, cred.senha];
    let servidor = null, ultimoErro = 'nenhum servidor respondeu';
    for (const s of cred.servidores) {
      try {
        const q = `${s}/player_api.php?username=${encodeURIComponent(cred.usuario)}&password=${encodeURIComponent(cred.senha)}`;
        const j = await pegarJson(q, { tentativas: 2, timeoutMs: 60000, segredos });
        if (j && j.user_info && Number(j.user_info.auth) === 1 && String(j.user_info.status || 'Active').toLowerCase() === 'active') { servidor = s; break; }
        ultimoErro = 'login_recusado em ' + new URL(s).host;
      } catch (e) { ultimoErro = new URL(s).host + ': ' + e.message; }
    }
    if (!servidor) throw new Error('login_falhou (' + ultimoErro + ')');
    const host = new URL(servidor).host;
    const api = (acao) => pegarJson(`${servidor}/player_api.php?username=${encodeURIComponent(cred.usuario)}&password=${encodeURIComponent(cred.senha)}&action=${acao}`, { segredos });
    lg('login ok em ' + host + '; baixando categorias');
    const [vodCats, serCats] = await Promise.all([api('get_vod_categories'), api('get_series_categories')]);
    lg('baixando filmes (pode demorar: o painel é lento)');
    const vod = await api('get_vod_streams');
    lg('filmes recebidos: ' + (Array.isArray(vod) ? vod.length : 0) + '; baixando séries');
    const series = await api('get_series');
    lg('séries recebidas: ' + (Array.isArray(series) ? series.length : 0));
    const r = montarCatalogo({ vodCats, serCats, vod, series });
    const filmes = r.itens.filter((i) => i.tipo === 'filme').length, sers = r.itens.length - filmes;
    // Trava de sanidade: não troca um catálogo bom por um muito menor (painel fora do ar devolvendo lista vazia).
    let antes = 0; try { antes = JSON.parse(fs.readFileSync(META, 'utf8')).total || 0; } catch { /* primeira vez */ }
    if (!r.itens.length || (antes > 1000 && r.itens.length < antes * 0.5)) throw new Error(`lista_suspeita: veio ${r.itens.length} itens e o catálogo atual tem ${antes}; mantive o anterior`);
    const meta = { atualizado_em: new Date().toISOString(), total: r.itens.length, filmes, series: sers, adultos_ignorados: r.adultos, itens_brutos: r.brutos, sem_capa: r.itens.filter((i) => !i.capa).length, servidor: host, duracao_s: Math.round((Date.now() - t0) / 1000), semente: false };
    gravarAtomico(ARQ, JSON.stringify({ gerado_em: meta.atualizado_em, itens: r.itens }));
    gravarAtomico(META, JSON.stringify(meta, null, 2));
    lg(`catálogo gravado: ${meta.total} itens (${filmes} filmes, ${sers} séries), ${r.adultos} adultos ignorados`);
    return { ok: true, meta };
  } finally { try { fs.unlinkSync(LOCK); } catch { /* ok */ } }
}

// Catálogo-semente: títulos conhecidos, ids e capas FICTÍCIOS. Rotulado "semente": nunca é usado pelo robô de verdade.
export function gerarSemente() {
  const F = (id, titulo, ano, categoria, nota) => ({ id: 'semente-f' + id, tipo: 'filme', titulo, ano, categoria, nota, capa: null });
  const S = (id, titulo, ano, categoria, nota) => ({ id: 'semente-s' + id, tipo: 'serie', titulo, ano, categoria, nota, capa: null });
  const itens = [
    F(1, 'O Poderoso Chefão', '1972', 'Drama', 9.2), F(2, 'O Poderoso Chefão II', '1974', 'Drama', 9.0), F(3, 'Vingadores: Ultimato', '2019', 'Ação', 8.4),
    F(4, 'Vingadores: Guerra Infinita', '2018', 'Ação', 8.4), F(5, 'Toy Story', '1995', 'Animação', 8.3), F(6, 'Toy Story 2', '1999', 'Animação', 7.9),
    F(7, 'Toy Story 3', '2010', 'Animação', 8.3), F(8, 'O Senhor dos Anéis: A Sociedade do Anel', '2001', 'Fantasia', 8.8), F(9, 'O Senhor dos Anéis: As Duas Torres', '2002', 'Fantasia', 8.8),
    F(10, 'Homem-Aranha: Sem Volta Para Casa', '2021', 'Ação', 8.2), F(11, 'Pantera Negra', '2018', 'Ação', 7.3), F(12, 'Rocky II', '1979', 'Drama', 7.3),
    F(13, 'Batman', '1989', 'Ação', 7.5), F(14, 'Batman', '2022', 'Ação', 7.8), F(15, 'Interestelar', '2014', 'Ficção', 8.7), F(16, 'A Freira', '2018', 'Terror', 5.3),
    F(17, 'Ainda Estou Aqui', '2024', 'Drama', 8.1), F(18, 'Velozes e Furiosos 7', '2015', 'Ação', 7.1), F(19, 'Divertida Mente', '2015', 'Animação', 8.1), F(20, 'Up: Altas Aventuras', '2009', 'Animação', 8.3),
    F(21, 'Amor à Primeira Vista', '2023', 'Romance', 6.1), F(22, 'Shrek', '2001', 'Animação', 7.9), F(23, 'Tropa de Elite', '2007', 'Ação', 8.0), F(24, 'Cidade de Deus', '2002', 'Drama', 8.6),
    S(1, 'Breaking Bad', '2008', 'Drama', 9.5), S(2, 'La Casa de Papel', '2017', 'Ação', 8.3), S(3, 'Stranger Things', '2016', 'Ficção', 8.6), S(4, 'The Last of Us', '2023', 'Drama', 8.7),
    S(5, 'Round 6', '2021', 'Suspense', 8.0), S(6, 'Chaves', '1973', 'Comédia', 8.5), S(7, 'Round 6 Desafio', '2022', 'Reality', 6.0), S(8, 'Game of Thrones', '2011', 'Fantasia', 9.2),
  ];
  const meta = { atualizado_em: new Date().toISOString(), total: itens.length, filmes: itens.filter((i) => i.tipo === 'filme').length, series: itens.filter((i) => i.tipo === 'serie').length, semente: true, aviso: 'FICTÍCIO: só para testes. Não representa o que existe no painel.' };
  const arq = path.join(PASTA, 'catalogo-semente.json');
  gravarAtomico(arq, JSON.stringify({ semente: true, aviso: meta.aviso, gerado_em: meta.atualizado_em, itens }, null, 1));
  return { arq, meta };
}

const principal = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (principal) {
  if (process.argv.includes('--semente')) {
    const r = gerarSemente(); log('catálogo-semente (FICTÍCIO) gravado em ' + r.arq + ' com ' + r.meta.total + ' itens. O robô não usa este arquivo.');
  } else {
    atualizar({ seVelho: process.argv.includes('--se-velho') }).then((r) => {
      if (r.pulou) log('nada a fazer: ' + r.motivo);
      else if (!r.ok) { log('não atualizou: ' + r.erro); process.exitCode = 1; }
    }).catch((e) => {
      if (e instanceof SemCredencial) { console.error(MENSAGEM_SEM_CREDENCIAL); process.exitCode = 2; }
      else { console.error('Falha ao atualizar o catálogo: ' + e.message); process.exitCode = 1; }
    });
  }
}
