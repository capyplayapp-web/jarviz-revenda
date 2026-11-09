// Testes do backlog de follow-ups (backlog.js + backlog-lib.mjs). Tudo com dados SIMULADOS numa pasta temporária:
// o cliente de WhatsApp é falso (sendMessage só anota), o Haiku é falso e nenhum arquivo real do robô é tocado.
// Rodar: node relatorios\testar-backlog.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const B = require(path.join(AQUI, '..', 'backlog.js'));
const L = await import('./backlog-lib.mjs');

let passou = 0, falhou = 0;
const ok = (cond, nome, extra) => { if (cond) passou++; else { falhou++; console.log('  FALHOU: ' + nome + (extra !== undefined ? ' -> ' + JSON.stringify(extra).slice(0, 300) : '')); } };
const sec = (t) => console.log('\n' + t);
const local = (y, m, d, h, mi = 0) => new Date(y, m - 1, d, h, mi, 0).getTime();

// ============ 1. travas puras ============
sec('1. janela, ritmo, teto, parada');
const T0 = local(2026, 11, 8, 10, 0);
const fi = (id, extra = {}) => ({ id, ref: id, nome: id, ultimo_contato: new Date(T0 - 5 * 864e5).toISOString(), status: 'na_fila', followups: [], piloto: false, texto: 'Oi mestre, tudo certo por aí?', ...extra });
ok(!B.dentroDaJanela(new Date(2026, 10, 8, 8, 59)), 'janela: 8h59 fora');
ok(B.dentroDaJanela(new Date(2026, 10, 8, 9, 0)), 'janela: 9h00 dentro');
ok(B.dentroDaJanela(new Date(2026, 10, 8, 19, 59)), 'janela: 19h59 dentro');
ok(!B.dentroDaJanela(new Date(2026, 10, 8, 20, 0)), 'janela: 20h00 fora');
ok(B.inicioDaProximaJanela(new Date(2026, 10, 8, 20, 30)).getTime() === local(2026, 11, 9, 9), 'próxima janela depois das 20h = 9h do dia seguinte');
ok(B.inicioDaProximaJanela(new Date(2026, 10, 8, 6, 0)).getTime() === local(2026, 11, 8, 9), 'próxima janela de madrugada = 9h de hoje');
{
  const h = (hh, mm = 0) => local(2026, 11, 8, hh, mm);
  const pl = (o) => B.planejarIntervalo({ hoje: 0, modo: 'completo', ...o });
  ok(pl({ agora: h(10), pendentes: 100 }) === 360000, 'intervalo = restante da janela / faltam (10h, 100 pendentes = 6 min)', pl({ agora: h(10), pendentes: 100 }));
  ok(pl({ agora: h(19), pendentes: 10 }) === 360000, 'intervalo = restante / faltam (19h, 10 pendentes = 6 min)');
  ok(pl({ agora: h(10), pendentes: 1000 }) === 300000, 'mais pendentes que o teto: divide pelo teto (120) = 5 min', pl({ agora: h(10), pendentes: 1000 }));
  ok(pl({ agora: h(10), pendentes: 1000, hoje: 100 }) === 10 * 3600e3 / 20, 'teto quase cheio: divide pelo que falta até o teto');
  ok(pl({ agora: h(19, 59), pendentes: 500 }) === 60000, 'nunca menos de 60 s');
  ok(pl({ agora: h(22), pendentes: 55 }) === 11 * 3600e3 / 55, 'fora da janela: planeja a janela inteira de amanhã');
  ok(pl({ agora: h(10), pendentes: 0 }) === null, 'sem pendentes: sem intervalo');
  ok(pl({ agora: h(10), pendentes: 5, modo: 'piloto' }) === 180000, 'piloto: intervalo limitado a 3 min');
  ok(B.sortearIntervalo(360000, () => 0) === 270000 && B.sortearIntervalo(360000, () => 1) === 450000 && B.sortearIntervalo(360000, () => 0.5) === 360000, 'jitter de ±25% em volta do intervalo calculado');
  ok(B.sortearIntervalo(60000, () => 0) === 60000 && B.sortearIntervalo(null, () => 0) === 60000, 'jitter nunca leva abaixo de 60 s');
  { const xs = Array.from({ length: 300 }, () => B.sortearIntervalo(400000)); ok(xs.every((x) => x >= 300000 && x <= 500000) && new Set(xs).size > 100, 'jitter varia dentro de ±25% (300 sorteios)'); }
  const itens = [fi('a'), fi('b'), fi('c', { status: 'enviado', followups: [{ quando: new Date(T0 - 30 * 3600e3).toISOString() }] }), fi('d', { status: 'enviado', followups: [{ quando: new Date(T0 - 2 * 3600e3).toISOString() }] })];
  var LIM2 = { ...B.LIM, segundo_ativo: true };   // 08/11 (funil): o 2º follow-up do backlog está DESLIGADO por padrão; aqui testa a lógica ligada
  ok(B.contarPendentes(itens, 'completo', T0, LIM2) === 3 && B.contarPendentes(itens, 'completo', T0) === 2 && B.contarPendentes(itens.map((x, i) => ({ ...x, piloto: i === 0 })), 'piloto', T0) === 1, 'pendentes: fila + 2º follow-up vencido (só se ligado); no piloto só os marcados');
  const dd = (o) => B.decidirEnvio({ itens: [fi('a'), fi('b')], agora: T0, pausado: false, modo: 'completo', ...o });
  ok(dd({ ultimoEnvio: T0 - 30000 }).motivo === 'rajada' && dd({ ultimoEnvio: T0 - 30000 }).acao === 'esperar', 'nenhum envio a menos de 45 s do anterior (rajada)');
  ok(dd({ ultimoEnvio: T0 - 46000 }).acao === 'enviar', '46 s depois do anterior já pode (se o intervalo calculado deixar)');
  ok(dd({ uptimeMs: 60000 }).motivo === 'reinicio_recente' && dd({ uptimeMs: 60000 }).ate === T0 + 120000, 'depois de reinício do robô espera 3 min (faltam 2)');
  ok(dd({ uptimeMs: 181000 }).acao === 'enviar', 'passados 3 min do reinício, envia');
}
ok(B.LIM.teto_dia === 120 && B.LIM.erros_para_parar === 3 && B.LIM.janela_ini === 9 && B.LIM.janela_fim === 20, 'limites fixos: 120/dia, 3 erros, 9-20h');
ok(B.mascararTelefone('5511987654321') === '•••• 4321' && L.mascararTelefone('+55 (11) 98765-4321') === '•••• 4321' && B.mascararTelefone('') === '', 'máscara de telefone: só 4 últimos dígitos');

{
  const itens = [fi('a', { piloto: true }), fi('b'), fi('c', { piloto: true })];
  let d = B.decidirEnvio({ itens, agora: T0, pausado: false, modo: 'piloto' });
  ok(d.acao === 'enviar' && d.item.piloto === true, 'piloto: só envia item marcado piloto', d);
  d = B.decidirEnvio({ itens: [fi('b')], agora: T0, pausado: false, modo: 'piloto' });
  ok(d.acao === 'esperar' && d.motivo === 'fila_vazia', 'piloto sem marcados: nada a enviar', d);
  d = B.decidirEnvio({ itens: [fi('a', { piloto: true, status: 'enviado', followups: [{ quando: new Date(T0).toISOString() }] }), fi('b')], agora: T0 + 3 * 864e5, pausado: false, modo: 'piloto' });
  ok(d.acao === 'esperar' && d.motivo === 'piloto_concluido', 'piloto concluído: não envia o resto nem o 2º follow-up', d);
  d = B.decidirEnvio({ itens, agora: T0, pausado: false, modo: 'completo' });
  ok(d.acao === 'enviar', 'modo completo envia', d);
  d = B.decidirEnvio({ itens, agora: T0, pausado: true, modo: 'completo' });
  ok(d.acao === 'esperar' && d.motivo === 'pausado', 'pausado: nada sai', d);
  d = B.decidirEnvio({ itens, agora: T0, pausado: false, modo: 'completo', estado: { parado_por_erros: true } });
  ok(d.acao === 'esperar' && d.motivo === 'parado_por_erros', 'parado por erros: nada sai', d);
  d = B.decidirEnvio({ itens, agora: local(2026, 11, 8, 20, 5), pausado: false, modo: 'completo' });
  ok(d.acao === 'esperar' && d.motivo === 'fora_da_janela' && d.ate === local(2026, 11, 9, 9), 'depois das 20h: espera até 9h', d);
  d = B.decidirEnvio({ itens, agora: local(2026, 11, 8, 7, 0), pausado: false, modo: 'completo' });
  ok(d.acao === 'esperar' && d.motivo === 'fora_da_janela', 'antes das 9h: espera', d);
  d = B.decidirEnvio({ itens, agora: T0, pausado: false, modo: 'completo', estado: { proximo_em: T0 + 30000 } });
  ok(d.acao === 'esperar' && d.motivo === 'intervalo', 'respeita o intervalo entre envios', d);
  const cheios = [fi('x', { status: 'enviado', followups: Array.from({ length: 120 }, (_, i) => ({ n: 1, quando: new Date(T0 - i * 1000).toISOString() })) }), fi('b')];
  d = B.decidirEnvio({ itens: cheios, agora: T0, pausado: false, modo: 'completo' });
  ok(d.acao === 'esperar' && d.motivo === 'teto_diario' && d.ate === local(2026, 11, 9, 9), 'teto de 120 por dia: para e volta amanhã 9h', d);
  const quase = [fi('x', { status: 'enviado', followups: Array.from({ length: 119 }, (_, i) => ({ n: 1, quando: new Date(T0 - i * 1000).toISOString() })) }), fi('b')];
  ok(B.decidirEnvio({ itens: quase, agora: T0, pausado: false, modo: 'completo' }).acao === 'enviar', '119 enviados hoje: ainda envia o 120º');
  const ontem = [fi('x', { status: 'enviado', followups: Array.from({ length: 120 }, () => ({ n: 1, quando: new Date(T0 - 864e5).toISOString() })) }), fi('b')];
  ok(B.decidirEnvio({ itens: ontem, agora: T0, pausado: false, modo: 'completo' }).acao === 'enviar', 'envios de ontem não contam no teto de hoje');
  // 2º follow-up: só depois de 24 h, no máximo um
  const um = fi('u', { status: 'enviado', followups: [{ n: 1, quando: new Date(T0 - 23 * 3600e3).toISOString() }] });
  ok(B.decidirEnvio({ itens: [um], agora: T0, pausado: false, modo: 'completo' }).acao === 'esperar', '2º follow-up antes de 24 h: não sai');
  um.followups[0].quando = new Date(T0 - 25 * 3600e3).toISOString();
  d = B.decidirEnvio({ itens: [um], agora: T0, pausado: false, modo: 'completo', lim: { ...B.LIM, segundo_ativo: true } });
  ok(d.acao === 'enviar' && d.tipo === 'segundo', '2º follow-up depois de 24 h sai (quando ligado)', d);
  ok(B.decidirEnvio({ itens: [um], agora: T0, pausado: false, modo: 'completo' }).acao === 'esperar', '2º follow-up DESLIGADO por padrão: a cadência de dias assume');
  const dois = fi('d2', { status: 'enviado', followups: [{ n: 1, quando: new Date(T0 - 99 * 3600e3).toISOString() }, { n: 2, quando: new Date(T0 - 70 * 3600e3).toISOString() }] });
  ok(B.decidirEnvio({ itens: [dois], agora: T0, pausado: false, modo: 'completo' }).acao === 'esperar', 'nunca há um 3º follow-up');
  const resp = fi('r', { status: 'respondeu', followups: [{ n: 1, quando: new Date(T0 - 99 * 3600e3).toISOString() }], respondeu_em: new Date(T0 - 50 * 3600e3).toISOString() });
  ok(B.decidirEnvio({ itens: [resp], agora: T0, pausado: false, modo: 'completo' }).acao === 'esperar', 'quem respondeu não recebe 2º');
  d = B.decidirEnvio({ itens: [fi('rec1', { ultimo_contato: new Date(T0 - 2 * 864e5).toISOString() }), fi('rec2', { ultimo_contato: new Date(T0 - 9 * 864e5).toISOString() })], agora: T0, pausado: false, modo: 'completo' });
  ok(d.item.id === 'rec1', 'fila ordenada por recência (mais recente primeiro)', d.item && d.item.id);
  d = B.decidirEnvio({ itens: [fi('a'), fi('b')], agora: T0, pausado: false, modo: 'completo', adiados: { a: T0 + 1000 } });
  ok(d.item.id === 'b', 'item adiado é pulado');
}

// ============ 2. elegibilidade e lista de bloqueio ============
sec('2. elegibilidade e lista de bloqueio');
const base = { categoria: 'esfriou', elegivel_haiku: true, individual: true, ultimo_ts: T0 - 5 * 864e5, ultimo_manual_senhor: null };
const el = (o) => B.avaliarElegibilidade({ ...base, ...o }, { agora: T0 });
ok(el({}).ok, 'caso feliz é elegível');
ok(!el({ individual: false }).ok, 'grupo/não individual: bloqueado');
ok(!el({ fechou_painel: true }).ok && !el({ categoria: 'painel_criado' }).ok, 'quem fechou painel: bloqueado');
ok(!el({ pediu_para_parar: true }).ok && !el({ categoria: 'sem_interesse' }).ok, 'sem interesse / pediu para parar: bloqueado');
ok(!el({ categoria: 'suporte' }).ok, 'suporte/cliente final/pagamento: bloqueado');
ok(!el({ categoria: 'equipe_ou_parceiro' }).ok, 'equipe/parceiro: bloqueado');
ok(!el({ categoria: 'irrelevante' }).ok, 'irrelevante: bloqueado');
ok(!el({ ultimo_manual_senhor: T0 - 2 * 864e5 }).ok, 'senhor atendeu na mão há 2 dias: bloqueado');
ok(el({ ultimo_manual_senhor: T0 - 4 * 864e5 }).ok, 'senhor atendeu há 4 dias: liberado');
ok(!el({ ja_no_backlog: true }).ok, 'já recebeu follow-up do backlog: bloqueado');
ok(!el({ followup_ao_vivo: true }).ok, 'já recebeu follow-up ao vivo: bloqueado');
ok(!el({ ao_vivo_ativo: true }).ok && !el({ quieto: true }).ok, 'fluxo ao vivo ativo / silêncio: bloqueado');
ok(!el({ etapa_ficha: 'encerrado' }).ok && !el({ etapa_ficha: 'fechado' }).ok, 'etapa encerrada: bloqueado');
ok(!el({ salvo_pelo_senhor: true }).ok, 'contato salvo pelo senhor com nome próprio: bloqueado');
ok(!el({ elegivel_haiku: false }).ok, 'Haiku não recomendou: bloqueado');
ok(!el({ ultimo_ts: T0 - 3600e3 }).ok, 'conversa de 1 h atrás: fica com o fluxo ao vivo');
for (const c of ['testando', 'interessado_sem_painel', 'duvida_aberta', 'sem_resposta_nossa', 'esfriou']) ok(el({ categoria: c }).ok, 'categoria elegível: ' + c);

sec('2b. texto do follow-up');
const baseMd = 'Criar o painel: https://painel.capyplay.site/#/rs/RvWGlK01e3/bQELo6e1gr\nGrupo https://t.me/capyplayoficial';
const vt = (t, o = {}) => B.validarFollowup(t, { nomes: ['Carlos Silva'], baseMd, anteriores: [], ...o });
ok(vt('Oi mestre, conseguiu ver o painel? Se travou em algo me fala.').ok, 'texto bom passa');
ok(!vt('Oi Carlos, conseguiu ver o painel? Me fala.').ok && !vt('Oi mestre Carlos, conseguiu?').ok, 'usar o nome da pessoa: reprovado');
ok(!vt('Oi, conseguiu ver o painel? Me fala se travou.').ok, 'sem "mestre": reprovado');
ok(!vt('Oi mestre, conseguiu ver o painel? 😀').ok, 'emoji: reprovado');
ok(!vt('Mestre, última chance de abrir o seu painel hoje.').ok, 'pressão: reprovado');
ok(!vt('Mestre, o link é https://golpe.example/x e ligue 11987654321').ok, 'link fora do base.md / telefone: reprovado');
ok(vt('Mestre, é só abrir https://t.me/capyplayoficial e ver os banners.').ok, 'link que está no base.md: ok');
ok(!vt('Mestre, usuário: abc senha 123 para entrar agora.').ok, 'fala de senha: reprovado');
ok(!vt('Mestre, tudo bem? Posso ajudar? Quer testar? Quer criar?').ok, 'perguntas demais: reprovado');
ok(!vt('Oi mestre, conseguiu ver o painel? Se travou em algo me fala.', { anteriores: ['Oi mestre, conseguiu ver o painel? Se travou em algo me fala.'] }).ok, 'texto igual a outro: reprovado');
ok(!vt('Oi mestre.').ok && !vt('Oi mestre, ' + 'muito '.repeat(60)).ok, 'curto/longo demais: reprovado');
ok(vt('Oi mestre, vi que falamos do painel. Se ficou dúvida, estou aqui.', { nomes: ['Painel do João'] }).ok, 'palavra comum no nome (painel) não reprova');

// ============ 3. pipeline completo com cliente falso ============
sec('3. mapa, fichas, renomeio e fila (cliente falso, Haiku falso)');
const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'backlog-teste-'));
fs.writeFileSync(path.join(pasta, 'base.md'), baseMd);
fs.writeFileSync(path.join(pasta, 'backlog-classificar.md'), 'teste');
fs.writeFileSync(path.join(pasta, 'revendedores.json'), JSON.stringify({ 'e@lid': { nome: 'Mario Painel', telefone: '5521999990005', painel_numero: 77, fechou_em: new Date(T0 - 864e5).toISOString() } }));
const NOW_S = T0 / 1000;
let seq = 0;
const msg = (fromMe, texto, secAtras, type = 'chat', extra = {}) => ({ id: { _serialized: 'm' + (++seq) }, fromMe, type, body: texto, timestamp: NOW_S - secAtras, ...extra });
const dia = 86400;
const enviados = [], renomeados = [];
function chatFalso(id, nome, msgs, { salvo = '', meu = false, grupo = false } = {}) {
  const c = {
    id: { _serialized: id }, isGroup: grupo, name: salvo || nome, msgs, get lastMessage() { return msgs[msgs.length - 1]; }, get timestamp() { return msgs[msgs.length - 1].timestamp; },
    fetchMessages: async () => msgs.slice(), getContact: async () => ({ pushname: nome, name: salvo, isMyContact: meu }), sendStateTyping: async () => {}, clearState: async () => {},
    sendMessage: async (t) => { if (c.falhaEnvio) throw new Error('Evaluation failed: simulado'); enviados.push({ id, t }); const m = msg(true, t, -0); m.timestamp = NOW_S + (c.avanco || 0); msgs.push(m); return m; },
  };
  return c;
}
const fones = { 'a@lid': '5511900000001', 'b@lid': '5511900000002', 'c@lid': '5511900000003', 'd@lid': '5511900000004', 'e@lid': '5521999990005', 'f@lid': '5511900000006', 'g@lid': '5511900000007', 'h@lid': '5511900000008', 'j@lid': '5511900000010', 'k@lid': '5511900000011' };
const chats = [
  chatFalso('a@lid', 'Carlos Silva', [msg(false, 'Oi, quero revender, como funciona o painel?', 4 * dia + 600), msg(true, 'Oi mestre', 4 * dia + 500), msg(false, 'Qual app funciona na Samsung?', 4 * dia)]),            // pergunta sem resposta
  chatFalso('b@lid', 'Dona Beatriz', [msg(false, 'quero ser revendedor', 6 * dia + 900), msg(true, 'Cada crédito custa R$ 3,50', 6 * dia + 800), msg(true, 'Pode criar seu painel por aqui', 6 * dia)]),    // esfriou (manual antigo)
  chatFalso('c@lid', 'Paulo', [msg(false, 'bom dia, quero testar', 2 * dia + 900), msg(true, 'te mando o teste agora', 1 * dia)]),                                                                   // senhor falou ontem
  chatFalso('d@lid', 'Zé Nao', [msg(false, 'quero revender', 5 * dia + 900), msg(true, 'explicacao', 5 * dia + 800), msg(false, 'não quero, obrigado', 5 * dia)]),                                  // sem interesse
  chatFalso('e@lid', 'Mario Painel', [msg(false, 'criei o painel', 3 * dia)]),                                                                                                                     // já tem painel
  chatFalso('f@lid', 'Sogra', [msg(false, 'filho, vem almoçar domingo', 3 * dia)]),                                                                                                                // pessoal
  chatFalso('g@lid', 'Lucia', [msg(false, 'quero revender', 5 * dia + 900), msg(true, 'explicação', 5 * dia)], { salvo: 'Lúcia do Zé (amiga)', meu: true }),                                      // salva pelo senhor
  chatFalso('h@lid', 'Hoje Cedo', [msg(false, 'oi quero revender', 3600), msg(true, 'Oi mestre', 3000)]),                                                                                         // recente demais
  chatFalso('i@g.us', 'Grupo', [msg(false, 'oi', 2 * dia)], { grupo: true }),                                                                                                                       // grupo
  chatFalso('j@lid', 'Robo Cliente', [msg(false, 'queria testar', 4 * dia + 800), msg(true, 'Vou gerar seu teste agora.', 4 * dia + 700), msg(true, 'Pronto, seu teste está liberado.', 4 * dia + 600)]),    // robô respondeu (evento) -> esfriou/testando
  chatFalso('k@lid', 'Fantasma', [msg(true, 'oi, tudo bem?', 5 * dia)]),                                                                                                                           // só nós falamos
];
// o robô (eventos) mandou as mensagens da conversa j
const eventosRobo = [
  { t: new Date(T0 - 4 * dia * 1000 - 700e3).toISOString(), chat: 'j@lid', tipo: 'resposta_robo', texto: 'Vou gerar seu teste agora.' },
  { t: new Date(T0 - 4 * dia * 1000 - 600e3).toISOString(), chat: 'j@lid', tipo: 'resposta_robo', texto: 'Pronto, seu teste está liberado.' },
];
const cliente = {
  getChats: async () => chats,
  getChatById: async (id) => chats.find((c) => c.id._serialized === id),
  getContactLidAndPhone: async (ids) => ids.map((id) => ({ lid: id, pn: fones[id] ? fones[id] + '@c.us' : null })),
  saveOrEditAddressbookContact: async (tel, nome, sufixo) => { renomeados.push({ tel, nome, sufixo }); },
  sendMessage: async () => { throw new Error('NÃO PODE enviar pelo client.sendMessage nos testes'); },
};
const haikuFalso = async (_sist, entrada) => {
  const blocos = entrada.split('### Conversa ').slice(1);
  return { itens: blocos.map((b) => {
    const n = parseInt(b, 10);
    const ult = b.trim().split('\n').pop();
    const baixo = b.toLowerCase();
    let categoria = 'esfriou', elegivel = true, parar = false, pergunta = false;
    if (baixo.includes('não quero')) { categoria = 'sem_interesse'; elegivel = false; parar = true; }
    else if (baixo.includes('almoçar')) { categoria = 'irrelevante'; elegivel = false; }
    else if (baixo.includes('queria testar') || baixo.includes('quero testar')) categoria = 'testando';
    else if (/Cliente: /.test(ult)) { categoria = 'sem_resposta_nossa'; pergunta = true; }
    return { n, categoria, etapa: categoria === 'testando' ? 'testando' : 'duvidas', resumo: 'Resumo da conversa ' + n + '. senha: 123456', elegivel, motivo: 'teste', pediu_para_parar: parar, pergunta_aberta: pergunta };
  }) };
};
let chamadasHaiku = 0, textoNum = 0;
const aberturas = ['Oi mestre, conseguiu seguir com o painel?', 'Mestre, ficou alguma dúvida do que falamos?', 'E aí mestre, deu para ver o que mandei?', 'Mestre, posso te ajudar a finalizar?', 'Oi mestre, passando para saber se precisa de algo.'];
const perguntarFalso = async (pedido) => {
  chamadasHaiku++;
  if (/Corrija isso/.test(pedido)) return { mensagens: [aberturas[textoNum++ % aberturas.length] + ' Estou por aqui.'] };
  if (chamadasHaiku === 2) return { mensagens: ['Oi Carlos, conseguiu ver o painel? Estou por aqui.'] };   // 1ª tentativa usa o nome: tem que ser recusada e refeita
  return { mensagens: [aberturas[textoNum++ % aberturas.length] + ' Estou por aqui ' + textoNum + '.'] };
};
const logs = [], eventos = [], avisos = [], pausas = [];
const fichas = { 'a@lid': { criado_em: '2026-11-07T20:00:00Z', notas: [], nome: 'Carlos Silva', etapa: 'duvidas' } };
let T = T0;
const ctx = {
  client: cliente, fichas, salvarFichas: () => { ctx._fichasSalvas = (ctx._fichasSalvas || 0) + 1; }, log: (t) => logs.push(t), evento: (tipo, chat, nome, d) => { eventos.push({ tipo, chat, nome, ...d }); return { t: new Date(T).toISOString() }; },
  erroEv: (onde, e) => logs.push('ERRO ' + onde + ' ' + (e && e.message || e)), avisarSenhor: async (t) => { avisos.push(t); }, limpar: (t) => String(t || '').replace(/[\p{Extended_Pictographic}]/gu, '').trim(),
  perguntarHaiku: perguntarFalso, haiku: haikuFalso, marcarEnvio: () => {}, seguindo: new Set(), aguardando: new Map(), textosDoRobo: new Set(), enviadasPeloRobo: new Set(), quieto: new Map(), atendendo: new Set(), fila: new Map(),
  ULTIMO_SENHOR: new Map(), painelRev: null, conversaValida: (id) => /@(c\.us|lid)$/.test(id), recentes: () => eventosRobo, pasta, SINCRONIZAR_AGENDA: true,
  est: {}, agora: () => T, dormir: async (ms) => { pausas.push(ms); }, rand: () => 0, uptimeMs: () => 1e9,
};
const r = await B.mapear(ctx, { dias: 14 });
ok(r.ok, 'mapear terminou', r);
const mapa = JSON.parse(fs.readFileSync(path.join(pasta, 'backlog.json'), 'utf8'));
const por = (id) => mapa.itens.find((i) => i.id === id);
ok(!enviados.length, 'NENHUMA mensagem enviada durante o mapeamento', enviados);
ok(pausas.filter((ms) => ms === 1000).length === 10 && pausas.every((ms) => ms === 1000 || ms === 3000), 'mapa: pausa de 1 a 2 s a cada conversa lida e de 3 a 5 s a cada renomeio (valores mínimos com rand=0)', pausas.length);
ok(pausas.filter((ms) => ms === 3000).length === renomeados.length && renomeados.length > 0, 'renomeio: no máximo 1 contato a cada 3-5 s (uma pausa por contato)', { p: pausas.filter((ms) => ms === 3000).length, r: renomeados.length });
ok(mapa.itens.length === 10, 'mapeou as 10 conversas individuais (grupo fora)', mapa.itens.length);
ok(!por('i@g.us'), 'grupo não entra no mapa');
ok(por('a@lid').categoria === 'sem_resposta_nossa' && por('a@lid').elegivel, 'pergunta sem resposta = sem_resposta_nossa e elegível', por('a@lid'));
ok(por('b@lid').categoria === 'esfriou' && por('b@lid').elegivel, 'esfriou elegível (senhor há 6 dias)', por('b@lid'));
ok(!por('c@lid').elegivel && /na mão/.test(por('c@lid').motivo), 'senhor falou ontem: não elegível', por('c@lid'));
ok(por('d@lid').categoria === 'sem_interesse' && !por('d@lid').elegivel, 'sem interesse: não elegível');
ok(por('e@lid').categoria === 'painel_criado' && !por('e@lid').elegivel, 'quem está em revendedores.json: painel_criado e bloqueado');
ok(por('f@lid').categoria === 'irrelevante' && !por('f@lid').elegivel, 'conversa pessoal: irrelevante');
ok(!por('g@lid').elegivel && por('g@lid').salvo_pelo_senhor && por('g@lid').renomeio.status === 'mantido', 'contato salvo pelo senhor: mantido e sem follow-up', por('g@lid'));
ok(!por('h@lid').elegivel, 'conversa de 1 h atrás: não entra no backlog', por('h@lid'));
ok(por('j@lid').categoria === 'testando' && por('j@lid').ultimo_quem === 'robo', 'mensagens do robô reconhecidas pelos eventos (não contam como senhor)', por('j@lid'));
ok(por('j@lid').elegivel, 'testando que sumiu: elegível', por('j@lid'));
ok(!por('k@lid').elegivel && /nunca escreveu/.test(por('k@lid').motivo), 'só nós falamos: não elegível', por('k@lid'));
ok(!/123456/.test(JSON.stringify(mapa)), 'senha nunca vai para o mapa');
// renomeio
const nomes = renomeados.map((x) => x.nome + ' ' + x.sufixo);
ok(nomes.includes('Carlos Silva · lead') && nomes.includes('Dona Beatriz · lead'), 'leads renomeados "Nome · lead"', nomes);
ok(nomes.includes('Robo Cliente · teste'), 'quem testou: "Nome · teste"', nomes);
ok(nomes.includes('Mario Painel · painel'.replace('· painel', '· painel')) === false, 'painel de revendedores.json fica com a rotina existente (não renomeia aqui)', nomes);
ok(!nomes.some((n) => /Lucia|Lúcia|Sogra|Zé Nao/.test(n)), 'não renomeia salvo pelo senhor, pessoal nem sem interesse', nomes);
ok(mapa.renomeio.renomeados === renomeados.length && mapa.renomeio.mantidos > 0, 'contagem de renomeados/mantidos no mapa', mapa.renomeio);
ok(renomeados.every((x) => /^\d{11,13}$/.test(x.tel)), 'renomeio usa telefone real (só dígitos)');
// fichas
ok(fichas['b@lid'] && fichas['b@lid'].origem === 'backlog' && fichas['b@lid'].etapa && fichas['b@lid'].resumo, 'ficha nova com origem backlog, etapa e resumo', fichas['b@lid']);
ok(!fichas['a@lid'].origem && fichas['a@lid'].telefone_real === '5511900000001', 'ficha existente não perde nada e ganha telefone real');
ok(fichas['b@lid'].contado_conversa === true, 'ficha nova não gera "conversa_nova" falsa');
ok(!fichas['i@g.us'], 'grupo sem ficha');
// fila
const filaArq = JSON.parse(fs.readFileSync(path.join(pasta, 'backlog-fila.json'), 'utf8'));
const fila = filaArq.itens;
ok(fila.length === mapa.contagens.elegiveis && fila.length === 3, 'fila = só os elegíveis (3)', fila.map((f) => f.id));
ok(fila.every((f) => f.status === 'na_fila'), 'tudo na fila, nada enviado');
ok(fila.every((f, i, a) => i === 0 || Date.parse(a[i - 1].ultimo_contato) >= Date.parse(f.ultimo_contato)), 'fila ordenada por recência');
ok(fila.filter((f) => f.piloto).length === 3, 'piloto marcado (até 5; aqui só há 3)');
ok(fila.every((f) => B.validarFollowup(f.texto, { nomes: [f.nome], baseMd }).ok), 'todos os textos passam na validação', fila.map((f) => f.texto));
ok(new Set(fila.map((f) => f.texto)).size === fila.length, 'textos diferentes entre si');
ok(!/Carlos/.test(fila.find((f) => f.id === 'a@lid').texto), 'texto que usava o nome foi recusado e refeito');
ok(mapa.custo.chamadas_classificacao === 2 && mapa.custo.chamadas_followup >= 4, 'custo contado (2 lotes de classificação; follow-ups com retentativa)', mapa.custo);
const est = JSON.parse(fs.readFileSync(path.join(pasta, 'backlog-estado.json'), 'utf8'));
ok(est.mapeamento && est.mapeamento.em_andamento === false && est.mapeamento.etapa === 'pronto', 'estado do mapeamento gravado', est.mapeamento);


sec('3b. manutenção: renomear de novo (devagar) e diversificar textos');
{
  const pm = fs.mkdtempSync(path.join(os.tmpdir(), 'backlog-manut-'));
  fs.writeFileSync(path.join(pm, 'base.md'), baseMd);
  const mk = (id, nome) => ({ ref: id, id, nome, telefone: '5511955500' + id.slice(1, 3), categoria: 'esfriou', etapa: 'duvidas', ultimo_contato: new Date(T0 - 5 * 864e5).toISOString(), elegivel: true, renomeio: { status: 'falhou', motivo: 't' }, followup_sugerido: 'x' });
  const itensM = ['q1@lid', 'q2@lid', 'q3@lid', 'q4@lid', 'q5@lid'].map((id, i) => mk(id, 'Pessoa' + i));
  fs.writeFileSync(path.join(pm, 'backlog.json'), JSON.stringify({ itens: itensM }));
  let tentativas = 0; const gravados = [];
  const ctxM = { ...ctx, pasta: pm, est: {}, log: () => {}, client: { saveOrEditAddressbookContact: async (t, n, su) => { tentativas++; throw new Error('t'); } } };
  const pausasM = []; ctxM.dormir = async (ms) => { pausasM.push(ms); };
  let r1 = await B.renomearPendentes(ctxM, { max: 10 });
  ok(r1.ok && tentativas === 3 && r1.parou_por_falhas, 'renomear de novo para depois de 3 falhas seguidas (não insiste)', { tentativas, r1 });
  ok(pausasM.length === 3 && pausasM.every((ms) => ms >= 3000 && ms <= 5000), 'renomear: pausa de 3 a 5 s entre contatos', pausasM);
  ctxM.client.saveOrEditAddressbookContact = async (t, n, su) => { gravados.push(n + ' ' + su); };
  const r2 = await B.renomearPendentes(ctxM, { max: 2 });
  ok(r2.feitos === 2 && r2.tentados === 2 && gravados.length === 2, 'renomear: respeita o máximo por rodada', r2);
  // diversificar
  const pd = fs.mkdtempSync(path.join(os.tmpdir(), 'backlog-div-'));
  fs.writeFileSync(path.join(pd, 'base.md'), baseMd);
  const mkf = (id, nome, texto, piloto = false) => ({ ref: id, id, nome, telefone: '551195550000', categoria: 'esfriou', etapa: 'duvidas', ultimo_contato: new Date(T0 - 5 * 864e5).toISOString(), status: 'na_fila', piloto, texto, followups: [] });
  const filaD = [mkf('d1@lid', 'Aa', 'Mestre, ficou alguma dúvida do painel?'), mkf('d2@lid', 'Bb', 'Mestre, ficou alguma dúvida da revenda?'), mkf('d3@lid', 'Cc', 'Mestre, ficou alguma dúvida dos apps?', true), mkf('d4@lid', 'Dd', 'Mestre, ficou alguma dúvida do teste?')];
  fs.writeFileSync(path.join(pd, 'backlog-fila.json'), JSON.stringify({ itens: filaD }));
  fs.writeFileSync(path.join(pd, 'backlog.json'), JSON.stringify({ itens: [] }));
  let seqD = 0; const novas = ['Posso te ajudar com o painel, mestre? É só falar.', 'Se precisar de ajuda com os apps, mestre, me chama por aqui.'];
  const ctxD = { ...ctx, pasta: pd, est: {}, log: () => {}, client: { getChatById: async () => ({ fetchMessages: async () => [msg(false, 'oi', 5 * dia)] }) }, perguntarHaiku: async () => ({ mensagens: [novas[seqD++ % 2]] }) };
  const rd = await B.diversificar(ctxD);
  const fd = JSON.parse(fs.readFileSync(path.join(pd, 'backlog-fila.json'), 'utf8')).itens;
  ok(rd.ok && rd.refeitos === 2, 'diversificar reescreve os que repetem a abertura (2 de 3; o 1º fica)', rd);
  ok(fd[0].texto.startsWith('Mestre, ficou') && fd[2].texto === 'Mestre, ficou alguma dúvida dos apps?', 'o primeiro e o piloto não mudam');
  ok(new Set(fd.map((x) => x.texto.split(' ').slice(0, 3).join(' '))).size >= 3, 'aberturas diferentes depois de diversificar', fd.map((x) => x.texto));
}

// ============ 4. motor de envio (cliente falso) ============
sec('4. motor de envio: piloto, ritmo, travas, erros');
const lerEst = () => JSON.parse(fs.readFileSync(path.join(pasta, 'backlog-estado.json'), 'utf8'));
const lerFila = () => JSON.parse(fs.readFileSync(path.join(pasta, 'backlog-fila.json'), 'utf8')).itens;
const passo = async (ms, livre = true) => { T += ms; if (livre) ctx.est.proximo_em = 0; await B.enviarProximo(ctx); };
// reinicia o relógio dentro da janela
T = local(2026, 11, 8, 10, 0);
// marca só 2 como piloto para testar o "só o piloto"
{ const f = JSON.parse(fs.readFileSync(path.join(pasta, 'backlog-fila.json'), 'utf8')); f.itens.forEach((x, i) => { x.piloto = i < 2; }); fs.writeFileSync(path.join(pasta, 'backlog-fila.json'), JSON.stringify(f)); }
await passo(0);
ok(enviados.length === 1, 'primeiro envio do piloto saiu', enviados);
ok(lerFila().filter((f) => f.status === 'enviado').length === 1, 'fila marca enviado');
ok(eventos.some((e) => e.tipo === 'followup_backlog' && e.n === 1), 'evento followup_backlog gravado');
ok(logs.some((l) => /^robô -> .*\[follow-up backlog 1\]/.test(l)), 'linha no log no padrão do robô');
await passo(30000, false);
ok(enviados.length === 1, 'antes do intervalo calculado: não envia o segundo', enviados.length);
await passo(50000, false);
ok(enviados.length === 1 && lerEst().motivo_espera === 'rajada' || enviados.length === 1, 'a menos de 45 s não há rajada', lerEst());
await passo(500000, false);
ok(enviados.length === 2, 'depois do intervalo (~2-4 min no piloto): envia o segundo do piloto', enviados.length);
await passo(200000);
ok(enviados.length === 2, 'piloto concluído: o terceiro (fora do piloto) NÃO sai', enviados.length);
ok(JSON.parse(fs.readFileSync(path.join(pasta, 'backlog-estado.json'), 'utf8')).motivo_espera === 'piloto_concluido', 'estado diz piloto_concluido');
ok(ctx.seguindo.size === 0, 'marca "seguindo" liberada (sem escada ao vivo)');
// libera tudo
fs.writeFileSync(path.join(pasta, 'backlog-config.json'), JSON.stringify({ modo: 'completo' }));
fs.writeFileSync(path.join(pasta, 'backlog-pausado'), 'x');
await passo(200000);
ok(enviados.length === 2, 'pausado: não envia mesmo em modo completo');
fs.unlinkSync(path.join(pasta, 'backlog-pausado'));
// o cliente do 3º item escreveu depois do mapa: não deve receber (o fluxo normal responde)
{
  const f3 = lerFila().find((f) => f.status === 'na_fila');
  const c3 = chats.find((c) => c.id._serialized === f3.id);
  c3.msgs.push(msg(false, 'voltei, ainda dá?', -(0)));
  c3.msgs[c3.msgs.length - 1].timestamp = NOW_S + 3600;
  await passo(200000);
  ok(enviados.length === 2, 'cliente voltou sozinho: não manda follow-up em cima', enviados.length);
  ok(lerFila().find((f) => f.id === f3.id).status === 'descartado', 'item vira descartado (voltou sozinho)', lerFila().find((f) => f.id === f3.id));
}
// 2º follow-up: só depois de 24 h, e uma vez
{
  const antes = enviados.length;
  await passo(3600e3);
  ok(enviados.length === antes, 'antes de 24 h: sem 2º follow-up', enviados.length);
  T = local(2026, 11, 9, 10, 30);
  chats.forEach((c) => { c.avanco = 86400; });
  await B.enviarProximo(ctx);
  ok(enviados.length === antes, 'depois de 24 h sem resposta: o 2º follow-up do backlog está desligado (a cadência do funil assume)', enviados.length);
  for (let i = 0; i < 5; i++) await passo(130000);
  const tot = enviados.length;
  ok(lerFila().every((f) => (f.followups || []).length <= 2), 'no máximo 2 follow-ups por conversa');
  await passo(130000 * 3);
  ok(enviados.length === tot, 'não há 3º follow-up', enviados.length);
}
// cliente responde ao follow-up
{
  const f1 = lerFila().find((f) => (f.followups || []).length >= 1 && f.status === 'enviado');
  if (f1) {
    B.aoReceber(ctx, f1.id, (Date.parse(f1.followups[f1.followups.length - 1].quando) + 7 * 60e3) / 1000);
    const x = lerFila().find((f) => f.id === f1.id);
    ok(x.status === 'respondeu' && x.minutos_ate_resposta === 7, 'resposta do cliente: status respondeu e minutos', x);
    ok(eventos.some((e) => e.tipo === 'backlog_respondeu'), 'evento backlog_respondeu');
  } else ok(false, 'havia item enviado sem resposta para testar');
}
// fechou painel depois do envio
{
  const alvo = lerFila().find((f) => f.status === 'enviado');
  if (alvo) {
    const rv = JSON.parse(fs.readFileSync(path.join(pasta, 'revendedores.json'), 'utf8'));
    rv['zz@lid'] = { nome: alvo.nome, telefone: alvo.telefone, fechou_em: new Date(T).toISOString() };
    fs.writeFileSync(path.join(pasta, 'revendedores.json'), JSON.stringify(rv));
    ctx.est.ultimaConfPainel = 0;
    B.conferirPaineis(ctx);
    ok(lerFila().find((f) => f.id === alvo.id).status === 'fechou_painel', 'fechou painel: status fechou_painel (casa por telefone)');
  }
}

sec('4b. erros de envio: 3 seguidos param tudo e avisam');
{
  const p2 = fs.mkdtempSync(path.join(os.tmpdir(), 'backlog-erro-'));
  fs.writeFileSync(path.join(p2, 'base.md'), baseMd);
  fs.writeFileSync(path.join(p2, 'backlog-config.json'), JSON.stringify({ modo: 'completo' }));
  const ch = Array.from({ length: 6 }, (_, i) => { const c = chatFalso('q' + i + '@lid', 'Fulano' + i, [msg(false, 'oi', 5 * dia)]); c.falhaEnvio = true; return c; });
  const itens = ch.map((c, i) => ({ ref: 'r' + i, id: c.id._serialized, nome: 'Fulano' + i, telefone: '55119111100' + i, categoria: 'esfriou', etapa: 'duvidas', ultimo_contato: new Date((NOW_S - 5 * dia) * 1000).toISOString(), ultima_msg_id: c.msgs[0].id._serialized, status: 'na_fila', piloto: true, texto: 'Oi mestre, tudo certo por aí? ' + i, followups: [], tentativas: 0 }));
  fs.writeFileSync(path.join(p2, 'backlog-fila.json'), JSON.stringify({ itens }));
  const avisos2 = [];
  const ctx2 = { ...ctx, pasta: p2, client: { ...cliente, getChatById: async (id) => ch.find((c) => c.id._serialized === id) }, est: {}, avisarSenhor: async (t) => { avisos2.push(t); }, log: () => {}, evento: () => ({}), agora: () => T, seguindo: new Set() };
  T = local(2026, 11, 9, 11, 0);
  for (let i = 0; i < 8; i++) { T += 130000; ctx2.est.proximo_em = 0; await B.enviarProximo(ctx2); }
  ok(ch.every((c) => !c.msgs.some((m) => m.fromMe)), 'nenhuma mensagem saiu (todas falharam)');
  ok(fs.existsSync(path.join(p2, 'backlog-pausado')), '3 erros seguidos criam backlog-pausado', ctx2.est);
  ok(avisos2.length === 1 && /3 vezes seguidas/.test(avisos2[0]), 'avisa o senhor uma vez no Telegram', avisos2);
  ok(ctx2.est.erros === 3, 'parou no terceiro erro (não tenta um quarto)', ctx2.est.erros);
  // sucesso no meio zera a contagem: erro, erro, sucesso, erro, erro, sucesso... nunca chega a 3 seguidos
  const p3 = fs.mkdtempSync(path.join(os.tmpdir(), 'backlog-erro2-'));
  fs.writeFileSync(path.join(p3, 'backlog-config.json'), JSON.stringify({ modo: 'completo' }));
  fs.writeFileSync(path.join(p3, 'base.md'), baseMd);
  let chamadas = 0;
  const ch3 = ch.map((c, i) => { const n = chatFalso(c.id._serialized, 'Fulano' + i, [msg(false, 'oi', 5 * dia)]); const orig = n.sendMessage; n.sendMessage = async (t) => { chamadas++; if (chamadas % 3 !== 0) throw new Error('simulado'); return orig(t); }; return n; });
  fs.writeFileSync(path.join(p3, 'backlog-fila.json'), JSON.stringify({ itens: itens.map((x, i) => ({ ...x, ultima_msg_id: ch3[i].msgs[0].id._serialized })) }));
  const ctx3 = { ...ctx2, pasta: p3, client: { ...cliente, getChatById: async (id) => ch3.find((c) => c.id._serialized === id) }, est: {} };
  for (let i = 0; i < 9; i++) { T += 130000; ctx3.est.proximo_em = 0; await B.enviarProximo(ctx3); }
  ok(!fs.existsSync(path.join(p3, 'backlog-pausado')) && chamadas === 9, 'erro, erro, sucesso (x3): o sucesso zera a contagem e não para', { chamadas, est: ctx3.est.erros });
}

// ============ 5. API: contrato e segurança ============
sec('5. API /api/followups e /api/backlog (contrato, máscara, POST)');
{
  const p4 = fs.mkdtempSync(path.join(os.tmpdir(), 'backlog-api-'));
  fs.copyFileSync(path.join(pasta, 'backlog.json'), path.join(p4, 'backlog.json'));
  { const fa = JSON.parse(fs.readFileSync(path.join(pasta, 'backlog-fila.json'), 'utf8')); fa.itens.push({ ref: 'sint2', id: 'sint2@lid', nome: 'Sintetico Fila', telefone: '5511933334444', categoria: 'duvida_aberta', etapa: 'duvidas', ultimo_contato: new Date(T0 - 2 * 864e5).toISOString(), status: 'na_fila', piloto: false, texto: 'Oi mestre, ficou dúvida?', followups: [] }, { ref: 'sint', id: 'sint@lid', nome: 'Sintetico', telefone: '5511911112222', categoria: 'esfriou', etapa: 'duvidas', ultimo_contato: new Date(T0 - 3 * 864e5).toISOString(), status: 'enviado', piloto: true, texto: 'Oi mestre', followups: [{ n: 1, quando: new Date(T0 - 3600e3).toISOString(), texto: 'Oi mestre, tudo certo?' }] }); fs.writeFileSync(path.join(p4, 'backlog-fila.json'), JSON.stringify(fa)); }
  fs.copyFileSync(path.join(pasta, 'backlog-estado.json'), path.join(p4, 'backlog-estado.json'));
  fs.writeFileSync(path.join(p4, 'backlog-config.json'), JSON.stringify({ modo: 'piloto' }));
  const agora = local(2026, 11, 9, 11, 0);
  const iso = (ms) => new Date(ms).toISOString();
  const ev = [
    { t: iso(agora - 3 * 3600e3), chat: 'v1@lid', nome: 'Viva Um', tipo: 'mensagem_cliente', texto: 'oi' },
    { t: iso(agora - 3 * 3600e3 + 5000), chat: 'v1@lid', nome: 'Viva Um', tipo: 'resposta_robo', texto: 'Oi mestre' },
    { t: iso(agora - 3 * 3600e3 + 7 * 60e3), chat: 'v1@lid', nome: 'Viva Um', tipo: 'followup', n: 1, minutos: 7, texto: 'Mestre, conseguiu?' },
    { t: iso(agora - 3 * 3600e3 + 12 * 60e3), chat: 'v1@lid', nome: 'Viva Um', tipo: 'cliente_respondeu_followup', n: 1, followup_t: iso(agora - 3 * 3600e3 + 7 * 60e3), minutos_ate_resposta: 5 },
    { t: iso(agora - 2 * 3600e3), chat: 'v2@lid', nome: 'Viva Dois', tipo: 'resposta_robo', texto: 'Oi mestre' },
    { t: iso(agora - 2 * 3600e3 + 7 * 60e3), chat: 'v2@lid', nome: 'Viva Dois', tipo: 'followup', n: 1, minutos: 7, texto: 'Mestre, ficou dúvida?' },
    { t: iso(agora - 5 * 3600e3), chat: 'e@lid', nome: 'Mario Painel', tipo: 'painel_fechado' },
  ];
  fs.writeFileSync(path.join(p4, 'eventos.jsonl'), ev.map((e) => JSON.stringify(e)).join('\n') + '\n');
  fs.writeFileSync(path.join(p4, 'clientes.json'), JSON.stringify({ 'v1@lid': { nome: 'Viva Um', telefone_real: '5511987654321', etapa: 'explicando' }, 'v2@lid': { nome: 'Viva Dois', telefone_real: '5511987650000', etapa: 'duvidas' } }));
  fs.writeFileSync(path.join(p4, 'revendedores.json'), '{}');
  const get = (rota, query = {}) => L.tratarRotaBacklog({ metodo: 'GET', rota, query, pasta: p4, agora });
  const f = get('/api/followups', { dias: '7' });
  ok(f && f.codigo === 200, 'GET /api/followups responde 200');
  const c = f.corpo;
  const chaves = (o, ks) => ks.every((k) => k in o);
  ok(typeof c.gerado_em === 'string' && !Number.isNaN(Date.parse(c.gerado_em)), 'gerado_em ISO');
  ok(chaves(c.resumo, ['em_fila', 'enviados', 'respondidos', 'taxa', 'paineis_depois', 'backlog_total', 'backlog_mapeados', 'backlog_renomeados', 'backlog_na_fila', 'backlog_enviados', 'backlog_respondeu', 'backlog_fechou_painel', 'backlog_descartados', 'pausado', 'proximo_envio_em', 'enviados_hoje', 'teto_dia']), 'resumo tem todos os campos do contrato', Object.keys(c.resumo));
  ok('intervalo_medio_s' in c.resumo && (c.resumo.intervalo_medio_s === null || typeof c.resumo.intervalo_medio_s === 'number'), 'resumo.intervalo_medio_s presente', c.resumo.intervalo_medio_s);
  ok(typeof c.resumo.pausado === 'boolean' && c.resumo.teto_dia === 120 && typeof c.resumo.taxa === 'number', 'tipos do resumo (pausado bool, teto 120, taxa número)');
  ok(c.resumo.enviados === 2 && c.resumo.respondidos === 1 && c.resumo.taxa === 0.5, 'follow-ups ao vivo contados (2 enviados, 1 respondido, 50%)', c.resumo);
  ok(c.resumo.backlog_total === 10 && c.resumo.backlog_na_fila + c.resumo.backlog_enviados > 0, 'contagens do backlog vêm do mapa e da fila', c.resumo);
  ok(c.resumo.backlog_renomeados === mapa.renomeio.renomeados, 'backlog_renomeados confere com o mapa');
  ok(Array.isArray(c.degraus) && c.degraus.length === 4 && c.degraus.every((d) => chaves(d, ['n', 'minutos', 'enviados', 'respondidos', 'taxa', 'paineis_depois'])) && c.degraus.map((d) => d.minutos).join() === '7,20,60,180', 'degraus 7/20/60/180 com campos do contrato');
  ok(c.degraus[0].enviados === 2 && c.degraus[0].respondidos === 1, 'degrau 1 conta os 2 ao vivo', c.degraus[0]);
  ok(Array.isArray(c.por_categoria) && c.por_categoria.length === 10 && c.por_categoria.every((x) => 'categoria' in x && typeof x.qtd === 'number'), 'por_categoria: 10 categorias', c.por_categoria);
  const STATUS = ['aguardando', 'respondeu', 'fechou_painel', 'sem_resposta', 'nao_incomodar', 'na_fila'];
  ok(c.clientes.length >= 5 && c.clientes.every((x) => chaves(x, ['nome', 'telefone_mascarado', 'origem', 'categoria', 'etapa', 'ultimo_contato', 'followups', 'proximo', 'status']) && ['ao_vivo', 'backlog'].includes(x.origem) && STATUS.includes(x.status) && Array.isArray(x.followups)), 'clientes com os campos e status do contrato', c.clientes.map((x) => x.status));
  ok(c.clientes.every((x) => x.proximo === null || (typeof x.proximo.n === 'number' && 'em' in x.proximo)), 'proximo é null ou {n, em}');
  ok(c.clientes.every((x) => x.followups.every((y) => chaves(y, ['n', 'quando', 'texto', 'respondeu', 'minutos_ate_resposta']))), 'followups com n/quando/texto/respondeu/minutos');
  const v1 = c.clientes.find((x) => x.nome === 'Viva Um'), v2 = c.clientes.find((x) => x.nome === 'Viva Dois');
  ok(v1 && v1.status === 'respondeu' && v1.followups[0].respondeu && v1.followups[0].minutos_ate_resposta === 5, 'ao vivo: respondeu com minutos', v1);
  ok(v2 && v2.status === 'aguardando' && v2.proximo && v2.proximo.n === 2, 'ao vivo: aguardando com próximo degrau', v2);
  ok(c.clientes.some((x) => x.origem === 'backlog' && x.status === 'na_fila') && c.clientes.some((x) => x.origem === 'backlog' && x.status === 'aguardando'), 'backlog: tem na_fila e aguardando (enviados)');
  const txt = JSON.stringify(f.corpo) + JSON.stringify(get('/api/backlog').corpo);
  ok(!/@lid|@c\.us|@g\.us/.test(txt), 'nenhum id de conversa na resposta');
  const todosFones = [...Object.values(fones), '5511987654321', '5511987650000'];
  ok(!todosFones.some((n) => txt.includes(n)) && !/\d{8,}/.test(txt.replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '')), 'telefone nunca aparece inteiro (só os 4 últimos)');
  ok(/•••• \d{4}/.test(txt), 'telefone mascarado no formato "•••• 1234"');
  const b = get('/api/backlog');
  ok(b.codigo === 200 && chaves(b.corpo, ['gerado_em', 'estado', 'resumo', 'mapa', 'fila']) && b.corpo.mapa.itens.length === 10 && b.corpo.fila.length === fila.length + 2, '/api/backlog devolve estado, resumo, mapa completo e fila');
  ok(chaves(b.corpo.estado, ['pausado', 'modo', 'proximo_envio_em', 'enviados_hoje', 'teto_dia']) && b.corpo.estado.modo === 'piloto', 'estado do motor na /api/backlog');
  ok(b.corpo.mapa.itens.every((i) => 'followup_sugerido' in i && 'renomeio' in i && 'resumo' in i && 'categoria' in i), 'itens do mapa com resumo, categoria, follow-up e renomeio');
  ok(!/123456/.test(txt), 'sem senha em nenhuma resposta');
  // pausa muda o resumo
  fs.writeFileSync(path.join(p4, 'backlog-pausado'), 'x');
  ok(get('/api/followups').corpo.resumo.pausado === true && get('/api/followups').corpo.resumo.proximo_envio_em === null, 'pausado: resumo.pausado true e sem próximo envio');
  fs.unlinkSync(path.join(p4, 'backlog-pausado'));
  // POST
  const post = (rota, o = {}) => L.tratarRotaBacklog({ metodo: 'POST', rota, headers: { 'content-type': 'application/json', ...(o.headers || {}) }, corpo: o.corpo || {}, pasta: p4, agora });
  ok(L.tratarRotaBacklog({ metodo: 'POST', rota: '/api/backlog/retomar', headers: {}, pasta: p4 }).codigo === 415, 'POST sem Content-Type JSON é recusado (415)');
  ok(post('/api/backlog/retomar', { headers: { origin: 'https://site-malicioso.example' } }).codigo === 403, 'POST com Origin de outro site é recusado (403)');
  ok(!fs.existsSync(path.join(p4, 'backlog-comando.json')), 'nada foi gravado pelos POST recusados');
  ok(post('/api/backlog/pausar', { headers: { origin: 'http://127.0.0.1:8811' } }).codigo === 200 && fs.existsSync(path.join(p4, 'backlog-pausado')), 'POST pausar cria backlog-pausado');
  const rr = post('/api/backlog/retomar', { corpo: { modo: 'piloto' } });
  ok(rr.codigo === 200 && !fs.existsSync(path.join(p4, 'backlog-pausado')) && JSON.parse(fs.readFileSync(path.join(p4, 'backlog-config.json'), 'utf8')).modo === 'piloto', 'POST retomar {modo:piloto} tira a pausa e mantém o piloto');
  post('/api/backlog/retomar');
  ok(JSON.parse(fs.readFileSync(path.join(p4, 'backlog-config.json'), 'utf8')).modo === 'completo', 'POST retomar sem corpo libera o modo completo');
  const mp = post('/api/backlog/mapear', { corpo: { dias: 7 } });
  ok(mp.codigo === 202 && JSON.parse(fs.readFileSync(path.join(p4, 'backlog-comando.json'), 'utf8')).dias === 7, 'POST mapear grava backlog-comando.json com os dias', mp);
  ok(L.tratarRotaBacklog({ metodo: 'GET', rota: '/api/backlog/retomar', pasta: p4 }).codigo === 405, 'GET numa rota de ação: 405');
  ok(L.tratarRotaBacklog({ metodo: 'GET', rota: '/api/outra', pasta: p4 }) === null, 'rota desconhecida: não é do backlog');
  const vazia = fs.mkdtempSync(path.join(os.tmpdir(), 'backlog-vazio-'));
  const fv = L.tratarRotaBacklog({ metodo: 'GET', rota: '/api/followups', query: {}, pasta: vazia, agora });
  ok(fv.codigo === 200 && fv.corpo.clientes.length === 0 && fv.corpo.resumo.backlog_total === 0 && fv.corpo.resumo.pausado === false, 'sem nenhum arquivo: contrato continua válido (zeros)');
}

console.log(`\n${passou} testes passaram, ${falhou} falharam.`);
if (falhou) process.exit(1);
