/* Escritório do Jarvis: tela inicial do dashboard no PC (08/11/2026).
   Pixel art 32 bits desenhada em código (original, nada copiado de jogo). Lê GET /api/escritorio a cada 5 s.
   Cada cliente é um bonequinho gerado pelo ref (mesma pessoa = mesmo visual) e senta na área da etiqueta dele.
   Chegou gente nova: entra pela porta, para na mesa do Jarvis e vai para a cadeira. Mudou a etiqueta: levanta e troca de área.
   Os números do topo (.numeros, preenchidos pelo app.js) viram o HUD por cima da sala. Nada de innerHTML com dado de fora. */
(() => {
'use strict';

const BASE = location.protocol === 'file:' ? 'http://127.0.0.1:8811' : '';
const params = new URLSearchParams(location.search);
const MOCK = params.get('mock');
const REDUZ = matchMedia('(prefers-reduced-motion: reduce)');
const MOVEL = matchMedia('(max-width: 820px), (max-height: 500px) and (pointer: coarse)');
const $ = (s, r = document) => r.querySelector(s);
const appEl = $('#app');
const POLL_MS = 5000, VEL = 52;

function h(tag, props, ...filhos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v; else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v === true ? '' : v);
  }
  for (const f of filhos.flat()) { if (f == null || f === false) continue; el.append(f.nodeType ? f : document.createTextNode(String(f))); }
  return el;
}

/* ---------- Zonas (uma por etiqueta do WhatsApp) ---------- */
const ZONAS = {
  lead: { nome: 'Leads', cor: '#5be7ff' },
  teste: { nome: 'Testando', cor: '#c39bff' },
  revendedor: { nome: 'Revendedores', cor: '#ffd84a' },
  suporte: { nome: 'Suporte', cor: '#ffb340' },
  senhor: { nome: 'Precisa do senhor', cor: '#ff5d6c' },
  esfriou: { nome: 'Esfriaram', cor: '#9fd6ff' },
  atrasado: { nome: 'Atrasados', cor: '#ff9f5a' },
};
const ORDEM_ZONAS = ['lead', 'teste', 'suporte', 'revendedor', 'senhor', 'esfriou', 'atrasado'];

/* ---------- Aleatório estável pelo ref ---------- */
function semente(str) { let x = 2166136261; for (let i = 0; i < str.length; i++) { x ^= str.charCodeAt(i); x = Math.imul(x, 16777619); } return x >>> 0; }
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const escolha = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length];
const cacheTom = new Map();   // os móveis são redesenhados a cada quadro: guarda o tom já calculado
function escurece(hex, f) {
  const ch = hex + f; let s = cacheTom.get(ch); if (s) return s;
  const n = parseInt(hex.slice(1), 16), c = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
  s = '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => c(v).toString(16).padStart(2, '0')).join('');
  cacheTom.set(ch, s); return s;
}

/* ---------- Sprites das pessoas (10 px de largura) ---------- */
const MAPAS = {
  frente: ['..hhhhhh..', '.hhhhhhhh.', '.hssssssh.', '.ssessess.', '.ssssssss.', '..ssssss..', '..ttsstt..', '.tttttttt.', '.atttttta.', '.atttttta.', '.stttttts.', '..pppppp..', '..pp..pp..', '..pp..pp..', '..oo..oo..'],
  costas: ['..hhhhhh..', '.hhhhhhhh.', '.hhhhhhhh.', '.hhhhhhhh.', '.shhhhhhs.', '..ssssss..', '..tttttt..', '.tttttttt.', '.atttttta.', '.atttttta.', '.stttttts.', '..pppppp..', '..pp..pp..', '..pp..pp..', '..oo..oo..'],
  lado: ['..hhhhh...', '.hhhhhhh..', '.hhhssss..', '.hhsssses.', '.hssssss..', '..sssss...', '...tttt...', '..ttttt...', '..ttatt...', '..ttatt...', '..ttstt...', '..ppppp...', '..pp.pp...', '..pp.pp...', '..oo.oo...'],
};
const PERNAS = {
  frente: { A: ['..pp..pp..', '..oo..pp..', '......oo..'], B: ['..pp..pp..', '..pp..oo..', '..oo......'] },
  lado: { A: ['.pp...pp..', '.p.....p..', '.oo....oo.'], B: ['...ppp....', '...pp.....', '...ooo....'] },
};
const CABELOS = {
  curto: {},
  comprido: { frente: { 2: '.hssssssh.', 3: '.hsessesh.', 4: '.hssssssh.', 5: '.hhsssshh.', 6: '.htssssth.' }, costas: { 5: '.hhhhhhhh.', 6: '.hhhhhhhh.', 7: '.thhhhhht.' }, lado: { 4: '.hhsssss..', 5: '.hhssss...', 6: '.hhtttt...' } },
  bone: { frente: { 0: '..cccccc..', 1: '.cccccccc.', 2: '.bbbbbbbb.' }, costas: { 0: '..cccccc..', 1: '.cccccccc.', 2: '.cccccccc.' }, lado: { 0: '..ccccc...', 1: '.cccccccc.', 2: '.cccccbbbb' } },
  crespo: { frente: { 0: '.hhhhhhhh.', 1: 'hhhhhhhhhh', 2: 'hhsssssshh', 3: 'hssessessh' }, costas: { 0: '.hhhhhhhh.', 1: 'hhhhhhhhhh', 2: 'hhhhhhhhhh', 3: 'hhhhhhhhhh', 4: '.hhhhhhhh.' }, lado: { 0: '.hhhhhh...', 1: 'hhhhhhhh..', 2: 'hhhhssss..', 3: 'hhhsssses.' } },
};
const PELE = ['#f3cba8', '#e2ac86', '#c98b63', '#9c6646', '#6f4530'];
const CABELO = ['#2b1d16', '#4a2f1d', '#7a4b26', '#c08a3e', '#e5cf7c', '#1e1e2a', '#8f3b2a', '#d6d6dc'];
const CAMISA = ['#e8505f', '#4aa3df', '#5ec27a', '#f5b041', '#9b6ad6', '#eef1f4', '#3b4d66', '#e67e22', '#1fbf9f', '#f06292', '#5b6bd6'];
const CALCA = ['#2c3e50', '#3d4b8a', '#4b3a2f', '#555b66', '#22313f', '#6b5b45'];
const BONE = ['#d23c3c', '#2e6fd8', '#1a1a1a', '#f0a830', '#2f9e5e'];
const CONTORNO = '#110e17';

const cacheSprite = new Map();   // limpo ao trocar o período e quando passa de 3000 desenhos
function visualDe(ref) {
  const r = rng(semente(String(ref)));
  return { pele: escolha(r, PELE), cabelo: escolha(r, CABELO), camisa: escolha(r, CAMISA), calca: escolha(r, CALCA), bone: escolha(r, BONE), estilo: escolha(r, ['curto', 'curto', 'comprido', 'bone', 'crespo']) };
}
function linhas(vis, pose) {
  // pose: frente, frenteA, frenteB, costas, costasA, costasB, lado, ladoA, ladoB, senta, sentaCostas
  const base = pose.startsWith('lado') ? 'lado' : (pose.startsWith('costas') || pose === 'sentaCostas') ? 'costas' : 'frente';
  const rows = MAPAS[base].slice();
  const ov = (CABELOS[vis.estilo] || {})[base] || {};
  for (const [i, l] of Object.entries(ov)) rows[i] = l;
  const passo = pose.endsWith('A') ? 'A' : pose.endsWith('B') ? 'B' : null;
  if (passo) { const p = PERNAS[base === 'lado' ? 'lado' : 'frente'][passo]; rows.splice(12, 3, ...p); }
  if (pose === 'senta') { rows.splice(11, 4, '.pppppppp.', '..oo..oo..'); }
  if (pose === 'sentaCostas') rows.splice(11, 4);
  return rows;
}
/* Alta definição: cada pixel do desenho vira 2x2 pelo Scale2x (arredonda as quinas) e ganha luz vinda
   de cima à esquerda, sombra à direita, olhos com brilho, boca e contorno fino de 1 pixel. */
function scale2x(rows) {
  const h0 = rows.length, w0 = rows[0].length, out = Array.from({ length: h0 * 2 }, () => new Array(w0 * 2).fill('.'));
  const at = (x, y) => (x < 0 || y < 0 || x >= w0 || y >= h0) ? '.' : rows[y][x];
  for (let y = 0; y < h0; y++) for (let x = 0; x < w0; x++) {
    const P = at(x, y), A = at(x, y - 1), B = at(x + 1, y), C = at(x - 1, y), D = at(x, y + 1);
    let e0 = P, e1 = P, e2 = P, e3 = P;
    if (C === A && C !== D && A !== B) e0 = A;
    if (A === B && A !== C && B !== D) e1 = B;
    if (D === C && D !== B && C !== A) e2 = C;
    if (B === D && B !== A && D !== C) e3 = D;
    out[y * 2][x * 2] = e0; out[y * 2][x * 2 + 1] = e1; out[y * 2 + 1][x * 2] = e2; out[y * 2 + 1][x * 2 + 1] = e3;
  }
  return out;
}
const SEM_LUZ = new Set(['e', 'E', 'm', 'C', 'c', 'k', 'z']);
function pintaAlta(g2, cor, sombreia) {
  const H2 = g2.length, W2 = g2[0].length, c = document.createElement('canvas'); c.width = W2 + 2; c.height = H2 + 2;
  const g = c.getContext('2d'), at = (x, y) => (x < 0 || y < 0 || x >= W2 || y >= H2) ? '.' : g2[y][x];
  g.fillStyle = CONTORNO;
  for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) if (g2[y][x] !== '.') {
    if (at(x - 1, y) === '.') g.fillRect(x, y + 1, 1, 1); if (at(x + 1, y) === '.') g.fillRect(x + 2, y + 1, 1, 1);
    if (at(x, y - 1) === '.') g.fillRect(x + 1, y, 1, 1); if (at(x, y + 1) === '.') g.fillRect(x + 1, y + 2, 1, 1);
  }
  for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) {
    const k = g2[y][x]; if (k === '.') continue;
    let f = 1;
    if (sombreia && !SEM_LUZ.has(k)) {
      const dir = at(x + 1, y), bai = at(x, y + 1), esq = at(x - 1, y), cim = at(x, y - 1);
      if (dir === '.' || (at(x + 2, y) === '.' && k !== 's')) f = 0.8;
      else if (bai === '.') f = 0.86;
      else if (esq === '.' || cim === '.') f = 1.2;
      if (k === 's' && (cim === 'h' || cim === 'c' || cim === 'b')) f = 0.8;      // sombra do cabelo na testa
      if (k === 't' && (cim === 's' || cim === 'h')) f = Math.min(f, 0.85);      // sombra do queixo na camisa
    }
    g.fillStyle = f === 1 ? cor[k] : escurece(cor[k], f); g.fillRect(x + 1, y + 1, 1, 1);
  }
  return c;
}
function sprite(ref, vis, pose) {
  const chave = ref + '|' + pose;
  let c = cacheSprite.get(chave); if (c) return c;
  if (cacheSprite.size > 3000) cacheSprite.clear();
  const pisca = pose.endsWith('~'), base = pisca ? pose.slice(0, -1) : pose;
  const rows = linhas(vis, base), g2 = scale2x(rows);
  rows.forEach((l, y) => [...l].forEach((k, x) => {
    if (k !== 'e') return;
    if (pisca) { g2[y * 2][x * 2] = 's'; g2[y * 2][x * 2 + 1] = 's'; g2[y * 2 + 1][x * 2] = 'k'; g2[y * 2 + 1][x * 2 + 1] = 'k'; }
    else g2[y * 2][x * 2] = 'E';
  }));
  if ((base.startsWith('frente') || base === 'senta') && rows[4] && rows[4][4] === 's' && rows[4][5] === 's') { g2[9][9] = 'm'; g2[9][10] = 'm'; }
  const cor = { h: vis.cabelo, s: vis.pele, e: '#1b1720', E: '#ffffff', k: escurece(vis.pele, 0.62), m: escurece(vis.pele, 0.68), t: vis.camisa, a: escurece(vis.camisa, 0.78), p: vis.calca, o: '#231f26', c: vis.bone, b: escurece(vis.bone, 0.7) };
  c = pintaAlta(g2, cor, true);
  cacheSprite.set(chave, c);
  return c;
}

/* ---------- Jarvis (16 px, também em alta definição) ---------- */
const JARVIS = ['.......cc.......', '.......gg.......', '....wwwwwwww....', '...wwwwwwwwww...', '...wkkkkkkkkw...', '...wkCCkkCCkw...', '...wkkkkkkkkw...', '...wwwwwwwwww...', '....gwwwwwwg....', '......gggg......', '..wwwwwwwwwwww..', '.wwwwwwccwwwwww.', '.gwwwwwccwwwwwg.', '.gwwwwwwwwwwwwg.', '.gwwwwwwwwwwwwg.', '.hhwwwwwwwwwwhh.', '..wwwwwwwwwwww..'];
const cacheJarvis = {};
function spriteJarvis(olho, antena) {
  const k = olho + antena; if (cacheJarvis[k]) return cacheJarvis[k];
  const g2 = scale2x(JARVIS);
  if (olho === 'aberto') JARVIS.forEach((l, y) => [...l].forEach((q, x) => { if (q === 'C' && (x === 5 || x === 9)) g2[y * 2][x * 2] = 'z'; }));
  const cor = { w: '#dfe6f0', g: '#8e9bb0', k: '#121826', C: olho === 'aberto' ? '#5be7ff' : '#121826', z: '#e6fdff', c: antena, h: '#8e9bb0' };
  const c = pintaAlta(g2, cor, true), gg = c.getContext('2d');
  gg.fillStyle = 'rgba(255,255,255,.85)'; gg.fillRect(9, 5, 6, 1); gg.fillRect(8, 6, 1, 2);   // brilho no capacete
  return (cacheJarvis[k] = c);
}

/* ---------- Estado ---------- */
const S = {
  W: 0, H: 0, esc: 1, L: null, fundo: null, ctx: null, cv: null,
  pessoas: new Map(), dados: null, primeira: true, ultimoT: null, filaEv: [], fila: [],
  efeitos: [], neve: [], ar: [], jarvis: { digitandoAte: 0, piscaAte: 0, proxPisca: 0, com: null, falaAte: 0 },
  ativo: false, raf: 0, t0: 0, agora: 0, hover: null, fixo: null, ultimoEnvelope: new Map(), barras: [], log: [],
  sobrando: {}, totalZona: {}, ctlPoll: null, timerPoll: 0, ok: true,
};

/* ---------- Layout da sala (coordenadas em pixel do mundo) ---------- */
function layout(W, H) {
  const WALL = 66, F = H - WALL;
  const a1 = WALL + Math.round(F * 0.33), a2 = WALL + Math.round(F * 0.68);
  const xA0 = 6, xA1 = Math.round(W * 0.33), xC0 = Math.round(W * 0.67), xC1 = W - 6, cx = Math.round(W / 2);
  const Ax = Math.round((xA0 + xA1) / 2), Cx = Math.round((xC0 + xC1) / 2), Aw = xA1 - xA0, Cw = xC1 - xC0;
  const L = { W, H, WALL, a1, a2, xA0, xA1, xC0, xC1, cx, Ax, Cx, Aw, Cw, aisles: [a1 + 4, a2 + 2, H - 3], assentos: {}, moveis: [], rotulos: {}, tapetes: [], sombras: [] };
  const add = (z, s) => { (L.assentos[z] = L.assentos[z] || []).push(s); };

  // Testando: sofá de costas para nós, olhando a TV da parede
  { const n = Math.max(3, Math.min(6, Math.floor((Aw - 30) / 15))), w = n * 15 + 6, x0 = Ax - Math.round(w / 2), y = Math.min(a1 - 8, WALL + 36);
    for (let i = 0; i < n; i++) add('teste', { x: x0 + 10 + i * 15, y, face: 'sentaCostas', dy: -3, acesso: x0 - 7 });
    L.moveis.push({ y: y + 0.6, d: (g) => sofaCostas(g, x0, w, y, '#5a4790') });
    L.tapetes.push([x0 - 12, WALL + 6, w + 24, y - WALL + 2, '#3c2f63', '#6d5aa8']); L.tvLuz = [x0 - 12, WALL + 6, w + 24, y - WALL + 2];
    L.tv = { x: Ax - 30, y: WALL - 40, w: 60, h: 34 };
    L.rotulos.teste = { x: x0 - 6, y: WALL + 4 }; }

  // Revendedores: sala VIP com dois sofás de frente
  { const n = Math.max(3, Math.min(6, Math.floor((Cw - 34) / 2 / 15))), w = n * 15 + 6, gap = Math.max(8, Cw - 2 * w - 26), x0 = Cx - Math.round((2 * w + gap) / 2), y = a1 - 8;
    for (const xs of [x0, x0 + w + gap]) {
      for (let i = 0; i < n; i++) add('revendedor', { x: xs + 10 + i * 15, y, face: 'senta', dy: -2, acesso: null });
      L.moveis.push({ y: y - 0.6, d: (g) => sofaFrente(g, xs, w, y, '#a8862a') });
    }
    L.tapetes.push([x0 - 10, WALL + 6, 2 * w + gap + 20, y - WALL + 8, '#6e5617', '#ffd84a']);
    L.moveis.push({ y: y - 1, d: (g) => planta(g, x0 + w + Math.round(gap / 2), y - 2) });
    L.trofeus = { x: Cx - 40, y: WALL - 36, w: 80 };
    L.rotulos.revendedor = { x: x0 - 4, y: WALL + 4 }; }

  // Jarvis: mesa no centro, telão atrás
  { const y = a1 - 8;
    L.mesa = { x: cx, y };
    L.atendimento = { x: cx, y: a1 + 4 };
    L.telao = { x: cx - 42, y: WALL - 42, w: 84, h: 36 };
    L.tapetes.push([cx - 62, WALL + 4, 124, a1 - WALL + 2, '#173f4a', '#5be7ff']);
    L.moveis.push({ y: y - 14, d: (g) => desenhaJarvis(g) });
    L.moveis.push({ y, d: (g) => mesa(g, cx, y) });
    L.rotulos.jarvis = { x: cx, y: y - 9 }; }

  // Leads: sala de espera com duas fileiras de cadeiras
  { const n = Math.max(4, Math.min(12, Math.floor((Aw - 14) / 17))), w = (n - 1) * 17, x0 = Ax - Math.round(w / 2);
    for (const y of [a1 + 28, a2 - 6]) for (let i = 0; i < n; i++) {
      const x = x0 + i * 17; add('lead', { x, y, face: 'senta', dy: 0, acesso: null });
      L.moveis.push({ y: y - 0.6, d: (g) => cadeiraFrente(g, x, y, '#2f8fa6') });
    }
    L.tapetes.push([x0 - 14, a1 + 9, w + 28, a2 - a1 - 13, '#33405a', '#51618a']);
    L.rotulos.lead = { x: x0 - 10, y: a1 + 11 }; }

  // Suporte: balcão com banquinhos
  { const w = Math.min(Aw - 20, 130), x0 = Ax - Math.round(w / 2), yb = a2 + 26, n = Math.max(3, Math.min(5, Math.floor(w / 24)));
    L.moveis.push({ y: yb, d: (g) => balcao(g, x0, w, yb) }); L.sombras.push([x0 + w / 2, yb, w / 2 + 4, 2]);
    const passo = Math.round(w / n);
    for (let i = 0; i < n; i++) {
      const x = x0 + Math.round(passo / 2) + i * passo, y = Math.min(L.H - 4, yb + 13);
      add('suporte', { x, y, face: 'sentaCostas', dy: -6, acesso: null });
      L.moveis.push({ y: y - 0.6, d: (g) => banquinho(g, x, y) });
    }
    L.rotulos.suporte = { x: x0 + 4, y: yb - 8 }; }

  // Esperando o senhor: divisória com a porta da sala do senhor, cadeiras olhando para a porta
  { const x0 = xC0 + 6, w = xC1 - 2 - x0, yb = a1 + 32, dx = xC1 - 34;
    L.porta = { x: dx, y: yb };
    L.moveis.push({ y: yb, d: (g) => divisoria(g, x0, w, yb, dx) });
    const n = Math.max(4, Math.min(8, Math.floor((Cw - 20) / 17))), y = Math.max(a2 - 6, yb + 24), xs = xC0 + 14;
    for (let i = 0; i < n; i++) {
      const x = xs + i * 17; add('senhor', { x, y, face: 'sentaCostas', dy: -4, acesso: null });
      L.moveis.push({ y: y + 0.6, d: (g) => cadeiraCostas(g, x, y, '#a3303f') });
    }
    L.tapetes.push([xs - 10, yb + 2, (n - 1) * 17 + 20, y - yb + 2, '#5c1d28', '#ff5d6c']);
    L.rotulos.senhor = { x: x0 + 4, y: yb - 19 }; }

  // Esfriaram: canto gelado com poltronas
  { const cols = 3, passo = Math.round((Cw - 46) / (cols - 1)), xs = xC0 + 18;
    const ys = [a2 + 30, H - 4];
    ys.forEach((y, r) => { for (let i = 0; i < cols; i++) {
      const x = xs + i * passo + (r ? Math.round(passo / 2) : 0); if (x > xC1 - 26) continue;
      add('esfriou', { x, y, face: 'senta', dy: -2, acesso: null });
      L.moveis.push({ y: y - 0.6, d: (g) => sofaFrente(g, x - 10, 20, y, '#4f7ea6') });
    } });
    L.gelo = { x: xC0 + 4, y: a2 + 14, w: Cw - 4, h: H - a2 - 14 };
    L.tapetes.push([xC0 + 4, a2 + 14, Cw - 4, H - a2 - 14, '#3f5f80', '#9fd6ff']);
    L.rotulos.esfriou = { x: xC0 + 8, y: a2 + 15 }; }

  // Atrasados: bancos dos dois lados da porta, relógio de pé
  { const y = H - 8, esq = [xA1 + 8, cx - 30], dir = [cx + 30, xC0 - 6];
    for (const [a, b] of [esq, dir]) {
      const n = Math.max(2, Math.floor((b - a - 6) / 15)), w = n * 15 + 6;
      for (let i = 0; i < n; i++) add('atrasado', { x: a + 10 + i * 15, y, face: 'senta', dy: -2, acesso: null });
      L.moveis.push({ y: y - 0.6, d: (g) => banco(g, a, w, y) });
    }
    L.relogio = { x: cx - 22, y: H - 4 };
    L.moveis.push({ y: H - 4, d: (g) => relogioPe(g, cx - 22, H - 4) });
    L.moveis.push({ y: H - 4, d: (g) => planta(g, cx + 22, H - 4) });
    L.rotulos.atrasado = { x: xA1 + 8, y: a2 + 10 }; }

  // Meio da sala: tapete redondo e bebedouro
  L.moveis.push({ y: a2 - 2, d: (g) => bebedouro(g, xA1 + 14, a2 - 2) });
  L.moveis.push({ y: a2 - 2, d: (g) => planta(g, xC0 - 12, a2 - 2) });
  L.porta_entrada = { x: cx, y: H + 18 };
  for (const ss of Object.values(L.assentos)) for (const st of ss) L.sombras.push([st.x, st.y, 7.5, 1.5]);
  L.sombras.push([cx, L.mesa.y, 41, 2.5], [xA1 + 14, a2 - 2, 6.5, 1.5], [xC0 - 12, a2 - 2, 6, 1.5], [cx - 22, H - 4, 6.5, 1.5], [cx + 22, H - 4, 6, 1.5]);
  return L;
}

/* ---------- Primitivas (o canvas tem o dobro de pixels: meio pixel do mundo = 1 pixel de alta definição) ---------- */
let G = null;
const R = (x, y, w, hh, c) => { G.fillStyle = c; G.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(hh)); };
const m2 = (v) => Math.round(v * 2) / 2;
const Q = (x, y, w, hh, c) => { G.fillStyle = c; G.fillRect(m2(x), m2(y), Math.max(0.5, m2(w)), Math.max(0.5, m2(hh))); };
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
// Pontilhado ordenado (dither) em meio pixel: luz e sombra sem gradiente borrado. f(u, v) devolve a força de 0 a 1.
function pontilha(x0, y0, w, hh, cor, f) {
  G.fillStyle = cor; x0 = m2(x0); y0 = m2(y0);
  const nx = Math.round(w * 2), ny = Math.round(hh * 2), bx = Math.round(x0 * 2), by = Math.round(y0 * 2);
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const v = f((x + 0.5) / nx, (y + 0.5) / ny); if (v <= 0) continue;
    if (v * 16 > BAYER[((by + y) & 3) * 4 + ((bx + x) & 3)]) G.fillRect(x0 + x / 2, y0 + y / 2, 0.5, 0.5);
  }
}
const elipse = (u, v) => { const dx = (u - 0.5) * 2, dy = (v - 0.5) * 2; return 1 - (dx * dx + dy * dy); };
function sombra(cx, y, rx, ry) { pontilha(cx - rx, y - ry, rx * 2, ry * 2, 'rgba(14,8,4,.5)', (u, v) => elipse(u, v) * 1.5); }
function bloco(x, y, w, hh, cor) {
  R(x, y, w, hh, cor);
  Q(x, y, w, 0.5, escurece(cor, 1.3)); Q(x, y + hh - 0.5, w, 0.5, escurece(cor, 0.6));
  if (hh > 2) { Q(x, y + 0.5, 0.5, hh - 1, escurece(cor, 1.12)); Q(x + w - 0.5, y + 0.5, 0.5, hh - 1, escurece(cor, 0.78)); }
}
function pernas(x, y, alt) { for (const lx of [x - 6, x + 5]) { Q(lx, y - alt, 1, alt, '#25252e'); Q(lx, y - alt, 0.5, alt, '#4a4a58'); } }

function cadeiraFrente(g, x, y, cor) {
  bloco(x - 6, y - 14, 12, 8, cor);
  Q(x - 4, y - 12, 8, 0.5, escurece(cor, 0.82)); Q(x - 4, y - 11.5, 8, 0.5, escurece(cor, 1.16)); Q(x - 4, y - 9, 8, 0.5, escurece(cor, 0.82));
  bloco(x - 7, y - 6, 14, 3, escurece(cor, 0.86));
  pernas(x, y, 3);
}
function cadeiraCostas(g, x, y, cor) {
  bloco(x - 6, y - 8, 12, 5, cor);
  Q(x - 4, y - 6.5, 8, 0.5, escurece(cor, 0.75)); Q(x - 4, y - 6, 8, 0.5, escurece(cor, 1.15));
  pernas(x, y, 3);
}
function sofaFrente(g, x0, w, y, cor) {
  bloco(x0, y - 17, w, 10, cor);
  for (let x = x0 + 15; x < x0 + w - 4; x += 15) { Q(x + 2, y - 15.5, 0.5, 8, escurece(cor, 0.7)); Q(x + 2.5, y - 15.5, 0.5, 8, escurece(cor, 1.14)); }
  for (let x = x0 + 4; x < x0 + w - 3; x += 5) { Q(x, y - 13.5, 0.5, 0.5, escurece(cor, 0.62)); Q(x + 2.5, y - 10.5, 0.5, 0.5, escurece(cor, 0.62)); }
  bloco(x0, y - 7, w, 4, escurece(cor, 1.1));
  for (let x = x0 + 15; x < x0 + w - 4; x += 15) Q(x + 2, y - 7, 0.5, 4, escurece(cor, 0.8));
  R(x0, y - 3, w, 2, escurece(cor, 0.6)); Q(x0, y - 3, w, 0.5, escurece(cor, 0.45));
  bloco(x0 - 3, y - 12, 4, 10, escurece(cor, 0.86)); bloco(x0 + w - 1, y - 12, 4, 10, escurece(cor, 0.86));
  Q(x0 - 2.5, y - 1, 2, 1, '#241a14'); Q(x0 + w + 0.5, y - 1, 2, 1, '#241a14');
}
function sofaCostas(g, x0, w, y, cor) {
  bloco(x0, y - 7, w, 6, cor);
  for (let x = x0 + 8; x < x0 + w - 4; x += 15) { Q(x, y - 6, 0.5, 4, escurece(cor, 0.75)); Q(x + 0.5, y - 6, 0.5, 4, escurece(cor, 1.12)); }
  bloco(x0 - 3, y - 9, 4, 8, escurece(cor, 0.86)); bloco(x0 + w - 1, y - 9, 4, 8, escurece(cor, 0.86));
  Q(x0 - 2.5, y - 1, 2, 1, '#241a14'); Q(x0 + w + 0.5, y - 1, 2, 1, '#241a14');
}
function banco(g, x0, w, y) {
  const m = '#8b5a34';
  bloco(x0, y - 14, w, 2, m); bloco(x0, y - 11, w, 2, m);
  bloco(x0 + 2, y - 14, 2, 8, escurece(m, 0.72)); bloco(x0 + w - 4, y - 14, 2, 8, escurece(m, 0.72));
  bloco(x0 - 1, y - 6, w + 2, 3, escurece(m, 1.15));
  for (let x = x0 + 3; x < x0 + w - 2; x += 7) Q(x, y - 5, 2.5, 0.5, escurece(m, 0.95));
  Q(x0 + 1, y - 3, 1.5, 3, '#3b2a1e'); Q(x0 + w - 2.5, y - 3, 1.5, 3, '#3b2a1e');
}
function banquinho(g, x, y) { bloco(x - 5, y - 7, 10, 2, '#d0463c'); Q(x - 1, y - 5, 2, 4, '#5a5f6b'); Q(x - 1, y - 5, 0.5, 4, '#8a909c'); bloco(x - 3, y - 1.5, 6, 1.5, '#3a3e48'); }
function planta(g, x, y) {
  bloco(x - 4, y - 7, 8, 7, '#b0603a'); bloco(x - 4.5, y - 8, 9, 1.5, '#c8714a'); Q(x - 3, y - 7.5, 6, 0.5, '#4a2e1c');
  const s = REDUZ.matches ? 0 : m2(Math.sin(S.agora / 1300 + x * 0.37) * 0.6), f = ['#2f8f4e', '#43c06c', '#22703b', '#7be08f'];
  Q(x - 0.5, y - 16, 1, 9, '#2a6b3a');
  Q(x - 2 + s, y - 17, 4, 7, f[0]); Q(x - 6 + s, y - 15, 4, 6, f[1]); Q(x + 2 + s, y - 16, 4, 7, f[1]);
  Q(x - 1.5 + s * 1.5, y - 20.5, 3, 4, f[1]); Q(x - 7 + s, y - 11.5, 3, 3, f[2]); Q(x + 4 + s, y - 11.5, 3, 3, f[2]);
  Q(x - 5.5 + s, y - 15, 1, 0.5, f[3]); Q(x + 2.5 + s, y - 16, 1, 0.5, f[3]); Q(x - 1 + s * 1.5, y - 20.5, 1, 0.5, f[3]); Q(x - 1.5 + s, y - 17, 0.5, 4, f[2]);
}
function bebedouro(g, x, y) {
  bloco(x - 4, y - 22, 8, 8, '#8fd3ff'); Q(x - 3, y - 21, 1, 5, '#e6f7ff'); Q(x - 4, y - 18, 8, 0.5, '#6fb8e6');
  const b = REDUZ.matches ? -1 : Math.floor(S.agora / 260) % 7; if (b >= 0) Q(x + 1, y - 15.5 - b, 0.5, 0.5, '#e6f7ff');
  bloco(x - 5, y - 14, 10, 14, '#e8ecf2'); bloco(x - 2, y - 11, 4, 2, '#3a7bd5'); Q(x - 1, y - 11, 0.5, 0.5, '#9fd6ff'); Q(x - 5, y - 1, 10, 1, '#9aa3b0');
}
function mesa(g, cx, y) {
  const x0 = cx - 38, w = 76;
  for (const mx of [cx - 33, cx + 15]) {
    bloco(mx, y - 33, 18, 13, '#2a2f3c'); Q(mx + 7, y - 28, 4, 3, '#353b4b'); Q(mx + 8.5, y - 27, 1, 1, '#5be7ff');
    Q(mx - 0.5, y - 32, 0.5, 11, '#5be7ff'); Q(mx + 18, y - 32, 0.5, 11, '#5be7ff');
    Q(mx - 1, y - 31, 0.5, 9, 'rgba(91,231,255,.4)'); Q(mx + 18.5, y - 31, 0.5, 9, 'rgba(91,231,255,.4)');
    bloco(mx + 7, y - 20.5, 4, 1.5, '#1d212b');
  }
  bloco(x0 + 2, y - 23, 5, 4, '#e8ecf2'); Q(x0 + 7, y - 22, 1, 2, '#e8ecf2'); Q(x0 + 3, y - 23, 3, 0.5, '#6b3f24');      // caneca
  if (!REDUZ.matches) for (let i = 0; i < 2; i++) { const k = ((S.agora / 900) + i * 0.5) % 1; Q(x0 + 3.5 + i * 1.5 + Math.sin(k * 6 + i) * 0.6, y - 24 - k * 5, 0.5, 0.5, 'rgba(255,255,255,' + (0.45 * (1 - k)).toFixed(2) + ')'); }
  const kx = x0 + w - 14, ky = y - 25;      // capivarinha de pelúcia (mascote)
  bloco(kx, ky, 9, 5, '#8a5a36'); bloco(kx + 6, ky - 2, 5, 4.5, '#8a5a36'); Q(kx + 7, ky - 3, 1, 1, '#6b4128');
  Q(kx + 9, ky - 1, 0.5, 0.5, '#1b1720'); Q(kx + 10.5, ky, 0.5, 1, '#4a2c1b'); Q(kx + 1, ky + 5, 1.5, 1, '#6b4128'); Q(kx + 6, ky + 5, 1.5, 1, '#6b4128'); Q(kx + 1, ky + 0.5, 4, 0.5, '#a8744a');
  bloco(x0 - 2, y - 20, w + 4, 4, '#8f5d3e');
  for (let x = x0 + 2; x < x0 + w; x += 9) Q(x, y - 18.5, 4, 0.5, '#9e6a48');
  bloco(x0, y - 16, w, 15, '#5d3925');
  bloco(x0 + 4, y - 13, 31, 9, '#6b442d'); bloco(x0 + w - 35, y - 13, 31, 9, '#6b442d');
  Q(x0 + 18, y - 9, 3, 0.5, '#c9a227'); Q(x0 + w - 21, y - 9, 3, 0.5, '#c9a227');
  bloco(cx - 7, y - 21.5, 14, 1.5, '#1d212b'); for (let k = cx - 6; k < cx + 6; k += 1.5) Q(k, y - 21, 0.5, 0.5, '#3a4050');
  const d = S.agora < S.jarvis.digitandoAte && !REDUZ.matches, f = Math.floor(S.agora / 100) % 2;
  bloco(cx - 9, y - 22.5 - (d && f ? 1 : 0), 4, 2, '#aab5c6'); bloco(cx + 5, y - 22.5 - (d && !f ? 1 : 0), 4, 2, '#aab5c6');
  Q(x0, y - 1, w, 1, '#3b2418');
}
function balcao(g, x0, w, yb) {
  const px0 = Math.round(x0 + w / 2);
  Q(px0 - 1, yb - 21, 2, 4, '#5a5f6b'); Q(px0 - 6, yb - 30, 12, 10, CONTORNO); bloco(px0 - 5.5, yb - 29.5, 11, 9, '#ffb340');
  Q(px0 - 2, yb - 28, 4, 1, '#3b2a10'); Q(px0 + 1, yb - 27, 1, 2, '#3b2a10'); Q(px0 - 0.5, yb - 25, 1.5, 1, '#3b2a10'); Q(px0 - 0.5, yb - 23, 1.5, 1, '#3b2a10');
  bloco(x0 - 2, yb - 17, w + 4, 3, '#d4dae3');
  bloco(x0, yb - 14, w, 14, '#3b4862'); Q(x0, yb - 9, w, 2, '#ffb340'); Q(x0, yb - 9, w, 0.5, '#ffd27a');
  for (let x = x0 + 6; x < x0 + w - 4; x += 14) Q(x, yb - 13, 0.5, 3, '#4a5878');
  bloco(x0 + 8, yb - 23, 10, 6, '#c8392f'); Q(x0 + 11, yb - 25, 4, 0.5, '#5a5f6b'); Q(x0 + 11, yb - 25, 0.5, 2, '#5a5f6b'); Q(x0 + 14.5, yb - 25, 0.5, 2, '#5a5f6b'); Q(x0 + 8, yb - 21, 10, 0.5, '#8a2219');
  bloco(x0 + w - 26, yb - 29, 16, 11, '#262b37'); R(x0 + w - 25, yb - 28, 14, 8, '#ffb340');
  Q(x0 + w - 24, yb - 27, 6, 0.5, '#3b2a10'); Q(x0 + w - 24, yb - 25.5, 9, 0.5, '#3b2a10'); Q(x0 + w - 24, yb - 24, 4, 0.5, '#3b2a10');
  if (REDUZ.matches || Math.floor(S.agora / 500) % 2) Q(x0 + w - 19.5, yb - 24, 1, 0.5, '#3b2a10');
  Q(x0 + w - 19, yb - 18, 2, 1, '#1d212b');
}
function divisoria(g, x0, w, yb, dx) {
  bloco(x0, yb - 24, w, 2, '#4f4875'); R(x0, yb - 22, w, 21, '#383357'); bloco(x0, yb - 3, w, 2, '#25213b');
  for (let x = x0 + 4; x < dx - 22; x += 14) { Q(x, yb - 20, 10, 0.5, '#2a2644'); Q(x, yb - 20, 0.5, 15, '#2a2644'); Q(x, yb - 5.5, 10, 0.5, '#4a4470'); Q(x + 9.5, yb - 20, 0.5, 15, '#4a4470'); }
  R(dx - 10, yb - 21, 20, 20, '#2a1c14'); bloco(dx - 9, yb - 20, 18, 19, '#7a4a2e');
  bloco(dx - 7, yb - 18, 6, 7, '#8a5634'); bloco(dx + 1, yb - 18, 6, 7, '#8a5634'); bloco(dx - 7, yb - 9, 6, 6, '#8a5634'); bloco(dx + 1, yb - 9, 6, 6, '#8a5634');
  Q(dx + 5, yb - 10.5, 1.5, 1.5, '#ffd84a'); Q(dx + 5, yb - 10.5, 0.5, 0.5, '#fff1a8');
  bloco(dx - 6, yb - 23.5, 12, 3, '#ffd84a'); Q(dx - 4, yb - 22.5, 8, 0.5, '#a8862a');
  const espera = (S.porZona && S.porZona.senhor) || 0;
  pontilha(dx + 8, yb - 26, 11, 9, espera > 0 ? 'rgba(255,93,108,.35)' : 'rgba(48,209,88,.3)', elipse);
  bloco(dx + 12, yb - 22.5, 3, 3, espera > 0 ? '#ff5d6c' : '#30d158');
}
function relogioPe(g, x, y) {
  bloco(x - 5, y - 34, 10, 34, '#5a3520'); bloco(x - 6, y - 36, 12, 2.5, '#6b4128'); Q(x - 1, y - 37, 2, 1, '#c9a227');
  R(x - 4, y - 32, 8, 8, '#c9a227'); R(x - 3.5, y - 31.5, 7, 7, '#f3ead6');
  for (let i = 0; i < 12; i += 3) { const a = i / 12 * Math.PI * 2; Q(x - 0.25 + Math.sin(a) * 3, y - 28.25 - Math.cos(a) * 3, 0.5, 0.5, '#8a7a5a'); }
  const d = new Date(), hr = (d.getHours() % 12 + d.getMinutes() / 60) / 12 * Math.PI * 2, mn = d.getMinutes() / 60 * Math.PI * 2;
  for (let k = 0.5; k <= 2.5; k += 0.5) Q(x - 0.25 + Math.sin(mn) * k, y - 28.25 - Math.cos(mn) * k, 0.5, 0.5, '#1b1720');
  for (let k = 0.5; k <= 1.5; k += 0.5) Q(x - 0.25 + Math.sin(hr) * k, y - 28.25 - Math.cos(hr) * k, 0.5, 0.5, '#c8392f');
  R(x - 3, y - 22, 6, 18, '#2a1a10'); Q(x - 3, y - 22, 0.5, 18, '#3a2618');
  const a = REDUZ.matches ? 0 : Math.sin(S.agora / 500) * 2;
  Q(x - 0.25 + a * 0.4, y - 21, 0.5, 9, '#c9a227'); bloco(x - 1.5 + a, y - 13, 3, 3, '#ffd84a');
}
function desenhaJarvis(g) {
  const L = S.L, J = S.jarvis, t = S.agora;
  if (t > J.proxPisca) { J.piscaAte = t + 140; J.proxPisca = t + 2600 + Math.random() * 3200; }
  const digit = t < J.digitandoAte;
  const ant = REDUZ.matches ? '#5be7ff' : (Math.floor(t / (digit ? 400 : 700)) % 2 ? '#5be7ff' : '#1f6f80');
  const sp = spriteJarvis(t < J.piscaAte ? 'fechado' : 'aberto', ant);
  const bob = digit && !REDUZ.matches ? (Math.floor(t / 220) % 2) * 0.5 : 0;
  const x = L.mesa.x - 8.5, y = L.mesa.y - 36 - bob;
  if (ant === '#5be7ff') { const c = 'rgba(91,231,255,.45)'; Q(x + 7.5, y - 0.5, 1.5, 0.5, c); Q(x + 7.5, y + 1.5, 1.5, 0.5, c); Q(x + 7, y + 0.5, 0.5, 1, c); Q(x + 9, y + 0.5, 0.5, 1, c); }   // brilho da antena
  G.drawImage(sp, x, y, sp.width / 2, sp.height / 2);
  if (!REDUZ.matches) { const k = Math.floor(t / 80) % 9; if (k < 6) Q(x + 4.5, y + 4.5 + k * 0.5, 8, 0.5, 'rgba(91,231,255,.3)'); }   // varredura do visor
  if (digit) Q(x + 3.5, y + 3.5, 10, 5, 'rgba(91,231,255,' + (0.08 + 0.05 * Math.sin(t / 60)).toFixed(3) + ')');                    // luz do monitor
  if (t < (J.acenaAte || 0) && !REDUZ.matches) { const o = Math.floor(t / 150) % 2 ? 0.5 : -0.5; bloco(x + 15, y + 7, 2, 6, '#dfe6f0'); bloco(x + 14.5 + o, y + 4, 3, 3, '#aab5c6'); }   // aceno
  S.jarvis.cabeca = { x: L.mesa.x, y };
}

/* ---------- Fundo estático (parede, janelas, luminárias, piso, tapetes, sombras) ---------- */
function corCeu(hr) {
  if (hr >= 6 && hr < 8) return ['#f6b26b', '#ffd9a8'];
  if (hr >= 8 && hr < 17) return ['#6fb7ff', '#bfe3ff'];
  if (hr >= 17 && hr < 19) return ['#e0776b', '#f9c18a'];
  return ['#0d1430', '#1f2a5a'];
}
function desenhaFundo() {
  const L = S.L, W = L.W, H = L.H, WL = L.WALL, c = document.createElement('canvas'); c.width = W * 2; c.height = H * 2;
  G = c.getContext('2d'); G.setTransform(2, 0, 0, 2, 0, 0); G.imageSmoothingEnabled = false;
  const r = rng(7);
  // parede com papel de parede, sombra do teto e lambri
  R(0, 0, W, WL, '#2b2f4d');
  for (let y = 12, i = 0; y < WL - 18; y += 6, i++) for (let x = i % 2 ? 4 : 0; x < W; x += 8) { Q(x + 0.5, y, 0.5, 0.5, '#383e6a'); Q(x, y + 0.5, 1.5, 0.5, '#333962'); Q(x + 0.5, y + 1, 0.5, 0.5, '#383e6a'); }
  pontilha(0, 10, W, 12, 'rgba(8,8,22,.55)', (u, v) => 1 - v * 1.15);
  R(0, 0, W, 9, '#1c1f36'); Q(0, 8, W, 0.5, '#2a2e4e'); Q(0, 9, W, 0.5, '#4a5190'); Q(0, 9.5, W, 0.5, '#20233a');
  R(0, WL - 16, W, 13, '#3a3557'); Q(0, WL - 16, W, 0.5, '#5a5488'); Q(0, WL - 15.5, W, 0.5, '#2a2644');
  for (let x = 3; x < W - 10; x += 22) { Q(x, WL - 13, 18, 0.5, '#2c2846'); Q(x, WL - 13, 0.5, 8, '#2c2846'); Q(x, WL - 5.5, 18, 0.5, '#4a4474'); Q(x + 17.5, WL - 13, 0.5, 8, '#4a4474'); }
  R(0, WL - 3, W, 3, '#1c1a2b'); Q(0, WL - 3, W, 0.5, '#4a4474');
  // janelas
  const hr = new Date().getHours(), [ceu1, ceu2] = corCeu(hr), noite = hr >= 19 || hr < 6;
  const ocupado = [[L.tv.x - 14, L.tv.x + L.tv.w + 14], [L.telao.x - 14, L.telao.x + L.telao.w + 14], [L.trofeus.x - 6, L.trofeus.x + L.trofeus.w + 6]];
  const janelas = [];
  for (let x = 10; x + 34 < W - 6; x += 4) { if (ocupado.some(([a, b]) => x + 34 > a && x < b) || janelas.some((j) => x < j + 46)) continue; janelas.push(x); }
  janelas.forEach((x, iJ) => {
    const y = WL - 40, w = 34, hh = 26;
    R(x - 2, y - 2, w + 4, hh + 4, '#1a1a28'); Q(x - 2, y - 2, w + 4, 0.5, '#3a3a58');
    R(x, y, w, hh, ceu1); pontilha(x, y, w, hh, ceu2, (u, v) => v * 1.15);
    if (noite) {
      for (let i = 0; i < 7; i++) Q(x + 1 + r() * (w - 2), y + 1 + r() * 10, 0.5, 0.5, '#fff7d6');
      if (iJ === 0) { pontilha(x + w - 13, y + 0.5, 11, 10, 'rgba(244,240,216,.28)', elipse); R(x + w - 9, y + 3, 4, 4, '#f4f0d8'); Q(x + w - 9, y + 3, 0.5, 0.5, ceu1); Q(x + w - 5.5, y + 6.5, 0.5, 0.5, ceu1); Q(x + w - 8, y + 4, 1, 1, '#d8d2b0'); }
    }
    for (let bx = x; bx < x + w; bx += 5 + Math.floor(r() * 4)) {
      const bh = 6 + Math.floor(r() * 12), bwc = Math.min(4 + Math.floor(r() * 4), x + w - bx);
      R(bx, y + hh - bh, bwc, bh, noite ? '#151a33' : '#7d93b8'); Q(bx, y + hh - bh, bwc, 0.5, noite ? '#262d52' : '#a3b5d2');
      for (let ly = y + hh - bh + 1.5; ly < y + hh - 1; ly += 1.5) for (let lx = bx + 0.5; lx < bx + bwc - 0.5; lx += 1) if (r() < (noite ? 0.35 : 0.15)) Q(lx, ly, 0.5, 0.5, noite ? (r() < 0.8 ? '#ffd27a' : '#9fd6ff') : '#c8d6ec');
    }
    for (let k = 0; k < 9; k++) { Q(x + 3 + k * 0.5, y + 1 + k, 0.5, 0.5, 'rgba(255,255,255,.2)'); Q(x + 6 + k * 0.5, y + 1 + k, 0.5, 0.5, 'rgba(255,255,255,.1)'); }
    R(x + w / 2 - 1, y, 2, hh, '#1a1a28'); Q(x + w / 2 - 1, y, 0.5, hh, '#34344e'); R(x, y + hh / 2 - 1, w, 2, '#1a1a28'); Q(x, y + hh / 2 - 1, w, 0.5, '#34344e');
    bloco(x - 3, y + hh + 2, w + 6, 2, '#4d4874');
  });
  // luminárias de parede ao lado da TV e do telão
  for (const ax of [L.tv.x - 8, L.tv.x + L.tv.w + 8, L.telao.x - 8, L.telao.x + L.telao.w + 8]) {
    if (ax < 4 || ax > W - 4) continue; const ay = WL - 34;
    pontilha(ax - 7, ay - 6, 14, 15, 'rgba(255,210,122,.16)', elipse);
    bloco(ax - 1, ay + 2, 2, 4, '#5a4a30'); bloco(ax - 2.5, ay - 1.5, 5, 3.5, '#ffd27a'); Q(ax - 2, ay - 1, 1, 1, '#fff6d8');
  }
  // TV (Testando), telão (Jarvis) e prateleira de troféus (Revendedores)
  { const t = L.tv; R(t.x - 2, t.y - 2, t.w + 4, t.h + 4, '#0d0d12'); Q(t.x - 2, t.y - 2, t.w + 4, 0.5, '#2a2a3a'); Q(t.x + t.w - 3, t.y + t.h + 0.5, 1, 0.5, '#30d158'); bloco(t.x + t.w / 2 - 6, t.y + t.h + 2, 12, 2, '#15151c'); }
  { const t = L.telao; R(t.x - 3, t.y - 3, t.w + 6, t.h + 6, '#0b0d14'); Q(t.x - 3, t.y - 3, t.w + 6, 0.5, '#3a4270'); Q(t.x - 3, t.y + t.h + 2.5, t.w + 6, 0.5, '#05060a'); pontilha(t.x - 10, t.y + t.h + 3, t.w + 20, 8, 'rgba(91,231,255,.10)', (u, v) => (1 - v) * (1 - Math.abs(u - 0.5) * 1.8)); }
  { const t = L.trofeus, y = t.y + 22;
    bloco(t.x, y, t.w, 3, '#6b4128'); bloco(t.x + 4, y + 3, 2, 3, '#4a2c1b'); bloco(t.x + t.w - 6, y + 3, 2, 3, '#4a2c1b');
    pontilha(t.x - 6, t.y - 6, t.w + 12, 34, 'rgba(255,216,74,.10)', elipse);
    for (let i = 0; i < 5; i++) { const x = t.x + 8 + i * 15, alto = i % 2 ? 12 : 16;
      bloco(x, y - 3, 8, 3, '#7a5c14'); Q(x + 3, y - 6, 2, 3, '#c9a227'); bloco(x, y - alto, 8, alto - 6, '#ffd84a'); Q(x + 1, y - alto + 1, 1, alto - 8, '#fff6c8'); Q(x + 6, y - alto + 1, 1, alto - 8, '#c9a227');
      Q(x - 2, y - alto + 1, 2, 0.5, '#c9a227'); Q(x - 2, y - alto + 1, 0.5, 3.5, '#c9a227'); Q(x - 2, y - alto + 4, 2, 0.5, '#c9a227');
      Q(x + 8, y - alto + 1, 2, 0.5, '#c9a227'); Q(x + 9.5, y - alto + 1, 0.5, 3.5, '#c9a227'); Q(x + 8, y - alto + 4, 2, 0.5, '#c9a227'); }
    R(t.x + 18, t.y - 2, t.w - 36, 7, '#1a1408'); R(t.x + 19, t.y - 1, t.w - 38, 5, '#3a2c08'); for (let k = t.x + 21; k < t.x + t.w - 21; k += 3) Q(k, t.y + 1, 1.5, 0.5, '#ffd84a'); }
  // piso de tábuas com veio
  const tons = ['#6e4b36', '#74503a', '#69472f', '#704c37'];
  for (let y = WL, i = 0; y < H; y += 6, i++) {
    const t = tons[i % 4];
    R(0, y, W, 6, t); Q(0, y, W, 0.5, '#5b3d2b'); Q(0, y + 0.5, W, 0.5, escurece(t, 1.1));
    let x = (i * 17) % 37; while (x < W) { Q(x, y + 0.5, 0.5, 5.5, '#5b3d2b'); Q(x + 0.5, y + 0.5, 0.5, 5.5, escurece(t, 1.08)); x += 26 + ((i * 13 + x) % 19); }
    for (let k = 0; k < W / 8; k++) Q(r() * W, y + 1.5 + Math.floor(r() * 8) / 2, 1.5 + r() * 4, 0.5, escurece(t, r() < 0.5 ? 0.9 : 1.06));
  }
  pontilha(0, WL, W, 7, 'rgba(0,0,0,.5)', (u, v) => 1 - v);
  // luz das janelas no chão
  for (const x of janelas) pontilha(x - 6, WL + 1, 46, 30, noite ? 'rgba(140,170,255,.13)' : 'rgba(255,236,190,.15)', (u, v) => (1 - v) * (1 - Math.abs(u - 0.5) * 1.7));
  // tapetes com franja
  for (const [x, y, w, hh, cor, borda] of L.tapetes) {
    R(x, y, w, hh, cor); pontilha(x, y, w, hh, 'rgba(0,0,0,.14)', () => 0.22);
    Q(x + 1, y + 1, w - 2, 0.5, borda); Q(x + 1, y + hh - 1.5, w - 2, 0.5, borda); Q(x + 1, y + 1, 0.5, hh - 2, borda); Q(x + w - 1.5, y + 1, 0.5, hh - 2, borda);
    Q(x + 2, y + 2, w - 4, 0.5, escurece(cor, 0.78)); Q(x + 2, y + hh - 2.5, w - 4, 0.5, escurece(cor, 0.78));
    for (let k = x + 4; k < x + w - 4; k += 4) { Q(k, y + 3, 0.5, 0.5, escurece(cor, 1.35)); Q(k + 2, y + hh - 3.5, 0.5, 0.5, escurece(cor, 1.35)); }
    for (let k = y + 1.5; k < y + hh - 1; k += 1) { Q(x - 1, k, 1, 0.5, escurece(borda, 0.8)); Q(x + w, k, 1, 0.5, escurece(borda, 0.8)); }
  }
  { const z = L.gelo; for (let i = 0; i < 70; i++) Q(z.x + 2 + r() * (z.w - 4), z.y + 2 + r() * (z.h - 4), 0.5, 0.5, r() < 0.5 ? '#d8eeff' : '#a8d2f2'); }
  // tapete redondo do meio com a capivara
  { const cx = L.cx, cy = Math.round((L.a1 + L.a2) / 2) + 2, rx = 34, ry = 16;
    for (let y = -ry; y <= ry; y += 0.5) { const half = m2(rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry)))); Q(cx - half, cy + y, half * 2, 0.5, Math.abs(y) > ry - 1.5 || half < 3 ? '#5be7ff' : '#1d4d57'); }
    pontilha(cx - rx + 4, cy - ry + 3, (rx - 4) * 2, (ry - 3) * 2, 'rgba(91,231,255,.10)', elipse);
    for (let y = -ry + 3; y <= ry - 3; y += 0.5) { const half = m2((rx - 5) * Math.sqrt(Math.max(0, 1 - (y * y) / ((ry - 3) * (ry - 3))))); if (Math.round(y * 2) % 3 === 0) { Q(cx - half, cy + y, 0.5, 0.5, '#2f7a86'); Q(cx + half - 0.5, cy + y, 0.5, 0.5, '#2f7a86'); } }
    const k = '#5be7ff', f = '#1d4d57';
    R(cx - 10, cy - 3, 16, 7, k); R(cx - 9, cy - 4, 14, 1, k); R(cx - 9, cy + 4, 14, 1, k); R(cx + 4, cy - 6, 8, 6, k); R(cx + 12, cy - 4, 1, 4, k);
    R(cx + 5, cy - 8, 2, 2, k); Q(cx + 9, cy - 4, 1, 1, f); Q(cx + 12, cy - 3, 0.5, 1, f); Q(cx - 9, cy - 3, 14, 0.5, '#c9f6ff');
    R(cx - 8, cy + 5, 2, 2, k); R(cx - 4, cy + 5, 2, 2, k); R(cx, cy + 5, 2, 2, k); R(cx + 3, cy + 5, 2, 2, k); }
  // tapete da porta
  { const cx = L.cx; R(cx - 18, H - 9, 36, 9, '#3d2a22'); Q(cx - 17, H - 8, 34, 0.5, '#7a5040'); Q(cx - 17, H - 8, 0.5, 8, '#7a5040'); Q(cx + 16.5, H - 8, 0.5, 8, '#7a5040');
    for (let k = cx - 15; k < cx + 15; k += 2) Q(k, H - 6, 0.5, 4, '#4d362b');
    bloco(cx - 22, H - 4, 4, 4, '#1c1a2b'); bloco(cx + 18, H - 4, 4, 4, '#1c1a2b'); pontilha(cx - 18, H - 14, 36, 14, 'rgba(255,236,190,.10)', (u, v) => v * (1 - Math.abs(u - 0.5) * 1.6)); }
  // sombras dos móveis no chão
  for (const sb of L.sombras || []) sombra(...sb);
  // cantos mais escuros
  pontilha(0, H - 10, W, 10, 'rgba(0,0,0,.35)', (u, v) => v * 0.9);
  pontilha(0, WL, 12, H - WL, 'rgba(0,0,0,.3)', (u) => 1 - u);
  pontilha(W - 12, WL, 12, H - WL, 'rgba(0,0,0,.3)', (u) => u);
  S.fundo = c;
}

/* ---------- Telas vivas: telão do Jarvis e TV ---------- */
function desenhaTelao() {
  const t = S.L.telao, n = S.barras.length || 1, max = Math.max(1, ...S.barras), bw = (t.w - 8) / n;
  R(t.x, t.y, t.w, t.h, '#07121a');
  for (let y = t.y + 4; y < t.y + t.h - 3; y += 4) Q(t.x + 2, y, t.w - 4, 0.5, 'rgba(91,231,255,.07)');
  for (let x = t.x + 4; x < t.x + t.w - 2; x += 8) Q(x, t.y + 8, 0.5, t.h - 11, 'rgba(91,231,255,.05)');
  const vivo = REDUZ.matches || Math.floor(S.agora / 600) % 2 === 0;
  bloco(t.x + 3, t.y + 3, 3, 3, vivo ? '#ff5d6c' : '#5a1f29');
  Q(t.x + 8, t.y + 3.5, 14, 0.5, '#2f7a86'); Q(t.x + 8, t.y + 5, 9, 0.5, '#1d4d57');
  S.barras.forEach((v, i) => {
    const hh = Math.max(0.5, m2((v / max) * (t.h - 13))), x = t.x + 4 + i * bw, top = t.y + t.h - 3 - hh, ult = i === n - 1;
    Q(x, top, bw - 0.5, hh, ult ? '#ffffff' : '#5be7ff'); Q(x, top, bw - 0.5, 0.5, ult ? '#ffffff' : '#c9f6ff'); Q(x + bw - 1, top + 0.5, 0.5, hh - 0.5, ult ? '#cfd8e0' : '#2fb4cf');
  });
  if (!REDUZ.matches) Q(t.x, t.y + ((S.agora / 40) % t.h), t.w, 0.5, 'rgba(91,231,255,.12)');
  Q(t.x + 2, t.y + t.h - 3, t.w - 4, 0.5, '#1d4d57');
}
function desenhaTV() {
  const t = S.L.tv, k = REDUZ.matches ? 0 : S.agora / 900;
  R(t.x, t.y, t.w, t.h, '#101425');
  const cores = ['#3b2a8f', '#5b3fc4', '#8a5cf0', '#c39bff'];
  for (let i = 0; i < 6; i++) { const x = t.x + ((i * 14 + Math.floor(k * 12)) % (t.w + 14)) - 14, x0 = Math.max(t.x, x), w = Math.min(12, t.x + t.w - x0) - (x0 - x); if (w > 0) { Q(x0, t.y + 6 + (i % 3) * 8, w, 6, cores[i % 4]); Q(x0, t.y + 6 + (i % 3) * 8, w, 0.5, escurece(cores[i % 4], 1.3)); } }
  const mx = t.x + t.w / 2, my = t.y + t.h / 2;
  for (let j = 0; j < 8; j++) Q(mx - 3 + j * 0.5, my - 4 + j * 0.5, 0.5, 8 - j, '#ffffff');
  for (let y = t.y; y < t.y + t.h; y += 1) Q(t.x, y + 0.5, t.w, 0.5, 'rgba(0,0,0,.16)');
  Q(t.x + 2, t.y + t.h - 4, m2((t.w - 4) * ((k % 10) / 10)), 1, '#ff5d6c'); Q(t.x + 2, t.y + t.h - 4, t.w - 4, 0.5, 'rgba(255,255,255,.18)');
  Q(t.x + 2, t.y + 1, 6, 0.5, 'rgba(255,255,255,.12)');
}

/* ---------- Pessoas ---------- */
function novaPessoa(d) {
  return { ref: d.ref, nome: d.nome, etiqueta: d.etiqueta, dados: d, vis: visualDe(d.ref), x: 0, y: 0, rota: [], assento: null, zona: null, estado: 'fora', pose: 'frente', flip: false, fase: Math.random() * 6000, bolha: null, aoChegar: null, espera: 0 };
}
function livres(z) { return (S.L.assentos[z] || []).filter((s) => !s.ocupante); }
function ocupa(p, z) {
  const ls = livres(z); if (!ls.length) return null;
  const s = ls[0]; s.ocupante = p.ref; p.assento = s; p.zona = z; return s;
}
const tempo = (p) => Date.parse((p.dados && p.dados.ultimo_contato) || 0) || 0;
function maisAntigo(z) {
  let m = null;
  for (const q of S.pessoas.values()) if (q.zona === z && q.estado === 'sentado' && !q.saindo && (!m || tempo(q) < tempo(m))) m = q;
  return m;
}
// Abre lugar na área: quem chegou agora toma a cadeira de quem está há mais tempo parado (esse sai pela porta).
function abreVaga(z, novo) {
  if (livres(z).length) return true;
  const m = maisAntigo(z); if (!m || (novo && tempo(novo) && tempo(m) > tempo(novo))) return false;
  sair(m); return livres(z).length > 0;
}
const vagas = (z) => livres(z).length - S.fila.filter((f) => f.etiqueta === z).length;
function solta(p) { if (p.assento) { p.assento.ocupante = null; p.assento = null; } }
function sentaJa(p) { const s = p.assento; p.x = s.x; p.y = s.y; p.estado = 'sentado'; p.rota = []; p.pose = s.face; p.flip = false; if (!S.primeira && !REDUZ.matches) { p.transAte = S.agora + 170; p.transPose = s.face === 'sentaCostas' ? 'costas' : 'frente'; } }
function corredor(y) { return S.L.aisles.reduce((m, a) => (Math.abs(a - y) < Math.abs(m - y) ? a : m), S.L.aisles[0]); }
function rotaAte(p, s) {
  const L = S.L, pts = [];
  let x = p.x, y = p.y;
  if (p.assento && p.estado === 'sentado' && p.assento.acesso != null) { pts.push([p.assento.acesso, y]); x = p.assento.acesso; }
  const aP = corredor(y), aT = corredor(s.y), ax = s.acesso != null ? s.acesso : s.x;
  pts.push([x, aP]);
  if (aP !== aT) { pts.push([L.cx, aP]); pts.push([L.cx, aT]); }
  pts.push([ax, aT]); pts.push([ax, s.y]); pts.push([s.x, s.y]);
  return pts.filter((q, i, a) => !i || q[0] !== a[i - 1][0] || q[1] !== a[i - 1][1]);
}
function rotaSaida(p) {
  const L = S.L, pts = []; let x = p.x;
  if (p.assento && p.assento.acesso != null) { pts.push([p.assento.acesso, p.y]); x = p.assento.acesso; }
  const aP = corredor(p.y); pts.push([x, aP]); pts.push([L.cx, aP]); pts.push([L.cx, L.H - 3]); pts.push([L.porta_entrada.x, L.porta_entrada.y]);
  return pts;
}
function anda(p, pts, aoChegar) { if (p.estado === 'sentado' && !REDUZ.matches) { p.transAte = S.agora + 170; p.transPose = p.pose === 'sentaCostas' ? 'costas' : 'frente'; } p.rota = pts; p.estado = 'andando'; p.partiu = S.agora + 170; p.aoChegar = aoChegar || null; if (REDUZ.matches) { const f = pts[pts.length - 1]; p.x = f[0]; p.y = f[1]; p.rota = []; chegou(p); } }
function chegou(p) {
  const fn = p.aoChegar; p.aoChegar = null;
  if (fn) fn(p);
  else if (p.assento) sentaJa(p);
}
function entrar(p, z) {
  abreVaga(z, p);
  const s = ocupa(p, z); if (!s) return false;
  const L = S.L; p.x = L.porta_entrada.x; p.y = L.porta_entrada.y; S.pessoas.set(p.ref, p);
  const ax = L.atendimento.x + (((S.nAt = (S.nAt || 0) + 1) % 3) - 1) * 12;
  anda(p, [[L.cx, L.H - 3], [L.cx, L.atendimento.y + 6], [ax, L.atendimento.y]], (q) => {
    q.estado = 'esperando'; q.pose = 'costas'; q.espera = S.agora + (REDUZ.matches ? 0 : 1500);
    falaJarvis('Oi, mestre!'); S.jarvis.acenaAte = S.agora + 1300;
    q.depois = () => anda(q, rotaAte(q, q.assento));
  });
  return true;
}
function trocar(p, z) {
  if (!livres(z).length && !abreVaga(z, null)) { sair(p); return; }
  const velho = p.assento, sentado = p.estado === 'sentado';
  p.assento = null; ocupa(p, z);
  const tmp = { ...p, assento: velho, estado: sentado ? 'sentado' : p.estado };
  if (velho) velho.ocupante = null;
  anda(p, rotaAte(tmp, p.assento), (q) => { sentaJa(q); if (z === 'revendedor') festa(q); });
}
function sair(p) {
  const pts = rotaSaida(p); solta(p); p.zona = null;
  anda(p, pts, (q) => { S.pessoas.delete(q.ref); });
  p.saindo = true;
}

/* ---------- Efeitos ---------- */
function bolha(p, tipo, ms) { if (p) p.bolha = { tipo, ate: S.agora + ms }; }
function festa(p) {
  if (REDUZ.matches) return;
  for (let i = 0; i < 16; i++) S.efeitos.push({ tipo: 'moeda', x: p.x, y: p.y - 14, vx: (Math.random() - 0.5) * 70, vy: -45 - Math.random() * 55, chao: p.y + Math.random() * 4 - 2, seed: i, ate: S.agora + 1700 });
  for (let i = 0; i < 6; i++) S.efeitos.push({ tipo: 'brilho', x: p.x + (Math.random() - 0.5) * 22, y: p.y - 8 - Math.random() * 16, t0: S.agora + i * 90, dur: 520 });
}
function envelope(p) {
  if (!p || REDUZ.matches) return;
  const ult = S.ultimoEnvelope.get(p.ref) || 0; if (S.agora - ult < 3500) return; S.ultimoEnvelope.set(p.ref, S.agora);
  const J = S.L.mesa; S.efeitos.push({ tipo: 'envelope', x0: J.x, y0: J.y - 34, alvo: p, t0: S.agora, dur: 950, rastro: [] });
}
let falaEl = null;
function falaJarvis(txt) {
  if (!falaEl) return;
  falaEl.textContent = txt; falaEl.classList.remove('some'); void falaEl.offsetWidth; falaEl.classList.add('mostra');
  clearTimeout(falaJarvis.t); falaJarvis.t = setTimeout(() => falaEl.classList.remove('mostra'), 2200);
}

/* ---------- Dados ---------- */
function aplicar(d) {
  S.dados = d;
  const L = S.L; if (!L) return;
  const quer = new Map((d.pessoas || []).map((x) => [x.ref, x]));
  S.totalZona = d.total || {};
  // 1. quem saiu do período ou trocou de etiqueta
  for (const p of [...S.pessoas.values()]) {
    if (p.saindo) continue;
    const q = quer.get(p.ref);
    if (!q) { if (S.primeira || p.provisorio && S.agora - p.nasceu < 180000) continue; sair(p); continue; }
    p.dados = q; p.nome = q.nome;
    if (p.provisorio) p.provisorio = false;
    if (q.etiqueta !== p.etiqueta) { p.etiqueta = q.etiqueta; if (p.estado !== 'esperando') trocar(p, q.etiqueta); else p.zonaPendente = q.etiqueta; }
  }
  // 2. quem ainda não está na sala, do mais recente para o mais antigo, até lotar a área
  const sobra = {};
  for (const q of d.pessoas || []) {
    if (S.pessoas.has(q.ref)) continue;
    const naFila = S.fila.find((x) => x.ref === q.ref);
    if (naFila) { naFila.etiqueta = q.etiqueta; naFila.dados = q; naFila.provisorio = false; continue; }
    const p = novaPessoa(q);
    const recente = !S.primeira && Date.now() - Date.parse(q.ultimo_contato) < 15 * 60e3;
    if (vagas(q.etiqueta) <= 0 && !(recente && maisAntigo(q.etiqueta) && tempo(maisAntigo(q.etiqueta)) < tempo(p))) { sobra[q.etiqueta] = (sobra[q.etiqueta] || 0) + 1; continue; }
    if (S.primeira) { ocupa(p, q.etiqueta); sentaJa(p); S.pessoas.set(p.ref, p); }
    else S.fila.push(p);
  }
  S.sobrando = sobra;
  S.primeira = false;
  // 3. barras do telão: mensagens de clientes por 10 min nas últimas 3 h
  const agora = Date.parse(d.gerado_em) || Date.now(), barras = new Array(18).fill(0);
  for (const e of d.eventos || []) if (e.tipo === 'mensagem_cliente') { const k = Math.floor((agora - Date.parse(e.t)) / 600000); if (k >= 0 && k < 18) barras[17 - k]++; }
  S.barras = barras;
  // 4. acontecimentos novos
  const evs = (d.eventos || []).filter((e) => S.ultimoT == null || e.t > S.ultimoT);
  if (S.ultimoT == null) { S.log = resumirLog(d.eventos || []).slice(-6); S.ultimoT = (d.eventos || []).length ? d.eventos[d.eventos.length - 1].t : d.gerado_em; }
  else if (evs.length) { S.ultimoT = evs[evs.length - 1].t; S.filaEv.push(...evs); S.log = S.log.concat(resumirLog(evs)).slice(-6); }
  if (d.jarvis && d.jarvis.digitando) S.jarvis.digitandoAte = Math.max(S.jarvis.digitandoAte, S.agora + 2500);
  pintarRotulos(); pintarLog(); pintarListaLeitor();
}
const FRASE = {
  mensagem_cliente: (n) => `${n} mandou mensagem`, resposta_robo: (n) => `Jarvis respondeu ${n}`, followup: (n) => `Jarvis chamou ${n} de novo`,
  followup_backlog: (n) => `Jarvis retomou ${n}`, toque_cadencia: (n) => `Jarvis chamou ${n} de novo`, toque_jornada: (n) => `Jarvis acompanhou ${n}`,
  retomada_senhor: (n) => `Jarvis retomou ${n}`, retorno_lacuna: (n) => `Jarvis voltou com a resposta para ${n}`, passou_ao_senhor: (n) => `${n} foi passado ao senhor`,
  teste_gerado: (n) => `${n} ganhou um teste`, painel_fechado: (n) => `${n} fechou painel`, senhor_escreveu: (n) => `O senhor falou com ${n}`,
  conversa_nova: (n) => `${n} entrou no escritório`, cliente_respondeu_followup: (n) => `${n} respondeu o follow-up`,
};
function resumirLog(evs) {
  const out = [];
  for (const e of evs) {
    const f = FRASE[e.tipo]; if (!f) continue;
    const ult = out[out.length - 1];
    if (ult && ult.ref === e.ref && ult.tipo === e.tipo) { ult.t = e.t; continue; }
    out.push({ t: e.t, ref: e.ref, tipo: e.tipo, txt: f(e.nome) });
  }
  return out;
}
function tocarEvento(e) {
  const p = S.pessoas.get(e.ref);
  switch (e.tipo) {
    case 'mensagem_cliente': case 'cliente_respondeu_followup':
      if (p) bolha(p, 'fala', 2600);
      else if (!S.fila.some((q) => q.ref === e.ref)) { const q = novaPessoa({ ref: e.ref, nome: e.nome, etiqueta: 'lead' }); q.provisorio = true; q.nasceu = S.agora; S.fila.push(q); }
      break;
    case 'resposta_robo': case 'followup': case 'followup_backlog': case 'toque_cadencia': case 'toque_jornada': case 'retomada_senhor': case 'retorno_lacuna':
      S.jarvis.digitandoAte = Math.max(S.jarvis.digitandoAte, S.agora + 1800); S.jarvis.com = e.ref;
      if (p && p.estado === 'sentado') envelope(p);
      break;
    case 'teste_gerado': if (p) bolha(p, 'tv', 3200); break;
    case 'painel_fechado': if (p) { bolha(p, 'moeda', 3000); festa(p); } falaJarvis('Painel fechado!'); break;
    case 'passou_ao_senhor': if (p) bolha(p, 'alerta', 4200); break;
    case 'senhor_escreveu': if (p) bolha(p, 'estrela', 2600); break;
  }
}

/* ---------- Laço de desenho ---------- */
let ultimoQuadro = 0, proxEv = 0, proxFila = 0;
function quadro(t) {
  S.raf = 0;
  if (!S.ativo) return;
  S.raf = requestAnimationFrame(quadro);
  if (t - ultimoQuadro < (REDUZ.matches ? 250 : 30)) return;   // ~30 qps bastam para pixel art; sem movimento, 4 qps
  const dt = Math.min(0.1, (t - (ultimoQuadro || t)) / 1000); ultimoQuadro = t; S.agora = t;
  // fila de chegadas: uma pessoa a cada 1,6 s
  if (S.fila.length && t > proxFila) { const p = S.fila.shift(); if (!S.pessoas.has(p.ref)) entrar(p, p.etiqueta) || (S.sobrando[p.etiqueta] = (S.sobrando[p.etiqueta] || 0) + 1); proxFila = t + 1600; }
  if (S.filaEv.length && t > proxEv) { tocarEvento(S.filaEv.shift()); proxEv = t + 420; pintarRotulos(); }
  for (const p of S.pessoas.values()) mover(p, dt);
  desenhar();
}
function mover(p, dt) {
  if (p.transAte > S.agora) return;   // levantando ou sentando
  if (p.estado === 'esperando') {
    if (S.agora > p.espera && p.depois) { const fn = p.depois; p.depois = null; if (p.zonaPendente) { const z = p.zonaPendente; p.zonaPendente = null; solta(p); if (!ocupa(p, z)) { sair(p); return; } } fn(); }
    return;
  }
  if (p.estado !== 'andando' || !p.rota.length) return;
  // sai devagar, pega velocidade e freia antes de chegar
  const fim = p.rota[p.rota.length - 1], resta = Math.hypot(fim[0] - p.x, fim[1] - p.y);
  const acel = Math.min(1, 0.3 + (S.agora - (p.partiu || 0)) / 420), freia = p.rota.length === 1 && resta < 8 ? 0.4 + (resta / 8) * 0.6 : 1;
  let passo = VEL * dt * acel * freia;
  while (passo > 0 && p.rota.length) {
    const [tx, ty] = p.rota[0], dx = tx - p.x, dy = ty - p.y, dist = Math.hypot(dx, dy);
    if (Math.abs(dx) > Math.abs(dy)) { p.pose = 'lado'; p.flip = dx < 0; } else if (dy !== 0) { p.pose = dy < 0 ? 'costas' : 'frente'; p.flip = false; }
    if (dist <= passo) { p.x = tx; p.y = ty; p.rota.shift(); passo -= dist; }
    else { p.x += (dx / dist) * passo; p.y += (dy / dist) * passo; passo = 0; }
  }
  if (!REDUZ.matches && S.agora - (p.ultPasso || 0) > 250) { p.ultPasso = S.agora; S.efeitos.push({ tipo: 'poeira', x: p.x + (Math.random() - 0.5) * 3, y: p.y, t0: S.agora }); }
  if (!p.rota.length) chegou(p);
}
function poseAtual(p) {
  const pisca = !REDUZ.matches && ((S.agora + p.fase) % 4700) < 130 ? '~' : '';
  if (p.transAte > S.agora) return { pose: p.transPose, bob: 0, agacha: 1.5 };
  if (p.estado === 'sentado') return { pose: p.pose + (p.pose === 'senta' ? pisca : ''), bob: 0, agacha: 0 };
  if (p.estado === 'andando' && !REDUZ.matches) { const f = Math.floor((S.agora + p.fase) / 125) % 4; return { pose: p.pose + ['A', '', 'B', ''][f], bob: f % 2 ? 0.5 : 0, agacha: 0 }; }
  return { pose: p.pose + (p.pose === 'frente' ? pisca : ''), bob: 0, agacha: 0 };
}
function desenhaPessoa(p) {
  const { pose, bob, agacha } = poseAtual(p), sp = sprite(p.ref, p.vis, pose), sw = sp.width / 2, sh = sp.height / 2;
  const dy = (p.estado === 'sentado' && p.assento ? p.assento.dy : 0) + agacha;
  const resp = p.estado === 'sentado' && !REDUZ.matches && ((S.agora + p.fase) % 4200) < 380 ? 0.5 : 0;
  const x = m2(p.x - sw / 2), y = m2(p.y + dy + 1 - sh - resp - bob);
  if (p.estado !== 'sentado') { Q(p.x - 3.5, p.y - 0.5, 7, 1, 'rgba(0,0,0,.28)'); Q(p.x - 2.5, p.y - 1, 5, 0.5, 'rgba(0,0,0,.16)'); }
  if (p.flip) { G.save(); G.translate(x + sw, y); G.scale(-1, 1); G.drawImage(sp, 0, 0, sw, sh); G.restore(); }
  else G.drawImage(sp, x, y, sw, sh);
  p.caixa = { x, y, w: sw, h: sh };
  if (S.hover === p.ref || S.fixo === p.ref) { const k = REDUZ.matches ? 0 : (Math.floor(S.agora / 250) % 2) * 0.5; Q(p.x - 1.5, y - 3.5 - k, 3, 0.5, '#ffffff'); Q(p.x - 1, y - 3 - k, 2, 0.5, '#ffffff'); Q(p.x - 0.5, y - 2.5 - k, 1, 0.5, '#ffffff'); }
}
function desenhaBolha(p) {
  const b = p.bolha; if (!b || !p.caixa) return;
  if (S.agora > b.ate) { p.bolha = null; return; }
  const x = Math.round(p.x) - 6, y = p.caixa.y - 12.5 - (REDUZ.matches ? 0 : (Math.floor(S.agora / 300) % 2) * 0.5);
  const fundo = { fala: '#ffffff', tv: '#efe6ff', moeda: '#fff6c8', alerta: '#ff5d6c', estrela: '#fff6c8' }[b.tipo] || '#ffffff';
  // balão com contorno de meio pixel (igual ao dos bonecos), quinas cortadas e ponta em degraus
  Q(x + 0.5, y, 11, 9, CONTORNO); Q(x, y + 0.5, 12, 8, CONTORNO); Q(x + 0.5, y + 0.5, 11, 8, fundo);
  Q(x + 1, y + 1, 9, 0.5, fundo === '#ff5d6c' ? '#ff8a95' : '#ffffff');
  Q(x + 4.5, y + 8.5, 3, 0.5, fundo); Q(x + 4, y + 8.5, 0.5, 0.5, CONTORNO); Q(x + 7.5, y + 8.5, 0.5, 0.5, CONTORNO);
  Q(x + 5, y + 9, 2, 0.5, fundo); Q(x + 4.5, y + 9, 0.5, 0.5, CONTORNO); Q(x + 7, y + 9, 0.5, 0.5, CONTORNO); Q(x + 5, y + 9.5, 2, 0.5, CONTORNO);
  if (b.tipo === 'fala') { const k = Math.floor(S.agora / 260) % 4; for (let n = 0; n < 3; n++) Q(x + 3 + n * 2.25, y + 3.75, 1.25, 1.25, n < k ? '#1b1720' : '#b9b4c4'); }
  if (b.tipo === 'tv') { Q(x + 3, y + 2, 6, 4.5, '#3b2a8f'); Q(x + 3.5, y + 2.5, 5, 3.5, '#5b3fc4'); Q(x + 5, y + 3, 0.5, 2.5, '#ffffff'); Q(x + 5.5, y + 3.5, 0.5, 1.5, '#ffffff'); Q(x + 6, y + 4, 0.5, 0.5, '#ffffff'); Q(x + 4.5, y + 6.5, 3, 0.5, '#3b2a8f'); }
  if (b.tipo === 'moeda') { Q(x + 4.5, y + 1.5, 3, 0.5, '#c98d12'); Q(x + 3.5, y + 2, 5, 4.5, '#c98d12'); Q(x + 4.5, y + 6.5, 3, 0.5, '#c98d12'); Q(x + 4, y + 2.5, 4, 3.5, '#ffd84a'); Q(x + 4.5, y + 2.5, 0.5, 2.5, '#fff1a8'); Q(x + 5.5, y + 3, 1, 2.5, '#e0a91c'); }
  if (b.tipo === 'alerta') { Q(x + 5.25, y + 1.5, 1.5, 3.5, '#ffffff'); Q(x + 5.25, y + 5.75, 1.5, 1.25, '#ffffff'); }
  if (b.tipo === 'estrela') { Q(x + 5.5, y + 1.5, 1, 6, '#e0a91c'); Q(x + 3, y + 3.5, 6, 1, '#e0a91c'); Q(x + 4.5, y + 2.5, 3, 4, '#ffd84a'); Q(x + 5, y + 3, 0.5, 1, '#fff6c8'); }
}
function desenhar() {
  const L = S.L; if (!L || !S.fundo) return;
  G = S.ctx; G.setTransform(2, 0, 0, 2, 0, 0); G.imageSmoothingEnabled = false;
  G.drawImage(S.fundo, 0, 0, L.W, L.H);
  desenhaTelao(); desenhaTV();
  if (!REDUZ.matches) {
    if (L.tvLuz) { const [x, y, w, hh] = L.tvLuz, a = 0.03 + 0.035 * (Math.sin(S.agora / 170) * Math.sin(S.agora / 530) + 1) / 2; Q(x, y, w, hh, 'rgba(170,140,255,' + a.toFixed(3) + ')'); }
    // poeira no ar, na luz das janelas
    while (S.ar.length < 26) S.ar.push({ x: Math.random() * L.W, y: L.WALL + 2 + Math.random() * 30, v: 0.6 + Math.random(), f: Math.random() * 6 });
    for (const a of S.ar) {
      a.y -= a.v / 60; a.x += Math.sin(S.agora / 1500 + a.f) * 0.03;
      if (a.y < L.WALL) { a.y = L.WALL + 32; a.x = Math.random() * L.W; }
      Q(a.x, a.y, 0.5, 0.5, 'rgba(255,240,210,' + (0.18 + 0.14 * Math.sin(S.agora / 400 + a.f)).toFixed(2) + ')');
    }
  }
  const itens = L.moveis.slice();
  for (const p of S.pessoas.values()) itens.push({ y: p.y + (p.estado === 'sentado' ? 0 : 0.3), d: () => desenhaPessoa(p) });
  itens.sort((a, b) => a.y - b.y);
  for (const it of itens) it.d(G);
  if (!REDUZ.matches) {
    for (const p of S.pessoas.values()) {
      if (p.estado !== 'sentado' || p.bolha || !p.caixa) continue;
      const fase = (S.agora + p.fase) % 3600;
      if (p.zona === 'esfriou' && fase < 2400) { const k = fase / 2400, zx = p.x + 5 + k * 5, zy = p.caixa.y - 1 - k * 9, cz = 'rgba(216,238,255,' + (1 - k * 0.7).toFixed(2) + ')'; Q(zx, zy, 2, 0.5, cz); Q(zx + 1, zy + 0.5, 0.5, 0.5, cz); Q(zx + 0.5, zy + 1, 0.5, 0.5, cz); Q(zx, zy + 1.5, 2, 0.5, cz); }
      if (p.zona === 'senhor' && fase < 900) { Q(p.x - 0.5, p.caixa.y - 7, 1.5, 3, '#ff5d6c'); Q(p.x - 0.5, p.caixa.y - 3, 1.5, 1, '#ff5d6c'); Q(p.x - 0.5, p.caixa.y - 7, 0.5, 3, '#ff9aa4'); }
      if (p.zona === 'revendedor' && fase < 300) { const r2 = fase < 150 ? 1 : 1.5; Q(p.x + 5, p.caixa.y + 2 - r2, 0.5, r2 * 2, '#fff1a8'); Q(p.x + 5 - r2 + 0.25, p.caixa.y + 2 - 0.25, r2 * 2, 0.5, '#fff1a8'); }
    }
    const z = L.gelo;
    while (S.neve.length < 30) S.neve.push({ x: z.x + Math.random() * z.w, y: z.y - Math.random() * z.h, v: 5 + Math.random() * 8 });
    for (const f of S.neve) { f.y += f.v / 30; f.x += Math.sin((S.agora + f.v * 900) / 700) * 0.15; if (f.y > z.y + z.h) { f.y = z.y; f.x = z.x + Math.random() * z.w; } if (f.y > z.y) Q(f.x, f.y, 0.5, 0.5, f.v > 10 ? '#ffffff' : '#cfe6fa'); }
  }
  for (const p of S.pessoas.values()) desenhaBolha(p);
  S.efeitos = S.efeitos.filter((e) => {
    if (e.tipo === 'poeira') { const k = (S.agora - e.t0) / 360; if (k >= 1) return false; const c = 'rgba(214,190,160,' + (0.5 * (1 - k)).toFixed(2) + ')'; Q(e.x - 1 - k * 2, e.y - 0.5 - k * 1.5, 0.5, 0.5, c); Q(e.x + 1 + k * 2, e.y - 0.5 - k, 0.5, 0.5, c); return true; }
    if (e.tipo === 'moeda') {
      if (S.agora > e.ate) return false;
      e.vy += 160 / 30; e.x += e.vx / 30; e.y += e.vy / 30; if (e.y > e.chao) { e.y = e.chao; e.vy *= -0.42; e.vx *= 0.7; }
      const w = [1.5, 1, 0.5, 1][Math.floor(S.agora / 70 + e.seed) % 4];
      if (!(S.agora > e.ate - 300 && Math.floor(S.agora / 60) % 2)) { Q(e.x - w / 2, e.y - 1.5, w, 1.5, '#e0a91c'); Q(e.x - w / 2, e.y - 1.5, Math.min(w, 0.5), 1, '#fff1a8'); }
      return true;
    }
    if (e.tipo === 'brilho') { const k = (S.agora - e.t0) / e.dur; if (k < 0) return true; if (k >= 1) return false; const r2 = m2(0.5 + Math.sin(k * Math.PI) * 1.5); Q(e.x, e.y - r2, 0.5, r2 * 2, '#fff6c8'); Q(e.x - r2, e.y, r2 * 2, 0.5, '#fff6c8'); return true; }
    if (e.tipo === 'envelope') {
      const k = (S.agora - e.t0) / e.dur; if (k >= 1 || !e.alvo.caixa) { if (e.alvo) bolha(e.alvo, 'fala', 900); return false; }
      const x1 = e.alvo.x, y1 = e.alvo.caixa.y - 2, mx = (e.x0 + x1) / 2, my = Math.min(e.y0, y1) - 26;
      const x = (1 - k) * (1 - k) * e.x0 + 2 * (1 - k) * k * mx + k * k * x1, y = (1 - k) * (1 - k) * e.y0 + 2 * (1 - k) * k * my + k * k * y1;
      e.rastro.push([x, y]); if (e.rastro.length > 6) e.rastro.shift();
      e.rastro.forEach(([rx, ry], i) => Q(rx, ry, 0.5, 0.5, 'rgba(91,231,255,' + ((i + 1) / 9).toFixed(2) + ')'));
      Q(x - 4, y - 3, 8, 6, CONTORNO); bloco(x - 3.5, y - 2.5, 7, 5, '#5be7ff');
      for (let j = 0; j < 3.5; j += 0.5) { Q(x - 3.5 + j, y - 2 + j * 0.6, 0.5, 0.5, '#1d6f80'); Q(x + 3 - j, y - 2 + j * 0.6, 0.5, 0.5, '#1d6f80'); }
      return true;
    }
    return false;
  });
  posicionarFala();
}

/* ---------- Camada DOM: rótulos, fala do Jarvis, dica, registro ---------- */
let mundo, cv, rotulosEl, dicaEl, logEl, leitorEl, jarvisTxt, hudEl, numerosOrig = null;
function montar() {
  const quadroEl = $('.quadro');
  const esc = h('section', { class: 'esc', id: 'esc', 'aria-label': 'Escritório do Jarvis' });
  mundo = h('div', { class: 'esc-mundo' });
  cv = h('canvas', { class: 'esc-cv', role: 'img', 'aria-label': 'Escritório do Jarvis com os clientes sentados por etiqueta' });
  hudEl = h('div', { class: 'esc-hud' });
  rotulosEl = h('div', { class: 'esc-rotulos', role: 'group', 'aria-label': 'Áreas do escritório' });
  falaEl = h('div', { class: 'esc-fala', 'aria-hidden': 'true' });
  dicaEl = h('div', { class: 'esc-dica', role: 'status', hidden: true });
  mundo.append(cv, rotulosEl, falaEl, dicaEl, hudEl);
  jarvisTxt = h('span', { class: 'esc-jarvis-txt' });
  logEl = h('ol', { class: 'esc-log', 'aria-label': 'Últimos acontecimentos' });
  const barra = h('div', { class: 'esc-barra' },
    h('div', { class: 'esc-jarvis' }, h('i', { class: 'esc-led', 'aria-hidden': 'true' }), h('b', { text: 'JARVIS' }), jarvisTxt),
    logEl);
  leitorEl = h('div', { class: 'so-leitor', 'aria-live': 'off' });
  esc.append(mundo, barra, leitorEl);
  quadroEl.prepend(esc);
  S.cv = cv; S.ctx = cv.getContext('2d', { alpha: false });
  new ResizeObserver(() => medir()).observe(esc);
  cv.addEventListener('pointermove', (ev) => { const p = acharPessoa(ev); const ref = p ? p.ref : null; if (ref !== S.hover) { S.hover = ref; cv.style.cursor = ref ? 'pointer' : ''; mostrarDica(); } });
  cv.addEventListener('pointerleave', () => { S.hover = null; mostrarDica(); });
  cv.addEventListener('click', (ev) => { const p = acharPessoa(ev); S.fixo = p && S.fixo !== p.ref ? p.ref : null; mostrarDica(); });
  addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && S.fixo) { S.fixo = null; mostrarDica(); } });
}
function medir() {
  const esc = $('#esc'); if (!esc || !esc.offsetParent) return;
  const barraH = $('.esc-barra', esc).offsetHeight, dpr = devicePixelRatio || 1;
  const aw = esc.clientWidth, ah = esc.clientHeight - barraH - 6;
  if (aw < 200 || ah < 150) return;
  // cada pixel do mundo = 2x2 pixels de alta definição; cada um deles ocupa P pixels do aparelho
  const P = Math.max(1, Math.floor((ah * dpr) / 392)), esc0 = P * 2;
  const W = Math.floor((aw * dpr) / esc0), H = Math.floor((ah * dpr) / esc0);
  if (W === S.W && H === S.H && esc0 === S.esc) return;
  S.W = W; S.H = H; S.esc = esc0;
  cv.width = W * 2; cv.height = H * 2;
  const cw = (W * esc0) / dpr, ch = (H * esc0) / dpr;
  mundo.style.width = cw + 'px'; mundo.style.height = ch + 'px';
  esc.style.setProperty('--px', (esc0 / dpr) + 'px');
  const antigos = [...S.pessoas.values()];
  S.L = layout(W, H); desenhaFundo();
  // reacomoda quem já estava na sala nas cadeiras novas
  S.pessoas.clear();
  for (const p of antigos) { if (p.saindo) continue; p.assento = null; p.rota = []; if (ocupa(p, p.etiqueta)) { sentaJa(p); S.pessoas.set(p.ref, p); } }
  if (S.dados && !antigos.length) { S.primeira = true; aplicar(S.dados); }
  pintarRotulos(); desenhar();
}
function acharPessoa(ev) {
  const r = cv.getBoundingClientRect(), x = ((ev.clientX - r.left) / r.width) * S.W, y = ((ev.clientY - r.top) / r.height) * S.H;
  let melhor = null;
  for (const p of S.pessoas.values()) { const c = p.caixa; if (c && x >= c.x - 1 && x <= c.x + c.w + 1 && y >= c.y - 1 && y <= c.y + c.h + 1 && (!melhor || p.y > melhor.y)) melhor = p; }
  return melhor;
}
const pxs = (v) => `calc(var(--px) * ${v})`;
const placas = {};
function pessoasDa(z) { return [...S.pessoas.values()].filter((p) => p.zona === z && !p.saindo).sort((a, b) => a.y - b.y || a.x - b.x); }
function focarPessoa(z, passo) {
  const ls = pessoasDa(z); if (!ls.length) { S.fixo = null; mostrarDica(); return; }
  let i = ls.findIndex((p) => p.ref === S.fixo); i = i < 0 ? 0 : (i + passo + ls.length) % ls.length;
  S.fixo = ls[i].ref; mostrarDica();
}
function pintarRotulos() {
  if (!S.L || !rotulosEl) return;
  const cont = {}; for (const p of S.pessoas.values()) if (p.zona && !p.saindo) cont[p.zona] = (cont[p.zona] || 0) + 1;
  S.porZona = cont;
  for (const z of ORDEM_ZONAS) {
    const pos = S.L.rotulos[z]; if (!pos) continue;
    let el = placas[z];
    if (!el || !el.isConnected) {
      el = placas[z] = h('button', { type: 'button', class: 'esc-placa', style: '--cor:' + ZONAS[z].cor }, h('i', { 'aria-hidden': 'true' }), h('span', { text: ZONAS[z].nome }), h('b'), h('em'));
      const naZona = () => { const f = S.fixo && S.pessoas.get(S.fixo); return f && f.zona === z; };
      el.addEventListener('click', () => focarPessoa(z, naZona() ? 1 : 0));
      el.addEventListener('keydown', (ev) => {
        if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') { ev.preventDefault(); focarPessoa(z, 1); }
        else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') { ev.preventDefault(); focarPessoa(z, -1); }
      });
      el.addEventListener('blur', () => setTimeout(() => { if (S.fixo && !rotulosEl.contains(document.activeElement)) { S.fixo = null; mostrarDica(); } }, 0));
      rotulosEl.append(el);
    }
    el.style.left = pxs(pos.x); el.style.top = pxs(pos.y);
    const n = cont[z] || 0, sobra = S.sobrando[z] || 0, total = S.totalZona[z];
    el.querySelector('b').textContent = String(n + sobra);
    const em = el.querySelector('em'); em.textContent = sobra ? '+' + sobra + ' de fora' : ''; em.hidden = !sobra;
    el.title = total != null ? total + ' com essa etiqueta no total' : '';
    el.setAttribute('aria-label', ZONAS[z].nome + ': ' + (n + sobra) + ' no período' + (sobra ? ', ' + sobra + ' fora da sala' : '') + (total != null ? ', ' + total + ' no total' : '') + '. Setas passam pelos clientes.');
    el.classList.toggle('alerta', z === 'senhor' && n > 0);
  }
  const pj = S.L.rotulos.jarvis;
  let j = placas.jarvis;
  if (!j || !j.isConnected) { j = placas.jarvis = h('div', { class: 'esc-placa jarvis', 'aria-hidden': 'true' }, h('span', { text: 'JARVIS' })); rotulosEl.append(j); }
  j.style.left = pxs(pj.x); j.style.top = pxs(pj.y);
}
function posicionarFala() {
  const c = S.jarvis.cabeca; if (!c || !falaEl) return;
  falaEl.style.left = pxs(c.x + 10); falaEl.style.top = pxs(c.y - 4);
}
function quando(iso) {
  const t = Date.parse(iso); if (!Number.isFinite(t)) return '';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'agora há pouco'; if (s < 3600) return `há ${Math.round(s / 60)} min`;
  if (s < 86400) return `há ${Math.round(s / 3600)} h`; return `há ${Math.round(s / 86400)} dias`;
}
const hora = (iso) => { const d = new Date(iso); return Number.isFinite(d.getTime()) ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''; };
function mostrarDica() {
  const ref = S.fixo || S.hover, p = ref ? S.pessoas.get(ref) : null;
  if (!p || !p.caixa) { dicaEl.hidden = true; return; }
  const d = p.dados || {}, z = ZONAS[p.zona || p.etiqueta] || ZONAS.lead;
  const linhasD = [h('b', { text: p.nome }), h('span', { class: 'esc-dica-z', style: `--cor:${z.cor}`, text: z.nome })];
  if (d.estado) linhasD.push(h('span', { text: d.estado }));
  if (d.ultimo_contato) linhasD.push(h('span', { text: `Último contato ${quando(d.ultimo_contato)}` + (d.ultimo_quem ? ` (${d.ultimo_quem === 'cliente' ? 'cliente' : d.ultimo_quem === 'senhor' ? 'senhor' : 'Jarvis'})` : '') }));
  if (d.proximo && d.proximo.rotulo) linhasD.push(h('span', { text: `Próximo: ${d.proximo.rotulo}${d.proximo.quando ? ' · ' + hora(d.proximo.quando) : ''}` }));
  if (p.provisorio) linhasD.push(h('span', { text: 'Acabou de chegar' }));
  dicaEl.replaceChildren(...linhasD);
  dicaEl.hidden = false;
  const c = p.caixa, dir = p.x > S.W * 0.7;
  dicaEl.style.left = pxs(dir ? c.x - 2 : c.x + c.w + 2); dicaEl.style.top = pxs(c.y);
  dicaEl.classList.toggle('esq', dir);
}
function pintarLog() {
  if (!logEl) return;
  const itens = S.log.slice(-4).reverse();
  logEl.replaceChildren(...(itens.length ? itens.map((l, i) => h('li', { class: 'tipo-' + l.tipo + (i === 0 ? ' novo' : '') }, h('time', { text: hora(l.t) }), h('span', { text: l.txt })))
    : [h('li', {}, h('span', { text: 'Sala vazia por enquanto. Quem chamar no WhatsApp entra pela porta.' }))]));
  const j = S.dados && S.dados.jarvis, com = S.jarvis.com && S.pessoas.get(S.jarvis.com);
  const dig = S.agora < S.jarvis.digitandoAte || (j && j.digitando);
  jarvisTxt.textContent = !S.ok ? 'sem conexão com o servidor' : dig ? (com ? `respondendo ${com.nome}` : 'respondendo') : j && j.ultima_resposta ? `de olho na porta · respondeu ${quando(j.ultima_resposta)}` : 'de olho na porta';
  $('.esc-led').classList.toggle('digitando', !!dig);
}
function pintarListaLeitor() {
  if (!leitorEl) return;
  const por = {}; for (const p of S.pessoas.values()) if (p.zona) (por[p.zona] = por[p.zona] || []).push(p.nome);
  leitorEl.replaceChildren(h('ul', {}, ...ORDEM_ZONAS.map((z) => h('li', { text: `${ZONAS[z].nome}: ${(por[z] || []).length + (S.sobrando[z] || 0)}${(por[z] || []).length ? ' (' + por[z].map((n) => n || 'Sem nome').join(', ') + ')' : ''}` }))));
}

/* ---------- HUD: os números do topo vão para cima da sala ---------- */
const ICONES = {
  'k-paineis': ['..yyyy..', '.yYYYYy.', 'yYyyyyYy', 'yYyYYyYy', 'yYyYYyYy', 'yYyyyyYy', '.yYYYYy.', '..yyyy..'],
  'k-conversas': ['.wwwwww.', 'wccccccw', 'wcwcwcwc', 'wccccccw', 'wccccccw', '.wwwwcw.', '....wc..', '....w...'],
  'k-testes': ['.p....p.', '..p..p..', 'pppppppp', 'pqqqqqqp', 'pqqwqqqp', 'pqqwwqqp', 'pqqqqqqp', 'pppppppp'],
  'k-senhor': ['...rr...', '..rrrr..', '.rrwwrr.', '.rrwwrr.', '.rrwwrr.', 'rrrrrrrr', '...ww...', '..wwww..'],
  'k-follow': ['cccccccc', 'cwccccwc', 'ccwccwcc', 'cccwwccc', 'cccccccc', 'cccccccc', 'cccccccc', 'cccccccc'],
  'k-taxa': ['...gg...', '..gggg..', '.gggggg.', '...gg...', '...gg...', 'gg.gg.gg', 'gggggggg', '.gggggg.'],
  'k-tempo': ['..wwww..', '.wccccw.', 'wcccwccw', 'wcccwccw', 'wcccwwcw', 'wccccccw', '.wccccw.', '..wwww..'],
};
const COR_ICONE = { y: '#e0a91c', Y: '#ffd84a', w: '#ffffff', c: '#5be7ff', p: '#8a5cf0', q: '#c39bff', r: '#ff5d6c', g: '#30d158' };
function iconeSvg(mapa) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 8 8'); s.setAttribute('shape-rendering', 'crispEdges'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('class', 'esc-ic');
  mapa.forEach((l, y) => [...l].forEach((k, x) => { if (k === '.') return; const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect'); r.setAttribute('x', x); r.setAttribute('y', y); r.setAttribute('width', 1); r.setAttribute('height', 1); r.setAttribute('fill', COR_ICONE[k]); s.append(r); }));
  return s;
}
function montarHud() {
  const nums = $('#numeros'); if (!nums || nums.dataset.hud) return;
  nums.dataset.hud = '1';
  for (const art of nums.querySelectorAll('.num')) {
    const m = ICONES[art.id]; if (m && !art.querySelector('.esc-ic')) art.prepend(iconeSvg(m));
    if (art.id === 'k-taxa' && !art.querySelector('.esc-xp')) art.append(h('div', { class: 'esc-xp', 'aria-hidden': 'true' }, h('i')));
  }
  const v = $('#k-taxa .valor');
  new MutationObserver(() => { const n = v._v; const i = $('#k-taxa .esc-xp i'); if (i) i.style.width = (n == null ? 0 : Math.max(0, Math.min(100, n <= 1 ? n * 100 : n))) + '%'; }).observe(v, { childList: true, subtree: true, characterData: true });
  const vp = $('#k-paineis .valor'); let antes = null;
  new MutationObserver(() => { const n = vp._v; if (antes != null && n > antes && S.ativo) { const a = $('#k-paineis'); a.classList.remove('ganhou'); void a.offsetWidth; a.classList.add('ganhou'); } if (n != null) antes = n; }).observe(vp, { childList: true, subtree: true, characterData: true });
}
function levarHud(dentro) {
  const nums = $('#numeros'); if (!nums) return;
  if (dentro) { if (nums.parentElement !== hudEl) { numerosOrig = numerosOrig || { pai: nums.parentElement, prox: nums.nextSibling }; hudEl.append(nums); } }
  else if (numerosOrig && nums.parentElement === hudEl) numerosOrig.pai.insertBefore(nums, numerosOrig.prox);
}

/* ---------- Busca ---------- */
async function buscar() {
  clearTimeout(S.timerPoll);
  if (!S.ativo) return;
  if (!document.hidden) {
    try {
      const dias = (window.relatorios && window.relatorios.dias && window.relatorios.dias()) || 1;
      const url = MOCK ? 'mock/escritorio.json' : `${BASE}/api/escritorio?dias=${dias}`;
      const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 8000);
      const r = await fetch(url, { cache: 'no-store', signal: ctl.signal, headers: { Accept: 'application/json' } }); clearTimeout(tm);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      if (S.diasAtual !== dias) { S.diasAtual = dias; reiniciarSala(); }
      S.ok = true; aplicar(d);
    } catch { S.ok = false; pintarLog(); }
  }
  S.timerPoll = setTimeout(buscar, POLL_MS);
}
function reiniciarSala() {
  cacheSprite.clear();
  S.pessoas.clear(); S.fila = []; S.filaEv = []; S.ultimoT = null; S.primeira = true;
  if (S.L) for (const z of Object.values(S.L.assentos)) for (const s of z) s.ocupante = null;
}

/* ---------- Liga e desliga com a vista ---------- */
function sincronizarVista() {
  const on = !MOVEL.matches && appEl.dataset.vista === 'escritorio';
  levarHud(on);
  if (on === S.ativo) return;
  S.ativo = on;
  if (on) { requestAnimationFrame(() => { medir(); if (!S.raf) S.raf = requestAnimationFrame(quadro); }); buscar(); }
  else { cancelAnimationFrame(S.raf); S.raf = 0; clearTimeout(S.timerPoll); }
}
montar(); montarHud();
new MutationObserver(sincronizarVista).observe(appEl, { attributes: true, attributeFilter: ['data-vista'] });
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.ativo) buscar(); });
setInterval(() => { if (S.ativo) { pintarLog(); if (S.hover || S.fixo) mostrarDica(); } }, 15000);
sincronizarVista();
})();
