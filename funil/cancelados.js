// Painéis cancelados (09/11/2026, pedido do senhor: "taxa de painéis cancelados e o motivo para aprimorar").
// O Dashboard (relatorios/cancelados-lib.mjs) grava em funil/comando.json {"acao":"cancelados","alvos":[...]} com os painéis
// desativados no Sigma. Aqui, dentro do robô (que tem o WhatsApp aberto), lemos as últimas 40 mensagens de cada um e o Haiku
// diz o motivo da desistência (categoria fixa + frase curta + citação do cliente). Só leitura: nada é enviado a ninguém.
// Saída: cancelados/motivos.json (fora do git: tem fala de cliente) e cancelados/conversas.json (o Opus lê no "Corrigir erro").
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PASTA = process.env.FUNIL_PASTA || path.resolve(__dirname, '..');
const DIR = path.join(PASTA, 'cancelados');
const ARQ = {
  motivos: path.join(DIR, 'motivos.json'), conversas: path.join(DIR, 'conversas.json'), estado: path.join(DIR, 'estado.json'),
  prompt: path.join(DIR, 'prompt-motivos.md'), clientes: path.join(PASTA, 'clientes.json'), log: path.join(PASTA, 'conversas.log'),
};
const lerJson = (arq, padrao) => { try { return JSON.parse(fs.readFileSync(arq, 'utf8').replace(/^﻿/, '')); } catch { return padrao; } };
const gravar = (arq, obj) => { fs.mkdirSync(path.dirname(arq), { recursive: true }); const t = arq + '.tmp'; fs.writeFileSync(t, JSON.stringify(obj, null, 1)); fs.renameSync(t, arq); };
const logar = (ctx, t) => { try { ctx.log(String(t)); } catch {} };
const fim8 = (t) => String(t || '').replace(/\D/g, '').slice(-8);
const HUMANO = ['chat', 'ptt', 'audio', 'image', 'document', 'video', 'automated_greeting_message'];
const LOTE = 8;

// Categorias fixas (a tela agrupa por elas). Mesma lista em relatorios/cancelados-lib.mjs.
const CATEGORIAS = {
  nunca_comecou: 'Abriu o painel e nunca começou',
  nao_conseguiu_vender: 'Não conseguiu vender',
  instabilidade: 'Instabilidade ou app travando',
  dificuldade_tecnica: 'Dificuldade para instalar ou configurar',
  preco_cobranca: 'Preço, mínimo ou cobrança',
  desconfianca: 'Desconfiança (achou golpe)',
  outro_fornecedor: 'Foi para outro fornecedor',
  sem_resposta_nossa: 'Ficou sem resposta nossa',
  sumiu_sem_dizer: 'Sumiu sem dizer o motivo',
  desativado_por_nos: 'Desativado por nós',
  outro: 'Outro motivo',
};

const PROMPT = `Você analisa por que revendedores da CapyPlay desistiram do painel de revenda (o painel foi desativado). Português do Brasil, frases curtas, sem emoji.
Contexto do negócio: o revendedor abre um painel pós-pago com 500 créditos, vende acesso de TV/filmes aos clientes dele e paga só o que usou no dia 5. Ele conversa no WhatsApp com o robô Jarvis ("robô"), com o responsável ("senhor") e às vezes com a equipe.

Você recebe vários revendedores. Cada um vem com sinais do painel (dias de casa, clientes criados, último acesso) e as últimas mensagens da conversa (pode não ter conversa).
Para cada um, devolva:
- "categoria": UMA destas chaves: ${Object.keys(CATEGORIAS).join(', ')}.
  nunca_comecou = abriu e não criou nenhum cliente, sem reclamar de nada; nao_conseguiu_vender = tentou e não vendeu / não achou cliente; instabilidade = reclamou de travar, cair, lento, canal fora; dificuldade_tecnica = não conseguiu instalar app, configurar TV, DNS, lista; preco_cobranca = achou caro, mínimo de R$ 35, cobrança, pós-pago; desconfianca = achou golpe, medo de pagar; outro_fornecedor = disse que vai usar/voltou para outro; sem_resposta_nossa = perguntou algo e ninguém respondeu; sumiu_sem_dizer = parou de responder sem motivo claro; desativado_por_nos = a equipe desativou (falta de pagamento, abuso, duplicado, teste); outro = nenhum dos anteriores.
- "motivo": uma frase curta (até 14 palavras) dizendo o motivo real, sem nome e sem telefone.
- "citacao": a frase do próprio revendedor que melhor mostra o motivo, copiada da conversa (até 160 caracteres), ou "" se não houver.
- "pediu_cancelar": true se ele pediu para cancelar/sair/desistir na conversa.
- "evitavel": true se um atendimento melhor provavelmente teria segurado esse revendedor.
- "confianca": de 0 a 1.
Responda SOMENTE com um JSON numa linha: {"itens":[{"ref":"r1","categoria":"...","motivo":"...","citacao":"...","pediu_cancelar":false,"evitavel":true,"confianca":0.7}]}`;

// Quem falou: cliente (não é nosso), robô (texto que o robô mandou, pelo conversas.log) ou senhor (nosso, digitado na mão).
function textosDoRoboNoLog() {
  const s = new Set(); let txt = ''; try { txt = fs.readFileSync(ARQ.log, 'utf8'); } catch {}
  const chave = (t) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, 70).toLowerCase();
  for (const m of txt.matchAll(/\] robô -> [^:]*?: ([^\n]*)/g)) s.add(chave(m[1]));
  return { s, chave };
}
function linhaDe(m, robo, ctx) {
  let corpo = '';
  if (m.type === 'chat' || m.type === 'automated_greeting_message') corpo = String(m.body || '').trim();
  else if (m.type === 'ptt' || m.type === 'audio') corpo = '[áudio]';
  else if (m.type === 'image') corpo = '[foto]' + (m.body ? ' ' + m.body : '');
  else if (m.type === 'video') corpo = '[vídeo]' + (m.body ? ' ' + m.body : '');
  else if (m.type === 'document') corpo = '[arquivo]' + (m.body ? ' ' + m.body : '');
  if (!corpo) return null;
  let quem = 'cliente';
  if (m.fromMe) quem = (m.type === 'automated_greeting_message' || (ctx.textosDoRobo && ctx.textosDoRobo.has(m.body)) || robo.s.has(robo.chave(m.body))) ? 'robô' : 'senhor';
  const d = new Date(m.timestamp * 1000).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  return { quem, t: m.timestamp, txt: `[${d}] ${quem}: ${corpo.replace(/\s+/g, ' ').slice(0, 400)}` };
}

async function acharChat(ctx, alvo, porTel) {
  const id = porTel.get(fim8(alvo.whatsapp));
  if (id) return id;
  if (!alvo.whatsapp) return null;
  try { const r = await ctx.client.getNumberId(String(alvo.whatsapp).replace(/\D/g, '')); return r ? r._serialized : null; } catch { return null; }
}

function haiku(texto) {
  return new Promise((resolve) => {
    if (!fs.existsSync(ARQ.prompt) || fs.readFileSync(ARQ.prompt, 'utf8') !== PROMPT) { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(ARQ.prompt, PROMPT); }
    const args = ['-p', '--model', 'haiku', '--setting-sources', '""', '--system-prompt-file', ARQ.prompt, '--tools', '""',
      '--no-session-persistence', '--strict-mcp-config', '--output-format', 'json'];
    const p = spawn('claude.cmd', args, { cwd: PASTA, shell: true, windowsHide: true });
    let out = ''; const t = setTimeout(() => { p.kill(); resolve(null); }, 120000);
    p.stdout.on('data', (d) => (out += d));
    p.on('close', () => {
      clearTimeout(t);
      const txt = require('../uso-ia.js').desembrulhar(out, 'cancelados', 'haiku');
      const m = txt.match(/\{[\s\S]*\}/); try { resolve(m ? JSON.parse(m[0]) : null); } catch { resolve(null); }
    });
    p.on('error', () => { clearTimeout(t); resolve(null); });
    p.stdin.end(texto);
  });
}

let pedido = null, rodando = false;
function pedir(ctx, c) {
  if (!Array.isArray(c.alvos) || !c.alvos.length) return;
  pedido = { alvos: c.alvos.slice(0, 300), pedido_em: c.pedido_em || new Date().toISOString() };
  gravar(ARQ.estado, { rodando: true, etapa: 'na_fila', feitos: 0, total: pedido.alvos.length, pedido_em: pedido.pedido_em });
  logar(ctx, `cancelados: leitura de ${pedido.alvos.length} painéis pedida pelo Dashboard`);
}

async function tick(ctx) {
  if (!pedido || rodando || !ctx.client) return;
  rodando = true; const p = pedido; pedido = null;
  const t0 = Date.now();
  try {
    const fichas = lerJson(ARQ.clientes, {}), porTel = new Map();
    for (const [id, f] of Object.entries(fichas)) if (f && f.telefone_real) porTel.set(fim8(f.telefone_real), id);
    const robo = textosDoRoboNoLog();
    const conversas = lerJson(ARQ.conversas, {});
    const est = { rodando: true, etapa: 'lendo', feitos: 0, total: p.alvos.length, pedido_em: p.pedido_em, iniciado_em: new Date(t0).toISOString() };
    // 1) Lê o WhatsApp
    for (const a of p.alvos) {
      let linhas = [], chatId = null;
      try {
        chatId = await acharChat(ctx, a, porTel);
        if (chatId) {
          const chat = await ctx.client.getChatById(chatId);
          const ms = await chat.fetchMessages({ limit: 40 }).catch(() => []);
          linhas = ms.filter((m) => HUMANO.includes(m.type)).map((m) => linhaDe(m, robo, ctx)).filter(Boolean);
        }
      } catch {}
      conversas[a.id] = { chat: chatId, nome: a.nome || null, lido_em: new Date().toISOString(), linhas: linhas.map((l) => l.txt), ultima_do_cliente: (linhas.filter((l) => l.quem === 'cliente').pop() || {}).txt || null };
      est.feitos++; if (est.feitos % 5 === 0) gravar(ARQ.estado, est);
      await new Promise((r) => setTimeout(r, 350));   // não pesa no WhatsApp
    }
    gravar(ARQ.conversas, conversas);
    // 2) Haiku diz o motivo, em lotes
    est.etapa = 'analisando'; est.feitos = 0; gravar(ARQ.estado, est);
    const motivos = lerJson(ARQ.motivos, { itens: {} }); motivos.itens = motivos.itens || {};
    for (let i = 0; i < p.alvos.length; i += LOTE) {
      const lote = p.alvos.slice(i, i + LOTE);
      const texto = lote.map((a, k) => {
        const cv = conversas[a.id] || { linhas: [] }, s = a.sinais || {};
        return `### r${k + 1}\nSinais do painel: ${s.dias_de_casa ?? '?'} dias de casa, ${s.clientes_total ?? 0} clientes criados, ${s.testes ?? 0} testes, último acesso ${s.dias_sem_entrar ?? '?'} dias atrás, ${s.creditos ?? '?'} créditos sobrando.\n` +
          (cv.linhas.length ? 'Conversa (mais antiga primeiro):\n' + cv.linhas.slice(-30).join('\n') : 'Sem conversa no WhatsApp.');
      }).join('\n\n');
      const r = await haiku(texto);
      const itens = (r && Array.isArray(r.itens)) ? r.itens : [];
      lote.forEach((a, k) => {
        const it = itens.find((x) => x && x.ref === 'r' + (k + 1));
        if (!it) return;
        const cat = CATEGORIAS[it.categoria] ? it.categoria : 'outro';
        motivos.itens[a.id] = { categoria: cat, motivo: String(it.motivo || '').slice(0, 140), citacao: String(it.citacao || '').slice(0, 200),
          pediu_cancelar: !!it.pediu_cancelar, evitavel: it.evitavel !== false, confianca: Math.max(0, Math.min(1, Number(it.confianca) || 0)),
          tem_conversa: !!((conversas[a.id] || {}).linhas || []).length, analisado_em: new Date().toISOString() };
      });
      est.feitos = Math.min(p.alvos.length, i + LOTE); gravar(ARQ.estado, est);
    }
    motivos.analisado_em = new Date().toISOString(); motivos.levou_s = Math.round((Date.now() - t0) / 1000);
    gravar(ARQ.motivos, motivos);
    gravar(ARQ.estado, { rodando: false, etapa: 'pronto', feitos: p.alvos.length, total: p.alvos.length, pedido_em: p.pedido_em, concluido_em: motivos.analisado_em, levou_s: motivos.levou_s });
    logar(ctx, `cancelados: ${p.alvos.length} painéis lidos e analisados em ${motivos.levou_s} s`);
  } catch (e) {
    gravar(ARQ.estado, { rodando: false, etapa: 'erro', erro: String(e && e.message || e).slice(0, 200), pedido_em: p.pedido_em });
    logar(ctx, 'cancelados falhou - ' + (e && e.message || e));
  } finally { rodando = false; }
}

module.exports = { pedir, tick, CATEGORIAS, ARQ };
