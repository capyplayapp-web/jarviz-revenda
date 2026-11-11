// Biblioteca dos relatórios do robô da revenda (lê do disco a cada chamada; nada fica em cache longo).
// Senhas nunca são lidas para dentro dos relatórios: todo texto passa por redigir().
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
const ENCERRA = /^\s*(ok|okay|blz|beleza|valeu|vlw|obrigad[oa]?|brigad[oa]?|show|certo|top|tmj|entendi|combinado|fechou|perfeito|isso|de nada|tudo bem|tranquilo|bom dia|boa tarde|boa noite|👍|🙏)[\s.!,👍🙏😊]*$/i;  // fim de conversa: o cliente só agradeceu ou concordou

export const AQUI = path.dirname(fileURLToPath(import.meta.url));
export const PASTA = path.resolve(AQUI, '..');
export const ARQ = {
  eventos: path.join(PASTA, 'eventos.jsonl'),
  historico: path.join(PASTA, 'eventos-historico.jsonl'),
  clientes: path.join(PASTA, 'clientes.json'),
  revendedores: path.join(PASTA, 'revendedores.json'),
  quieto: path.join(PASTA, 'quieto.json'),
  log: path.join(PASTA, 'conversas.log'),
  base: path.join(PASTA, 'base.md'),
  aprendizados: path.join(AQUI, 'aprendizados.json'),
  aprendizadosMd: path.join(AQUI, 'aprendizados.md'),
  estadoAprender: path.join(AQUI, 'aprender-estado.json'),
  painelSync: path.join(PASTA, 'painel-sync.json'),
};
export const NOTA_COFRE = 'D:/CAPY/CapyPlay_Obsidian/07 Atendimento WPP/12 Revendedores que fecharam painel.md';
export const FOLLOWUP_MIN = [7, 20, 60, 180];

export const lerJson = (arq, padrao) => { try { return JSON.parse(fs.readFileSync(arq, 'utf8').replace(/^\uFEFF/, '')); } catch { return padrao; } };
export const gravarJson = (arq, obj) => { fs.writeFileSync(arq + '.tmp', JSON.stringify(obj, null, 1)); fs.renameSync(arq + '.tmp', arq); };

// ---------- redação (nunca senha) ----------
export function redigir(t) {
  return String(t == null ? '' : t)
    .replace(/(senha|password|pass)\s*[:=]\s*\S+/gi, '$1: [oculta]')
    .replace(/(senha)\s+(?=\S*\d)\S+/gi, '$1 [oculta]');
}
// Para mandar ao Haiku: além da senha, tira e-mails e números de telefone/usuário de teste soltos.
export function mascarar(t) {
  return redigir(t).replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[e-mail]').replace(/\b(\d{9,})\b/g, '[número]');
}

// ---------- eventos ----------
function lerJsonl(arq) {
  let txt = ''; try { txt = fs.readFileSync(arq, 'utf8'); } catch { return []; }
  const saida = [];
  for (const l of txt.split('\n')) { if (!l) continue; try { const e = JSON.parse(l); if (e && e.t && e.tipo) saida.push(e); } catch {} }
  return saida;
}
// Eventos ao vivo + histórico reconstruído. O histórico só vale antes do primeiro evento ao vivo (sem contar dupla).
export function lerEventos() {
  const vivo = lerJsonl(ARQ.eventos);
  const hist = lerJsonl(ARQ.historico);
  const proprios = vivo.filter((e) => !e.varredura).map((e) => Date.parse(e.t)).filter(Number.isFinite);
  const corte = proprios.length ? Math.min(...proprios) : Infinity;
  const todos = hist.filter((e) => Date.parse(e.t) < corte).concat(vivo);
  return todos.sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
}

// ---------- conversas.log ----------
const RX_LINHA = /^\[(\d{2})\/(\d{2})\/(\d{4}), (\d{2}):(\d{2}):(\d{2})\] ([\s\S]*)$/;
const RX_SISTEMA = /^(conectado ao WhatsApp|robô da revenda LIGADO|estado do WhatsApp|conexão estranha|transcritor|varredura achou|respondendo conversa|QR novo|desconectado|revendedor com painel|painel fechado|painéis sincronizados|contato salvo|servidor de relatórios|gerando teste|follow-up de|senhor devolveu|prompt com|backlog)/;
const RX_ERRO = /^(erro solto|erro grave|erro:|erro ao atender|falha de login|WhatsApp travado|falha no Telegram|follow-up falhou|teste falhou|varredura falhou|envio manual falhou|ficha não salvou|áudio não baixou|transcrição falhou|histórico falhou|getChat falhou|sincronizar painel falhou|contato não salvou|telefone real não)/;

// Lê o log em entradas { t(Date), tipo, nome, chat, texto, ... }. tipo: cliente | robo | senhor | bloqueio | haiku | erro | sistema
export function lerConversas() {
  let txt = ''; try { txt = fs.readFileSync(ARQ.log, 'utf8'); } catch { return []; }
  const brutas = [];
  for (const l of txt.split(/\r?\n/)) {
    const m = l.match(RX_LINHA);
    if (m) brutas.push({ t: new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +m[6]), corpo: m[7] });
    else if (brutas.length) brutas[brutas.length - 1].corpo += '\n' + l;
  }
  const fichas = lerJson(ARQ.clientes, {});
  const porNome = new Map();
  for (const [id, f] of Object.entries(fichas)) if (f.nome) porNome.set(String(f.nome).trim(), id);
  const chatDe = (nome) => porNome.get(String(nome).trim()) || (/^\d{8,}$/.test(String(nome).trim()) && fichas[nome.trim() + '@lid'] ? nome.trim() + '@lid' : null);
  const saida = [], bloq = new Set();   // bloq: o log escreve "robô -> ..." mesmo quando o envio foi barrado por repetição; essa linha não conta
  for (const b of brutas) {
    const c = b.corpo.replace(/\s+$/, '');
    let m;
    if ((m = c.match(/^robô -> ([^\n]*?): ([\s\S]*)$/))) {
      const nome = m[1], chat = /@(lid|c\.us)$/.test(nome) ? nome : chatDe(nome);
      if (chat && bloq.delete(chat + '|' + m[2])) continue;
      saida.push({ t: b.t, tipo: 'robo', nome: chat === nome ? (fichas[chat]?.nome || null) : nome, chat, texto: m[2] });
    } else if ((m = c.match(/^senhor (?:escreveu em|respondeu|devolveu) (\S+?)(?::| )/))) saida.push({ t: b.t, tipo: 'senhor', chat: m[1], nome: fichas[m[1]]?.nome || null, texto: '' });
    else if ((m = c.match(/^texto repetido não enviado a (\S+): ([\s\S]*)$/))) (bloq.add(m[1] + '|' + m[2]), saida.push({ t: b.t, tipo: 'bloqueio', chat: m[1], nome: fichas[m[1]]?.nome || null, texto: m[2] }));
    else if (/^Haiku não respondeu/.test(c)) saida.push({ t: b.t, tipo: 'haiku', texto: c });
    else if (RX_ERRO.test(c)) saida.push({ t: b.t, tipo: 'erro', texto: c.split('\n')[0].slice(0, 300) });
    else if (RX_SISTEMA.test(c)) saida.push({ t: b.t, tipo: 'sistema', texto: c.split('\n')[0] });
    else if ((m = c.match(/^([^\n]*?) \[áudio transcrito\]: ([\s\S]*)$/))) saida.push({ t: b.t, tipo: 'cliente', nome: m[1], chat: chatDe(m[1]), texto: m[2], audio: true });
    else if ((m = c.match(/^([^\n:]+?): ([\s\S]*)$/))) saida.push({ t: b.t, tipo: 'cliente', nome: m[1].trim(), chat: chatDe(m[1]), texto: m[2] });
    else saida.push({ t: b.t, tipo: 'sistema', texto: c.split('\n')[0].slice(0, 200) });
  }
  return saida;
}

// ---------- processos do robô ----------
let _proc = { em: 0, n: 0 };
export function processosBot() {
  return new Promise((ok) => {
    if (Date.now() - _proc.em < 15000) return ok(_proc.n);
    const cmd = "@(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match '\\bbot\\.js' -and $_.CommandLine -notmatch '--check' }).Count";
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { windowsHide: true, timeout: 10000 }, (e, out) => {
      const n = e ? -1 : parseInt(String(out).trim(), 10);
      _proc = { em: Date.now(), n: Number.isFinite(n) ? n : -1 };
      ok(_proc.n);
    });
  });
}

// ---------- resumo (contrato de /api/resumo) ----------
const ROTULO_ETAPA = { primeiro_contato: 'Primeiro contato', explicando: 'Explicando', duvidas: 'Com dúvidas', criando_painel: 'Criando o painel', painel_criado: 'Painel criado', testando: 'Testando', cliente_ativo: 'Cliente ativo', parado: 'Parado', encerrado: 'Encerrado' };
const r1 = (n) => Math.round(n * 10) / 10;
const iso = (d) => new Date(d).toISOString();
const hora2 = (h) => String(h).padStart(2, '0') + 'h';

// 10/11/2026: conversas que já tinham painel antes de `ini` (revendedor tirando dúvida não é lead e distorcia o funil).
export function chatsComPainelAntes(ini, evs, paineis) {
  const s = new Set();
  for (const p of paineis) if (Date.parse(p.quando) < ini) { s.add(p.contato_id); if (p.contato_lid) s.add(p.contato_lid); }
  for (const e of evs) if (e.tipo === 'painel_fechado' && e.chat && Date.parse(e.t) < ini) s.add(e.chat);
  return s;
}

export function lerRevendedoresLista() {
  const rev = lerJson(ARQ.revendedores, {});
  const fichas = lerJson(ARQ.clientes, {});
  const lista = Object.entries(rev).map(([id, r]) => {
    const fechou = r.fechou_em || (r.criado_em && paraIso(r.criado_em)) || null;
    return {
      quando: fechou, nome: r.nome || fichas[id]?.nome || '', telefone: r.telefone || fichas[id]?.telefone_real || '',
      usuario_painel: r.usuario_painel || '', painel_id: r.painel_id ?? null, painel_numero: r.painel_numero ?? null,
      origem: r.origem || 'robo', fonte: r.fonte || 'usuario_senha', contato_salvo: r.contato_salvo || null, contato_id: id,
      contato_lid: r.telefone_lid ? String(r.telefone_lid) + '@lid' : null,
    };
  }).filter((x) => x.quando);
  return lista.sort((a, b) => Date.parse(b.quando) - Date.parse(a.quando));
}
function paraIso(s) { const m = String(s || '').match(/(\d+)\/(\d+)\/(\d+),? (\d+):(\d+):(\d+)/); return m ? new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +m[6]).toISOString() : null; }

export async function resumo({ dias = 1 } = {}) {
  dias = Math.min(Math.max(parseInt(dias, 10) || 1, 1), 31);
  const agora = new Date();
  const ini = new Date(agora); ini.setHours(0, 0, 0, 0); ini.setDate(ini.getDate() - (dias - 1));
  const T = (e) => Date.parse(e.t);
  const todos = lerEventos();
  const ev = todos.filter((e) => T(e) >= ini && T(e) <= agora.getTime() + 60000);
  const por = (tipo) => ev.filter((e) => e.tipo === tipo);
  const fichas = lerJson(ARQ.clientes, {});
  const quieto = lerJson(ARQ.quieto, {});
  const nomeDe = (e) => e.nome || fichas[e.chat]?.nome || '';

  // Painéis fechados (revendedores.json) dentro do período.
  const paineisTodos = lerRevendedoresLista();
  const paineis = paineisTodos.filter((p) => Date.parse(p.quando) >= ini && Date.parse(p.quando) <= agora.getTime() + 60000);

  // Follow-ups
  const fus = por('followup'), resp = por('cliente_respondeu_followup');
  const respondeu = (f) => resp.find((r) => r.chat === f.chat && (r.followup_t === f.t || (r.n === f.n && Date.parse(r.followup_t) === Date.parse(f.t))));
  const fechamentos = todos.filter((e) => e.tipo === 'painel_fechado');
  const porEtapa = FOLLOWUP_MIN.map((min, i) => {
    const n = i + 1, fe = fus.filter((f) => f.n === n), re = fe.filter((f) => respondeu(f));
    // painéis fechados na mesma conversa depois deste follow-up (e antes de outro mais recente)
    let paineisDepois = 0;
    for (const pf of fechamentos) {
      if (T(pf) < ini) continue;
      const antes = todos.filter((e) => e.tipo === 'followup' && e.chat === pf.chat && T(e) < T(pf) && T(pf) - T(e) < 12 * 3600e3).pop();
      if (antes && antes.n === n) paineisDepois++;
    }
    return { n, minutos: fe[0]?.minutos || min, enviados: fe.length, respondidos: re.length, taxa: fe.length ? Math.round(re.length / fe.length * 1000) / 1000 : 0, paineis_depois: paineisDepois };
  });
  const recentes = fus.slice().reverse().slice(0, 40).map((f) => {
    const r = respondeu(f);
    // Situação honesta: "sem resposta" só quando ninguém atendeu e a conversa não terminou.
    const tf = Date.parse(f.t);
    const depois = todos.filter((e) => e.chat === f.chat && T(e) > tf);
    const senhorAtendeu = depois.some((e) => e.tipo === 'senhor_escreveu');
    const cli = depois.filter((e) => e.tipo === 'mensagem_cliente');
    const encerrada = cli.length > 0 && ENCERRA.test(String(cli[cli.length - 1].texto || ''));
    const status = r ? 'respondeu' : senhorAtendeu ? 'atendido_pelo_senhor' : encerrada ? 'encerrada' : 'sem_resposta';
    return { quando: f.t, nome: nomeDe(f), n: f.n, texto: f.texto || '', respondeu: !!r, status, minutos_ate_resposta: r ? r.minutos_ate_resposta ?? null : null };
  });

  // Tempo médio da primeira resposta (mensagem do cliente -> primeira resposta do robô; ignora varredura e esperas > 10 min)
  const pend = new Map(), deltas = [];
  for (const e of todos) {
    if (e.tipo === 'mensagem_cliente') { if (!pend.has(e.chat) && !e.varredura) pend.set(e.chat, T(e)); }
    else if (e.tipo === 'resposta_robo' && pend.has(e.chat)) { const d = (T(e) - pend.get(e.chat)) / 1000; pend.delete(e.chat); if (T(e) >= ini && d >= 0 && d <= 600) deltas.push(d); }
  }
  const tempoMedio = deltas.length ? Math.round(deltas.reduce((a, b) => a + b, 0) / deltas.length) : 0;

  const fe = fus.length, fr = fus.filter((f) => respondeu(f)).length;
  const sync = lerJson(ARQ.painelSync, { criados_sem_avisar: [] });
  const kpis = {
    conversas_novas: por('conversa_nova').length,
    mensagens_recebidas: por('mensagem_cliente').length,
    respostas_robo: por('resposta_robo').length,
    paineis_fechados: paineis.length,
    testes_gerados: por('teste_gerado').length,
    passados_ao_senhor: new Set(por('passou_ao_senhor').map((e) => e.chat)).size,   // conversas distintas (antes contava cada aviso)
    passados_eventos: por('passou_ao_senhor').length,
    followups_enviados: fe,
    followups_respondidos: fr,
    taxa_resposta_followup: fe ? Math.round(fr / fe * 1000) / 1000 : 0,
    tempo_medio_primeira_resposta_s: tempoMedio,
  };

  // Funil (conversas distintas no período)
  // Só leads: quem já tinha painel antes do período fica fora (10/11/2026).
  const jaTinha = chatsComPainelAntes(ini, todos, paineisTodos);
  const chatsContato = new Set(por('mensagem_cliente').map((e) => e.chat).filter((c) => c && !jaTinha.has(c)));
  const roboTxt = (re) => new Set(todos.filter((e) => e.tipo === 'resposta_robo' && chatsContato.has(e.chat) && Date.parse(e.t) <= agora.getTime() + 60000 && re.test(e.texto || '')).map((e) => e.chat));
  const soube = roboTxt(/p[oó]s-?pago|R\$ ?3,50/i), link = roboTxt(/painel\.capyplay\.site\/#\/rs\//i);
  const criou = new Set(paineis.filter((p) => chatsContato.has(p.contato_id) || chatsContato.has(p.contato_lid)).map((p) => p.contato_id));
  const funil = [
    { etapa: 'Entrou em contato', qtd: chatsContato.size },
    { etapa: 'Soube como funciona', qtd: soube.size },
    { etapa: 'Recebeu o link do painel', qtd: link.size },
    { etapa: 'Criou o painel', qtd: criou.size },
  ];

  // Conversas ativas (últimas 24 h)
  const ultimoPor = (tipo, chat) => { let m = 0; for (const e of todos) if (e.tipo === tipo && e.chat === chat) m = Math.max(m, T(e)); return m; };
  const limite = agora.getTime() - 24 * 3600e3;
  const ativas = [];
  for (const [id, f] of Object.entries(fichas)) {
    const ultCli = ultimoPor('mensagem_cliente', id);
    const ult = Math.max(ultCli, Date.parse(f.ultimo_contato) || 0);
    if (ult < limite) continue;
    const fuApos = todos.filter((e) => e.tipo === 'followup' && e.chat === id && T(e) > ultCli).length;
    const q = Number(quieto[id] || 0);
    const pas = ultimoPor('passou_ao_senhor', id), sen = ultimoPor('senhor_escreveu', id);
    const ultCliEv = todos.reduce((m, e) => (e.tipo === 'mensagem_cliente' && e.chat === id && (!m || T(e) > T(m)) ? e : m), null);
    const encerrouDepois = !!(ultCliEv && T(ultCliEv) > pas && ENCERRA.test(String(ultCliEv.texto || '')));
    ativas.push({
      nome: f.nome || '', telefone: f.telefone_real || '', etapa: ROTULO_ETAPA[f.etapa] || f.etapa || 'Sem etapa', etapa_codigo: f.etapa || null,
      ultimo_contato: iso(ult), followups_enviados: fuApos, quieto_ate: q > agora.getTime() ? iso(q) : null,
      precisa_do_senhor: pas > sen && agora.getTime() - pas < 24 * 3600e3 && !encerrouDepois, contato_id: id,
    });
  }
  ativas.sort((a, b) => Date.parse(b.ultimo_contato) - Date.parse(a.ultimo_contato));
  kpis.esperando_o_senhor = ativas.filter((a) => a.precisa_do_senhor).length;

  // Horas do dia (soma do período)
  const horas = Array.from({ length: 24 }, (_, h) => ({ hora: hora2(h), mensagens: 0, respostas: 0 }));
  for (const e of ev) {
    const h = new Date(e.t).getHours();
    if (e.tipo === 'mensagem_cliente') horas[h].mensagens++;
    else if (e.tipo === 'resposta_robo' || e.tipo === 'followup') horas[h].respostas++;
  }

  // Últimas 2 h (última rodada do aprendizado)
  const ap = lerJson(ARQ.aprendizados, { rodadas: [] });
  const ult = (ap.rodadas || []).slice(-1)[0];
  const ultimas_2h = ult
    ? { gerado_em: ult.gerado_em, resumo: ult.resumo || '', funcionou: ult.funcionou || [], deu_errado: ult.deu_errado || [], regras_novas: (ult.regras_novas || []).filter((r) => r.status === 'aprovada').map((r) => r.regra), sugestoes_para_o_senhor: ult.sugestoes_para_o_senhor || [], inconsistencias: (ult.inconsistencias || []).map((x) => ({ titulo: x.titulo, exemplo: x.exemplo, regra: x.regra, tipo: x.tipo, causa: x.causa })), perguntas_nao_cobertas: ult.perguntas_nao_cobertas || [], janela: ult.janela || null }
    : { gerado_em: null, resumo: '', funcionou: [], deu_errado: [], regras_novas: [], sugestoes_para_o_senhor: [], inconsistencias: [], perguntas_nao_cobertas: [], janela: null };

  // Saúde
  const procs = await processosBot();
  const vivos = todos.filter((e) => !e.origem || e.origem !== 'historico');
  const sistema = lerConversas().filter((c) => c.tipo === 'sistema' && /LIGADO|desconectado/.test(c.texto)).pop();
  const saude = {
    robo_ligado: procs >= 1, processos_bot: procs < 0 ? null : procs,
    ultimo_evento: todos.length ? todos[todos.length - 1].t : null,
    repeticoes_bloqueadas: por('repeticao_bloqueada').length, erros: por('erro').length,
    ultimo_ligado: sistema ? iso(sistema.t) : null,
  };

  return {
    gerado_em: iso(agora), periodo: { inicio: iso(ini), fim: iso(agora) }, kpis,
    followups: { por_etapa: porEtapa, recentes }, funil,
    paineis: paineis.map((p) => ({ quando: p.quando, nome: p.nome, telefone: p.telefone, usuario_painel: p.usuario_painel, painel_id: p.painel_id, painel_numero: p.painel_numero, origem: p.origem, contato_salvo: p.contato_salvo })),
    conversas_ativas: ativas.slice(0, 60), ultimas_2h, horas, saude,
    paineis_criados_sem_avisar: (sync.criados_sem_avisar || []).length,
  };
}

// ---------- nota do cofre (revendedores) ----------
export function escreverNota() {
  const lista = lerRevendedoresLista();
  const dt = (q) => { const d = new Date(q); return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); };
  const esc = (s) => String(s ?? '').replace(/\|/g, '/').replace(/\n/g, ' ');
  const linhas = lista.map((p, i) => `| ${lista.length - i} | ${esc(p.nome)} | ${esc(p.telefone || 'a confirmar')} | ${esc(p.usuario_painel || 'a confirmar')} | ${p.painel_numero ?? 'a confirmar'} | ${esc(p.painel_id || 'a confirmar')} | ${dt(p.quando)} | ${p.origem === 'senhor' ? 'senhor' : 'robô'} |`);
  const agora = new Date();
  const md = `---
tipo: registro
atualizado: ${agora.toISOString().slice(0, 10)}
status: gerado sozinho pelo servidor de relatórios do robô da revenda (não editar à mão)
---
# Revendedores que fecharam painel
[[07 Atendimento WPP/00 Início - Atendimento WPP|← Atendimento WPP]]

Quem criou o painel depois de falar com o robô da revenda (11 97052-1624): mandou "Usuário/Senha" do painel que criou, ou o robô marcou a etapa "painel criado". **Senhas nunca são guardadas aqui.**

- Total: **${lista.length}** · atualizado em ${dt(agora)}.
- "Painel (n.º)" = ordem de criação na lista de revendedores do painel (1 = o mais antigo). "Painel (id)" = identificador do revendedor no painel (o painel não usa número simples).
- O contato no WhatsApp da revenda é salvo como "Nome · painel N".
- Painel de relatórios (só no PC): http://127.0.0.1:8811/

| # | Nome | WhatsApp | Usuário no painel | Painel (n.º) | Painel (id) | Fechou em | Quem fechou |
|---|---|---|---|---|---|---|---|
${linhas.join('\n') || '| | | | | | | | |'}
`;
  const antigo = (() => { try { return fs.readFileSync(NOTA_COFRE, 'utf8'); } catch { return ''; } })();
  const semData = (t) => t.replace(/atualizado: .*\n/, '').replace(/atualizado em [^\n]*\./, '');
  if (semData(antigo) === semData(md)) return { escrita: false, total: lista.length };
  try { fs.mkdirSync(path.dirname(NOTA_COFRE), { recursive: true }); fs.writeFileSync(NOTA_COFRE, md); return { escrita: true, total: lista.length }; }
  catch (e) { return { escrita: false, total: lista.length, erro: e.message }; }
}
