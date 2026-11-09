// catalogo.js - catálogo de filmes e séries da CapyPlay para o robô da revenda.
// CommonJS, sem dependências. Somente leitura de catalogo.json (gerado por atualizar.mjs).
//
//   const cat = require('./catalogo/catalogo.js');
//   cat.carregar();                                  // opcional (buscar carrega sozinho)
//   cat.buscar('o poderoso chefão', { max: 3 });     // [{titulo, ano, tipo, categoria, capa_url, nota, confianca, id, chave}]
//   await cat.capa(item);                            // caminho local de uma imagem válida, ou null
//   await cat.responder('poderoso chefao', { jaEnviadas: [...] }); // tudo pronto para o bot (capa + legenda + avisar)
//
// Regras de segurança:
//  - Nunca "chuta": abaixo da confiança mínima devolve lista vazia.
//  - Catálogo-semente (fictício, rotulado "semente": true) só é usado se configurar({permitirSemente:true}).
//  - Conteúdo adulto é descartado na carga (mesmo que o arquivo traga).
//  - Nenhuma credencial é lida ou gravada aqui.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PASTA = __dirname;
const cfg = {
  arquivo: path.join(PASTA, 'catalogo.json'),
  meta: path.join(PASTA, 'catalogo-meta.json'),
  capasDir: path.join(PASTA, 'capas'),
  permitirSemente: false,
  confMin: 0.72,
  tmdbBase: process.env.TMDB_BASE || 'https://api.themoviedb.org',
  tmdbImgBase: process.env.TMDB_IMG_BASE || 'https://image.tmdb.org/t/p/w500',
  tmdbKeyFile: process.env.TMDB_KEY_FILE || path.join(PASTA, 'tmdb.local'),
  capaMinBytes: 6 * 1024,
  capaMaxBytes: 8 * 1024 * 1024,
  capaMinLargura: 120,
  capaMinAltura: 160,
};
function configurar(o = {}) { Object.assign(cfg, o); estado_.arquivoMtime = -1; if (o.arquivo) base = null; return cfg; }

// ---------------------------------------------------------------- texto
const ROMANOS = { ii: '2', iii: '3', iv: '4', vi: '6', vii: '7', viii: '8' };
const ARTIGOS = new Set(['o', 'a', 'os', 'as', 'um', 'uma', 'uns', 'umas', 'the', 'el', 'la', 'los', 'las', 'le', 'les', 'un', 'une', 'l']);
const STOP = new Set([...ARTIGOS, 'de', 'do', 'da', 'dos', 'das', 'e', 'em', 'no', 'na', 'nos', 'nas', 'para', 'por', 'com', 'of', 'and', 'y', 'ao', 'aos', 'à', 'que']);

/** minúsculas, sem acento, sem pontuação, espaços únicos. "Homem-Aranha: De Volta" -> "homem aranha de volta" */
function normalizar(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’`´]/g, '')
    .replace(/&/g, ' e ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Prefixos/sufixos típicos de painel.
const RE_TAG_NOME = '(?:leg(?:endad[oa])?|dub(?:lad[oa])?|dual(?:\\s*[aá]udio)?|nacional|4k|uhd|fhd|hd|sd|1080p?|720p?|2160p?|hdr|cam|hdcam|hdts|ts|web-?dl|webrip|bluray|brrip|h\\.?26[45]|x26[45]|hevc|multi|br|pt-?br|lan[cç]amentos?|novo|new|vod|filmes?|s[eé]ries?|netflix|prime|disney\\+?|max|hbo|globoplay|star\\+?)';
const RE_TAG_COLCHETE = '(?:' + RE_TAG_NOME + '|[ldn]|dl|lg)';
// Só qualidade/idioma pode sair do FIM do título sem colchete ("Mad Max" não pode virar "Mad").
const RE_TAG_QUAL = '(?:leg(?:endad[oa])?|dub(?:lad[oa])?|dual(?:\\s*[aá]udio)?|4k|uhd|fhd|hd|sd|1080p?|720p?|2160p?|hdr|hdcam|web-?dl|webrip|bluray|brrip|h\\.?26[45]|x26[45]|hevc)';
const RE_COLCHETE_TAG = new RegExp('[\\[(]\\s*' + RE_TAG_COLCHETE + '(?:\\s*[-/|+,&]\\s*' + RE_TAG_COLCHETE + ')*\\s*[\\])]', 'gi');
const RE_PREFIXO_PALAVRA = new RegExp('^\\s*(?:' + RE_TAG_NOME + ')(?:\\s+' + RE_TAG_NOME + ')*\\s*[|:»>\\-–—]+\\s*', 'i');
const RE_SUFIXO_TAG = new RegExp('(?:\\s*[|\\-–—]\\s*|\\s+)' + RE_TAG_QUAL + '\\s*$', 'i');

/** Tira prefixos/sufixos de painel e o ano. Devolve { titulo, ano }. */
function limparTitulo(bruto) {
  let t = String(bruto == null ? '' : bruto).replace(/\s+/g, ' ').trim();
  let ano = null;
  // prefixos "FILMES | ", "SÉRIES | ", "NETFLIX | 4K | " (pipe) - até 3 vezes
  for (let i = 0; i < 3; i++) {
    const antes = t;
    t = t.replace(/^\s*[\p{L}\p{N}+&' ]{2,22}\s*[|»]\s*(?=\S)/u, '');
    t = t.replace(RE_PREFIXO_PALAVRA, '');
    if (t === antes) break;
  }
  // [LEG] / (DUB) / [4K] no começo ou fim: colchetes sem palavra conhecida só saem no começo
  t = t.replace(/^\s*(?:\[[^\]]{1,14}\]\s*)+(?=\S)/, '');
  t = t.replace(RE_COLCHETE_TAG, ' ');
  // sufixos soltos antes do ano ("... - 2022 DUBLADO")
  for (let i = 0; i < 4; i++) { const antes = t; t = t.replace(RE_SUFIXO_TAG, ''); if (t === antes) break; }
  // ano entre parênteses/colchetes (o último vale)
  const reAno = /[\[(]\s*((?:19|20)\d{2})\s*[\])]/g;
  let m; while ((m = reAno.exec(t))) ano = m[1];
  if (ano) t = t.replace(reAno, ' ');
  // " - 2019" no fim
  if (!ano) {
    const f = t.match(/^(.*\S)\s*[-–—|]\s*((?:19|20)\d{2})\s*$/);
    if (f) { ano = f[2]; t = f[1]; }
  }
  // sufixos soltos: "4K", "FHD", "LEG", "DUBLADO" ...
  for (let i = 0; i < 4; i++) { const antes = t; t = t.replace(RE_SUFIXO_TAG, ''); if (t === antes) break; }
  t = t.replace(/\s{2,}/g, ' ').replace(/^[\s|\-–—:.,]+|[\s|\-–—:|,]+$/g, '').trim();
  return { titulo: t, ano };
}

/** "O PODEROSO CHEFÃO" -> "O Poderoso Chefão" (só quando vem todo em maiúsculas). */
function embelezar(t) {
  const letras = t.replace(/[^\p{L}]/gu, '');
  if (letras.length < 4 || letras !== letras.toUpperCase()) return t;
  const peq = new Set(['de', 'do', 'da', 'dos', 'das', 'e', 'a', 'o', 'as', 'os', 'em', 'no', 'na', 'um', 'uma', 'para', 'por', 'com', 'ao']);
  return t.toLowerCase().split(' ').map((p, i) => (i > 0 && peq.has(p)) ? p : p.replace(/^(\P{L}*)(\p{L})/u, (_, a, b) => a + b.toUpperCase())).join(' ');
}

// Conteúdo adulto: mesma ideia de data/Adult.kt do app (categoria + palavras no título).
const RE_ADULTO_CAT = /\b(adult[oa]s?|adults?|xxx|porn\w*|erotic[oa]s?|sexy|sexo|hot|playboy|brasileirinhas|hentai|onlyfans|prive)\b|\+ ?18\b|\b18 ?\+/;
const RE_ADULTO_TIT = /\b(xxx|porn\w*|hentai|brasileirinhas)\b/i;
function ehAdulto(categoria, titulo) {
  return RE_ADULTO_CAT.test(normalizar(categoria || '').replace(/\b18 mais\b/, '18+')) || RE_ADULTO_CAT.test(String(categoria || '').toLowerCase()) || RE_ADULTO_TIT.test(String(titulo || ''));
}

/** Tokens de busca de uma string já normalizada (artigo inicial fora, romanos viram número). */
function tokens(norm) {
  let t = norm.split(' ').filter(Boolean);
  if (t.length > 1 && ARTIGOS.has(t[0])) t = t.slice(1);
  return t.map((x) => ROMANOS[x] || x);
}

// ---------------------------------------------------------------- distância de edição (Damerau/OSA limitada)
function dist(a, b, max) {
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  if (a === b) return 0;
  let p2 = null, p1 = new Array(lb + 1), c = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) p1[j] = j;
  for (let i = 1; i <= la; i++) {
    c[0] = i; let minLinha = c[0];
    for (let j = 1; j <= lb; j++) {
      const custo = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      let v = Math.min(p1[j] + 1, c[j - 1] + 1, p1[j - 1] + custo);
      if (i > 1 && j > 1 && a.charCodeAt(i - 1) === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === b.charCodeAt(j - 1)) v = Math.min(v, p2[j - 2] + 1);
      c[j] = v; if (v < minLinha) minLinha = v;
    }
    if (minLinha > max) return max + 1;
    p2 = p1; p1 = c; c = new Array(lb + 1);
  }
  return p1[lb];
}

// ---------------------------------------------------------------- carga e índice
let base = null; // { itens, vocab(Map tok->[idx]), vocabOrdenado[], porTamanho(Map), exato(Map compact->[idx]), meta }
const estado_ = { arquivoMtime: -1, checadoEm: 0 };

function lerMeta() { try { return JSON.parse(fs.readFileSync(cfg.meta, 'utf8')); } catch { return null; } }

function montarIndice(lista, meta) {
  const itens = [];
  for (const x of lista) {
    if (!x || !x.titulo) continue;
    const tipo = x.tipo === 'serie' ? 'serie' : 'filme';
    if (ehAdulto(x.categoria, x.titulo)) continue;
    const n = normalizar(x.titulo);
    if (!n) continue;
    const tk = tokens(n);
    if (!tk.length) continue;
    itens.push({
      id: x.id == null ? '' : String(x.id), tipo, titulo: x.titulo, ano: x.ano ? String(x.ano) : null,
      categoria: x.categoria || '', nota: x.nota == null ? null : Number(x.nota), capa_url: x.capa || x.capa_url || null,
      _tk: tk, _n: tk.join(' '), _c: tk.join(''), chave: tipo + ':' + (x.id == null ? n : x.id),
    });
  }
  const vocab = new Map();
  const exato = new Map();
  itens.forEach((it, i) => {
    for (const t of new Set(it._tk)) { let l = vocab.get(t); if (!l) vocab.set(t, l = []); l.push(i); }
    let e = exato.get(it._c); if (!e) exato.set(it._c, e = []); e.push(i);
  });
  const vocabOrdenado = [...vocab.keys()].sort();
  const porTamanho = new Map();
  for (const t of vocabOrdenado) { let l = porTamanho.get(t.length); if (!l) porTamanho.set(t.length, l = []); l.push(t); }
  return { itens, vocab, vocabOrdenado, porTamanho, exato, meta };
}

/** Lê catalogo.json e monta o índice. Devolve { total, atualizado_em, semente, ok }. Não lança erro. */
function carregar(opcoes) {
  if (opcoes) configurar(opcoes);
  try {
    const st = fs.statSync(cfg.arquivo);
    const j = JSON.parse(fs.readFileSync(cfg.arquivo, 'utf8'));
    const lista = Array.isArray(j) ? j : (j.itens || []);
    const meta = Array.isArray(j) ? (lerMeta() || {}) : { ...(lerMeta() || {}), ...(j.meta || {}), semente: !!j.semente, atualizado_em: (lerMeta() || {}).atualizado_em || j.gerado_em || null };
    base = montarIndice(lista, meta);
    estado_.arquivoMtime = st.mtimeMs; estado_.checadoEm = Date.now();
    return { ok: true, total: base.itens.length, atualizado_em: meta.atualizado_em || null, semente: !!meta.semente };
  } catch (e) {
    base = { itens: [], vocab: new Map(), vocabOrdenado: [], porTamanho: new Map(), exato: new Map(), meta: { erro: e.code === 'ENOENT' ? 'catalogo.json ainda não existe' : e.message } };
    estado_.arquivoMtime = -1; estado_.checadoEm = Date.now();
    return { ok: false, total: 0, erro: base.meta.erro };
  }
}

function garantirBase() {
  const agora = Date.now();
  if (!base) { carregar(); return; }
  if (agora - estado_.checadoEm < 60000) return; // confere o arquivo no máximo 1x por minuto
  estado_.checadoEm = agora;
  try { const m = fs.statSync(cfg.arquivo).mtimeMs; if (m !== estado_.arquivoMtime) carregar(); } catch { /* mantém o que já tem */ }
}

/** Situação do catálogo: total, idade em horas, se é semente. */
function estado() {
  garantirBase();
  const m = base.meta || {};
  const t = m.atualizado_em ? Date.parse(m.atualizado_em) : NaN;
  return { total: base.itens.length, atualizado_em: m.atualizado_em || null, idade_horas: isNaN(t) ? null : Math.round((Date.now() - t) / 36e5 * 10) / 10, semente: !!m.semente, usavel: base.itens.length > 0 && (!m.semente || cfg.permitirSemente) };
}

// ---------------------------------------------------------------- busca
const peso = (t) => STOP.has(t) ? 0.3 : (/^\d+$/.test(t) ? 1.2 : 1) * (0.6 + 0.4 * Math.min(t.length, 7) / 7);
const maxDist = (len) => len <= 3 ? 0 : len <= 6 ? 1 : 2;

function expandir(q) {
  // Map token do catálogo -> nota de semelhança (0..1) com o token q da consulta
  const out = new Map();
  const { vocab, vocabOrdenado, porTamanho } = base;
  if (vocab.has(q)) out.set(q, 1);
  if (STOP.has(q) || /^\d+$/.test(q)) return out;
  if (q.length >= 4) { // prefixo: "poderos" -> "poderoso"
    let lo = 0, hi = vocabOrdenado.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (vocabOrdenado[mid] < q) lo = mid + 1; else hi = mid; }
    for (let i = lo, n = 0; i < vocabOrdenado.length && n < 200 && vocabOrdenado[i].startsWith(q); i++, n++) {
      const t = vocabOrdenado[i];
      if (t.length - q.length <= 4 && !out.has(t)) out.set(t, 0.8);
    }
  }
  const md = maxDist(q.length);
  const pequeno = out.has(q) && vocab.get(q).length >= 3;
  if (md > 0 && !(pequeno || (out.has(q) && q.length < 5))) {
    for (let len = q.length - md; len <= q.length + md; len++) {
      const lista = porTamanho.get(len); if (!lista) continue;
      for (const t of lista) {
        if (out.has(t)) continue;
        if (t.charCodeAt(0) !== q.charCodeAt(0) && t.charCodeAt(1) !== q.charCodeAt(1) && t.charCodeAt(t.length - 1) !== q.charCodeAt(q.length - 1)) continue; // filtro barato
        const d = dist(q, t, md);
        if (d <= md) out.set(t, d === 1 ? (q.length >= 6 ? 0.85 : 0.7) : 0.65);
      }
    }
  }
  return out;
}

/** Interpreta a consulta: tira "filme/série", ano e artigo inicial. */
function interpretar(consulta) {
  let n = normalizar(consulta);
  let tipoDica = null;
  const m = n.match(/^(?:(?:o|a|os|as|um|uma) )?(filmes?|series?|novelas?|desenhos?|animes?)\s+(?:(?:de|do|da|chamad[oa]) )?(.+)$/);
  if (m) { tipoDica = /^serie|^novela|^desenho|^anime/.test(m[1]) ? 'serie' : 'filme'; n = m[2]; }
  let ano = null;
  const ma = n.match(/\b((?:19[3-9]|20[0-3])\d)\b/g);
  if (ma && n.replace(/\b(?:19[3-9]|20[0-3])\d\b/g, '').trim()) { ano = ma[ma.length - 1]; n = n.replace(new RegExp('\\b' + ano + '\\b'), ' ').replace(/\s+/g, ' ').trim(); }
  return { n, ano, tipoDica, tk: tokens(n) };
}

/**
 * Busca tolerante. Devolve até `max` itens com confiança >= `min` (padrão 0.72); vazio quando não há certeza.
 * opcoes: { max=3, min, tipo: 'filme'|'serie' }
 */
function buscar(consulta, opcoes = {}) {
  garantirBase();
  const max = opcoes.max || 3, min = opcoes.min == null ? cfg.confMin : opcoes.min;
  if (!base.itens.length) return [];
  if (base.meta && base.meta.semente && !cfg.permitirSemente) return [];
  const q = interpretar(consulta);
  const tipoDica = opcoes.tipo || q.tipoDica;
  if (!q.tk.length || q.n.length < 2) return [];
  const qCompact = q.tk.join('');
  const { itens } = base;
  const conf = new Map(); // idx -> confiança

  // 1) igualdade exata (com ou sem espaços/acento/artigo)
  const ex = base.exato.get(qCompact);
  if (ex) for (const i of ex) conf.set(i, 1);

  // 2) fuzzy por tokens
  const qt = q.tk;
  const exps = qt.map(expandir);
  const naoStop = qt.map((t, k) => ({ t, k })).filter((x) => !STOP.has(x.t));
  if (naoStop.length) {
    const cand = new Set();
    const listas = [];
    for (const { k } of naoStop) {
      const ids = [];
      for (const tok of exps[k].keys()) { const l = base.vocab.get(tok); if (l) ids.push(l); }
      const tam = ids.reduce((s, l) => s + l.length, 0);
      if (tam) listas.push({ ids, tam });
    }
    const pequenas = listas.filter((l) => l.tam <= 6000);
    for (const l of (pequenas.length ? pequenas : listas)) for (const arr of l.ids) { const lim = arr.length > 6000 ? 6000 : arr.length; for (let z = 0; z < lim; z++) cand.add(arr[z]); }

    const pesoQ = qt.map(peso); const somaQ = pesoQ.reduce((a, b) => a + b, 0);
    const numQ = qt.filter((t) => /^\d+$/.test(t));
    for (const i of cand) {
      if (conf.get(i) === 1) continue;
      const it = itens[i];
      let sq = 0, ultimaPos = -1, foraDeOrdem = false;
      for (let k = 0; k < qt.length; k++) {
        const e = exps[k]; let melhor = 0, pos = -1;
        for (let z = 0; z < it._tk.length; z++) { const v = e.get(it._tk[z]); if (v && v > melhor) { melhor = v; pos = z; } }
        sq += pesoQ[k] * melhor;
        if (pos >= 0 && !STOP.has(qt[k])) { if (pos < ultimaPos) foraDeOrdem = true; ultimaPos = pos; }
      }
      const qcov = sq / somaQ;
      if (qcov < 0.5) continue;
      let si = 0, somaI = 0, itemNum = false;
      for (const t of it._tk) {
        const w = peso(t); somaI += w;
        let m = 0;
        for (let k = 0; k < qt.length; k++) { const v = exps[k].get(t); if (v && v > m) m = v; }
        si += w * m;
      }
      const icov = si / somaI;
      let c = qcov * (0.7 + 0.3 * icov);
      if (foraDeOrdem) c *= 0.8; // as mesmas palavras em outra ordem não é o mesmo título
      // número da consulta que não existe no título ("toy story 5"): não é o mesmo filme
      for (const nq of numQ) if (!it._tk.includes(nq)) { c *= 0.55; break; }
      // consulta de uma palavra curta e genérica ("amor") contra título longo: não chuta
      if (naoStop.length === 1 && naoStop[0].t.length < 6 && it._tk.filter((t) => !STOP.has(t)).length > 1) c *= 0.6;
      if (c > (conf.get(i) || 0)) conf.set(i, c);
    }
  }

  // 3) ajustes por ano e tipo; monta resultado
  const saida = [];
  for (const [i, c0] of conf) {
    const it = itens[i];
    let c = c0;
    if (q.ano && it.ano) c += it.ano === q.ano ? 0.05 : (Math.abs(+it.ano - +q.ano) === 1 ? -0.05 : -0.3);
    if (tipoDica) c += it.tipo === tipoDica ? 0.03 : -0.08;
    if (opcoes.tipo && it.tipo !== opcoes.tipo) continue;
    c = Math.max(0, Math.min(1, c));
    if (c >= min) saida.push({ titulo: it.titulo, ano: it.ano, tipo: it.tipo, categoria: it.categoria, capa_url: it.capa_url, nota: it.nota, confianca: Math.round(c * 100) / 100, id: it.id, chave: it.chave });
  }
  saida.sort((a, b) => b.confianca - a.confianca || (b.nota || 0) - (a.nota || 0) || a.titulo.length - b.titulo.length);
  return saida.slice(0, max);
}

// ---------------------------------------------------------------- capa
function dimensoes(buf) {
  try {
    if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return { tipo: 'png', ext: 'png', w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
      let p = 2;
      while (p + 9 < buf.length) {
        if (buf[p] !== 0xff) { p++; continue; }
        const mk = buf[p + 1];
        if (mk === 0xd8 || mk === 0x01 || (mk >= 0xd0 && mk <= 0xd7)) { p += 2; continue; }
        const len = buf.readUInt16BE(p + 2);
        if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) return { tipo: 'jpeg', ext: 'jpg', h: buf.readUInt16BE(p + 5), w: buf.readUInt16BE(p + 7) };
        p += 2 + len;
      }
      return { tipo: 'jpeg', ext: 'jpg', w: 0, h: 0 };
    }
    if (buf.length > 30 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
      const f = buf.toString('latin1', 12, 16);
      if (f === 'VP8X') return { tipo: 'webp', ext: 'webp', w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
      if (f === 'VP8 ') return { tipo: 'webp', ext: 'webp', w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
      return { tipo: 'webp', ext: 'webp', w: 0, h: 0 };
    }
  } catch { /* cai para null */ }
  return null;
}

/** Verifica se os bytes são uma imagem utilizável como capa. Devolve { ok, ext, motivo }. */
function validarImagem(buf) {
  if (!buf || buf.length < cfg.capaMinBytes) return { ok: false, motivo: 'muito_pequena' };
  if (buf.length > cfg.capaMaxBytes) return { ok: false, motivo: 'muito_grande' };
  const d = dimensoes(buf);
  if (!d) return { ok: false, motivo: 'nao_e_imagem' };
  if (d.w && d.h && (d.w < cfg.capaMinLargura || d.h < cfg.capaMinAltura)) return { ok: false, motivo: `dimensao_${d.w}x${d.h}` };
  return { ok: true, ext: d.ext, w: d.w, h: d.h };
}

async function baixar(url, ms = 15000) {
  if (!/^https?:\/\//i.test(String(url || ''))) throw new Error('url_invalida');
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 CapyPlayBot', Accept: 'image/*,*/*' } });
    if (!r.ok) throw new Error('http_' + r.status);
    const len = Number(r.headers.get('content-length') || 0);
    if (len > cfg.capaMaxBytes) throw new Error('muito_grande');
    const partes = []; let total = 0;
    for await (const parte of r.body) { total += parte.length; if (total > cfg.capaMaxBytes) throw new Error('muito_grande'); partes.push(Buffer.from(parte)); }
    return Buffer.concat(partes);
  } finally { clearTimeout(t); }
}

const falhasCapa = new Map(); // chave -> quando falhou (não insiste por 30 min)
const emAndamento = new Map();
const seguro = (s) => String(s).replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 60);

function achaCacheado(prefixo) {
  try { for (const f of fs.readdirSync(cfg.capasDir)) if (f.startsWith(prefixo + '.')) { const p = path.join(cfg.capasDir, f); const b = fs.readFileSync(p); if (validarImagem(b).ok) return p; fs.unlinkSync(p); } } catch { /* sem cache */ }
  return null;
}
function gravarCapa(prefixo, buf, ext) {
  fs.mkdirSync(cfg.capasDir, { recursive: true });
  const p = path.join(cfg.capasDir, prefixo + '.' + ext);
  fs.writeFileSync(p + '.tmp', buf); fs.renameSync(p + '.tmp', p);
  return p;
}

function chaveTmdb() {
  if (process.env.TMDB_API_KEY) return process.env.TMDB_API_KEY.trim();
  try {
    const t = fs.readFileSync(cfg.tmdbKeyFile, 'utf8');
    const m = t.match(/tmdb\.apiKey\s*=\s*(\S+)/) || t.match(/^\s*([A-Za-z0-9._-]{20,})\s*$/m);
    return m ? m[1] : null;
  } catch { return null; }
}
const semelhante = (a, b) => { a = normalizar(a); b = normalizar(b); if (!a || !b) return false; if (a === b) return true; const m = Math.max(a.length, b.length); return dist(a, b, Math.ceil(m * 0.15)) <= Math.ceil(m * 0.15); };

async function capaTmdb(item) {
  const chave = chaveTmdb(); if (!chave) return { buf: null, motivo: 'sem_chave_tmdb' };
  const tipo = item.tipo === 'serie' ? 'tv' : 'movie';
  const bearer = chave.length > 60 && chave.startsWith('eyJ');
  const ano = item.ano ? (tipo === 'movie' ? '&year=' : '&first_air_date_year=') + item.ano : '';
  const url = `${cfg.tmdbBase}/3/search/${tipo}?query=${encodeURIComponent(item.titulo)}&language=pt-BR&include_adult=false${ano}${bearer ? '' : '&api_key=' + encodeURIComponent(chave)}`;
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 12000);
  let r;
  try { r = await fetch(url, { signal: ctl.signal, headers: bearer ? { Authorization: 'Bearer ' + chave } : {} }); } finally { clearTimeout(t); }
  if (!r.ok) return { buf: null, motivo: 'tmdb_http_' + r.status };
  const j = await r.json();
  const achado = (j.results || []).find((x) => x.poster_path && (semelhante(x.title || x.name, item.titulo) || semelhante(x.original_title || x.original_name, item.titulo)));
  if (!achado) return { buf: null, motivo: 'tmdb_sem_resultado_igual' };
  return { buf: await baixar(cfg.tmdbImgBase + achado.poster_path), motivo: null };
}

/** Garante uma capa utilizável. Devolve { caminho, fonte: 'painel'|'tmdb'|null, motivo }. Nunca lança erro. */
async function capaInfo(item) {
  if (!item) return { caminho: null, fonte: null, motivo: 'sem_item' };
  const k = seguro(item.chave || item.id || item.titulo);
  const cacheado = achaCacheado(k); if (cacheado) return { caminho: cacheado, fonte: 'cache', motivo: null };
  const f = falhasCapa.get(k); if (f && Date.now() - f.em < 30 * 60000) return { caminho: null, fonte: null, motivo: f.motivo + ' (recente)' };
  if (emAndamento.has(k)) return emAndamento.get(k);
  const p = (async () => {
    let motivo = 'sem_capa_no_painel';
    if (item.capa_url) {
      try {
        const buf = await baixar(item.capa_url);
        const v = validarImagem(buf);
        if (v.ok) return { caminho: gravarCapa(k, buf, v.ext), fonte: 'painel', motivo: null };
        motivo = 'capa_do_painel_' + v.motivo;
      } catch (e) { motivo = 'capa_do_painel_' + (e.name === 'AbortError' ? 'timeout' : e.message); }
    }
    try {
      const t = await capaTmdb(item);
      if (t.buf) { const v = validarImagem(t.buf); if (v.ok) return { caminho: gravarCapa(k, t.buf, v.ext), fonte: 'tmdb', motivo: null }; motivo += '; tmdb_' + v.motivo; }
      else motivo += '; ' + t.motivo;
    } catch (e) { motivo += '; tmdb_' + (e.name === 'AbortError' ? 'timeout' : e.message); }
    falhasCapa.set(k, { em: Date.now(), motivo });
    return { caminho: null, fonte: null, motivo };
  })().finally(() => emAndamento.delete(k));
  emAndamento.set(k, p);
  return p;
}
async function capa(item) { return (await capaInfo(item)).caminho; }

// ---------------------------------------------------------------- resposta pronta para o bot
const T = require('./texto-disponibilidade.js');

/**
 * Orquestra tudo: busca, escolhe, baixa a capa e monta a legenda.
 * opcoes: { jaEnviadas: ['filme:123', ...], tipo }
 * Retorno: { achou, item, itens, capa (caminho|null), enviarCapa, legenda, avisar, motivo, ambiguo, repetida }
 */
async function responder(consulta, opcoes = {}) {
  const st = estado();
  const consultaLimpa = String(consulta || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!st.usavel) return { achou: false, item: null, itens: [], capa: null, enviarCapa: false, legenda: T.naoAchou(), avisar: true, motivo: 'catalogo_indisponivel: ' + (st.semente ? 'só tem catálogo-semente' : 'catalogo.json vazio ou ausente') + ' | pedido: ' + consultaLimpa };
  const itens = buscar(consultaLimpa, { max: 3, tipo: opcoes.tipo });
  if (!itens.length) return { achou: false, item: null, itens: [], capa: null, enviarCapa: false, legenda: T.naoAchou(), avisar: true, motivo: 'conteudo_nao_encontrado: ' + consultaLimpa };
  const top = itens[0];
  const empatados = itens.filter((x) => x.confianca >= top.confianca - 0.04);
  if (empatados.length > 1 && top.confianca < 0.97) {
    return { achou: true, ambiguo: true, item: null, itens: empatados, capa: null, enviarCapa: false, legenda: T.desambiguar(empatados), avisar: false, motivo: 'varios_resultados' };
  }
  if (empatados.length > 1 && top.confianca >= 0.97 && empatados.every((x) => x.confianca >= 0.97) && new Set(empatados.map((x) => x.chave)).size > 1) {
    const iguais = empatados.filter((x) => x.confianca >= 0.97);
    if (iguais.length > 1) return { achou: true, ambiguo: true, item: null, itens: iguais, capa: null, enviarCapa: false, legenda: T.desambiguar(iguais), avisar: false, motivo: 'varios_resultados' };
  }
  const ja = new Set(opcoes.jaEnviadas || []);
  if (ja.has(top.chave)) return { achou: true, repetida: true, item: top, itens: [top], capa: null, enviarCapa: false, legenda: T.repetida(top), avisar: false, motivo: 'capa_ja_enviada' };
  const info = await capaInfo(top);
  return { achou: true, item: top, itens: [top], capa: info.caminho, enviarCapa: !!info.caminho, capaFonte: info.fonte, legenda: T.legenda(top), avisar: false, motivo: info.caminho ? null : 'sem_capa: ' + info.motivo };
}

module.exports = { carregar, buscar, capa, capaInfo, responder, estado, configurar, normalizar, limparTitulo, embelezar, ehAdulto, validarImagem, legenda: T.legenda };
