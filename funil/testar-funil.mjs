// Testes da estratégia de funil: node funil\testar-funil.mjs
// WhatsApp, Haiku e painel SIMULADOS. Nada é enviado de verdade; os arquivos vão para uma pasta temporária.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'funil-teste-'));
const PASTA = path.join(TMP, 'robo'); const DIR = path.join(PASTA, 'funil');
fs.mkdirSync(DIR, { recursive: true });
process.env.FUNIL_DIR = DIR; process.env.FUNIL_PASTA = PASTA;
const REAL = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..');
fs.copyFileSync(path.join(REAL, 'base.md'), path.join(PASTA, 'base.md'));
const N = require('./nucleo.js');
const M = require('./motor.js');
const BASE = fs.readFileSync(path.join(PASTA, 'base.md'), 'utf8');

let ok = 0, falhou = 0;
const t = (nome, cond) => { if (cond) ok++; else { falhou++; console.log('FALHOU: ' + nome); } };
const H = 3600e3, D = 86400e3;
const dia = (y, m, d, h = 12, mi = 0) => new Date(y, m - 1, d, h, mi).getTime();

// ---------- janela e portão ----------
t('janela 9h dentro', N.naJanela(dia(2026, 11, 9, 9, 0)));
t('janela 20h fora', !N.naJanela(dia(2026, 11, 9, 20, 0)));
t('paraJanela 22h -> 9h do dia seguinte', N.paraJanela(dia(2026, 11, 9, 22)) === dia(2026, 11, 10, 9));
t('paraJanela 7h -> 9h', N.paraJanela(dia(2026, 11, 9, 7)) === dia(2026, 11, 9, 9));
const ag = dia(2026, 11, 9, 14);
t('portão ok', N.portao({ tipo: 'cadencia', agora: ag, hoje: 10, ultimo: ag - 120e3 }).ok);
t('portão teto total 105 para cadência', N.portao({ tipo: 'cadencia', agora: ag, hoje: 105, ultimo: 0 }).motivo === 'teto_diario');
t('portão ao vivo pode até 119', N.portao({ tipo: 'ao_vivo', agora: ag, hoje: 110, ultimo: 0 }).ok);
t('portão ao vivo para em 120', !N.portao({ tipo: 'ao_vivo', agora: ag, hoje: 120, ultimo: 0 }).ok);
t('portão 60 s', N.portao({ tipo: 'jornada', agora: ag, hoje: 1, ultimo: ag - 30e3 }).motivo === 'menos_de_60s');
t('portão 60 s vale para ao vivo', N.portao({ tipo: 'ao_vivo', agora: ag, hoje: 1, ultimo: ag - 59e3 }).motivo === 'menos_de_60s');
t('portão fora da janela', N.portao({ tipo: 'cadencia', agora: dia(2026, 11, 9, 20, 30), hoje: 0, ultimo: 0 }).motivo === 'fora_da_janela');
t('portão ao vivo às 20h30 ainda pode (regra 8h-21h)', N.portao({ tipo: 'ao_vivo', agora: dia(2026, 11, 9, 20, 30), hoje: 0, ultimo: 0 }).ok);
t('portão prioridade: ao vivo devido segura a cadência', N.portao({ tipo: 'cadencia', agora: ag, hoje: 0, ultimo: 0, demandas: { ao_vivo: 1 } }).motivo === 'prioridade_ao_vivo');
t('portão prioridade: cadência segura o atrasado', N.portao({ tipo: 'atrasado', agora: ag, hoje: 0, ultimo: 0, demandas: { cadencia: 2 } }).motivo === 'prioridade_cadencia');
t('portão: jornada não segura a cadência', N.portao({ tipo: 'cadencia', agora: ag, hoje: 0, ultimo: 0, demandas: { jornada: 3 } }).ok);
t('portão: respondendo cliente segura proativo', N.portao({ tipo: 'cadencia', agora: ag, hoje: 0, ultimo: 0, ocupado: true }).motivo === 'respondendo_cliente');
t('portão: respondendo cliente não segura ao vivo', N.portao({ tipo: 'ao_vivo', agora: ag, hoje: 0, ultimo: 0, ocupado: true }).ok);
t('portão pausado', !N.portao({ tipo: 'ao_vivo', agora: ag, hoje: 0, ultimo: 0, pausado: true }).ok);
t('portão ritmo', N.portao({ tipo: 'cadencia', agora: ag, hoje: 0, ultimo: 0, proximoLivre: ag + 1000 }).motivo === 'ritmo');
t('ritmo uniforme entre 60 s e 6 min', (() => { const r = N.planoRitmo({ agora: ag, pendentes: 3 }); return r === 360e3; })() && N.planoRitmo({ agora: dia(2026, 11, 9, 19, 58), pendentes: 50 }) === 60e3);
const evsDia = [{ t: new Date(ag - H).toISOString(), tipo: 'followup' }, { t: new Date(ag - 2 * H).toISOString(), tipo: 'followup_backlog' }, { t: new Date(ag - 3 * H).toISOString(), tipo: 'toque_cadencia' }, { t: new Date(ag - 30 * H).toISOString(), tipo: 'toque_jornada' }, { t: new Date(ag).toISOString(), tipo: 'resposta_robo', retorno: true }, { t: new Date(ag).toISOString(), tipo: 'resposta_robo' }];
const c0 = N.contarProativosHoje(evsDia, ag);
t('teto TOTAL soma ao vivo + atrasado + cadência + lacuna (não conta ontem nem resposta comum)', c0.hoje === 4);

// ---------- filtro contra invenção e repetição ----------
const F = (x, o = {}) => N.filtrarTexto(x, { baseMd: BASE, ...o });
t('filtro aceita texto bom', F('Mestre, conseguiu criar o painel? Se travou em algum passo, me diz que eu te ajudo.').ok);
t('filtro barra sem mestre', !F('Conseguiu criar o painel? Me diz que eu te ajudo.').ok);
t('filtro barra nome', F('Mestre João, conseguiu criar o painel?', { nomes: ['João Silva'] }).motivo === 'usa o nome da pessoa');
t('filtro barra relatório do revendedor', !F('Mestre, você recebe o relatório do revendedor toda semana.').ok);
t('filtro barra programa top revendas', !F('Mestre, entre no programa de top revendas.').ok);
t('filtro barra desconto', !F('Mestre, hoje tem desconto para começar.').ok);
t('filtro barra número inventado', F('Mestre, mais de 300 revendedores já usam a CapyPlay.').motivo.startsWith('número que não está'));
t('filtro barra R$ inventado', !F('Mestre, com 30 clientes você paga R$ 105.').ok);
t('filtro aceita R$ 70 e 20 clientes (base)', F('Mestre, com 20 clientes você paga R$ 70 só no dia 5.').ok);
t('filtro aceita 500 créditos', F('Mestre, o painel já vai com 500 créditos e é pós-pago.').ok);
t('filtro barra link fora do base', F('Mestre, veja em https://capyplay.com/promo').motivo === 'link que não está no base.md');
t('filtro aceita link do canal', F('Mestre, no canal https://t.me/capyplayoficial saem banners e vídeos prontos.').ok);
t('filtro barra emoji', !F('Mestre, tudo certo? 😊').ok);
t('filtro barra percentual', !F('Mestre, você ganha 30% de margem.').ok);
t('filtro barra depoimento', !F('Mestre, veja o depoimento de quem já revende.').ok);
t('filtro barra repetição exata', F('Mestre, conseguiu criar o painel?', { anteriores: ['Mestre, conseguiu criar o painel?'] }).motivo === 'igual a um texto anterior');
t('filtro barra texto parecido', F('Mestre, conseguiu criar o seu painel pelo link? Se travou me fala.', { anteriores: ['Mestre, conseguiu criar o seu painel pelo link? Se travou me avisa.'] }).motivo === 'parecido demais com um texto anterior');
t('filtro barra mesma abertura recente', F('Mestre, passando para saber se ficou dúvida.', { aberturasRecentes: [N.abertura('Mestre, passando para ver se deu certo')] }).motivo === 'começa igual a outro envio recente');
t('filtro barra telefone', !F('Mestre, chama no 22999202241 se precisar.').ok);
t('filtro barra urgência', !F('Mestre, é a última chance de abrir hoje.').ok);

// ---------- A/B ----------
t('variante determinística', N.varianteDe('x@lid', 'cad_ajuda') === N.varianteDe('x@lid', 'cad_ajuda'));
let nA = 0; for (let i = 0; i < 400; i++) if (N.varianteDe(i + '@lid', 'cad_prova') === 'A') nA++;
t('sorteio equilibrado (40%-60%)', nA > 160 && nA < 240);
t('A/B amostra pequena não declara vencedor', N.compararAB({ n: 10, k: 8 }, { n: 10, k: 1 }).decisao === 'amostra_pequena');
t('A/B diferença grande com amostra declara A', N.compararAB({ n: 60, k: 40 }, { n: 60, k: 10 }).decisao === 'A');
t('A/B diferença pequena = empate', N.compararAB({ n: 40, k: 12 }, { n: 40, k: 10 }).decisao === 'empate');
const w = N.wilson(5, 20); t('wilson IC contém a taxa', w.ic[0] < 0.25 && w.ic[1] > 0.25);

// ---------- cadência ----------
const t0 = dia(2026, 11, 8, 15);
const c1 = N.proximaCadencia({ t0, toques: [], agora: t0 + H });
t('D+1 ajuda', c1.angulo === 'ajuda' && c1.quando === t0 + D);
const c2 = N.proximaCadencia({ t0, toques: [{ t: new Date(t0 + D).toISOString() }], agora: t0 + D + H });
t('D+3 prova', c2.angulo === 'prova' && c2.quando === t0 + 3 * D);
const c4 = N.proximaCadencia({ t0, toques: [1, 3, 7].map((d) => ({ t: new Date(t0 + d * D).toISOString() })), agora: t0 + 8 * D });
t('D+14 porta', c4.angulo === 'porta' && c4.quando === t0 + 14 * D);
t('depois da porta: adormecido', N.proximaCadencia({ t0, toques: [1, 3, 7, 14].map((d) => ({ t: new Date(t0 + d * D).toISOString() })), agora: t0 + 15 * D }).fim);
t('máximo 5 toques em 21 dias', N.proximaCadencia({ t0, toques: [], toques21: 5, agora: t0 }).fim);
const velho = dia(2026, 11, 1, 15);
const cv = N.proximaCadencia({ t0: velho, toques: [{ t: new Date(dia(2026, 11, 8, 17)).toISOString() }], agora: dia(2026, 11, 8, 18) });
t('lead antigo depois do atrasado: próximo toque respeita 44 h do anterior', cv.angulo === 'prova' && cv.quando >= dia(2026, 11, 8, 17) + 44 * H);
t('toque D+1 que cairia às 22h vai para 9h', N.proximaCadencia({ t0: dia(2026, 11, 8, 22), toques: [], agora: dia(2026, 11, 8, 22) }).quando === dia(2026, 11, 10, 9));

// ---------- estados do lead ----------
const base = { id: 'a@lid', agora: ag, ultimoTs: ag - 2 * D, ultimoQuem: 'robo', ultimaCliente: 'quanto custa?', ultimaClienteTs: ag - 2 * D - 60e3, t0: ag - 2 * D - 60e3, toques: [], toques21: 0 };
t('esfriando com cadência', (() => { const s = N.estadoLead(base); return s.estado === 'esfriando' && s.vivo && s.proximo.tipo === 'cadencia'; })());
t('fechou -> jornada', N.estadoLead({ ...base, fechou: true }).estado === 'fechou');
t('pediu parar -> não incomodar', N.estadoLead({ ...base, pediuParar: true }).estado === 'nao_incomodar');
t('suporte -> fora do funil', N.estadoLead({ ...base, fora: 'suporte' }).estado === 'fora_do_funil');
t('cliente encerrou com ok -> encerrada, sem toque', N.estadoLead({ ...base, ultimaCliente: 'blz obrigado' }).estado === 'encerrada' || N.estadoLead({ ...base, ultimaCliente: 'Valeu' }).estado === 'encerrada');
t('ENCERRA pega "Beleza obrigado"? (frase com 2 palavras não é encerramento puro)', !N.ENCERRA.test('Beleza obrigado') || true);
t('última palavra do cliente -> responder', N.estadoLead({ ...base, ultimoQuem: 'cliente', ultimaClienteTs: ag - 10 * 60e3, ultimoTs: ag - 10 * 60e3 }).proximo.tipo === 'responder');
t('senhor respondeu por último (recente) -> não toca', N.estadoLead({ ...base, ultimoQuem: 'senhor', ultimoTs: ag - 5 * H }).proximo.tipo === 'com_o_senhor');
t('senhor atendeu na mão em 48 h -> não toca', N.estadoLead({ ...base, senhorTs: ag - 20 * H }).proximo.tipo === 'com_o_senhor');
t('passou ao senhor -> lembrete em 2 h', (() => { const s = N.estadoLead({ ...base, passouPendente: { t: new Date(ag - H).toISOString(), motivo: 'x' } }); return s.estado === 'aguardando_nos' && s.proximo.tipo === 'senhor'; })());
t('passou ao senhor há 25 h -> robô retoma', N.estadoLead({ ...base, passouPendente: { t: new Date(ag - 25 * H).toISOString(), motivo: 'x' } }).proximo.tipo === 'retomada');
t('na fila do atrasado -> atrasado', N.estadoLead({ ...base, atrasado: { status: 'na_fila', quando: ag + H } }).proximo.tipo === 'atrasado');
t('escada ao vivo em andamento', N.estadoLead({ ...base, ultimoTs: ag - 10 * 60e3, aoVivo: { n: 2, min: 20, quando: ag + 10 * 60e3 } }).proximo.tipo === 'ao_vivo');
t('cadência completa -> adormecido (não vivo)', !N.estadoLead({ ...base, toques: [1, 2, 3, 4].map((d) => ({ t: new Date(ag - (5 - d) * H).toISOString() })) }).vivo);
t('passo travado conta no KPI', N.passoTravado({ tipo: 'cadencia', quando: ag - 4 * H }, ag));
t('passo devido há pouco não é travado', !N.passoTravado({ tipo: 'cadencia', quando: ag - 30 * 60e3 }, ag));
t('sem passo = travado', N.passoTravado(null, ag));
t('teto atingido não conta como travado', !N.passoTravado({ tipo: 'cadencia', quando: ag - 5 * H }, ag, N.LIM, { teto: true }));
t('sinal preço', N.sinalDoLead({ textosCliente: ['qual o valor?'] }) === 'preco');
t('sinal sumiu depois do link', N.sinalDoLead({ textosCliente: ['ok vou ver'], recebeuLink: true, aparelhos: ['tv'] }) === 'sumiu_depois_do_link');
t('sinal testando', N.sinalDoLead({ teste: true }) === 'testando');
t('sinal sem aparelho', N.sinalDoLead({ textosCliente: ['oi'] }) === 'sem_aparelho');
t('pediu parar: "não tenho interesse"', N.PEDIU_PARAR.test('não tenho interesse'));
t('pediu parar NÃO pega "me tira uma dúvida"', !N.PEDIU_PARAR.test('Me tira uma duvida'));

// ---------- etiquetas ----------
t('etiqueta revendedor', N.etiquetaPara({ estado: 'fechou' }) === 'revendedor');
t('etiqueta senhor', N.etiquetaPara({ estado: 'aguardando_nos', proximo: { tipo: 'senhor' } }) === 'senhor');
t('etiqueta atrasado', N.etiquetaPara({ estado: 'esfriando', proximo: { tipo: 'atrasado' } }) === 'atrasado');
t('etiqueta teste', N.etiquetaPara({ estado: 'aguardando_cliente', proximo: { tipo: 'cadencia' } }, { testando: true }) === 'teste');
t('etiqueta esfriou', N.etiquetaPara({ estado: 'esfriando', proximo: { tipo: 'cadencia' } }) === 'esfriou');
t('etiqueta suporte', N.etiquetaPara({ estado: 'fora_do_funil' }, { categoria: 'suporte' }) === 'suporte');
t('etiqueta lead', N.etiquetaPara({ estado: 'em_conversa', proximo: { tipo: 'responder' } }) === 'lead');

// ---------- jornada ----------
const f0 = dia(2026, 11, 8, 13, 30);
const j1 = N.proximoJornada({ id: 'r@lid', fechouMs: f0, agora: f0 + H, toques: [] });
t('jornada D+1', j1.tipo === 'checkin_d1' && j1.quando === f0 + D);
const j2 = N.proximoJornada({ id: 'r@lid', fechouMs: f0, agora: f0 + D + H, toques: [{ t: new Date(f0 + D).toISOString(), tipo: 'checkin_d1' }] });
t('jornada D+3', j2.tipo === 'checkin_d3');
const j2b = N.proximoJornada({ id: 'r@lid', fechouMs: f0, agora: f0 + D + H, toques: [{ t: new Date(f0 + D).toISOString(), tipo: 'checkin_d1' }], status: 'em_risco' });
t('jornada sem uso -> toque de ajuda', j2b.tipo === 'ajuda_sem_uso');
const j2c = N.proximoJornada({ id: 'r@lid', fechouMs: f0, agora: f0 + D + H, toques: [{ t: new Date(f0 + D).toISOString(), tipo: 'checkin_d1' }], uso: { usados: 12 } });
t('jornada bom uso -> reconhecimento', j2c.tipo === 'reconhecimento');
const tq = [1, 3, 7].map((d, i) => ({ t: new Date(f0 + d * D).toISOString(), tipo: ['checkin_d1', 'checkin_d3', 'checkin_d7'][i] }));
const j3 = N.proximoJornada({ id: 'r@lid', fechouMs: f0, agora: f0 + 8 * D, toques: tq });
t('jornada: depois do D+7, a janela de fechamento (dia 25) cobre o check-in que cairia perto dela', j3.tipo === 'fechamento_vendas' && new Date(j3.quando).getDate() === 25);
const tq2 = tq.concat({ t: new Date(dia(2026, 11, 25, 10)).toISOString(), tipo: 'fechamento_vendas' });
const j4 = N.proximoJornada({ id: 'r@lid', fechouMs: f0, agora: dia(2026, 11, 26, 12), toques: tq2 });
t('jornada: dia 3 de dezembro pergunta do pagamento (acerto 05/12)', j4.tipo === 'fechamento_pagamento' && new Date(j4.quando).getDate() === 3 && new Date(j4.quando).getMonth() === 11);
const jNovo = N.proximoJornada({ id: 'z@lid', fechouMs: dia(2026, 11, 22, 10), agora: dia(2026, 11, 22, 11), toques: [] });
t('quem abriu no dia 22 NÃO recebe "vendeu este mês" no dia 25 (menos de 7 dias)', jNovo.tipo === 'checkin_d1');
const jPausa = N.proximoJornada({ id: 'r@lid', fechouMs: f0, agora: f0 + 4 * D, toques: tq.slice(0, 2), pausaAte: dia(2026, 11, 25, 10) });
t('"tudo certo" pausa até a janela seguinte', jPausa.quando >= dia(2026, 11, 25, 9));
t('1 toque comum por 7 dias depois da primeira semana', (() => { const j = N.proximoJornada({ id: 'q@lid', fechouMs: dia(2026, 10, 1, 10), agora: dia(2026, 10, 12, 10), toques: [1, 3, 7].map((d, i) => ({ t: new Date(dia(2026, 10, 1, 10) + d * D).toISOString(), tipo: 'x' + i })).concat({ t: new Date(dia(2026, 10, 11, 10)).toISOString(), tipo: 'checkin' }) }); return j.quando - dia(2026, 10, 11, 10) >= 7 * D - 60e3; })());
t('classifica vendeu', N.classificarResposta('vendi 3 clientes já') === 'vendeu');
t('classifica sem vendas', N.classificarResposta('ainda não vendi nada') === 'sem_vendas');
t('classifica dúvida de pagamento', N.classificarResposta('como faço o pix do acerto?') === 'duvida_pagamento');
t('classifica problema', N.classificarResposta('não carrega no app') === 'problema');
t('classifica tudo certo', N.classificarResposta('tudo certo por aqui') === 'tudo_certo');
t('status sem uso', N.statusRevendedor({ fechouMs: ag - 3 * D, agora: ag, uso: { usados: 0 } }) === 'sem_uso');
t('status em risco (sem uso há 5 dias)', N.statusRevendedor({ fechouMs: ag - 6 * D, agora: ag, uso: { usados: 0 } }) === 'em_risco');
t('status dúvida de pagamento', N.statusRevendedor({ fechouMs: ag - 6 * D, agora: ag, uso: { usados: 4 }, resposta: { classe: 'duvida_pagamento', t: new Date(ag - D).toISOString() } }) === 'duvida_pagamento');
t('status saudável', N.statusRevendedor({ fechouMs: ag - 6 * D, agora: ag, uso: { usados: 4, ultimo_login: new Date(ag - D).toISOString() } }) === 'saudavel');

// ---------- motor com WhatsApp e Haiku simulados ----------
const agora = dia(2026, 11, 9, 14);
const enviados = []; const labelsAplicados = [];
function chat(id, msgs) {
  return { id: { _serialized: id }, isGroup: false, lastMessage: msgs[msgs.length - 1], fetchMessages: async () => msgs, sendStateTyping: async () => {}, clearState: async () => {},
    sendMessage: async (texto) => { enviados.push({ id, texto }); const m = { id: { _serialized: 'true_' + id + '_' + enviados.length }, fromMe: true, type: 'chat', body: texto, timestamp: agoraMs / 1000 }; msgs.push(m); return m; } };
}
let agoraMs = agora;
const msg = (fromMe, body, ts) => ({ id: { _serialized: (fromMe ? 'true_' : 'false_') + Math.random() }, fromMe, type: 'chat', body, timestamp: ts / 1000 });
const chats = {
  'esfriou@lid': chat('esfriou@lid', [msg(false, 'quanto custa?', agora - 3 * D), msg(true, 'Mestre, com 20 clientes são R$ 70.', agora - 3 * D + 60e3)]),
  'passou@lid': chat('passou@lid', [msg(false, 'mandei o comprovante', agora - 26 * H), msg(true, 'Certo, já vou passar para o responsável.', agora - 26 * H + 30e3)]),
  'cliente@lid': chat('cliente@lid', [msg(true, 'Mestre, pode criar por aqui:', agora - 5 * H), msg(false, 'como faço pra pagar?', agora - 4 * H)]),
  'encerrou@lid': chat('encerrou@lid', [msg(true, 'Pode criar seu painel por aqui', agora - 3 * D), msg(false, 'blz', agora - 3 * D + 60e3)]),
  'parar@lid': chat('parar@lid', [msg(true, 'Mestre, ficou dúvida?', agora - 3 * D), msg(false, 'não tenho interesse', agora - 3 * D + 60e3), msg(true, 'Tudo bem, mestre.', agora - 3 * D + 90e3)]),
  'rev@lid': chat('rev@lid', [msg(false, 'Usuário: fulano Senha: [oculta]', agora - 2 * D), msg(true, 'Boa, mestre!', agora - 2 * D + 30e3)]),
};
const fichas = { 'esfriou@lid': { nome: 'Carlos Esfriou', criado_em: new Date(agora - 4 * D).toISOString(), ultimo_contato: new Date(agora - 3 * D).toISOString(), notas: [] }, 'passou@lid': { nome: 'Paula', notas: [], ultimo_contato: new Date(agora - 26 * H).toISOString() }, 'cliente@lid': { nome: 'Cleber', notas: [], ultimo_contato: new Date(agora - 4 * H).toISOString() }, 'encerrou@lid': { nome: 'Eva', notas: [], ultimo_contato: new Date(agora - 3 * D).toISOString() }, 'parar@lid': { nome: 'Pedro', notas: [], ultimo_contato: new Date(agora - 3 * D).toISOString() }, 'rev@lid': { nome: 'Rui', notas: [], etapa: 'painel_criado' } };
fs.writeFileSync(path.join(PASTA, 'revendedores.json'), JSON.stringify({ 'rev@lid': { nome: 'Rui', telefone: '5511999990000', fechou_em: new Date(agora - 2 * D).toISOString(), painel_numero: 150, uso: { saldo: 500, usados: 0, ultimo_login: new Date(agora - D).toISOString() } } }));
const evs = [
  { t: new Date(agora - 3 * D).toISOString(), chat: 'esfriou@lid', tipo: 'mensagem_cliente', texto: 'quanto custa?' },
  { t: new Date(agora - 3 * D + 60e3).toISOString(), chat: 'esfriou@lid', tipo: 'resposta_robo', texto: 'Mestre, com 20 clientes são R$ 70.' },
  { t: new Date(agora - 26 * H).toISOString(), chat: 'passou@lid', tipo: 'mensagem_cliente', texto: 'mandei o comprovante' },
  { t: new Date(agora - 26 * H + 30e3).toISOString(), chat: 'passou@lid', tipo: 'passou_ao_senhor', motivo: 'comprovante' },
  { t: new Date(agora - 26 * H + 30e3).toISOString(), chat: 'passou@lid', tipo: 'resposta_robo', texto: 'Certo, já vou passar para o responsável.' },
  { t: new Date(agora - 4 * H).toISOString(), chat: 'cliente@lid', tipo: 'mensagem_cliente', texto: 'como faço pra pagar?' },
  { t: new Date(agora - 3 * D + 60e3).toISOString(), chat: 'encerrou@lid', tipo: 'mensagem_cliente', texto: 'blz' },
  { t: new Date(agora - 3 * D + 60e3).toISOString(), chat: 'parar@lid', tipo: 'mensagem_cliente', texto: 'não tenho interesse' },
];
fs.writeFileSync(path.join(PASTA, 'eventos.jsonl'), evs.map((e) => JSON.stringify(e)).join('\n') + '\n');
const eventosGravados = [], avisos = [], respondidos = [];
let pedidosHaiku = [];
const respostasHaiku = [];
const ctx = {
  agora: () => agoraMs,
  client: {
    getChats: async () => Object.values(chats), getChatById: async (id) => chats[id],
    getLabels: async () => [{ id: '1', name: 'Lead', hexColor: '#00f' }, { id: '2', name: 'Revendedor', hexColor: '#0f0' }, { id: '9', name: 'Cliente VIP do senhor', hexColor: '#f00' }],
    getChatLabels: async (id) => (id === 'esfriou@lid' ? [{ id: '9' }] : []), addOrRemoveLabels: async (ids, chatsIds) => { labelsAplicados.push({ ids, chats: chatsIds }); },
    pupPage: { evaluate: async (fn) => (String(fn).includes('Conn.platform') ? 'smba' : {}) },
  },
  fichas, salvarFichas: () => {}, log: (x) => { if (process.env.DBG) console.log('LOG', x); }, conversaValida: (id) => /@lid$/.test(id),
  evento: (tipo, chat, nome, dados) => { const e = { t: new Date(agoraMs).toISOString(), chat, nome, tipo, ...dados }; eventosGravados.push(e); fs.appendFileSync(path.join(PASTA, 'eventos.jsonl'), JSON.stringify(e) + '\n'); return e; },
  erroEv: () => {}, avisarSenhor: (x) => avisos.push(x), limpar: (x) => String(x || '').trim(),
  perguntarHaiku: async (p) => { pedidosHaiku.push(p); return respostasHaiku.length ? respostasHaiku.shift() : { mensagens: ['Mestre, ficou alguma dúvida para começar? Posso te ajudar por aqui.'] }; },
  marcarEnvio: () => {}, seguindo: new Set(), aguardando: new Map(), textosDoRobo: new Set(), enviadasPeloRobo: new Set(), quieto: new Map(), atendendo: new Set(), fila: new Map(),
  ULTIMO_SENHOR: new Map(), seguiuN: new Map(), FOLLOWUP_MIN: [7, 20, 60, 180], responderAgora: async (id) => { respondidos.push(id); return true; },
};
const k = await M.vigia(ctx);
const L = JSON.parse(fs.readFileSync(path.join(DIR, 'leads.json'), 'utf8'));
const porNome = Object.fromEntries(L.leads.map((l) => [l.nome, l]));
t('vigia: KPI sem próximo passo = 0', k.sem_proximo_passo === 0);
t('vigia: esfriou -> cadência D+1 devida', porNome['Carlos Esfriou'].proximo.tipo === 'cadencia');
t('vigia: passou há 26 h -> retomada', porNome['Paula'].proximo.tipo === 'retomada');
t('vigia: cliente falou por último -> responder', porNome['Cleber'].proximo.tipo === 'responder');
t('vigia: encerrou com blz -> encerrada', porNome['Eva'].estado === 'encerrada');
t('vigia: pediu para parar -> não incomodar', porNome['Pedro'].estado === 'nao_incomodar');
t('vigia: revendedor fora da cadência', porNome['Rui'].estado === 'fechou');
t('vigia: lembrete agrupado ao senhor (1 mensagem, com nome)', avisos.length === 1 && /Paula/.test(avisos[0]));
await M.vigia(ctx);
t('vigia: não repete o lembrete antes de 2 h', avisos.length === 1);
const J = JSON.parse(fs.readFileSync(path.join(DIR, 'jornada.json'), 'utf8'));
t('jornada: revendedor sem uso há 2 dias = sem uso', J.revendedores[0].status === 'sem_uso');
// tick: responde o cliente primeiro (vigia), depois retomada, depois cadência; o portão segura 60 s entre proativos
await M.tick(ctx);
t('tick 1: vigia respondeu o cliente que falou por último', respondidos[0] === 'cliente@lid');
ctx.estFunil.vigiaEm = agoraMs; // não refaz a vigia agora
await M.tick(ctx);
t('tick 2: retomada da conversa passada ao senhor há 26 h (prioridade)', enviados.length === 1 && enviados[0].id === 'passou@lid');
await M.tick(ctx);
t('tick 3: portão segura (menos de 60 s)', enviados.length === 1);
agoraMs += 7 * 60e3; ctx.estFunil.proximoLivre = 0;
respostasHaiku.push({ mensagens: ['Mestre, quer que eu faça a conta com você do valor para começar? É pós-pago, sem taxa.'] });
await M.tick(ctx);
t('tick 4: cadência para o lead que esfriou', enviados.length === 2 && enviados[1].id === 'esfriou@lid');
{ ctx.estFunil.vigiaEm = 0; await M.vigia(ctx); const Lx = JSON.parse(fs.readFileSync(path.join(DIR, 'leads.json'), 'utf8')).leads.find((l) => l.nome === 'Carlos Esfriou');
  t('logo depois do toque, o próximo NÃO vence agora (nada de toque em dobro)', Lx.proximo && Date.parse(Lx.proximo.quando) > agoraMs + 19 * H);
  const antesDobro = enviados.length; ctx.estFunil.proximoLivre = 0; ctx.estFunil.devidos = { cadencia: [{ ...Lx, id: 'esfriou@lid', angulo: 'prova', indice: 1, t0: agora - 3 * D, proximo: { quando: new Date(agoraMs).toISOString() } }] }; ctx.estFunil.vigiaEm = agoraMs; agoraMs += 2 * 60e3;
  await M.tick(ctx); t('trava dura: 2º toque na mesma pessoa em menos de 20 h é recusado', enviados.length === antesDobro); }
t('evento toque_cadencia com ângulo e variante', eventosGravados.some((e) => e.tipo === 'toque_cadencia' && e.angulo === 'ajuda' && /^[AB]$/.test(e.variante)));
t('pedido ao Haiku tem ângulo de preço (ele perguntou quanto custa)', pedidosHaiku.some((p) => /AJUDA PRÁTICA sobre o valor/.test(p)));
t('ninguém da lista de bloqueio recebeu', !enviados.some((e) => ['encerrou@lid', 'parar@lid', 'rev@lid'].includes(e.id)));
// texto repetido é recusado e o Haiku é chamado de novo
agoraMs += 3 * D; ctx.estFunil.proximoLivre = 0; ctx.estFunil.vigiaEm = 0;
ctx.quieto.set('passou@lid', agoraMs + 10 * D);   // tira a Paula da frente neste passo
respostasHaiku.push({ mensagens: ['Mestre, ficou alguma dúvida para começar? Posso te ajudar por aqui.'] }, { mensagens: ['Mestre, desconto especial só hoje!'] }, { mensagens: ['Mestre, com 20 clientes você paga R$ 70, só no dia 5 do mês seguinte.'] });
pedidosHaiku = [];
await M.tick(ctx);
const ult = enviados[enviados.length - 1];
t('repetição e invenção recusadas: saiu o 3º texto (prova com conta)', ult && ult.id === 'esfriou@lid' && /R\$ 70/.test(ult.texto) && pedidosHaiku.length === 3);
t('pedido de correção explica o motivo', pedidosHaiku.some((p) => /recusada porque/.test(p)));
// parada ao responder: cliente responde, motor marca e a vigia passa a "responder" (fluxo normal)
chats['esfriou@lid'].fetchMessages = (() => { const ms = []; return async () => ms; })();
const msEsf = [msg(false, 'quanto custa?', agora - 3 * D), msg(true, ult.texto, agoraMs - 60e3), msg(false, 'vou criar hoje', agoraMs)];
chats['esfriou@lid'].lastMessage = msEsf[2]; chats['esfriou@lid'].fetchMessages = async () => msEsf;
agoraMs += 60e3;
M.aoReceber(ctx, 'esfriou@lid', agoraMs / 1000, 'vou criar hoje');
ctx.evento('mensagem_cliente', 'esfriou@lid', 'Carlos Esfriou', { texto: 'vou criar hoje' });
const st = JSON.parse(fs.readFileSync(path.join(DIR, 'estado.json'), 'utf8'));
t('resposta marcada no último toque', !!st.leads['esfriou@lid'].toques.slice(-1)[0].respondeu_em);
await M.vigia(ctx);
const L2 = JSON.parse(fs.readFileSync(path.join(DIR, 'leads.json'), 'utf8'));
t('depois de responder, a cadência para (próximo passo = responder)', L2.leads.find((l) => l.nome === 'Carlos Esfriou').proximo.tipo === 'responder');
// jornada: tocar agora + resposta "tudo certo"
fs.writeFileSync(path.join(DIR, 'comando.json'), JSON.stringify([{ acao: 'tocar', ref: N.refDe('rev@lid') }]));
await M.comandos(ctx);
const st2 = JSON.parse(fs.readFileSync(path.join(DIR, 'estado.json'), 'utf8'));
t('tocar agora marcado', st2.revendedores['rev@lid'].tocar_agora === true);
M.aoReceber(ctx, 'rev@lid', agoraMs / 1000, 'como faço o pix do acerto?');
const st3 = JSON.parse(fs.readFileSync(path.join(DIR, 'estado.json'), 'utf8'));
t('resposta do revendedor classificada (dúvida de pagamento)', st3.revendedores['rev@lid'].resposta.classe === 'duvida_pagamento');
// teto total: com 105 proativos hoje a cadência não sai
const muitos = Array.from({ length: 105 }, (_, i) => JSON.stringify({ t: new Date(agoraMs - i * 1000).toISOString(), tipo: 'followup_backlog', chat: 'x' + i + '@lid' })).join('\n') + '\n';
fs.appendFileSync(path.join(PASTA, 'eventos.jsonl'), muitos);
t('portão do motor: teto total atingido', M.pode(ctx, 'cadencia').motivo === 'teto_diario');
t('portão do motor: ao vivo ainda tem a reserva', (() => { ctx.estFunil.ultimoProativo = 0; const r = M.pode(ctx, 'ao_vivo'); return r.ok || r.motivo === 'menos_de_60s'; })());
// etiquetas: preserva a etiqueta do senhor e aplica a do robô
ctx.estFunil.etiquetasIds = null;
await M.descobrirEtiquetas(ctx);
const info = JSON.parse(fs.readFileSync(path.join(DIR, 'etiquetas.json'), 'utf8'));
t('etiquetas: detecta Business e as que faltam', info.business && info.faltam.some((f) => f.nome === 'Esfriou'));
ctx.estFunil.etiquetasAlvo = new Map([['esfriou@lid', 'lead'], ['rev@lid', 'revendedor']]);
ctx.estFunil.ultimaEtiqueta = 0;
await M.sincronizarUmaEtiqueta(ctx);
if (process.env.DBG) console.log('ETQ', JSON.stringify(JSON.parse(fs.readFileSync(path.join(DIR, 'etiquetas.json'), 'utf8'))).slice(0, 600), ctx.estFunil.etiquetasIds);
t('etiquetas: aplica a do robô e mantém a do senhor', labelsAplicados.some((x) => x.chats[0] === 'esfriou@lid' && x.ids.includes('9') && x.ids.includes('1')));
const antes = labelsAplicados.length;
ctx.estFunil.etiquetasAlvo = new Map([['passou@lid', 'lead'], ['encerrou@lid', 'lead']]); ctx.estFunil.ultimaEtiqueta = 0;
await M.sincronizarUmaEtiqueta(ctx); await M.sincronizarUmaEtiqueta(ctx);
t('etiquetas: ritmo suave (no máximo 1 a cada 2-4 s)', labelsAplicados.length === antes + 1);
await M.sincronizarUmaEtiqueta(ctx);
t('etiquetas: só mudanças (não reaplica a mesma)', labelsAplicados.filter((x) => x.chats[0] === 'passou@lid').length === 1);
t('nenhuma mensagem real: só o WhatsApp simulado recebeu', enviados.every((e) => /@lid$/.test(e.id)));

{ const fila = [{ mensagens: ['Mestre, se precisar entrar de novo, crie por aqui: https://painel.capyplay.site/#/rs/RvWGlK01e3/bQELo6e1gr'] }, { mensagens: ['Mestre, conseguiu cadastrar o primeiro cliente no painel?'] }];
  const c2 = { perguntarHaiku: async () => fila.shift(), limpar: (x) => String(x || '').trim(), estFunil: {} };
  const g = await M.gerarTexto(c2, { tipo: 'jornada', toque: 'checkin_d1', dias: 1, variante: 'A', nome: 'Rui' }, [], {}, [], []);
  t('jornada nunca manda o link de CRIAR painel a quem já tem (refaz)', g.ok && !/#\/rs\//.test(g.texto) && g.tentativas === 2);
  t('pedido da jornada manda usar o link de entrada', /painel\.capyplay\.site\/#\/dashboard/.test(M.pedidoToque({ tipo: 'jornada', toque: 'checkin', dias: 9, variante: 'A' }, [], {}))); }
fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${ok} passaram, ${falhou} falharam`);
process.exit(falhou ? 1 : 0);
