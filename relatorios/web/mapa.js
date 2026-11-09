/* Mapa do conhecimento do robô da revenda (08/11/2026).
   Grafo de bolinhas e conexões no estilo do Obsidian, no padrão dos Robôs (fundo #121214, ciano #5be7ff, Inter).
   Uso: const mapa = window.montarMapa(elemento, { buscar: (caminho) => pegar(caminho), dias: 7 });
        mapa.atualizar(); mapa.destruir();
   Canvas 2D puro, sem framework e sem CDN. Física própria (repulsão, mola nas ligações, gravidade leve);
   o requestAnimationFrame só roda enquanto algo se move. prefers-reduced-motion: layout calculado de uma vez e estático. */
(function () {
  'use strict';

  const CAMADAS = [['fluxo', 'Fluxo'], ['conhecimento', 'Conhecimento'], ['aprendizado', 'Aprendizado'], ['memoria', 'Memória']];
  const CAMADA_DO_TIPO = { etapa: 'fluxo', conhecimento: 'conhecimento', recurso: 'conhecimento', regra_aprendida: 'aprendizado', inconsistencia: 'aprendizado', cliente: 'memoria' };
  const NOME_TIPO = { etapa: 'Etapa do atendimento', conhecimento: 'Conhecimento da base', recurso: 'Recurso', regra_aprendida: 'Regra aprendida', inconsistencia: 'Erro encontrado', cliente: 'Cliente' };
  const NOME_LIGACAO = { fluxo: 'Fluxo', usa: 'Usa', aprendeu: 'Ensina', corrige: 'Corrige', cliente_em: 'Cliente nesta etapa', acontece_em: 'Onde o erro aparece' };
  const COR = {
    ciano: '#5be7ff', cianoClaro: '#a8f2ff', cinza: '#8e8e99', azul: '#7aa2ff', menta: '#5ee6b5',
    ambar: '#ffb340', ambarCalmo: '#c9a46a', recurso: '#5b77b8', cliente: '#c7c7d1', clienteApagado: '#6b6b75',
  };
  const LEGENDA = [
    ['etapa', 'Etapa do atendimento', COR.ciano, 'cheio'],
    ['conhecimento', 'Conhecimento da base', COR.azul, 'cheio'],
    ['recurso', 'Recurso (link, vídeo, guia)', COR.recurso, 'pequeno'],
    ['regra', 'Regra aprendida', COR.menta, 'cheio'],
    ['sugestao', 'Sugestão ainda não aprovada', COR.menta, 'anel'],
    ['erro', 'Erro encontrado', COR.ambar, 'cheio'],
    ['tratado', 'Erro já corrigido', COR.ambarCalmo, 'cheio'],
    ['cliente', 'Cliente (memória)', COR.cliente, 'ponto'],
    ['revendedor', 'Revendedor (verde ok, âmbar em risco)', COR.menta, 'cheio'],
  ];
  const DIST = { fluxo: 150, usa: 74, aprendeu: 84, corrige: 62, cliente_em: 30, acontece_em: 125 };
  const CARGA = { etapa: -520, conhecimento: -300, recurso: -120, regra_aprendida: -170, inconsistencia: -200, cliente: -46 };
  const POS_ETAPA = { 'etapa:contato': [-285, 0], 'etapa:soube': [-95, 0], 'etapa:link': [95, 0], 'etapa:criou': [285, 0], 'etapa:senhor': [-40, -190], 'etapa:sumiu': [60, 200] };

  const reduzir = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const svg = (d, extra) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra || ''}>${d}</svg>`;
  const ICONE = {
    busca: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
    fechar: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
    mais: svg('<path d="M12 5v14M5 12h14"/>'),
    menos: svg('<path d="M5 12h14"/>'),
    ajustar: svg('<path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4"/>'),
    play: svg('<path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none"/>'),
    pausa: svg('<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" stroke="none"/>'),
    legenda: svg('<circle cx="6" cy="7" r="2"/><circle cx="6" cy="17" r="2"/><path d="M11 7h8M11 17h8"/>'),
  };
  const hashN = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967295; };
  const fmtData = (ms) => { if (!Number.isFinite(ms)) return '—'; const d = new Date(ms); return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' às ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); };
  const fmtDia = (ms) => new Date(ms).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  // link cru vira link curto legível: "painel.capyplay.site/…"
  const encurtar = (t) => String(t).replace(/https?:\/\/([^\s/]+)(\/\S*)?/g, (m, dom, resto) => (resto && resto.length > 1 && (dom + resto).length > 30 ? dom + '/…' : dom + (resto || '')));
  const fmtValor = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) ? fmtData(Date.parse(v)) : v == null || v === '' ? '—' : String(v));
  const semAcento = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const corte = (s, n) => (s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s);

  function corDoNo(n) {
    switch (n.tipo) {
      case 'etapa': return n.grupo === 'sumiu' ? COR.cinza : n.grupo === 'senhor' ? COR.cianoClaro : COR.ciano;
      case 'conhecimento': return COR.azul;
      case 'regra_aprendida': return COR.menta;
      case 'inconsistencia': return n.grupo === 'tratada' ? COR.ambarCalmo : COR.ambar;
      case 'recurso': return COR.recurso;
      case 'revendedor': return n.grupo === 'saudavel' ? COR.menta : n.grupo === 'duvida_pagamento' ? COR.azul : n.grupo === 'passou_ao_senhor' ? COR.cianoClaro : COR.ambar;   // jornada do revendedor (08/11)
      case 'cliente': return n.grupo === 'criou' ? COR.ciano : n.grupo === 'sumiu' ? COR.clienteApagado : COR.cliente;
      default: return COR.recurso;
    }
  }
  function raioDoNo(n) {
    const p = Math.max(1, Number(n.peso) || 1), s = Math.sqrt(p);
    switch (n.tipo) {
      case 'etapa': return Math.min(34, 13 + s * 2.1);
      case 'conhecimento': return Math.min(17, 6.5 + s * 1.7);
      case 'regra_aprendida': return n.grupo === 'aprovada' ? 6.2 : 5;
      case 'inconsistencia': return Math.min(14, 5.5 + s * 1.6);
      case 'recurso': return Math.min(10, 3.4 + s * 0.8);
      case 'cliente': return Math.min(4.6, 2.4 + s * 0.3);
      default: return 4;
    }
  }
  function corDaLigacao(tipo) {
    switch (tipo) {
      case 'fluxo': return [91, 231, 255, 0.5];
      case 'aprendeu': return [94, 230, 181, 0.3];
      case 'corrige': return [255, 179, 64, 0.32];
      case 'cliente_em': return [255, 255, 255, 0.085];
      case 'acontece_em': return [255, 179, 64, 0.16];
      default: return [159, 178, 200, 0.22];
    }
  }

  function montarMapa(container, opcoes) {
    if (!container) throw new Error('montarMapa: falta o elemento');
    if (container.__mapa) container.__mapa.destruir();
    opcoes = opcoes || {};
    const buscar = typeof opcoes.buscar === 'function' ? opcoes.buscar : (c) => fetch(c, { cache: 'no-store' }).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
    let dias = opcoes.dias || null;

    // ---------- DOM ----------
    const raiz = el('div', 'mapa');
    raiz.setAttribute('role', 'region');
    raiz.setAttribute('aria-label', 'Mapa do conhecimento do atendimento');
    raiz.innerHTML = `
      <canvas class="mapa-tela" tabindex="0" aria-label="Mapa de bolinhas e conexões. Use a busca para abrir um item."></canvas>
      <div class="mapa-topo">
        <div class="mapa-camadas" role="group" aria-label="Camadas do mapa"></div>
        <div class="mapa-busca" role="search">
          <span class="mapa-busca-ic">${ICONE.busca}</span>
          <input type="search" placeholder="Buscar no mapa" aria-label="Buscar no mapa" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="false" aria-controls="">
          <ul class="mapa-resultados" role="listbox" hidden></ul>
        </div>
      </div>
      <div class="mapa-numeros" aria-live="polite">
        <div class="mapa-num"><b data-n="nos">0</b><span data-n="nos-r">bolinhas</span></div>
        <div class="mapa-num"><b data-n="regras">0</b><span>regras aprendidas</span></div>
        <div class="mapa-num destaque"><b data-n="taxa">0%</b><span>taxa de painel</span></div>
      </div>
      <div class="mapa-legenda" aria-label="Legenda"></div>
      <button type="button" class="mapa-bt-legenda" aria-expanded="false">${ICONE.legenda}<span>Legenda</span></button>
      <div class="mapa-zoom" role="group" aria-label="Zoom">
        <button type="button" data-z="mais" aria-label="Aproximar">${ICONE.mais}</button>
        <button type="button" data-z="menos" aria-label="Afastar">${ICONE.menos}</button>
        <button type="button" data-z="ajustar" aria-label="Mostrar o mapa inteiro">${ICONE.ajustar}</button>
      </div>
      <div class="mapa-tempo">
        <button type="button" class="mapa-play" aria-label="Reproduzir a evolução">${ICONE.play}<span>Evolução</span></button>
        <div class="mapa-trilho">
          <svg class="mapa-curva" preserveAspectRatio="none" aria-hidden="true"></svg>
          <input type="range" min="0" max="1000" step="1" value="1000" aria-label="Linha do tempo do mapa" title="Área: bolinhas no mapa. Linha ciano: taxa de painel. Pontos: marcos.">
          <div class="mapa-pontas" aria-hidden="true"><span></span><span></span></div>
        </div>
        <div class="mapa-quando"><b data-q="data">Agora</b><span data-q="marco"></span></div>
      </div>
      <aside class="mapa-detalhe" aria-label="Detalhe" hidden>
        <div class="mapa-alca" aria-hidden="true"></div>
        <button type="button" class="mapa-fechar" aria-label="Fechar detalhe">${ICONE.fechar}</button>
        <div class="mapa-detalhe-corpo"></div>
      </aside>
      <div class="mapa-aviso" hidden></div>`;
    container.appendChild(raiz);
    const $ = (s) => raiz.querySelector(s);
    const canvas = $('.mapa-tela'), ctx = canvas.getContext('2d');
    const campoBusca = $('.mapa-busca input'), listaRes = $('.mapa-resultados');
    const idLista = 'mapa-res-' + Math.random().toString(36).slice(2, 8);
    listaRes.id = idLista; campoBusca.setAttribute('aria-controls', idLista);
    const painel = $('.mapa-detalhe'), corpoPainel = $('.mapa-detalhe-corpo');
    const aviso = $('.mapa-aviso');
    const slider = $('.mapa-trilho input'), btPlay = $('.mapa-play');

    const camadasLigadas = new Set(CAMADAS.map((c) => c[0]));
    const boxCamadas = $('.mapa-camadas');
    for (const [k, rot] of CAMADAS) {
      const b = el('button', 'mapa-pilula', rot);
      b.type = 'button'; b.dataset.camada = k; b.setAttribute('aria-pressed', 'true');
      b.prepend(el('i', 'mapa-pilula-ponto'));
      boxCamadas.appendChild(b);
    }
    const boxLegenda = $('.mapa-legenda');
    for (const [k, rot, cor, forma] of LEGENDA) {
      const item = el('span', 'mapa-leg-item');
      const p = el('i', 'mapa-leg-ponto ' + forma); p.style.setProperty('--c', cor);
      item.append(p, el('span', null, rot)); item.dataset.k = k;
      item.dataset.camada = { etapa: 'fluxo', conhecimento: 'conhecimento', recurso: 'conhecimento', regra: 'aprendizado', sugestao: 'aprendizado', erro: 'aprendizado', tratado: 'aprendizado', cliente: 'memoria' }[k];
      boxLegenda.appendChild(item);
    }

    // ---------- estado ----------
    let periodoInicio = null;
    let nos = [], ligs = [], porId = new Map(), vizinhos = new Map(), evolucao = [], marcos = [];
    let largura = 0, altura = 0, dpr = 1, escalaFonte = 1, fonte = 'Inter, -apple-system, "Segoe UI", sans-serif';
    const vista = { k: 1, x: 0, y: 0 };
    let alpha = 0, alphaAlvo = 0;
    // No celular em pé o fluxo corre de cima para baixo (cabe melhor na tela alta).
    let vertical = false;
    let esticar = 1; // tela larga (34"): o fluxo se espalha na horizontal para usar a largura
    const posEtapa = (id) => { const p = POS_ETAPA[id]; return !p ? p : vertical ? [p[1] * 0.85, p[0] * 1.15] : [p[0] * esticar, p[1]]; };
    const ALPHA_MIN = 0.002, DECAI = 1 - Math.pow(0.001, 1 / 300);
    let raf = 0, sujo = false, destruido = false;
    let foco = null, selecionado = null, busca = '', achados = new Set(), indiceRes = -1;
    let tempo = null, tocando = false, tocouEm = 0, valorInicioPlay = 0;
    let animVista = null, primeiraVez = true, reajustar = false;
    const sprites = new Map();
    const agoraMs = () => performance.now();

    // ---------- dados ----------
    function aplicarDados(g) {
      const antigos = porId;
      nos = []; ligs = []; porId = new Map(); vizinhos = new Map();
      for (const n0 of (g && Array.isArray(g.nos) ? g.nos : [])) {
        if (!n0 || !n0.id || porId.has(n0.id)) continue;
        const velho = antigos.get(n0.id);
        const n = Object.assign({}, n0, {
          desdeMs: n0.desde ? Date.parse(n0.desde) : -Infinity,
          camada: CAMADA_DO_TIPO[n0.tipo] || 'conhecimento',
          busca: semAcento(n0.tipo === 'cliente' ? n0.rotulo : n0.rotulo + ' ' + (n0.detalhe || '')), // cliente: só pelo nome (o resumo gera ruído)
          x: velho ? velho.x : NaN, y: velho ? velho.y : NaN, vx: 0, vy: 0, fx: null, fy: null,
          surgiu: velho ? velho.surgiu : -1, grau: 0,
        });
        n.r = raioDoNo(n); n.cor = corDoNo(n); n.carga = CARGA[n.tipo] || -100;
        nos.push(n); porId.set(n.id, n); vizinhos.set(n.id, new Set());
      }
      for (const l0 of (g && Array.isArray(g.ligacoes) ? g.ligacoes : [])) {
        const s = porId.get(l0.de), t = porId.get(l0.para);
        if (!s || !t || s === t) continue;
        const l = { s, t, tipo: l0.tipo, peso: Math.max(1, Number(l0.peso) || 1) };
        l.dist = (DIST[l.tipo] || 70) + (l.tipo === 'cliente_em' ? t.r : 0);
        ligs.push(l); s.grau++; t.grau++;
        vizinhos.get(s.id).add(t.id); vizinhos.get(t.id).add(s.id);
      }
      for (const l of ligs) { l.forca = l.tipo === 'fluxo' ? 0.7 : 1 / Math.min(s0(l.s), s0(l.t)); l.vies = l.s.grau / (l.s.grau + l.t.grau); }
      function s0(n) { return Math.max(1, n.grau); }
      evolucao = (g && Array.isArray(g.evolucao) ? g.evolucao : []).map((p) => Object.assign({}, p, { ms: Date.parse(p.quando) })).filter((p) => Number.isFinite(p.ms)).sort((a, b) => a.ms - b.ms);
      periodoInicio = g && g.periodo && g.periodo.inicio ? Date.parse(g.periodo.inicio) : null;
      marcos = (g && Array.isArray(g.marcos) ? g.marcos : []).map((m) => ({ ms: Date.parse(m.quando), texto: m.texto })).filter((m) => Number.isFinite(m.ms));
      if (selecionado && !porId.has(selecionado.id)) fecharDetalhe();
      if (foco && !porId.has(foco.id)) foco = null;
      posicionarNovos();
      desenharCurva();
      if (busca) filtrarBusca(busca);
      atualizarNumeros();
    }

    // Lugar inicial: etapas no eixo do fluxo; o resto em espiral em volta de um vizinho já posicionado (sempre igual a cada carga).
    function posicionarNovos() {
      const ordem = nos.slice().sort((a, b) => peso0(a) - peso0(b));
      function peso0(n) { return { etapa: 0, conhecimento: 1, inconsistencia: 2, regra_aprendida: 3, recurso: 4, cliente: 5 }[n.tipo] ?? 6; }
      for (const n of ordem) {
        if (Number.isFinite(n.x)) continue;
        const p = posEtapa(n.id);
        if (p) { n.x = p[0]; n.y = p[1]; continue; }
        let ancora = null;
        for (const v of vizinhos.get(n.id)) { const m = porId.get(v); if (m && Number.isFinite(m.x) && (!ancora || peso0(m) < peso0(ancora))) ancora = m; }
        const a = hashN(n.id) * Math.PI * 2, d = (ancora ? (DIST[n.tipo === 'cliente' ? 'cliente_em' : 'usa']) : 260) * (0.6 + hashN(n.id + '#') * 0.6);
        n.x = (ancora ? ancora.x : 0) + Math.cos(a) * d;
        n.y = (ancora ? ancora.y : 0) + Math.sin(a) * d;
      }
    }

    // ---------- física ----------
    function visivel(n) { return camadasLigadas.has(n.camada) && (tempo == null || n.desdeMs <= tempo); }
    function passo() {
      const ativos = nos.filter((n) => camadasLigadas.has(n.camada));
      const N = ativos.length;
      // repulsão + colisão (n² com corte de distância; 400 nós ≈ 80 mil pares)
      for (let i = 0; i < N; i++) {
        const a = ativos[i];
        for (let j = i + 1; j < N; j++) {
          const b = ativos[j];
          let dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy;
          if (d2 > 360000) continue;
          if (d2 < 1) { dx = (hashN(a.id + b.id) - 0.5) * 2; dy = (hashN(b.id + a.id) - 0.5) * 2; d2 = dx * dx + dy * dy + 1; }
          const w = alpha / d2;
          a.vx += dx * b.carga * w; a.vy += dy * b.carga * w;
          b.vx -= dx * a.carga * w; b.vy -= dy * a.carga * w;
          const min = a.r + b.r + 3;
          if (d2 < min * min) { const d = Math.sqrt(d2), f = (min - d) / d * 0.5; a.vx -= dx * f; a.vy -= dy * f; b.vx += dx * f; b.vy += dy * f; }
        }
      }
      // molas
      for (const l of ligs) {
        const s = l.s, t = l.t;
        if (!camadasLigadas.has(s.camada) || !camadasLigadas.has(t.camada)) continue;
        let dx = t.x + t.vx - s.x - s.vx, dy = t.y + t.vy - s.y - s.vy;
        let d = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = (d - l.dist) / d * alpha * l.forca;
        dx *= f; dy *= f;
        t.vx -= dx * l.vies; t.vy -= dy * l.vies;
        s.vx += dx * (1 - l.vies); s.vy += dy * (1 - l.vies);
      }
      // gravidade leve e eixo do fluxo
      for (const n of ativos) {
        const p = posEtapa(n.id);
        if (p) { n.vx += (p[0] - n.x) * 0.14 * alpha; n.vy += (p[1] - n.y) * 0.14 * alpha; }
        else { n.vx -= n.x * (vertical ? 0.03 : 0.014 / (esticar * esticar)) * alpha; n.vy -= n.y * (vertical ? 0.009 : 0.014) * alpha; }
      }
      for (const n of ativos) {
        if (n.fx != null) { n.x = n.fx; n.y = n.fy; n.vx = n.vy = 0; continue; }
        n.vx *= 0.6; n.vy *= 0.6;
        n.x += n.vx; n.y += n.vy;
      }
      alpha += (alphaAlvo - alpha) * DECAI;
    }
    function aquecer(a) {
      if (reduzir()) { assentar(); pedirDesenho(); return; }
      alpha = Math.max(alpha, a); pedirDesenho();
    }
    // Calcula o layout de uma vez (sem animação): usado na primeira carga e no modo de movimento reduzido.
    function assentar(ate) {
      const t0 = agoraMs(); alpha = Math.max(alpha, 1);
      const alvo = ate == null ? ALPHA_MIN : ate;
      while (alpha > alvo && agoraMs() - t0 < 900) passo();
      if (ate == null) alpha = 0;
    }

    // ---------- desenho ----------
    function sprite(cor) {
      if (sprites.has(cor)) return sprites.get(cor);
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, hexA(cor, 0.42)); gr.addColorStop(0.35, hexA(cor, 0.16)); gr.addColorStop(1, hexA(cor, 0));
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64); sprites.set(cor, c); return c;
    }
    function hexA(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; }
    const tela = (n) => [n.x * vista.k + vista.x, n.y * vista.k + vista.y];

    function escalaSurgir(n, t) {
      if (n.surgiu < 0) return 1;
      const p = Math.min(1, (t - n.surgiu) / 460);
      if (p >= 1) { n.surgiu = -1; return 1; }
      const c1 = 1.5, c3 = c1 + 1; return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2); // mola leve (easeOutBack)
    }

    function desenhar() {
      const t = agoraMs();
      let animando = false;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, largura, altura);
      if (!nos.length) return false;
      const destaque = selecionado || foco;
      const viz = destaque ? vizinhos.get(destaque.id) : null;
      const temBusca = achados.size > 0 || (busca && achados.size === 0);
      const apagado = (n) => (destaque ? n !== destaque && !viz.has(n.id) : temBusca ? !achados.has(n.id) : false);
      const k = vista.k, kl = Math.max(0.55, Math.min(1.6, Math.sqrt(k)));

      // ligações
      for (const l of ligs) {
        const s = l.s, u = l.t;
        if (!visivel(s) || !visivel(u)) continue;
        const [x1, y1] = tela(s), [x2, y2] = tela(u);
        if ((x1 < -50 && x2 < -50) || (x1 > largura + 50 && x2 > largura + 50) || (y1 < -50 && y2 < -50) || (y1 > altura + 50 && y2 > altura + 50)) continue;
        const [r, g, b, a0] = corDaLigacao(l.tipo);
        const ligadoAoFoco = destaque && (s === destaque || u === destaque);
        let a = a0;
        if (destaque) a = ligadoAoFoco ? Math.min(0.9, a0 * 2.4 + 0.15) : a0 * 0.18;
        else if (temBusca) a = achados.has(s.id) && achados.has(u.id) ? a0 * 1.6 : a0 * 0.25;
        const surg = Math.min(escalaSurgir(s, t), escalaSurgir(u, t));
        if (surg < 1) { a *= Math.max(0, surg); animando = true; }
        const larg = l.tipo === 'fluxo' ? Math.min(7, 1.1 + Math.log2(1 + l.peso) * 0.85) : Math.min(2.6, 0.6 + Math.log2(1 + l.peso) * 0.33);
        ctx.strokeStyle = `rgba(${r},${g},${b},${a})`;
        ctx.lineWidth = larg * kl;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        if (l.tipo === 'fluxo' && k > 0.45) { // seta discreta no meio: o fluxo tem direção
          const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, ang = Math.atan2(y2 - y1, x2 - x1), z = 4.5 * kl + larg * 0.4;
          ctx.fillStyle = `rgba(${r},${g},${b},${Math.min(1, a * 1.5)})`;
          ctx.beginPath(); ctx.moveTo(mx + Math.cos(ang) * z, my + Math.sin(ang) * z);
          ctx.lineTo(mx + Math.cos(ang + 2.5) * z, my + Math.sin(ang + 2.5) * z);
          ctx.lineTo(mx + Math.cos(ang - 2.5) * z, my + Math.sin(ang - 2.5) * z); ctx.closePath(); ctx.fill();
        }
      }

      // bolinhas
      const rotulos = [], circulos = [];
      const ordem = nos.filter(visivel);
      for (const n of ordem) {
        const [x, y] = tela(n);
        const surg = escalaSurgir(n, t); if (surg < 1) animando = true;
        const rr = Math.max(n.tipo === 'cliente' ? 1.7 : n.tipo === 'etapa' ? 13 : 2.4, n.r * k) * Math.max(0, surg);
        if (x < -rr * 3 || x > largura + rr * 3 || y < -rr * 3 || y > altura + rr * 3) continue;
        const dim = apagado(n), real = n === destaque || (destaque && viz.has(n.id)) || achados.has(n.id);
        ctx.globalAlpha = dim ? 0.13 : 1;
        const brilha = !dim && (n.tipo === 'etapa' || n.tipo === 'conhecimento' || (n.tipo === 'regra_aprendida' && n.grupo === 'aprovada') || (n.tipo === 'inconsistencia' && n.grupo !== 'tratada') || real);
        if (brilha && rr > 2) { const g = rr * (n.tipo === 'etapa' ? 2.5 : 3); ctx.drawImage(sprite(n.cor), x - g, y - g, g * 2, g * 2); }
        ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2);
        if (n.tipo === 'regra_aprendida' && n.grupo === 'sugestao') {
          ctx.fillStyle = 'rgba(18,18,20,.9)'; ctx.fill();
          ctx.lineWidth = Math.max(1.2, 1.6 * kl); ctx.strokeStyle = hexA(n.cor, 0.85); ctx.stroke();
        } else {
          ctx.fillStyle = n.tipo === 'cliente' && n.grupo !== 'criou' ? hexA(n.cor, 0.78) : n.cor; ctx.fill();
          if (n.tipo !== 'cliente') { ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.stroke(); }
        }
        if (n === destaque) { ctx.beginPath(); ctx.arc(x, y, rr + 4, 0, Math.PI * 2); ctx.lineWidth = 2; ctx.strokeStyle = hexA(n.cor, 0.9); ctx.stroke(); }
        else if (achados.has(n.id)) { ctx.beginPath(); ctx.arc(x, y, rr + 3.5, 0, Math.PI * 2); ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.stroke(); }
        if (n.tipo === 'etapa' && rr >= 12 && !dim) { // número de conversas dentro da etapa
          ctx.fillStyle = n.grupo === 'sumiu' ? '#fff' : '#001a22';
          ctx.font = `700 ${Math.round(Math.min(rr * 0.78, 15 * escalaFonte * kl))}px ${fonte}`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          const num = tempo == null ? n.peso : numeroNoTempo(n.id);
          if (num != null) ctx.fillText(String(num), x, y + 0.5);
        }
        ctx.globalAlpha = 1;
        // rótulo?
        const limiar = { etapa: 0, conhecimento: 0.5, inconsistencia: 0.62, regra_aprendida: 1.25, recurso: 1.45, cliente: 2.3 }[n.tipo] ?? 2;
        if (!dim && rr >= 4) circulos.push([x, y, rr, n]);
        if (!dim && (k >= limiar || real)) rotulos.push({ n, x, y, rr, prio: n === destaque ? 0 : real ? 1 : { etapa: 2, conhecimento: 3, inconsistencia: 4, regra_aprendida: 5, recurso: 6, cliente: 7 }[n.tipo] });
      }

      // rótulos sem se sobrepor (os mais importantes primeiro)
      rotulos.sort((a, b) => a.prio - b.prio);
      const ocupado = [];
      const fs = Math.round(11.5 * escalaFonte * Math.max(0.9, Math.min(1.25, kl)));
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      for (const r of rotulos) {
        const n = r.n, forte = n.tipo === 'etapa' || r.prio <= 1;
        ctx.font = `${forte ? 600 : 500} ${n.tipo === 'etapa' ? fs + 1 : fs}px ${fonte}`;
        const txt = corte(String(n.rotulo || ''), n === destaque ? 60 : n.tipo === 'regra_aprendida' ? 34 : 30);
        const w = ctx.measureText(txt).width, h = fs * 1.25, x0 = r.x - w / 2;
        let y0 = r.y + r.rr + 5;
        const bateLabel = (yy) => ocupado.some((o) => x0 < o[2] && x0 + w > o[0] && yy < o[3] && yy + h > o[1]);
        const bateBola = (yy) => circulos.some(([cx, cy, cr, cn]) => cn !== n && cx + cr > x0 && cx - cr < x0 + w && cy + cr > yy && cy - cr < yy + h);
        if (n.tipo === 'etapa' && r.prio > 0) {
          // etapa do fluxo sempre tem nome: se embaixo estiver ocupado, escreve em cima do círculo
          const acima = r.y - r.rr - 5 - h;
          if ((bateLabel(y0) || bateBola(y0)) && !bateLabel(acima) && !bateBola(acima)) y0 = acima;
        } else {
          if (r.prio > 0 && bateLabel(y0)) continue;
          if (r.prio > 2 && bateBola(y0)) continue; // nome não escreve em cima de outra bolinha
        }
        ocupado.push([x0 - 4, y0 - 2, x0 + w + 4, y0 + h + 2]);
        ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(18,18,20,.85)'; ctx.strokeText(txt, r.x, y0);
        ctx.fillStyle = forte ? '#fff' : 'rgba(235,235,245,.72)';
        ctx.fillText(txt, r.x, y0);
      }
      return animando;
    }

    function pedirDesenho() { sujo = true; if (!raf && !destruido) raf = requestAnimationFrame(quadro); }
    function quadro() {
      raf = 0;
      if (destruido || !largura || !altura) return;
      let mexe = false;
      if (alpha > ALPHA_MIN || alphaAlvo > 0) { passo(); mexe = true; if (alpha <= ALPHA_MIN && reajustar && !gesto) { reajustar = false; irPara(vistaAjustada(), 520); } }
      if (animVista) mexe = passoVista() || mexe;
      if (tocando) { mexe = passoPlay() || mexe; }
      const animando = desenhar();
      sujo = false;
      // pedirDesenho() chamado durante o quadro já agendou o próximo: nunca abrir duas cadeias de rAF
      if ((mexe || animando) && !raf) raf = requestAnimationFrame(quadro);
    }

    // ---------- vista (zoom e pan) ----------
    const margens = () => {
      const estreito = largura < 640;
      const baixo = raiz.classList.contains('baixo');
      return { topo: estreito ? 168 : baixo ? 64 * escalaFonte : 118 * escalaFonte, base: estreito ? 160 : 110 * escalaFonte + 24, lado: estreito ? 16 : 48 };
    };
    function caixa(lista) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const n of lista) { x0 = Math.min(x0, n.x - n.r); y0 = Math.min(y0, n.y - n.r); x1 = Math.max(x1, n.x + n.r); y1 = Math.max(y1, n.y + n.r); }
      return [x0, y0, x1, y1];
    }
    function vistaAjustada() {
      const lista = nos.filter((n) => camadasLigadas.has(n.camada));
      if (!lista.length || !largura) return { k: 1, x: largura / 2, y: altura / 2 };
      const [x0, y0, x1, y1] = caixa(lista), m = margens();
      const w = Math.max(80, x1 - x0), h = Math.max(80, y1 - y0);
      const k = Math.max(0.15, Math.min(2.2, Math.min((largura - m.lado * 2) / w, (altura - m.topo - m.base) / h)));
      return { k, x: largura / 2 - ((x0 + x1) / 2) * k, y: m.topo + (altura - m.topo - m.base) / 2 - ((y0 + y1) / 2) * k };
    }
    function irPara(alvo, ms) {
      if (reduzir() || !ms) { Object.assign(vista, alvo); animVista = null; pedirDesenho(); return; }
      animVista = { de: { ...vista }, para: alvo, t0: agoraMs(), ms }; pedirDesenho();
    }
    function passoVista() {
      const a = animVista, p = Math.min(1, (agoraMs() - a.t0) / a.ms), e = 1 - Math.pow(1 - p, 4);
      vista.k = a.de.k + (a.para.k - a.de.k) * e; vista.x = a.de.x + (a.para.x - a.de.x) * e; vista.y = a.de.y + (a.para.y - a.de.y) * e;
      if (p >= 1) animVista = null;
      return p < 1;
    }
    function zoomEm(fator, sx, sy) {
      const k = Math.max(0.12, Math.min(6, vista.k * fator)), f = k / vista.k;
      vista.x = sx - (sx - vista.x) * f; vista.y = sy - (sy - vista.y) * f; vista.k = k; animVista = null; pedirDesenho();
    }
    function centrar(n) {
      const estreito = largura < 640, painelW = !painel.hidden && !estreito ? painel.offsetWidth + 24 : 0;
      const k = Math.max(vista.k, 0.9), alturaUtil = estreito && !painel.hidden ? altura * 0.42 : altura;
      irPara({ k, x: (largura - painelW) / 2 - n.x * k, y: alturaUtil / 2 + (estreito ? 30 : 0) - n.y * k }, 420);
    }

    // ---------- tamanho ----------
    function medir() {
      const r = raiz.getBoundingClientRect();
      const w = Math.round(r.width), h = Math.round(r.height);
      if (!w || !h) { largura = altura = 0; return; }
      const mudou = w !== largura || h !== altura;
      const cx = largura ? (largura / 2 - vista.x) / vista.k : 0, cy = altura ? (altura / 2 - vista.y) / vista.k : 0;
      largura = w; altura = h; dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
      escalaFonte = Math.max(0.9, Math.min(1.5, parseFloat(getComputedStyle(document.documentElement).fontSize) / 13 || 1));
      fonte = getComputedStyle(raiz).fontFamily || fonte;
      raiz.classList.toggle('estreito', w < 640);
      raiz.classList.toggle('baixo', h < 520 && w >= 640);
      if (mudou && !primeiraVez && cx) { vista.x = w / 2 - cx * vista.k; vista.y = h / 2 - cy * vista.k; }
      desenharCurva();
      pedirDesenho();
    }
    const ro = new ResizeObserver(() => medir());
    ro.observe(raiz);

    // ---------- interação ----------
    function noEm(sx, sy, folga) {
      const wx = (sx - vista.x) / vista.k, wy = (sy - vista.y) / vista.k;
      let melhor = null, md = Infinity;
      for (const n of nos) {
        if (!visivel(n)) continue;
        const dx = n.x - wx, dy = n.y - wy, d = Math.sqrt(dx * dx + dy * dy) * vista.k;
        const raio = Math.max(n.tipo === 'cliente' ? 1.7 : 2.4, n.r * vista.k) + folga;
        if (d <= raio && d < md) { md = d; melhor = n; }
      }
      return melhor;
    }
    const ponteiros = new Map();
    let gesto = null; // {tipo:'no'|'pan'|'pinca', ...}
    function pos(e) { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return;
      canvas.setPointerCapture(e.pointerId);
      const [x, y] = pos(e); ponteiros.set(e.pointerId, { x, y });
      fecharResultados();
      if (ponteiros.size === 2) {
        const [a, b] = [...ponteiros.values()];
        if (gesto && gesto.no) { gesto.no.fx = gesto.no.fy = null; alphaAlvo = 0; }
        gesto = { tipo: 'pinca', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, k0: vista.k, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, vx: vista.x, vy: vista.y };
        return;
      }
      const toque = e.pointerType !== 'mouse';
      const n = noEm(x, y, toque ? 12 : 4);
      gesto = n ? { tipo: 'no', no: n, x0: x, y0: y, moveu: false } : { tipo: 'pan', x0: x, y0: y, vx: vista.x, vy: vista.y, moveu: false };
      animVista = null;
    });
    canvas.addEventListener('pointermove', (e) => {
      const [x, y] = pos(e);
      if (ponteiros.has(e.pointerId)) ponteiros.set(e.pointerId, { x, y });
      if (!gesto) {
        if (e.pointerType === 'mouse') {
          const n = noEm(x, y, 4);
          if (n !== foco) { foco = n; canvas.style.cursor = n ? 'pointer' : 'grab'; pedirDesenho(); }
        }
        return;
      }
      const limiar = e.pointerType === 'mouse' ? 3 : 8;
      if (gesto.tipo === 'pinca' && ponteiros.size >= 2) {
        const [a, b] = [...ponteiros.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const k = Math.max(0.12, Math.min(6, gesto.k0 * d / gesto.d0)), f = k / gesto.k0;
        vista.k = k; vista.x = mx - (gesto.mx - gesto.vx) * f; vista.y = my - (gesto.my - gesto.vy) * f;
        pedirDesenho(); return;
      }
      if (!gesto.moveu && Math.hypot(x - gesto.x0, y - gesto.y0) < limiar) return;
      gesto.moveu = true;
      if (gesto.tipo === 'no') {
        const n = gesto.no; n.fx = (x - vista.x) / vista.k; n.fy = (y - vista.y) / vista.k;
        if (reduzir()) { n.x = n.fx; n.y = n.fy; pedirDesenho(); }
        else { alphaAlvo = 0.25; aquecer(0.25); }
        canvas.style.cursor = 'grabbing';
      } else if (gesto.tipo === 'pan') {
        vista.x = gesto.vx + (x - gesto.x0); vista.y = gesto.vy + (y - gesto.y0); canvas.style.cursor = 'grabbing'; pedirDesenho();
      }
    });
    function soltar(e) {
      ponteiros.delete(e.pointerId);
      if (!gesto) return;
      if (gesto.tipo === 'pinca') { if (ponteiros.size === 0) gesto = null; return; }
      const g = gesto; gesto = null;
      canvas.style.cursor = foco ? 'pointer' : 'grab';
      if (g.tipo === 'no') {
        g.no.fx = g.no.fy = null; alphaAlvo = 0;
        if (!g.moveu) selecionar(g.no, false);
        else if (!reduzir()) aquecer(0.08);
      } else if (!g.moveu && e.type === 'pointerup') { if (selecionado) fecharDetalhe(); else if (foco && e.pointerType !== 'mouse') { foco = null; pedirDesenho(); } }
    }
    canvas.addEventListener('pointerup', soltar);
    canvas.addEventListener('pointercancel', soltar);
    canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !gesto && foco) { foco = null; pedirDesenho(); } });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const [x, y] = pos(e);
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomEm(Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0018)), x, y);
    }, { passive: false });
    canvas.addEventListener('keydown', (e) => {
      const passoPan = 60;
      if (e.key === '+' || e.key === '=') zoomEm(1.25, largura / 2, altura / 2);
      else if (e.key === '-') zoomEm(0.8, largura / 2, altura / 2);
      else if (e.key === 'ArrowLeft') { vista.x += passoPan; pedirDesenho(); }
      else if (e.key === 'ArrowRight') { vista.x -= passoPan; pedirDesenho(); }
      else if (e.key === 'ArrowUp') { vista.y += passoPan; pedirDesenho(); }
      else if (e.key === 'ArrowDown') { vista.y -= passoPan; pedirDesenho(); }
      else if (e.key === '0') irPara(vistaAjustada(), 380);
      else return;
      e.preventDefault();
    });
    raiz.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (!listaRes.hidden) fecharResultados(); else if (selecionado) fecharDetalhe(); else if (busca) { campoBusca.value = ''; filtrarBusca(''); } } });

    $('.mapa-zoom').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.z === 'mais') zoomEm(1.3, largura / 2, altura / 2);
      else if (b.dataset.z === 'menos') zoomEm(1 / 1.3, largura / 2, altura / 2);
      else irPara(vistaAjustada(), 420);
    });
    boxCamadas.addEventListener('click', (e) => {
      const b = e.target.closest('.mapa-pilula'); if (!b) return;
      const k = b.dataset.camada;
      if (camadasLigadas.has(k)) camadasLigadas.delete(k); else camadasLigadas.add(k);
      b.setAttribute('aria-pressed', camadasLigadas.has(k) ? 'true' : 'false');
      boxLegenda.querySelectorAll(`[data-camada="${k}"]`).forEach((it) => it.classList.toggle('desligada', !camadasLigadas.has(k)));
      if (selecionado && !visivel(selecionado)) fecharDetalhe();
      for (const n of nos) if (n.camada === k && camadasLigadas.has(k) && !reduzir()) n.surgiu = agoraMs();
      atualizarNumeros(); mostrarAviso();
      reajustar = true; aquecer(0.18); if (reduzir()) { reajustar = false; irPara(vistaAjustada(), 0); } pedirDesenho();
    });
    $('.mapa-bt-legenda').addEventListener('click', (e) => {
      const aberto = raiz.classList.toggle('legenda-aberta');
      e.currentTarget.setAttribute('aria-expanded', aberto ? 'true' : 'false');
    });

    // ---------- busca ----------
    function filtrarBusca(q) {
      busca = semAcento(q.trim());
      achados = new Set();
      listaRes.innerHTML = ''; indiceRes = -1;
      if (!busca) { fecharResultados(); pedirDesenho(); return; }
      const res = nos.filter((n) => n.busca.includes(busca)).sort((a, b) => (semAcento(a.rotulo).startsWith(busca) ? 0 : 1) - (semAcento(b.rotulo).startsWith(busca) ? 0 : 1) || b.peso - a.peso);
      for (const n of res) achados.add(n.id);
      if (!res.length) {
        const li = el('li', 'mapa-res-vazio', 'Nada com esse nome no mapa.'); listaRes.appendChild(li);
      }
      res.slice(0, 7).forEach((n, i) => {
        const li = el('li', 'mapa-res'); li.setAttribute('role', 'option'); li.id = idLista + '-' + i; li.dataset.id = n.id;
        const p = el('i', 'mapa-leg-ponto ' + formaLegenda(n)); p.style.setProperty('--c', n.cor);
        li.append(p, el('span', 'mapa-res-rot', corte(n.rotulo, 54)), el('span', 'mapa-res-tipo', NOME_TIPO[n.tipo] || n.tipo));
        listaRes.appendChild(li);
      });
      if (res.length > 7) listaRes.appendChild(el('li', 'mapa-res-vazio', `Mais ${res.length - 7} no mapa, realçados.`));
      listaRes.hidden = false; campoBusca.setAttribute('aria-expanded', 'true');
      pedirDesenho();
    }
    function formaLegenda(n) { return n.tipo === 'cliente' ? 'ponto' : n.tipo === 'recurso' ? 'pequeno' : n.tipo === 'regra_aprendida' && n.grupo === 'sugestao' ? 'anel' : 'cheio'; }
    function fecharResultados() { listaRes.hidden = true; campoBusca.setAttribute('aria-expanded', 'false'); campoBusca.removeAttribute('aria-activedescendant'); }
    function marcarRes(i) {
      const itens = [...listaRes.querySelectorAll('.mapa-res')]; if (!itens.length) return;
      indiceRes = (i + itens.length) % itens.length;
      itens.forEach((li, j) => li.setAttribute('aria-selected', j === indiceRes ? 'true' : 'false'));
      campoBusca.setAttribute('aria-activedescendant', itens[indiceRes].id);
    }
    campoBusca.addEventListener('input', () => filtrarBusca(campoBusca.value));
    campoBusca.addEventListener('focus', () => { if (busca) filtrarBusca(campoBusca.value); });
    campoBusca.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); marcarRes(indiceRes + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); marcarRes(indiceRes - 1); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        const itens = [...listaRes.querySelectorAll('.mapa-res')];
        const li = itens[indiceRes >= 0 ? indiceRes : 0];
        if (li) { const n = porId.get(li.dataset.id); fecharResultados(); if (n) selecionar(n, true); }
      }
    });
    listaRes.addEventListener('pointerdown', (e) => e.preventDefault());
    listaRes.addEventListener('click', (e) => {
      const li = e.target.closest('.mapa-res'); if (!li) return;
      const n = porId.get(li.dataset.id); fecharResultados(); if (n) selecionar(n, true);
    });
    document.addEventListener('pointerdown', foraDaBusca, true);
    function foraDaBusca(e) { if (!raiz.querySelector('.mapa-busca').contains(e.target)) fecharResultados(); }

    // ---------- detalhe ----------
    function selecionar(n, centralizar) {
      if (!n) return;
      if (!camadasLigadas.has(n.camada)) { camadasLigadas.add(n.camada); boxCamadas.querySelector(`[data-camada="${n.camada}"]`).setAttribute('aria-pressed', 'true'); atualizarNumeros(); }
      if (tempo != null && n.desdeMs > tempo) irParaAgora();
      selecionado = n; foco = null;
      montarDetalhe(n);
      const abrindo = painel.hidden;
      painel.hidden = false;
      if (abrindo) { painel.classList.remove('aberto'); void painel.offsetWidth; }
      painel.classList.add('aberto');
      raiz.classList.add('com-detalhe');
      if (centralizar || raiz.classList.contains('estreito')) centrar(n);
      pedirDesenho();
    }
    function fecharDetalhe() {
      if (painel.hidden) return;
      selecionado = null; raiz.classList.remove('com-detalhe');
      painel.classList.remove('aberto');
      const fim = () => { if (!selecionado) painel.hidden = true; };
      if (reduzir()) fim(); else setTimeout(fim, 220);
      pedirDesenho();
    }
    $('.mapa-fechar').addEventListener('click', () => { fecharDetalhe(); canvas.focus({ preventScroll: true }); });
    $('.mapa-alca').addEventListener('click', fecharDetalhe);
    function montarDetalhe(n) {
      corpoPainel.innerHTML = '';
      const chip = el('div', 'mapa-chip');
      const p = el('i', 'mapa-leg-ponto ' + formaLegenda(n)); p.style.setProperty('--c', n.cor);
      chip.append(p, el('span', null, n.tipo === 'regra_aprendida' && n.grupo === 'sugestao' ? 'Sugestão de regra' : NOME_TIPO[n.tipo] || n.tipo));
      const h = el('h3', 'mapa-titulo', n.rotulo);
      const quando = el('p', 'mapa-desde', Number.isFinite(n.desdeMs) ? 'Desde ' + (new Date(n.desdeMs).getHours() === 0 && new Date(n.desdeMs).getMinutes() === 0 ? fmtDia(n.desdeMs) : fmtData(n.desdeMs)) : 'Desde o começo do robô');
      corpoPainel.append(chip, h, quando);
      if (n.detalhe) corpoPainel.appendChild(el('p', 'mapa-texto', encurtar(n.detalhe)));
      if (Array.isArray(n.fatos) && n.fatos.length) {
        const dl = el('dl', 'mapa-fatos');
        for (const [r, v] of n.fatos) { const d = el('div'); d.append(el('dt', null, r), el('dd', null, fmtValor(v))); dl.appendChild(d); }
        corpoPainel.appendChild(dl);
      }
      if (Array.isArray(n.itens) && n.itens.length) {
        const ul = el('ul', 'mapa-itens');
        for (const it of n.itens.slice(0, 6)) ul.appendChild(el('li', null, encurtar(it)));
        corpoPainel.append(el('h4', 'mapa-sub', n.tipo === 'inconsistencia' ? 'Onde apareceu' : 'O que o robô sabe'), ul);
      }
      const viz = [...vizinhos.get(n.id)].map((id) => porId.get(id)).filter(Boolean);
      if (viz.length) {
        const tipoLig = (m) => { const l = ligs.find((x) => (x.s === n && x.t === m) || (x.t === n && x.s === m)); return l ? l.tipo : 'usa'; };
        const ordemT = { etapa: 0, conhecimento: 1, inconsistencia: 2, regra_aprendida: 3, recurso: 4, cliente: 5 };
        viz.sort((a, b) => (ordemT[a.tipo] - ordemT[b.tipo]) || b.peso - a.peso);
        corpoPainel.appendChild(el('h4', 'mapa-sub', `Ligações (${viz.length})`));
        const ul = el('ul', 'mapa-ligs');
        const clientes = viz.filter((m) => m.tipo === 'cliente'), outros = viz.filter((m) => m.tipo !== 'cliente');
        const mostrar = clientes.length > 3 ? outros : viz;
        for (const m of mostrar.slice(0, 40)) {
          const b = el('button', 'mapa-lig'); b.type = 'button'; b.dataset.id = m.id;
          const pt = el('i', 'mapa-leg-ponto ' + formaLegenda(m)); pt.style.setProperty('--c', m.cor);
          b.append(pt, el('span', 'mapa-lig-rot', m.rotulo), el('span', 'mapa-lig-tipo', NOME_LIGACAO[tipoLig(m)] || ''));
          const li = el('li'); li.appendChild(b); ul.appendChild(li);
        }
        if (mostrar.length > 40) ul.appendChild(el('li', 'mapa-res-vazio', `Mais ${mostrar.length - 40}.`));
        if (clientes.length > 3) { // muitos clientes: uma linha só, que abre ao tocar
          const b = el('button', 'mapa-lig mapa-lig-grupo'); b.type = 'button'; b.setAttribute('aria-expanded', 'false');
          const pt = el('i', 'mapa-leg-ponto ponto'); pt.style.setProperty('--c', COR.cliente);
          b.append(pt, el('span', 'mapa-lig-rot', `${clientes.length} clientes ${n.tipo === 'etapa' ? 'nesta etapa' : 'ligados'}`), el('span', 'mapa-lig-tipo', 'Ver'));
          const sub = el('ul', 'mapa-ligs mapa-sub-lista'); sub.hidden = true;
          for (const m of clientes) { const bb = el('button', 'mapa-lig'); bb.type = 'button'; bb.dataset.id = m.id; const p2 = el('i', 'mapa-leg-ponto ponto'); p2.style.setProperty('--c', m.cor); bb.append(p2, el('span', 'mapa-lig-rot', m.rotulo), el('span', 'mapa-lig-tipo', (m.fatos && m.fatos[0] && m.fatos[0][1]) || '')); const li2 = el('li'); li2.appendChild(bb); sub.appendChild(li2); }
          b.addEventListener('click', () => { sub.hidden = !sub.hidden; b.setAttribute('aria-expanded', sub.hidden ? 'false' : 'true'); b.lastChild.textContent = sub.hidden ? 'Ver' : 'Fechar'; });
          const li = el('li'); li.append(b, sub); ul.appendChild(li);
        }
        corpoPainel.appendChild(ul);
      }
      corpoPainel.scrollTop = 0;
    }
    corpoPainel.addEventListener('click', (e) => { const b = e.target.closest('.mapa-lig'); if (b) selecionar(porId.get(b.dataset.id), true); });

    // ---------- números e linha do tempo ----------
    function numeroNoTempo(id) { const p = pontoEm(tempo); return p && p.etapas && id in p.etapas ? p.etapas[id] : null; }
    function pontoEm(ms) { let p = null; for (const e of evolucao) { if (e.ms <= ms + 1000) p = e; else break; } return p || evolucao[0] || null; }
    function atualizarNumeros() {
      const set = (k, v) => { const e = raiz.querySelector(`[data-n="${k}"]`); if (e && e.textContent !== String(v)) e.textContent = v; };
      const p = tempo == null ? evolucao[evolucao.length - 1] : pontoEm(tempo);
      const vis = nos.filter(visivel);
      const nVis = vis.length;
      const lVis = ligs.filter((l) => visivel(l.s) && visivel(l.t)).length;
      set('nos', nVis);
      set('nos-r', raiz.classList.contains('estreito') ? (nVis === 1 ? 'bolinha' : 'bolinhas') : `${nVis === 1 ? 'bolinha' : 'bolinhas'} · ${lVis} ${lVis === 1 ? 'conexão' : 'conexões'}`);
      const regras = p ? p.regras_aprendidas : nos.filter((n) => n.tipo === 'regra_aprendida' && n.grupo === 'aprovada' && (tempo == null || n.desdeMs <= tempo)).length;
      set('regras', regras);
      set('taxa', p && nos.length ? Math.round((p.taxa_painel || 0) * 100) + '%' : '—');
      const dt = raiz.querySelector('[data-q="data"]'), mc = raiz.querySelector('[data-q="marco"]');
      if (tempo == null) {
        dt.textContent = 'Agora';
        const u = evolucao[evolucao.length - 1] || {};
        const conv = u.conversas ?? (u.etapas && u.etapas['etapa:contato']) ?? porId.get('etapa:contato')?.peso;
        const pain = u.paineis ?? (u.etapas && u.etapas['etapa:criou']) ?? porId.get('etapa:criou')?.peso;
        const ini = periodoInicio || (evolucao[0] && evolucao[0].ms);
        mc.textContent = conv != null && pain != null ? `${conv} conversas e ${pain} ${pain === 1 ? 'painel' : 'painéis'}${ini ? (dias ? ` nos últimos ${dias} dias` : ' desde ' + fmtDia(ini)) : ''}` : '';
      }
      else { dt.textContent = fmtData(tempo); const m = marcos.filter((x) => x.ms <= tempo + 1000).pop(); mc.textContent = m ? m.texto : (p && p.marco) || ''; }
      canvas.setAttribute('aria-label', `Mapa com ${nVis} bolinhas e ${lVis} conexões. ${regras} regras aprendidas. Use a busca para abrir um item.`);
    }
    // índice contínuo da linha do tempo: cada ponto da evolução ocupa o mesmo espaço do trilho
    function tempoDoSlider(v) {
      if (evolucao.length < 2) return null;
      const f = (v / 1000) * (evolucao.length - 1), i = Math.min(evolucao.length - 2, Math.floor(f)), r = f - i;
      return evolucao[i].ms + (evolucao[i + 1].ms - evolucao[i].ms) * r;
    }
    function aplicarTempo(v, deTocar) {
      const antes = tempo;
      tempo = v >= 1000 ? null : tempoDoSlider(v);
      raiz.classList.toggle('no-tempo', tempo != null);
      const t = agoraMs();
      if (!reduzir()) for (const n of nos) {
        const eraVis = antes == null ? true : n.desdeMs <= antes, ficaVis = tempo == null ? true : n.desdeMs <= tempo;
        if (!eraVis && ficaVis) n.surgiu = t;
      }
      if (selecionado && !visivel(selecionado)) fecharDetalhe();
      if (!deTocar) slider.value = String(v);
      slider.style.setProperty('--p', (v / 10) + '%');
      atualizarNumeros(); mostrarAviso(); pedirDesenho();
    }
    function irParaAgora() { pararPlay(); aplicarTempo(1000); }
    slider.addEventListener('input', () => { pararPlay(); aplicarTempo(+slider.value, true); });
    function iniciarPlay() {
      if (evolucao.length < 2) return;
      tocando = true; btPlay.innerHTML = ICONE.pausa + '<span>Pausar</span>'; btPlay.setAttribute('aria-label', 'Pausar a evolução');
      valorInicioPlay = +slider.value >= 1000 ? 0 : +slider.value;
      tocouEm = agoraMs() - 0;
      if (reduzir()) { // sem animação: anda em saltos de ponto a ponto
        const pulo = 1000 / (evolucao.length - 1);
        let v = valorInicioPlay; aplicarTempo(v);
        const id = setInterval(() => { if (!tocando || destruido) return clearInterval(id); v += pulo; if (v >= 999.5) { clearInterval(id); pararPlay(); aplicarTempo(1000); } else aplicarTempo(v); }, 900);
        return;
      }
      aplicarTempo(valorInicioPlay); pedirDesenho();
    }
    function passoPlay() {
      const dur = Math.max(6000, Math.min(14000, evolucao.length * 650)) * (1 - valorInicioPlay / 1000);
      const p = Math.min(1, (agoraMs() - tocouEm) / Math.max(800, dur));
      const v = valorInicioPlay + (1000 - valorInicioPlay) * p;
      slider.value = String(Math.round(v));
      aplicarTempo(v >= 999.5 ? 1000 : v, false);
      if (p >= 1) { pararPlay(); return false; }
      return true;
    }
    function pararPlay() { if (!tocando) return; tocando = false; btPlay.innerHTML = ICONE.play + '<span>Evolução</span>'; btPlay.setAttribute('aria-label', 'Reproduzir a evolução'); }
    btPlay.addEventListener('click', () => (tocando ? pararPlay() : iniciarPlay()));

    // curva da evolução atrás do trilho: bolinhas (área) e taxa de painel (linha)
    function desenharCurva() {
      const box = raiz.querySelector('.mapa-curva');
      if (!box) return;
      if (evolucao.length < 2) { box.innerHTML = ''; raiz.classList.add('sem-tempo'); return; }
      raiz.classList.remove('sem-tempo');
      const W = 1000, Hh = 100, maxN = Math.max(1, ...evolucao.map((p) => p.nos));
      const x = (i) => (i / (evolucao.length - 1)) * W;
      const area = evolucao.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${(Hh - (p.nos / maxN) * (Hh - 14)).toFixed(1)}`).join(' ');
      const maxT = Math.max(0.01, ...evolucao.map((p) => p.taxa_painel || 0)); // a taxa usa a altura toda (escala própria)
      const taxa = evolucao.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${(Hh - ((p.taxa_painel || 0) / maxT) * (Hh - 14)).toFixed(1)}`).join(' ');
      const ticks = evolucao.map((p, i) => (p.marco && (i === 0 || p.marco !== evolucao[i - 1].marco) ? `<circle cx="${x(i).toFixed(1)}" cy="${Hh - 4}" r="3"><title>${String(p.marco).replace(/[<&]/g, '')}</title></circle>` : '')).join('');
      box.setAttribute('viewBox', `0 0 ${W} ${Hh}`);
      box.innerHTML = `<path class="c-area" d="${area} L${W},${Hh} L0,${Hh} Z"/><path class="c-taxa" d="${taxa}" vector-effect="non-scaling-stroke"/><g class="c-marcos">${ticks}</g>`;
      const pe = raiz.querySelector('.mapa-pontas');
      if (pe) { pe.firstChild.textContent = fmtDia(evolucao[0].ms); pe.lastChild.textContent = 'hoje'; }
    }

    // ---------- avisos (carregando, vazio, erro) ----------
    function mostrarAviso(tipo, texto) {
      raiz.classList.toggle('sem-dados', !nos.length);
      if (!tipo) {
        const algum = nos.length > 0, ligado = nos.some((n) => camadasLigadas.has(n.camada));
        if (algum && !ligado) { tipo = 'vazio'; texto = 'Todas as camadas estão desligadas. Toque numa pílula lá em cima para ver o mapa.'; }
        else if (algum && tempo != null && !nos.some(visivel)) { tipo = 'info'; texto = 'Nada tinha surgido ainda nesse momento.'; }
        else { aviso.hidden = true; raiz.dataset.estado = algum ? 'pronto' : raiz.dataset.estado; return; }
      }
      raiz.dataset.estado = tipo;
      aviso.hidden = false; aviso.className = 'mapa-aviso ' + tipo; aviso.innerHTML = '';
      if (tipo === 'carregando') { aviso.append(el('span', 'mapa-girando'), el('p', null, texto || 'Montando o mapa…')); return; }
      if (tipo === 'vazio' && !nos.length) {
        aviso.insertAdjacentHTML('beforeend', '<svg class="mapa-vazio-ilus" viewBox="0 0 120 64" aria-hidden="true"><path d="M20 40 L58 18 L98 36" /><circle cx="20" cy="40" r="7"/><circle cx="58" cy="18" r="9"/><circle cx="98" cy="36" r="6"/><circle cx="76" cy="54" r="3"/><circle cx="40" cy="56" r="2.5"/></svg>');
        aviso.append(el('h3', null, 'O mapa ainda está em branco'), el('p', null, texto || 'Ele vai crescendo sozinho conforme o robô atende e aprende. Volte depois das primeiras conversas.'));
        return;
      }
      aviso.append(el('p', null, texto || ''));
      if (tipo === 'erro') { aviso.insertBefore(el('h3', null, 'Não deu para abrir o mapa'), aviso.firstChild); const b = el('button', 'mapa-bt', 'Tentar de novo'); b.type = 'button'; b.addEventListener('click', () => atualizar()); aviso.appendChild(b); }
    }

    // ---------- carga ----------
    let carregando = null;
    function atualizar(novasOpcoes) {
      if (novasOpcoes && 'dias' in novasOpcoes) dias = novasOpcoes.dias;
      if (carregando) return carregando;
      if (!nos.length) mostrarAviso('carregando');
      const caminho = '/api/grafo' + (dias ? '?dias=' + encodeURIComponent(dias) : '');
      carregando = Promise.resolve().then(() => buscar(caminho)).then((g) => {
        if (destruido) return;
        const tinha = nos.length;
        if (!tinha) { medir(); vertical = largura > 0 && largura < 640 && altura > largura * 1.2; esticar = altura ? Math.max(1, Math.min(1.7, (largura / altura) / 1.35)) : 1; }
        aplicarDados(g);
        if (!nos.length) { mostrarAviso('vazio'); pedirDesenho(); return; }
        mostrarAviso();
        medir();
        if (primeiraVez || !tinha) {
          if (reduzir()) assentar(); else { assentar(0.09); alpha = 0.09; }
          Object.assign(vista, vistaAjustada());
          primeiraVez = false;
          if (!reduzir()) for (const n of nos) n.surgiu = -1;
        } else aquecer(0.12);
        pedirDesenho();
      }).catch((e) => {
        if (destruido) return;
        if (!nos.length) mostrarAviso('erro', 'O painel não respondeu. Confira se o robô está ligado e tente de novo.');
      }).finally(() => { carregando = null; });
      return carregando;
    }

    // fonte carregada = redesenha com a métrica certa
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (!destruido) pedirDesenho(); });
    const mq = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    const aoMudarMovimento = () => { if (reduzir()) { assentar(); pedirDesenho(); } };
    if (mq && mq.addEventListener) mq.addEventListener('change', aoMudarMovimento);

    medir();
    atualizar();

    const api = {
      atualizar,
      destruir() {
        destruido = true; if (raf) cancelAnimationFrame(raf); ro.disconnect();
        document.removeEventListener('pointerdown', foraDaBusca, true);
        if (mq && mq.removeEventListener) mq.removeEventListener('change', aoMudarMovimento);
        raiz.remove(); delete container.__mapa;
      },
      selecionar: (id) => selecionar(porId.get(id), true),
      get dados() { return { nos: nos.length, ligacoes: ligs.length, evolucao: evolucao.length, vista: { ...vista }, parado: !raf, tempo }; },
    };
    container.__mapa = api;
    return api;
  }

  window.montarMapa = montarMapa;
})();
