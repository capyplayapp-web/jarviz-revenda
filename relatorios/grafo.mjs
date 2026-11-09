// Mapa do conhecimento do robô da revenda (08/11/2026).
// Monta, só do disco e sem IA, o grafo de bolinhas e conexões: fluxo de atendimento, base de conhecimento (base.md),
// regras aprendidas (aprendizados.*), padrões de erro, recursos (links, vídeos, guias, follow-ups) e a memória dos clientes.
// Contrato: { gerado_em, nos:[{id,tipo,rotulo,peso,desde,grupo,detalhe}], ligacoes:[{de,para,tipo,peso}], evolucao:[{quando,nos,ligacoes,regras_aprendidas,conhecimento,taxa_painel,clientes}] }
// Extras (podem ser ignorados): nos[].fatos [[rótulo, valor]], nos[].itens [texto], marcos [{quando,texto}], totais {...},
// ligação extra "acontece_em" (padrão de erro -> etapa do fluxo onde ele aparece).
// Nunca entra telefone, senha, e-mail nem usuário do painel: todo texto passa por limpar().
// Teste: node relatorios\grafo.mjs --json   |   node relatorios\testar-grafo.mjs
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const PASTA = process.env.GRAFO_PASTA || path.resolve(AQUI, '..'); // GRAFO_PASTA: só para o teste de escala
const ARQ = {
  eventos: path.join(PASTA, 'eventos.jsonl'),
  historico: path.join(PASTA, 'eventos-historico.jsonl'),
  clientes: path.join(PASTA, 'clientes.json'),
  revendedores: path.join(PASTA, 'revendedores.json'),
  base: path.join(PASTA, 'base.md'),
  videos: path.join(PASTA, 'videos.json'),
  guias: 'D:/CAPY/Guias TV/guias.json',
  aprendizados: path.join(AQUI, 'aprendizados.json'),
  aprendizadosMd: path.join(AQUI, 'aprendizados.md'),
  memoria: path.join(os.homedir(), '.claude', 'projects', 'C--Users-gusta', 'memory', 'robo-whats-revenda.md'),
};
const MAX_NOS = 400;
const H = 3600e3;

// ---------- leitura ----------
const lerTxt = (arq) => { try { return fs.readFileSync(arq, 'utf8').replace(/^\uFEFF/, ''); } catch { return ''; } };
const lerJson = (arq, padrao) => { try { return JSON.parse(lerTxt(arq)); } catch { return padrao; } };
function lerJsonl(arq) {
  const saida = [];
  for (const l of lerTxt(arq).split('\n')) { if (!l) continue; try { const e = JSON.parse(l); if (e && e.t && e.tipo) saida.push(e); } catch {} }
  return saida;
}
// Mesma regra do lib.mjs: o histórico reconstruído só vale antes do primeiro evento ao vivo.
function lerEventos() {
  const vivo = lerJsonl(ARQ.eventos), hist = lerJsonl(ARQ.historico);
  let corte = Infinity;
  for (const e of vivo) if (!e.varredura) { const t = Date.parse(e.t); if (t < corte) corte = t; }
  return hist.filter((e) => Date.parse(e.t) < corte).concat(vivo).map((e) => ({ ...e, ms: Date.parse(e.t) })).filter((e) => Number.isFinite(e.ms)).sort((a, b) => a.ms - b.ms);
}

// ---------- limpeza (nada de dado pessoal) ----------
export function limpar(t, max = 220) {
  let s = String(t == null ? '' : t)
    .replace(/\b(senha|password)\b\s*[:=]\s*\S+/gi, '$1 [oculta]')
    .replace(/\bsenha\s+(?=\S*\d)\S+/gi, 'senha [oculta]')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[e-mail]')
    .replace(/\(?\+?\d{2}\)?[\s.-]?\d{4,5}[\s.-]?\d{4}\b/g, '[telefone]')
    .replace(/\d{8,}/g, '[número]')
    .replace(/\s+/g, ' ').trim();
  if (s.length > max) s = s.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
  return s;
}
// Só o primeiro nome, sem número, sem emoji. "MÁXIMO" -> "Máximo"; "73165506113588" -> "Sem nome".
export function primeiroNome(nome) {
  const palavras = String(nome || '').normalize('NFC').split(/\s+/)
    .map((p) => p.replace(/[^\p{L}'-]/gu, '').replace(/^[-']+|[-']+$/g, ''))
    .filter((p) => p.length >= 2);
  const p = palavras[0];
  if (!p) return 'Sem nome';
  return p.charAt(0).toLocaleUpperCase('pt-BR') + p.slice(1).toLocaleLowerCase('pt-BR');
}
const hashCurto = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const palavras = (s) => new Set(norm(s).split(' ').filter((w) => w.length >= 4));
function parecido(a, b) { const A = palavras(a), B = palavras(b); if (!A.size || !B.size) return 0; let i = 0; for (const w of A) if (B.has(w)) i++; return i / (A.size + B.size - i); }

// ---------- catálogo fixo do fluxo ----------
const ETAPAS = [
  { id: 'etapa:contato', rotulo: 'Entrou em contato', ordem: 0 },
  { id: 'etapa:soube', rotulo: 'Soube como funciona', ordem: 1 },
  { id: 'etapa:link', rotulo: 'Recebeu o link do painel', ordem: 2 },
  { id: 'etapa:criou', rotulo: 'Criou o painel', ordem: 3 },
  { id: 'etapa:senhor', rotulo: 'Passou ao senhor', ordem: 9 },
  { id: 'etapa:sumiu', rotulo: 'Sumiu', ordem: 9 },
];
const FUNIL = ['etapa:contato', 'etapa:soube', 'etapa:link', 'etapa:criou'];
const ROTULO_ETAPA_FICHA = { primeiro_contato: 'Primeiro contato', explicando: 'Explicando', duvidas: 'Com dúvidas', criando_painel: 'Criando o painel', painel_criado: 'Painel criado', testando: 'Testando', cliente_ativo: 'Cliente ativo', parado: 'Parado', encerrado: 'Encerrado' };
const NIVEL_FICHA = { primeiro_contato: 0, explicando: 1, duvidas: 1, testando: 1, cliente_ativo: 1, criando_painel: 2, painel_criado: 3 }; // cliente_ativo = já era revenda: não conta como painel novo
const RX_SOUBE = /cr[eé]dito|p[oó]s-?pago|R\$ ?3,50/i;
const RX_LINK = /painel\.capyplay\.site\/#\/rs\//i;

// Seções do base.md -> nó de conhecimento (id fixo e rótulo curto). Seção nova vira nó sozinha (id pelo título).
const SECOES = [
  { rx: /^como escrever/, id: 'con:escrever', rotulo: 'Como escrever' },
  { rx: /^regras do negocio/, id: 'con:negocio', rotulo: 'Regras do negócio' },
  { rx: /^links/, id: 'con:links', rotulo: 'Links' },
  { rx: /^atendimento/, id: 'con:atendimento', rotulo: 'Atendimento único' },
  { rx: /^memoria/, id: 'con:memoria', rotulo: 'Ficha do cliente' },
  { rx: /^escola/, id: 'con:escola', rotulo: 'Escola do Revendedor' },
  { rx: /^banners/, id: 'con:banners', rotulo: 'Banners e criativos' },
  { rx: /^apps parceiros/, id: 'con:apps', rotulo: 'Apps parceiros' },
  { rx: /^app proprio/, id: 'con:app_proprio', rotulo: 'App próprio' },
  { rx: /^teste/, id: 'con:teste', rotulo: 'Teste grátis' },
  { rx: /^guia/, id: 'con:guias', rotulo: 'Guias de TV' },
  { rx: /^videos/, id: 'con:videos', rotulo: 'Vídeos' },
  { rx: /^roteiro/, id: 'con:roteiro', rotulo: 'Roteiro' },
  { rx: /^quando chamar/, id: 'con:responsavel', rotulo: 'Quando chamar o responsável' },
  { rx: /^filmes/, id: 'con:catalogo', rotulo: 'Filmes e séries' },
  { rx: /^formato/, id: null }, // formato técnico da saída do Haiku: não é conhecimento de atendimento
];
// Onde cada conhecimento entra no fluxo.
const USA_ETAPA = {
  'etapa:contato': ['con:escrever', 'con:atendimento', 'con:memoria', 'con:roteiro'],
  'etapa:soube': ['con:negocio', 'con:roteiro'],
  'etapa:link': ['con:links', 'rec:link_painel', 'con:teste', 'rec:fu1'],
  'etapa:criou': ['rec:manual', 'rec:suporte', 'rec:pagamento', 'con:escola', 'con:banners', 'con:apps', 'con:app_proprio'],
  'etapa:senhor': ['con:responsavel'],
};
const USA_CON = { // conhecimento -> recurso fixo (links e materiais ligam pela tabela REC, com o peso de uso)
  'con:apps': ['con:guias', 'con:videos'],
  'con:app_proprio': ['vid:appproprio'],
};
// Temas das regras aprendidas: para qual conhecimento ela ensina e qual padrão de erro ela corrige.
const TEMAS = [
  { rx: /link|manual/, con: ['con:links'] },
  { rx: /mensage|frase|curt|repet|repit|uma vez|no maximo/, con: ['con:escrever'] },
  { rx: /responsavel|verificar|passar|passe /, con: ['con:responsavel'] },
  { rx: /subrevenda|primeira resposta|resposta seguinte|passo \d|explique o app/, con: ['con:roteiro'] },
  { rx: /pagamento|preco|subrevenda|pos pago|pre pago/, con: ['con:negocio'] },
  { rx: /senha|dados do painel/, con: ['con:atendimento', 'con:memoria'] },
  { rx: /painel nao abre|o que aparece/, con: ['con:roteiro'] },
  { rx: /teste/, con: ['con:teste'] },
  { rx: /escola/, con: ['con:escola'] },
  { rx: /\bapp\b|aparelho/, con: ['con:apps'] },
];
// Padrões de erro (títulos das inconsistências das leituras de 2 h).
// etapa = onde o erro aparece no fluxo (ligação extra "acontece_em").
const PADROES = [
  { id: 'inc:link_faltando', rotulo: 'Link anunciado e não enviado', rx: /link.*(nao enviado|sem o link|anunciado)|anunciado.*link/, etapa: 'etapa:link' },
  { id: 'inc:link_errado', rotulo: 'Link errado', rx: /link.*errad|errad.*link/, etapa: 'etapa:criou' },
  { id: 'inc:repeticao', rotulo: 'Resposta repetida', rx: /repet|de novo|dobro/, tipo: 'repeticao', etapa: 'etapa:criou' },
  { id: 'inc:fora_de_hora', rotulo: 'Assunto fora de hora', rx: /primeira resposta|cedo|antes do|logo na|fora de hora/, tipo: 'fora_de_hora', etapa: 'etapa:soube' },
  { id: 'inc:passou_sem_precisar', rotulo: 'Passou ao senhor sem precisar', rx: /responsavel|passagem|passado/, tipo: 'passou_sem_precisar', etapa: 'etapa:senhor' },
  { id: 'inc:mal_entendida', rotulo: 'Pergunta mal entendida', rx: /virou|sem resposta|mal entend/, tipo: 'pergunta_mal_entendida', etapa: 'etapa:contato' },
  { id: 'inc:contradicao', rotulo: 'Informação que não existia', rx: /$^/, tipo: 'contradicao', etapa: 'etapa:soube' },
  { id: 'inc:sem_resposta', rotulo: 'Robô não respondeu', rx: /$^/, etapa: 'etapa:contato' },
];
const CORRIGE = [
  { rx: /anunciar um link|link na mesma resposta/, inc: 'inc:link_faltando' },
  { rx: /link do manual|exatamente como/, inc: 'inc:link_errado' },
  { rx: /uma vez|nao repita|repit|repet|no maximo \d+ mensagens/, inc: 'inc:repeticao' },
  { rx: /subrevenda|primeira resposta|so explique o app|depois que a pessoa disser/, inc: 'inc:fora_de_hora' },
  { rx: /sem passar ao responsavel|antes de passar/, inc: 'inc:passou_sem_precisar' },
  { rx: /sem pergunta|nao abre|o que aparece|nao souber|verificar/, inc: 'inc:mal_entendida' },
  { rx: /pagamento foi confirmado|afirme pagamento|nunca afirme/, inc: 'inc:contradicao' },
];

// ---------- base.md e cópias (quando cada seção apareceu) ----------
function secoesDe(txt) {
  const mapa = new Map(); let atual = null;
  for (const l of txt.split(/\r?\n/)) {
    const m = l.match(/^#\s+(.+?)\s*$/);
    if (m) { atual = m[1]; mapa.set(atual, []); continue; }
    if (atual && l.trim()) mapa.get(atual).push(l.trim());
  }
  return mapa;
}
function chaveSecao(titulo) { return norm(String(titulo).split('(')[0]); }
function infoSecao(titulo) {
  const k = chaveSecao(titulo);
  const s = SECOES.find((x) => x.rx.test(k));
  if (s) return s.id ? { id: s.id, rotulo: s.rotulo } : null;
  return { id: 'con:' + k.replace(/\s+/g, '_').slice(0, 30), rotulo: limpar(String(titulo).split('(')[0], 40) };
}
function inicioDoRobo(copias) {
  const mem = lerTxt(ARQ.memoria).match(/Desde (\d{2})\/(\d{2})\/(\d{4})/);
  const daMemoria = mem ? new Date(+mem[3], +mem[2] - 1, +mem[1], 0, 0, 0).getTime() : Infinity;
  const daCopia = copias.length ? copias[0].ms - 60e3 : Infinity;
  return Math.min(daMemoria, daCopia);
}
function lerBase() {
  let copias = [];
  try {
    copias = fs.readdirSync(PASTA).filter((f) => /^base\.md\.(antes|com)-/.test(f))
      .map((f) => { const arq = path.join(PASTA, f); return { nome: f, ms: fs.statSync(arq).mtimeMs, secoes: secoesDe(lerTxt(arq)) }; })
      .sort((a, b) => a.ms - b.ms);
  } catch {}
  const atual = secoesDe(lerTxt(ARQ.base));
  let msAtual = Date.now(); try { msAtual = fs.statSync(ARQ.base).mtimeMs; } catch {}
  const inicio = inicioDoRobo(copias);
  const secoes = [];
  for (const [titulo, linhas] of atual) {
    const info = infoSecao(titulo); if (!info) continue;
    // casa pela identidade do nó (o título pode mudar: "Banners e criativos…" virou "Banners, vídeos de divulgação…")
    const conteudo = (snap) => { for (const [t, l] of snap.secoes) if (infoSecao(t)?.id === info.id) return l.join('\n'); return null; };
    // Cópia "antes-X" = estado logo antes da edição X (feita na hora da cópia). Seção ausente na cópia => entrou naquela edição.
    let desde = inicio, mudancas = 0, ultima = null;
    const serie = copias.map((c) => ({ ms: c.ms, txt: conteudo(c) })).concat([{ ms: msAtual, txt: linhas.join('\n') }]);
    for (let i = 0; i < serie.length - 1; i++) {
      if (serie[i].txt == null) desde = serie[i].ms;
      else if (serie[i + 1].txt != null && serie[i].txt !== serie[i + 1].txt) { mudancas++; ultima = serie[i].ms; }
    }
    const itens = linhas.filter((l) => /^(-|\d+\.)\s/.test(l)).map((l) => limpar(l.replace(/^(-|\d+\.)\s*/, ''), 160));
    const corpo = linhas.filter((l) => !/^(-|\d+\.)\s/.test(l)).join(' ');
    secoes.push({ ...info, titulo: limpar(titulo, 80), desde, mudancas, ultima, itens: itens.length ? itens : [limpar(corpo, 160)].filter(Boolean), tamanho: Math.max(1, itens.length) });
  }
  // marcos das edições (nome da cópia diz o que mudou)
  const marcos = copias.filter((c) => c.nome.startsWith('base.md.antes-')).map((c) => {
    const nova = secoes.find((s) => Math.abs(s.desde - c.ms) < 1000);
    const k = c.nome.replace('base.md.antes-', '');
    const assunto = MUDANCA_BASE[k] || (k.charAt(0).toUpperCase() + k.slice(1)).replace(/-/g, ' ');
    return { ms: c.ms, texto: nova ? `Base ganhou "${nova.rotulo}"` : `Base ajustada: ${assunto}` };
  });
  return { secoes, inicio, marcos: marcos.concat(marcosDoRobo()) };
}
// Nome legível das edições da base (cópias base.md.antes-X).
const MUDANCA_BASE = { saudacao: 'saudação', 'link-cedo': 'link do painel mais cedo', calma: 'respostas mais calmas', catalogo: 'catálogo de filmes', banners: 'banners', grupo: 'grupo de banners', trafego: 'artes para tráfego', guias: 'guias de TV' };
// Cópias bot.js.antes-X: cada uma marca a hora em que o robô ganhou um comportamento novo.
const MUDANCA_ROBO = { guias: 'Robô passou a mandar guias de TV', vigia: 'Vigia do robô ligado', saudacao: 'Saudação automática no 1º contato', followup: 'Follow-up de 7 min', 'senhor-entra': 'Robô segue falando quando o senhor entra', link: 'Conserto do link do painel cortado', paralelo: 'Uma conversa por vez (sem resposta em dobro)', escada: 'Follow-up em escada: 7 min, 20 min, 1 h, 3 h', relatorios: 'Eventos e relatórios ligados', relatorios2: 'Painéis fechados e leitura de 2 h', catalogo: 'Catálogo de filmes testado', semavisar: 'Conta painel criado sem avisar', pendentes: 'Responder pendentes' };
function marcosDoRobo() {
  try {
    return fs.readdirSync(PASTA).filter((f) => /^bot\.js\.antes-/.test(f)).map((f) => {
      const k = f.replace('bot.js.antes-', '');
      return { ms: fs.statSync(path.join(PASTA, f)).mtimeMs, texto: MUDANCA_ROBO[k] || 'Robô ajustado: ' + k.replace(/-/g, ' '), chave: k };
    });
  } catch { return []; }
}

// ---------- aprendizado ----------
function lerAprendizado() {
  const ap = lerJson(ARQ.aprendizados, { rodadas: [], regras_ativas: [] });
  const rodadas = (ap.rodadas || []).filter((r) => r && r.gerado_em).sort((a, b) => Date.parse(a.gerado_em) - Date.parse(b.gerado_em));
  const nRodada = (ms) => { let n = 0; rodadas.forEach((r, i) => { if (Date.parse(r.gerado_em) <= ms + 1000) n = i + 1; }); return n || null; };
  let ativas = (ap.regras_ativas || []).filter((r) => r && r.regra).map((r) => ({ texto: r.regra, desde: Date.parse(r.desde) || null }));
  if (!ativas.length) { // sem json: usa o .md (sem data)
    ativas = lerTxt(ARQ.aprendizadosMd).split(/\r?\n/).filter((l) => /^- /.test(l)).map((l) => ({ texto: l.slice(2).trim(), desde: null }));
  }
  const regras = ativas.map((r) => ({ ...r, status: 'aprovada', vezes: 1, rodada: r.desde ? nRodada(r.desde) : null }));
  // sugestões que ainda não viraram regra (agrupa as parecidas; some se já existe regra aprovada parecida)
  for (const [i, r] of rodadas.entries()) {
    for (const s of r.regras_novas || []) {
      if (!s || !s.regra || s.status !== 'sugestao') continue;
      if (regras.some((x) => x.status === 'aprovada' && parecido(x.texto, s.regra) >= 0.42)) continue;
      const igual = regras.find((x) => x.status === 'sugestao' && parecido(x.texto, s.regra) >= 0.34);
      if (igual) { igual.vezes++; continue; }
      regras.push({ texto: s.regra, desde: Date.parse(r.gerado_em), status: 'sugestao', vezes: 1, rodada: i + 1 });
    }
  }
  // padrões de erro
  const padroes = new Map();
  const somar = (id, ms, titulo, exemplo) => {
    const p = padroes.get(id) || { id, n: 0, desde: Infinity, ultima: 0, titulos: new Map(), exemplos: [] };
    p.n++; p.desde = Math.min(p.desde, ms); p.ultima = Math.max(p.ultima, ms);
    if (titulo) p.titulos.set(titulo, (p.titulos.get(titulo) || 0) + 1);
    if (exemplo && p.exemplos.length < 3) p.exemplos.push(limpar(exemplo, 170));
    padroes.set(id, p);
  };
  for (const r of rodadas) {
    const ms = Date.parse(r.gerado_em);
    for (const inc of r.inconsistencias || []) {
      const k = norm(inc.titulo);
      const p = PADROES.find((x) => x.rx.test(k)) || PADROES.find((x) => x.tipo === inc.tipo) || PADROES.find((x) => x.id === 'inc:contradicao');
      somar(p.id, ms, limpar(inc.titulo, 80), inc.exemplo);
    }
  }
  const sug = rodadas.length ? (rodadas[rodadas.length - 1].sugestoes_para_o_senhor || []).length : 0;
  return { rodadas, regras, padroes, somar, sugestoesSenhor: sug };
}

// ---------- fluxo por conversa ----------
function fluxoPorConversa(eventos, fichas, revs, agora) {
  const conv = new Map();
  const de = (chat) => { if (!conv.has(chat)) conv.set(chat, { chat, t: [Infinity, Infinity, Infinity, Infinity], ultRobo: 0, ultCli: 0, passou: [], primeiro: Infinity }); return conv.get(chat); };
  for (const e of eventos) {
    if (!e.chat) continue;
    const c = de(e.chat);
    if (e.tipo === 'mensagem_cliente' || e.tipo === 'conversa_nova') { c.t[0] = Math.min(c.t[0], e.ms); if (e.tipo === 'mensagem_cliente') c.ultCli = Math.max(c.ultCli, e.ms); }
    else if (e.tipo === 'resposta_robo' || e.tipo === 'followup') {
      c.ultRobo = Math.max(c.ultRobo, e.ms);
      if (e.tipo === 'resposta_robo' && RX_SOUBE.test(e.texto || '')) c.t[1] = Math.min(c.t[1], e.ms);
      if (e.tipo === 'resposta_robo' && RX_LINK.test(e.texto || '')) c.t[2] = Math.min(c.t[2], e.ms);
    } else if (e.tipo === 'painel_fechado') c.t[3] = Math.min(c.t[3], e.ms);
    else if (e.tipo === 'passou_ao_senhor') c.passou.push(e.ms);
  }
  for (const [chat, f] of Object.entries(fichas)) {
    const c = de(chat), criado = Date.parse(f.criado_em);
    if (Number.isFinite(criado)) c.t[0] = Math.min(c.t[0], criado);
    const nivel = f.painel_criado ? 3 : (NIVEL_FICHA[f.etapa] ?? 0);
    const quando = Date.parse(f.ultimo_contato) || criado;
    for (let i = 1; i <= nivel; i++) if (!Number.isFinite(c.t[i]) && Number.isFinite(quando)) c.t[i] = quando;
    c.ficha = f;
  }
  for (const [chat, r] of Object.entries(revs)) {
    const ms = Date.parse(r.fechou_em); if (!Number.isFinite(ms)) continue;
    const c = de(chat); c.t[3] = Math.min(c.t[3], ms); if (!Number.isFinite(c.t[0])) c.t[0] = ms;
  }
  for (const c of conv.values()) {
    // funil monotônico: quem chegou numa etapa passou pelas anteriores
    for (let i = 2; i >= 0; i--) if (c.t[i + 1] < c.t[i]) c.t[i] = c.t[i + 1];
    c.nivel = c.t.reduce((m, t, i) => (Number.isFinite(t) ? i : m), -1);
    c.primeiro = c.t[0];
    const nivelEm = (ms) => c.t.reduce((m, t, i) => (t <= ms ? i : m), 0);
    c.passouDe = c.passou.length ? nivelEm(c.passou[0]) : null;
    // sumiu: não criou, a última palavra foi do robô e o cliente está calado há mais de 3 h (fim da escada de follow-up)
    const calado = c.ultRobo > c.ultCli && agora - c.ultRobo > 3 * H;
    c.sumiu = c.nivel < 3 && c.nivel >= 0 && (calado || c.ficha?.etapa === 'parado');
    const ultPassou = c.passou.length ? c.passou[c.passou.length - 1] : 0;
    c.lugar = c.nivel >= 3 ? 'etapa:criou' : (ultPassou && ultPassou >= c.ultRobo - 60e3 && agora - ultPassou < 24 * H) ? 'etapa:senhor' : c.sumiu ? 'etapa:sumiu' : FUNIL[Math.max(0, c.nivel)];
  }
  return conv;
}

// ---------- grafo ----------
export async function grafo({ dias } = {}) {
  const agora = Date.now();
  const nDias = parseInt(dias, 10);
  const desdeJanela = Number.isFinite(nDias) && nDias > 0 ? (() => { const d = new Date(agora); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (Math.min(nDias, 365) - 1)); return d.getTime(); })() : -Infinity;

  const todos = lerEventos();
  const fichasTodas = lerJson(ARQ.clientes, {});
  const revsTodos = lerJson(ARQ.revendedores, {});
  const base = lerBase();
  const ap = lerAprendizado();
  const videos = Object.keys(lerJson(ARQ.videos, {}));
  const guias = lerJson(ARQ.guias, {});

  const eventos = todos.filter((e) => e.ms >= desdeJanela);
  const fichas = Object.fromEntries(Object.entries(fichasTodas).filter(([, f]) => (Date.parse(f.ultimo_contato) || Date.parse(f.criado_em) || 0) >= desdeJanela));
  const revs = Object.fromEntries(Object.entries(revsTodos).filter(([, r]) => (Date.parse(r.fechou_em) || 0) >= desdeJanela));
  const conv = fluxoPorConversa(eventos, fichas, revs, agora);
  const convTodas = desdeJanela === -Infinity ? conv : fluxoPorConversa(todos, fichasTodas, revsTodos, agora);
  const inicio = Math.min(base.inicio, todos[0]?.ms ?? Infinity, ...Object.values(fichasTodas).map((f) => Date.parse(f.criado_em) || Infinity));

  const nos = new Map(), ligacoes = new Map();
  const no = (n) => { if (!nos.has(n.id)) nos.set(n.id, { peso: 1, desde: null, grupo: n.tipo, detalhe: '', ...n }); return nos.get(n.id); };
  const liga = (de, para, tipo, peso = 1) => {
    if (!de || !para || de === para) return;
    const k = de + '>' + para + '>' + tipo;
    const l = ligacoes.get(k); if (l) l.peso += peso; else ligacoes.set(k, { de, para, tipo, peso });
  };
  const pct = (a, b) => (b ? Math.round(a / b * 100) : 0);

  // Etapas
  const lista = [...conv.values()].filter((c) => c.nivel >= 0);
  const chegou = FUNIL.map((_, i) => lista.filter((c) => c.nivel >= i).length);
  const passaram = lista.filter((c) => c.passouDe != null);
  const sumiram = lista.filter((c) => c.sumiu);
  const ESCRITO = {
    'etapa:contato': `${chegou[0]} conversas começaram por aqui.`,
    'etapa:soube': `${chegou[1]} de ${chegou[0]} (${pct(chegou[1], chegou[0])}%) ouviram como funciona: pós-pago, 500 créditos, R$ 3,50 por tela.`,
    'etapa:link': `${chegou[2]} receberam o link para criar o painel (${pct(chegou[2], chegou[0])}% de quem chegou).`,
    'etapa:criou': `${chegou[3]} criaram o painel. Taxa de painel: ${pct(chegou[3], chegou[0])}% das conversas.`,
    'etapa:senhor': `${passaram.length} conversas foram passadas ao senhor (o robô não sabia ou era caso de responsável).`,
    'etapa:sumiu': `${sumiram.length} pararam de responder depois da última mensagem do robô (mais de 3 h calados, sem painel).`,
  };
  for (const e of ETAPAS) {
    const i = FUNIL.indexOf(e.id);
    const qtd = i >= 0 ? chegou[i] : e.id === 'etapa:senhor' ? passaram.length : sumiram.length;
    no({ id: e.id, tipo: 'etapa', rotulo: e.rotulo, peso: Math.max(1, qtd), desde: iso(inicio), grupo: i >= 0 ? 'funil' : e.id === 'etapa:senhor' ? 'senhor' : 'sumiu', detalhe: ESCRITO[e.id], fatos: [['Conversas', qtd]], ordem: e.ordem });
  }
  for (let i = 0; i < 3; i++) liga(FUNIL[i], FUNIL[i + 1], 'fluxo', chegou[i + 1]);
  for (const c of passaram) liga(FUNIL[c.passouDe], 'etapa:senhor', 'fluxo', 1);
  for (const c of sumiram) liga(FUNIL[c.nivel], 'etapa:sumiu', 'fluxo', 1);

  // Uso dos recursos (respostas do robô na janela)
  const respostas = eventos.filter((e) => e.tipo === 'resposta_robo');
  const usos = (rx) => respostas.filter((e) => rx.test(e.texto || '')).length;
  const fichasL = Object.values(fichas);
  const contaLista = (campo, chave) => fichasL.filter((f) => Array.isArray(f[campo]) && f[campo].includes(chave)).length;
  const fus = eventos.filter((e) => e.tipo === 'followup'), fuResp = eventos.filter((e) => e.tipo === 'cliente_respondeu_followup');
  const testes = eventos.filter((e) => e.tipo === 'teste_gerado').length;

  // Conhecimento (seções do base.md)
  const conhecimento = new Set();
  for (const s of base.secoes) {
    conhecimento.add(s.id);
    const fatos = [['Itens na base', s.tamanho], ['Mudou', s.mudancas ? `${s.mudancas} ${s.mudancas === 1 ? 'vez' : 'vezes'}` : 'nunca']];
    no({ id: s.id, tipo: 'conhecimento', rotulo: s.rotulo, peso: s.tamanho, desde: iso(s.desde), grupo: 'base', detalhe: s.itens[0] || '', itens: s.itens.slice(0, 6), fatos, ultima_mudanca: iso(s.ultima) });
  }
  const desdeCon = (id) => nos.get(id)?.desde || iso(inicio);

  // Recursos
  const REC = [
    { id: 'rec:link_painel', rotulo: 'Link de criar o painel', grupo: 'link', con: 'con:links', uso: usos(RX_LINK), det: 'Sai na 2ª ou 3ª resposta, sempre como última mensagem.' },
    { id: 'rec:manual', rotulo: 'Manual do Revenda', grupo: 'link', con: 'con:links', uso: usos(/manual_do_revenda/i), det: 'Vídeos no Telegram, mandados depois que o painel é criado.' },
    { id: 'rec:pagamento', rotulo: 'Link de pagamento', grupo: 'link', con: 'con:links', uso: usos(/membership\/renew/i), det: 'Gera o QR Code do acerto no painel (vence dia 5).' },
    { id: 'rec:suporte', rotulo: 'Suporte oficial', grupo: 'link', con: 'con:links', uso: usos(/99920|suporte oficial/i), det: 'WhatsApp do suporte para quando não falarem com a gente.' },
    { id: 'rec:escola', rotulo: 'Link da Escola', grupo: 'link', con: 'con:escola', uso: usos(/escola\.capyapp\.net(?!\/criativos)/i), det: 'Escola gratuita; quem termina ganha campanha de R$ 50 feita por nós.' },
    { id: 'rec:banners', rotulo: 'Banners da revenda', grupo: 'material', con: 'con:banners', uso: usos(/criativos\/revenda/i), det: 'Artes prontas para o revendedor divulgar.' },
    { id: 'rec:galeria', rotulo: 'Galeria do cliente final', grupo: 'material', con: 'con:banners', uso: usos(/criativos\/?(\s|$)/i), det: 'Mostra ao cliente final o que a CapyPlay tem.' },
    { id: 'rec:teste', rotulo: 'Teste grátis de 6 h', grupo: 'material', con: 'con:teste', uso: testes, det: 'Gerado sozinho pelo robô, um por número a cada 30 dias.' },
  ];
  for (const r of REC) {
    no({ id: r.id, tipo: 'recurso', rotulo: r.rotulo, peso: Math.max(1, r.uso), desde: desdeCon(r.con), grupo: r.grupo, detalhe: r.det, fatos: [['Usado', `${r.uso} ${r.uso === 1 ? 'vez' : 'vezes'}`]] });
  }
  const NOME_VIDEO = { smarttv: 'Smart TV', tvbox: 'TV Box e Android', firestick: 'Fire Stick', computador: 'Computador', aparelhos: 'Em quais aparelhos', naocarrega: 'Não carrega', travando: 'Está travando', appproprio: 'App próprio' };
  for (const v of videos) {
    const n = contaLista('videos', v);
    no({ id: 'vid:' + v, tipo: 'recurso', rotulo: 'Vídeo: ' + (NOME_VIDEO[v] || v), peso: Math.max(1, n), desde: desdeCon('con:videos'), grupo: 'video', detalhe: `Vídeo curto de instalação ou problema, mandado quando ajuda.`, fatos: [['Conversas que receberam', n]] });
    liga('con:videos', 'vid:' + v, 'usa', Math.max(1, n));
  }
  for (const [k, g] of Object.entries(guias)) {
    const n = contaLista('guias', k);
    no({ id: 'guia:' + k, tipo: 'recurso', rotulo: limpar(g?.titulo || k, 48), peso: Math.max(1, n), desde: desdeCon('con:guias'), grupo: 'guia', detalhe: limpar(g?.quando || 'Passo a passo ilustrado para achar o app na TV.', 170), fatos: [['Conversas que receberam', n], ['Passos', Array.isArray(g?.passos) ? g.passos.length : '—']] });
    liga('con:guias', 'guia:' + k, 'usa', Math.max(1, n));
  }
  const MIN_FU = [7, 20, 60, 180];
  const marcoRobo = (k) => base.marcos.find((x) => x.chave === k)?.ms;
  const desdeFu = (n) => iso(n === 1 ? marcoRobo('followup') : marcoRobo('escada')) || iso(fus.find((f) => f.n === n)?.ms) || iso(inicio);
  for (let n = 1; n <= 4; n++) {
    const env = fus.filter((f) => f.n === n), resp = fuResp.filter((r) => r.n === n);
    no({ id: 'rec:fu' + n, tipo: 'recurso', rotulo: `Follow-up ${n} (${MIN_FU[n - 1] < 60 ? MIN_FU[n - 1] + ' min' : MIN_FU[n - 1] / 60 + ' h'})`, peso: Math.max(1, env.length), desde: desdeFu(n), grupo: 'followup', detalhe: `Mensagem de acompanhamento depois de ${MIN_FU[n - 1] < 60 ? MIN_FU[n - 1] + ' minutos' : MIN_FU[n - 1] / 60 + (n === 3 ? ' hora' : ' horas')} de silêncio do cliente.`, fatos: [['Enviados', env.length], ['Respondidos', resp.length], ['Taxa de resposta', env.length ? pct(resp.length, env.length) + '%' : '—']] });
    if (n > 1) liga('rec:fu' + (n - 1), 'rec:fu' + n, 'usa', Math.max(1, env.length));
  }
  liga('rec:fu4', 'etapa:sumiu', 'usa', 1);

  // Ligações "usa" (etapa -> conhecimento/recurso e conhecimento -> recurso)
  const pesoUso = (id) => nos.get(id)?.tipo === 'recurso' ? nos.get(id).peso : 1;
  for (const [et, alvos] of Object.entries(USA_ETAPA)) for (const a of alvos) if (nos.has(a)) liga(et, a, 'usa', pesoUso(a));
  for (const [c, alvos] of Object.entries(USA_CON)) for (const a of alvos) if (nos.has(c) && nos.has(a)) liga(c, a, 'usa', pesoUso(a));
  for (const r of REC) if (nos.has(r.con)) liga(r.con, r.id, 'usa', Math.max(1, r.uso));
  for (const s of base.secoes) if (![...ligacoes.values()].some((l) => l.para === s.id || l.de === s.id)) liga('etapa:contato', s.id, 'usa', 1); // seção nova sem lugar definido

  // Padrões de erro (inclui o que os eventos registram)
  for (const e of todos) {
    if (e.tipo === 'repeticao_bloqueada') ap.somar('inc:repeticao', e.ms, 'Repetição barrada antes de sair', null);
    else if (e.tipo === 'erro' && /haiku/i.test(String(e.onde || '') + ' ' + String(e.mensagem || ''))) ap.somar('inc:sem_resposta', e.ms, 'O Haiku não respondeu a tempo', null);
  }

  // Regras aprendidas
  const regrasNos = [];
  for (const r of ap.regras) {
    const t = norm(r.texto);
    const id = 'reg:' + hashCurto(t);
    const desde = r.desde || null;
    const nR = r.rodada ? `leitura ${r.rodada}` : 'leitura de 2 h';
    const nd = no({ id, tipo: 'regra_aprendida', rotulo: limpar(r.texto, 140), peso: r.vezes + (r.status === 'aprovada' ? 2 : 0), desde: iso(desde), grupo: r.status, rodada: r.rodada,
      detalhe: r.status === 'aprovada' ? `Aprendida na ${nR}. O robô já segue esta regra.` : `Sugerida ${r.vezes > 1 ? r.vezes + ' vezes' : 'na ' + nR}; ainda não entrou (o filtro segura o que fala de preço, link ou política).`,
      fatos: [['Situação', r.status === 'aprovada' ? 'Aprovada' : 'Sugestão'], ['Rodada', r.rodada || '—']] });
    regrasNos.push(nd);
    let algum = false;
    for (const tema of TEMAS) if (tema.rx.test(t)) for (const c of tema.con) if (nos.has(c)) { liga(id, c, 'aprendeu', 1); algum = true; }
    if (!algum && nos.has('con:atendimento')) liga(id, 'con:atendimento', 'aprendeu', 1);
    for (const c of CORRIGE) if (c.rx.test(t)) { nd._corrige = (nd._corrige || []).concat(c.inc); }
  }
  for (const p of PADROES) {
    const d = ap.padroes.get(p.id); if (!d) continue;
    const corretoras = regrasNos.filter((r) => (r._corrige || []).includes(p.id));
    const aprovadas = corretoras.filter((r) => r.grupo === 'aprovada');
    const regraMs = Math.min(...aprovadas.map((r) => Date.parse(r.desde) || Infinity));
    const situacao = !aprovadas.length ? 'Sem regra ainda' : d.ultima > regraMs + 60e3 ? 'Voltou depois da regra' : 'Com regra';
    const titulos = [...d.titulos.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => (n > 1 ? `${t} (${n}x)` : t));
    no({ id: p.id, tipo: 'inconsistencia', rotulo: p.rotulo, peso: d.n, desde: iso(d.desde), grupo: situacao === 'Com regra' ? 'tratada' : 'aberta',
      detalhe: `${d.n} ${d.n === 1 ? 'vez' : 'vezes'}. ${situacao}.`, itens: titulos.slice(0, 5).concat(d.exemplos.slice(0, 2)), fatos: [['Ocorrências', d.n], ['Situação', situacao], ['Última vez', iso(d.ultima)]], situacao });
    for (const r of corretoras) liga(r.id, p.id, 'corrige', 1);
    if (p.etapa) liga(p.id, p.etapa, 'acontece_em', d.n); // extra: onde o erro aparece no fluxo
  }
  for (const r of regrasNos) delete r._corrige;

  // Revendedores (jornada do revendedor, 08/11/2026): uma bolinha por painel, ligada a "Criou o painel", cor pelo status (funil\jornada.json).
  const revsJ = lerJson(path.join(PASTA, 'revendedores.json'), {});
  const jorJ = lerJson(path.join(PASTA, 'funil', 'jornada.json'), { revendedores: [] });
  const porRefJ = new Map((jorJ.revendedores || []).map((r) => [r.ref, r]));
  const ROT_ST = { saudavel: 'Saudável', sem_uso: 'Sem uso', em_risco: 'Em risco', duvida_pagamento: 'Dúvida de pagamento', passou_ao_senhor: 'Passou ao senhor' };
  for (const [chat, r] of Object.entries(revsJ)) {
    const j = porRefJ.get(crypto.createHash('sha1').update(chat).digest('hex').slice(0, 10)) || {};
    const st = j.status || 'saudavel', idR = 'rev:' + hashCurto(chat);
    no({ id: idR, tipo: 'revendedor', rotulo: primeiroNome(r.nome || 'Revendedor') + (r.painel_numero ? ' · painel ' + r.painel_numero : ''), peso: 2 + Math.min(6, (j.uso && j.uso.creditos_usados) || 0), desde: iso(Date.parse(r.fechou_em)), grupo: st,
      detalhe: `Revendedor com painel. Situação: ${ROT_ST[st] || st}.${j.proximo ? ' Próximo toque da jornada: ' + j.proximo.tipo.replace(/_/g, ' ') + '.' : ''}`,
      fatos: [['Situação', ROT_ST[st] || st], ['Dias de painel', j.dias ?? '—'], ['Créditos usados', j.uso && j.uso.creditos_usados != null ? j.uso.creditos_usados : '—'], ['Respondeu', j.resposta ? j.resposta.classe.replace(/_/g, ' ') : '—']] });
    liga(idR, 'etapa:criou', 'revendedor_em', 1);
  }

  // Clientes (memória). Os mais recentes viram bolinha; o resto vira "Outros clientes (n)". Quem já é revendedor aparece acima.
  const cand = Object.entries(fichas).filter(([chat]) => !revsJ[chat]).map(([chat, f]) => ({ chat, f, c: conv.get(chat), ms: Date.parse(f.ultimo_contato) || Date.parse(f.criado_em) || 0 })).sort((a, b) => b.ms - a.ms);
  const vagas = Math.max(0, MAX_NOS - nos.size - 1);
  const mostrar = cand.slice(0, vagas), resto = cand.slice(vagas);
  for (const { chat, f, c } of mostrar) {
    const id = 'cli:' + hashCurto(chat);
    let resumo = limpar(f.resumo || '', 160);
    if (f.usuario_painel) resumo = resumo.split(String(f.usuario_painel)).join('[usuário]');
    const nomeCheio = String(f.nome || '').trim();
    if (/\s/.test(nomeCheio)) resumo = resumo.split(nomeCheio).join(primeiroNome(nomeCheio)); // nome completo vira só o primeiro
    const lugar = c?.lugar || 'etapa:contato';
    no({ id, tipo: 'cliente', rotulo: primeiroNome(f.nome), peso: Math.max(1, Number(f.mensagens) || 1), desde: iso(Date.parse(f.criado_em)), grupo: lugar.replace('etapa:', ''),
      detalhe: resumo, fatos: [['Etapa', ROTULO_ETAPA_FICHA[f.etapa] || 'Sem etapa'], ['Mensagens', Number(f.mensagens) || 0], ['Já revende', f.ja_revende === true ? 'Sim' : f.ja_revende === false ? 'Não' : '—'], ['Último contato', iso(Date.parse(f.ultimo_contato))]] });
    liga(id, lugar, 'cliente_em', 1);
  }
  if (resto.length) {
    no({ id: 'cli:outros', tipo: 'cliente', rotulo: `Outros clientes (${resto.length})`, peso: resto.length, desde: iso(Math.min(...resto.map((x) => Date.parse(x.f.criado_em) || Infinity))), grupo: 'outros', detalhe: 'Conversas mais antigas, juntas numa bolinha só para o mapa continuar leve.', fatos: [['Conversas', resto.length]] });
    for (const x of resto) liga('cli:outros', x.c?.lugar || 'etapa:contato', 'cliente_em', 1);
  }

  const listaNos = [...nos.values()];
  const listaLig = [...ligacoes.values()].filter((l) => nos.has(l.de) && nos.has(l.para));

  // ---------- evolução no tempo ----------
  const marcosRodada = ap.rodadas.map((r, i) => {
    const ms = Date.parse(r.gerado_em);
    const novas = ap.regras.filter((x) => x.status === 'aprovada' && x.rodada === i + 1).length;
    return { ms, texto: `Leitura ${i + 1} de 2 h: ${novas ? '+' + novas + (novas === 1 ? ' regra aprovada' : ' regras aprovadas') : 'nenhuma regra nova'}` };
  });
  const primeiroPainel = Math.min(...[...convTodas.values()].map((c) => c.t[3]));
  const marcos = [{ ms: inicio, texto: 'Robô começou a atender' }, ...base.marcos, ...marcosRodada]
    .concat(Number.isFinite(primeiroPainel) ? [{ ms: primeiroPainel, texto: 'Primeiro painel fechado pelo robô' }] : [])
    .filter((m) => Number.isFinite(m.ms)).sort((a, b) => a.ms - b.ms);
  let tempos = new Set([inicio, agora, ...marcos.map((m) => m.ms)]);
  const horas = new Set(todos.map((e) => Math.ceil(e.ms / H) * H).filter((t) => t > inicio && t < agora));
  for (const t of horas) tempos.add(t);
  tempos = [...tempos].sort((a, b) => a - b);
  const juntos = []; for (const t of tempos) if (!juntos.length || t - juntos[juntos.length - 1] > 5 * 60e3) juntos.push(t); else juntos[juntos.length - 1] = t;
  let pontos = juntos;
  if (pontos.length > 120) { // muitos dias: um ponto por dia + marcos
    const dias = new Set(pontos.map((t) => { const d = new Date(t); d.setHours(23, 59, 59, 0); return Math.min(d.getTime(), agora); }));
    pontos = [...new Set([...dias, ...marcos.map((m) => m.ms), agora])].sort((a, b) => a - b);
  }
  const msDe = (n) => (n.desde ? Date.parse(n.desde) : -Infinity);
  const nosMs = listaNos.map((n) => [n.id, msDe(n), n]);
  const convArr = [...convTodas.values()].filter((c) => c.nivel >= 0);
  const evolucao = pontos.map((q) => {
    const vis = new Set(nosMs.filter(([, ms]) => ms <= q + 1000).map(([id]) => id));
    const cont = convArr.filter((c) => c.primeiro <= q);
    const criou = cont.filter((c) => c.t[3] <= q).length;
    const marco = marcos.filter((m) => m.ms <= q + 1000).pop();
    return {
      quando: iso(q), nos: vis.size,
      ligacoes: listaLig.filter((l) => vis.has(l.de) && vis.has(l.para)).length,
      regras_aprendidas: nosMs.filter(([, ms, n]) => n.tipo === 'regra_aprendida' && n.grupo === 'aprovada' && ms <= q + 1000).length,
      conhecimento: nosMs.filter(([, ms, n]) => n.tipo === 'conhecimento' && ms <= q + 1000).length,
      taxa_painel: cont.length ? Math.round(criou / cont.length * 1e4) / 1e4 : 0,
      clientes: Object.values(fichasTodas).filter((f) => (Date.parse(f.criado_em) || Infinity) <= q).length,
      conversas: cont.length, paineis: criou,
      etapas: { // extra: quantas conversas já tinham passado por cada etapa naquele momento
        'etapa:contato': cont.length, 'etapa:soube': cont.filter((c) => c.t[1] <= q).length, 'etapa:link': cont.filter((c) => c.t[2] <= q).length,
        'etapa:criou': criou, 'etapa:senhor': cont.filter((c) => c.passou.length && c.passou[0] <= q).length,
      },
      marco: marco ? marco.texto : null,
    };
  });

  return {
    gerado_em: iso(agora),
    periodo: { dias: Number.isFinite(nDias) && nDias > 0 ? nDias : null, inicio: iso(desdeJanela === -Infinity ? inicio : desdeJanela), fim: iso(agora) },
    nos: listaNos,
    ligacoes: listaLig,
    evolucao,
    marcos: marcos.map((m) => ({ quando: iso(m.ms), texto: m.texto })),
    totais: {
      conversas: chegou[0], paineis: chegou[3], taxa_painel: chegou[0] ? Math.round(chegou[3] / chegou[0] * 1e4) / 1e4 : 0,
      regras_aprovadas: ap.regras.filter((r) => r.status === 'aprovada').length, sugestoes: ap.regras.filter((r) => r.status === 'sugestao').length,
      conhecimento: conhecimento.size, rodadas: ap.rodadas.length, clientes_agrupados: resto.length,
    },
  };
}
export default grafo;

// node relatorios\grafo.mjs --json [--dias=7]
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dArg = process.argv.find((a) => a.startsWith('--dias='));
  const t0 = performance.now();
  grafo({ dias: dArg ? dArg.split('=')[1] : undefined }).then((g) => {
    if (process.argv.includes('--json')) process.stdout.write(JSON.stringify(g, null, 1) + '\n');
    else {
      const porTipo = {}; for (const n of g.nos) porTipo[n.tipo] = (porTipo[n.tipo] || 0) + 1;
      console.log(`grafo: ${g.nos.length} nós, ${g.ligacoes.length} ligações, ${g.evolucao.length} pontos de evolução em ${Math.round(performance.now() - t0)} ms`);
      console.log(porTipo, g.totais);
    }
  });
}
