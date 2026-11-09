// Testes do agente das lacunas. Tudo em pasta temporária, com modelo simulado (stub) e painel simulado: não gasta token,
// não abre o Chrome, não toca em lacunas\estado.json real nem em relatorios\aprendizados.* reais, não manda mensagem a ninguém.
//   node relatorios\testar-lacunas.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const PASTA = path.resolve(AQUI, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lacunas-teste-'));
process.env.LACUNAS_MAX_DIA = '50';
process.env.LACUNAS_DIR = path.join(TMP, 'lac'); process.env.LACUNAS_REL = path.join(TMP, 'rel');
fs.mkdirSync(process.env.LACUNAS_REL, { recursive: true });
const L = await import(path.join(PASTA, 'lacunas.mjs').replace(/\\/g, '/').replace(/^([A-Z]):/, 'file:///$1:'));
const ARQ = L.ARQ;

let passou = 0, falhou = 0; const falhas = [];
const ok = (c, nome, extra = '') => { if (c) passou++; else { falhou++; falhas.push(nome + (extra ? ' -> ' + extra : '')); } };
const lerJ = (f, p) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return p; } };
const lerT = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
const reset = () => { for (const f of fs.readdirSync(L.DIR)) if (!/^prompt-/.test(f)) fs.rmSync(path.join(L.DIR, f), { recursive: true, force: true }); for (const f of fs.readdirSync(process.env.LACUNAS_REL)) fs.rmSync(path.join(process.env.LACUNAS_REL, f), { force: true }); };
const agente = (id, extra = [], env = {}) => spawnSync(process.execPath, [path.join(PASTA, 'aprender-lacuna.mjs'), id, ...extra], { env: { ...process.env, ...env }, encoding: 'utf8', timeout: 60000 });
const saida = (r) => { try { return JSON.parse(r.stdout.trim().split('\n').pop()); } catch { return { erro_parse: r.stdout + r.stderr }; } };
const stubArq = (obj, nome = 'stub.json') => { const f = path.join(TMP, nome); fs.writeFileSync(f, JSON.stringify(obj)); return f; };
const painelStub = path.join(TMP, 'painel.json');
fs.writeFileSync(painelStub, JSON.stringify({ ok: true, obtido_em: '2026-11-08T12:00:00Z', fatos: [
  { id: 'preco_creditos', fonte: '/api/creditpackages/price', titulo: 'Compra de créditos avulsos', linhas: ['pacote de 10 créditos: R$ 3,50 cada', 'pacote de 100 créditos: R$ 3,00 cada'] },
  { id: 'mensalista', fonte: '/api/membershipplans', titulo: 'Planos mensalistas', linhas: ['Mensalista Dia 5 mais de 100 ativos: R$ 3,00 por cliente ativo'] },
  { id: 'pacotes', fonte: '/api/packages', titulo: 'Pacotes', linhas: ['TESTE COMPLETO SEM ADULTO: 0 crédito(s); duração 6 HOURS; é TESTE'] },
] }));
const seguro = { pergunta_canonica: 'Quanto custa cada crédito?', resposta_sugerida: 'Cada crédito custa R$ 3,50 e vale uma tela.', fatos_do_painel: [{ fato: 'pacote de 10 créditos: R$ 3,50 cada', fonte: '/api/creditpackages/price' }], confianca: 0.93, tipo: 'regra_segura', confirmado_no_base: true, contradiz_base: false, regra_para_base: 'Se perguntarem o preço do crédito, diga que cada crédito custa R$ 3,50 e vale uma tela.', motivo_precisa_senhor: '' };

// ============ 1. dedupe e similaridade ============
{
  reset();
  const a = L.registrarLacuna({ chat: '1111@lid', nome1: 'Digital Tv', pergunta: 'Funciona com pré-pago?', motivo: 'sem_informacao_no_base' });
  const b = L.registrarLacuna({ chat: '2222@lid', nome1: 'Fox Streaming', pergunta: 'Ou tem pré pago tbm?', motivo: 'nao_entendeu' });
  const c = L.registrarLacuna({ chat: '3333@lid', nome1: 'Maria Souza', pergunta: 'Existe plano pre-pago?', motivo: 'sem_informacao_no_base' });
  const d = L.registrarLacuna({ chat: '4444@lid', nome1: 'João', pergunta: 'Qual é o preço do crédito?', motivo: 'sem_informacao_no_base' });
  const e = L.registrarLacuna({ chat: '1111@lid', nome1: 'Digital Tv', pergunta: 'funciona com pré pago??', motivo: 'sem_informacao_no_base' });
  ok(a.nova && a.id === 'L1', 'dedupe: primeira cria L1');
  ok(!b.nova && b.id === a.id && !c.nova && c.id === a.id, 'dedupe: três jeitos de perguntar pré-pago viram UMA lacuna', JSON.stringify([a, b, c]));
  ok(d.nova && d.id !== a.id, 'dedupe: pergunta diferente (preço do crédito) é outra lacuna');
  const it = L.obter(a.id);
  ok(it.ocorrencias === 4, 'dedupe: contador de ocorrências = 4', String(it.ocorrencias));
  ok(it.clientes.length === 3, 'dedupe: o mesmo cliente perguntando de novo não duplica na lista de espera', String(it.clientes.length));
  ok(it.clientes.map((x) => x.nome1).join() === 'Digital,Fox,Maria', 'dedupe: só primeiro nome', it.clientes.map((x) => x.nome1).join());
  ok(it.motivos.includes('nao_entendeu') && it.motivos.includes('sem_informacao_no_base'), 'motivos acumulados');
  ok(L.pendentesParaResposta(a.id).length === 3, 'pendentesParaResposta lista os 3');
  ok(L.similaridade('qual o preço do crédito', 'funciona com pré-pago?') < 0.3, 'similaridade: assuntos diferentes ficam abaixo do limiar');
  ok(L.similaridade('Funciona com pré-pago?', 'Existe plano pré-pago?') >= 0.6, 'similaridade: mesma pergunta acima do limiar');
  ok(L.registrarLacuna({ chat: 'x@lid', pergunta: 'ok' }).ignorada, 'pergunta vazia/curta é ignorada');
}

// ============ 2. privacidade ============
{
  reset();
  L.registrarLacuna({ chat: '5511970521624@c.us', nome1: 'Carlos Alberto', pergunta: 'Meu e-mail é joao@gmail.com e a senha: segredo123 como renovo?', contexto: ['Cliente: meu telefone 11 97052-1624', 'Revenda: usuario 4455667788 senha 998877', 'Cliente: oi'], motivo: 'nao_entendeu' });
  L.registrarLacuna({ chat: '9999@lid', nome1: 'Ana', pergunta: 'Posso usar o cartão de outra pessoa?', contexto: 'Cliente: ligue 21 99999-8888\nRevenda: ok', motivo: 'fora_do_roteiro' });
  const arquivos = ['lacunas.jsonl', 'estado.json', 'eventos-lacunas.jsonl'].map((f) => lerT(path.join(L.DIR, f))).join('\n');
  ok(!/segredo123|998877|joao@gmail|97052|99999-8888|\d{9,}/.test(arquivos), 'privacidade: sem senha, e-mail nem telefone em jsonl/estado/eventos', (arquivos.match(/segredo123|998877|joao@gmail|97052|99999-8888|\d{9,}/) || [''])[0]);
  ok(/Carlos/.test(arquivos) && !/Alberto/.test(arquivos), 'privacidade: só o primeiro nome');
  const ag = lerT(ARQ.aguardando);
  ok(/5511970521624@c\.us/.test(ag) && !/senha|@gmail/.test(ag), 'chat fica só em aguardando.json (operacional)');
  const it = L.listar({})[0];
  ok(!('chat' in (it.clientes[0] || {})), 'item público não traz o chat');
}

// ============ 3. detecção a partir da resposta do Haiku ============
{
  const d = (r, m = [], u = 'Tem pré-pago?') => L.detectarLacuna({ r, mensagens: m, ultimaMensagem: u });
  ok(d({ lacuna: 'Existe pré-pago?', avisar: false })?.motivo === 'sem_informacao_no_base', 'detecção: campo lacuna');
  ok(d({ avisar: true, motivo: 'Perguntou algo que não está aqui' })?.motivo === 'sem_informacao_no_base', 'detecção: avisar com "não está aqui"');
  ok(d({ avisar: true, motivo: 'Não entendi o que a pessoa quer' })?.motivo === 'nao_entendeu', 'detecção: não entendeu');
  ok(d({ avisar: true, motivo: '' })?.motivo === 'avisar_sem_motivo_claro', 'detecção: avisar sem motivo claro');
  ok(d({ avisar: true, motivo: 'Recarga de crédito' }) === null, 'detecção: recarga nunca vira lacuna');
  ok(d({ avisar: true, motivo: 'Mandou comprovante' }) === null, 'detecção: comprovante nunca vira lacuna');
  ok(d({ avisar: true, motivo: 'Pessoa brava reclamando' }) === null, 'detecção: pessoa brava nunca vira lacuna');
  ok(d({ lacuna: 'algo qualquer', avisar: true, motivo: 'Recarga' }) === null, 'detecção: campo lacuna não vence a regra de rotina');
  ok(d({ avisar: false }, ['Não tenho essa informação aqui.'])?.motivo === 'sem_informacao_no_base', 'detecção: "não tenho essa informação" na resposta');
  ok(d({ avisar: false }, ['Boa, mestre! O acerto é dia 5.']) === null, 'detecção: resposta normal não é lacuna');
}

// ============ 4. estados e API ============
{
  reset();
  const r = L.registrarLacuna({ chat: 'a@lid', nome1: 'Beto', pergunta: 'Dá para pagar com cartão de crédito no painel?', motivo: 'sem_informacao_no_base' });
  ok(L.obter(r.id).status === 'nova', 'estado: nasce nova');
  L.marcar(r.id, 'investigando', { tentativas: 1 });
  ok(L.obter(r.id).status === 'investigando' && L.obter(r.id).tentativas === 1, 'estado: investigando');
  let erro = null; try { L.marcar(r.id, 'inventado'); } catch (e) { erro = e; } ok(!!erro, 'estado: status inválido recusado');
  erro = null; try { L.marcar('../../x', 'nova'); } catch (e) { erro = e; } ok(!!erro, 'estado: id inválido recusado (sem path traversal)');
  L.marcar(r.id, 'precisa_senhor', { resposta_sugerida: 'Pelo painel o pagamento sai por QR Code.', confianca: 0.7, tipo: 'precisa_senhor', motivo_precisa_senhor: 'Falta confirmar.' });
  const s = L.resumoLacunas();
  ok(s.resumo.precisa_senhor === 1 && s.resumo.novas === 0 && s.resumo.ocorrencias_total === 1, 'API: resumo conta por status', JSON.stringify(s.resumo));
  const camposItem = ['id', 'quando', 'pergunta', 'ocorrencias', 'clientes_aguardando', 'motivo', 'status', 'resposta_sugerida', 'fatos_do_painel', 'confianca', 'tipo', 'regra_para_base', 'resolvido_em'];
  ok(camposItem.every((k) => k in s.itens[0]) && 'gerado_em' in s, 'API: contrato /api/lacunas completo');
  ok(L.reinvestigar(r.id).status === 'nova', 'reinvestigar volta para nova');
  L.marcar(r.id, 'precisa_senhor', { resposta_sugerida: 'Só por QR Code no painel.' });
  const ap = L.aprovar(r.id, { resposta: 'Pode pagar pelo QR Code que o painel gera.' });
  ok(L.obter(r.id).status === 'aprendida' && L.obter(r.id).resultado.aprovada_por === 'senhor', 'aprovar: vira aprendida (pelo senhor)');
  ok(/lacuna 1/.test(lerT(ARQ.aprendizadosMd)) && /QR Code/.test(lerT(ARQ.aprendizadosMd)), 'aprovar: regra entra no aprendizados.md');
  ok(L.aprovar(r.id, { resposta: 'x' }) && true, 'aprovar de novo não quebra');
  const r2 = L.registrarLacuna({ chat: 'b@lid', nome1: 'Caio', pergunta: 'Vocês aceitam criptomoeda?', motivo: 'sem_informacao_no_base' });
  L.descartar(r2.id);
  ok(L.obter(r2.id).status === 'descartada' && L.pendentesParaResposta(r2.id).length === 0, 'descartar: some da espera');
  const r3 = L.registrarLacuna({ chat: 'b@lid', nome1: 'Caio', pergunta: 'Vocês aceitam criptomoeda?', motivo: 'sem_informacao_no_base' });
  ok(r3.nova && r3.id !== r2.id, 'descartada não recebe duplicatas novas (pergunta volta como nova)');
}

// ============ 5. a guarda: nada de dinheiro, prazo, política ou link novo entra sozinho ============
{
  const ctx = { painelTexto: 'pacote de 100 créditos: R$ 3,00 cada\nMensalista mais de 100 ativos: R$ 3,00', fontesOk: ['/api/creditpackages/price', 'base.md'] };
  const base = { ...seguro };
  const caso = (nome, mudar, esperado) => { const r = L.decidirResultado({ ...base, ...mudar }, ctx); ok(r.tipo === esperado, 'guarda: ' + nome, r.tipo + ' | ' + r.motivos.join(' / ')); return r; };
  caso('regra confirmada e sem nada novo é segura', {}, 'regra_segura');
  caso('preço novo (R$ 3,00 acima de 100) vai ao senhor mesmo estando no painel', { resposta_sugerida: 'Acima de 100 créditos cada um custa R$ 3,00.', regra_para_base: 'Acima de 100 créditos o preço é R$ 3,00.' }, 'precisa_senhor');
  caso('link novo vai ao senhor', { resposta_sugerida: 'Pague em https://novo-site.com/pagar para renovar.' }, 'precisa_senhor');
  caso('link que já está no base.md é permitido', { resposta_sugerida: 'Pague pelo QR Code em https://painel.capyplay.site/#/membership/renew', regra_para_base: 'Para pagar, mande o link de renovação do base.' }, 'regra_segura');
  caso('prazo novo vai ao senhor', { resposta_sugerida: 'O teste dura 48 horas.' }, 'precisa_senhor');
  caso('desconto vai ao senhor', { resposta_sugerida: 'Damos desconto para quem fecha logo.' }, 'precisa_senhor');
  caso('promessa/garantia vai ao senhor', { resposta_sugerida: 'Garantimos o dinheiro de volta.' }, 'precisa_senhor');
  caso('confiança baixa vai ao senhor', { confianca: 0.79 }, 'precisa_senhor');
  caso('modelo disse precisa_senhor', { tipo: 'precisa_senhor', motivo_precisa_senhor: 'dúvida' }, 'precisa_senhor');
  caso('contradiz o base.md vai ao senhor', { contradiz_base: true }, 'precisa_senhor');
  caso('sem nenhuma confirmação vai ao senhor', { fatos_do_painel: [], confirmado_no_base: false }, 'precisa_senhor');
  const inv = caso('fato com fonte inventada é descartado (e sem base não é seguro)', { fatos_do_painel: [{ fato: 'Existe plano pré-pago', fonte: '/api/inventado' }], confirmado_no_base: false }, 'precisa_senhor');
  ok(inv.fatos.length === 0, 'guarda: fonte inventada não aparece nos fatos');
  const num = L.decidirResultado({ ...base, fatos_do_painel: [{ fato: 'pacote de 77 créditos: R$ 9,99', fonte: '/api/creditpackages/price' }], confirmado_no_base: false }, ctx);
  ok(num.fatos.length === 0, 'guarda: fato com número que não existe no painel é descartado');
}

// ============ 6. agente de ponta a ponta com modelo simulado ============
{
  reset();
  const base = ['--painel-stub', painelStub];
  // 6a. regra segura vira aprendida, com clientes esperando
  const r1 = L.registrarLacuna({ chat: '1001@lid', nome1: 'Paulo Reis', pergunta: 'Quanto custa cada crédito mesmo?', motivo: 'sem_informacao_no_base' });
  L.registrarLacuna({ chat: '1002@lid', nome1: 'Rita', pergunta: 'qual o valor de cada crédito?', motivo: 'sem_informacao_no_base' });
  const o1 = saida(agente(r1.id, base, { LACUNA_STUB: stubArq(seguro) }));
  ok(o1.ok && o1.status === 'aprendida' && o1.retornos_gerados === 2, 'agente: regra segura -> aprendida com 2 retornos', JSON.stringify(o1));
  ok(/\[lacuna 1\] Se perguntarem o preço do crédito/.test(lerT(ARQ.aprendizadosMd)), 'agente: regra entrou no aprendizados.md marcada com a lacuna');
  ok(L.obter(r1.id).resultado.fatos_do_painel.length === 1 && L.obter(r1.id).resultado.custo_usd === 0, 'agente: fatos e custo gravados');
  // 6b. idempotência
  const md1 = lerT(ARQ.aprendizadosMd), ret1 = lerT(ARQ.retornos);
  const o2 = saida(agente(r1.id, base, { LACUNA_STUB: stubArq(seguro) }));
  ok(o2.ja_resolvida === true, 'idempotência: lacuna resolvida não é refeita');
  ok(lerT(ARQ.aprendizadosMd) === md1 && lerT(ARQ.retornos) === ret1, 'idempotência: nada muda no aprendizados.md nem nos retornos');
  ok(L.sincronizarAprendizados().mudou === false && L.gerarRetornos(r1.id) === 0, 'idempotência: sincronizar e gerar retornos de novo não duplicam');
  // 6c. nada de dinheiro/prazo/link novo entra sozinho, mesmo com o modelo jurando que é seguro
  const perigosos = [
    ['preço novo', { resposta_sugerida: 'Acima de 100 créditos cada um sai por R$ 3,00.', regra_para_base: 'Acima de 100 créditos custa R$ 3,00 cada.' }],
    ['link novo', { resposta_sugerida: 'Veja em https://outro-site.net/precos', regra_para_base: 'Mande https://outro-site.net/precos para preços.' }],
    ['prazo novo', { resposta_sugerida: 'O teste vale por 72 horas.', regra_para_base: 'O teste vale 72 horas.' }],
    ['desconto', { resposta_sugerida: 'Tem desconto para quem leva mais.', regra_para_base: 'Ofereça desconto para volume.' }],
  ];
  const mdAntes = lerT(ARQ.aprendizadosMd);
  perigosos.forEach(([nome, mud], i) => {
    const q = L.registrarLacuna({ chat: `20${i}@lid`, nome1: 'Teste' + i, pergunta: `Pergunta perigosa número ${i} sobre ${['mensalidade', 'plataforma', 'duração', 'bonificação'][i]} especial`, motivo: 'sem_informacao_no_base' });
    const o = saida(agente(q.id, base, { LACUNA_STUB: stubArq({ ...seguro, ...mud, confianca: 0.99 }) }));
    ok(o.status === 'precisa_senhor' && !o.retornos_gerados, 'agente: ' + nome + ' vira precisa_senhor, sem retorno', JSON.stringify(o));
  });
  ok(lerT(ARQ.aprendizadosMd) === mdAntes, 'agente: nenhuma regra perigosa entrou no aprendizados.md');
  ok(!/R\$ 3,00|outro-site|72 horas|desconto/.test(lerT(ARQ.aprendizadosMd)), 'agente: textos perigosos ausentes do aprendizados.md');
  ok(JSON.parse(lerT(ARQ.retornos) || '[]').every((r) => r.lacuna === r1.id), 'agente: retornos só da lacuna segura');
  // 6d. 2 tentativas e para
  const f = L.registrarLacuna({ chat: '3001@lid', nome1: 'Falha', pergunta: 'Pergunta cujo modelo nunca responde direito', motivo: 'nao_entendeu' });
  const bad = path.join(TMP, 'nao-existe.json');
  const t1 = saida(agente(f.id, base, { LACUNA_STUB: bad }));
  ok(t1.status === 'nova' && L.obter(f.id).tentativas === 1, '1ª tentativa sem resposta: volta para nova', JSON.stringify(t1));
  const t2 = saida(agente(f.id, base, { LACUNA_STUB: bad }));
  ok(t2.status === 'precisa_senhor' && L.obter(f.id).tentativas === 2, '2ª tentativa sem resposta: vai ao senhor (sem loop)', JSON.stringify(t2));
  const t3 = saida(agente(f.id, base, { LACUNA_STUB: bad }));
  ok(t3.ja_resolvida === true && L.obter(f.id).tentativas === 2, 'sem 3ª tentativa');
  // 6e. fila de 1 por vez
  const g = L.registrarLacuna({ chat: '4001@lid', nome1: 'Fila', pergunta: 'Qual horário de atendimento do suporte oficial?', motivo: 'sem_informacao_no_base' });
  fs.writeFileSync(ARQ.investigando, JSON.stringify({ id: 'Lx', pid: 1, t: Date.now() }));
  const oc = saida(agente(g.id, base, { LACUNA_STUB: stubArq(seguro) }));
  ok(oc.ok === false && /ocupado/.test(oc.motivo || ''), 'fila: com outra investigação rodando, esta espera', JSON.stringify(oc));
  ok(L.investigacaoOcupada() === true && L.dispararInvestigacao(g.id) === false, 'fila: dispararInvestigacao recusa quando ocupado');
  fs.rmSync(ARQ.investigando, { force: true });
  ok(L.investigacaoOcupada() === false, 'fila: trava libera');
  { const ol = saida(agente(g.id, base, { LACUNA_STUB: stubArq(seguro), LACUNAS_MAX_DIA: '1' })); ok(ol.ok === false && /limite di/.test(ol.motivo || ''), 'limite: teto de investigações por dia respeitado', JSON.stringify(ol)); ok(L.obter(g.id).status === 'nova' && L.obter(g.id).tentativas === 0, 'limite: lacuna fica nova para o dia seguinte'); }
  // 6f. pergunta sem conteúdo não gasta modelo
  const v = L.registrarLacuna({ chat: '5001@lid', nome1: 'Vazio', pergunta: 'ahn sim ok?', motivo: 'avisar_sem_motivo_claro' });
  const ov = saida(agente(v.id, base, { LACUNA_STUB: stubArq(seguro) }));
  ok(ov.status === 'descartada', 'relevância: pergunta sem conteúdo é descartada sem gastar modelo', JSON.stringify(ov));
  // 6g. dry-run só estima
  const dry = saida(agente(g.id, ['--dry', ...base]));
  ok(dry.dry === true && dry.custo_estimado_usd > 0 && dry.fontes_painel.length >= 3, 'dossiê: --dry mostra tamanho e custo estimado', JSON.stringify(dry));
  ok(L.obter(g.id).status === 'nova', 'dossiê: --dry não altera nada');
}

// ============ 7. limite de linhas do aprendizados.md e convivência com o aprender.mjs ============
{
  reset();
  const outras = Array.from({ length: 25 }, (_, i) => ({ regra: `Regra de comportamento número ${i + 1} do atendimento.`, desde: '2026-11-08T10:00:00Z' }));
  fs.writeFileSync(ARQ.aprendizadosJson, JSON.stringify({ rodadas: [], regras_ativas: outras }));
  for (let i = 0; i < 14; i++) {
    const q = L.registrarLacuna({ chat: null, nome1: '', pergunta: `Dúvida inédita ${i} sobre aplicativo${'abcdefghijklmn'[i]} da televisão`, motivo: 'sem_informacao_no_base' });
    L.concluirAprendida(q.id, { resposta: `Resposta número ${i} sobre o aplicativo.`, regra: `Se perguntarem do aplicativo ${i}, mande o vídeo do aparelho.`, auto: true });
  }
  const linhas = () => lerT(ARQ.aprendizadosMd).split('\n').filter((l) => /^- /.test(l));
  ok(linhas().length <= 25, 'limite: aprendizados.md tem no máximo 25 linhas', String(linhas().length));
  ok(linhas().filter((l) => /\[lacuna /.test(l)).length === 10, 'limite: no máximo 10 regras de lacuna ativas (as mais novas)', String(linhas().filter((l) => /\[lacuna /.test(l)).length));
  // simula uma rodada do aprender.mjs: põe 5 regras novas na frente e corta em 25 (é o que ele faz)
  const h = JSON.parse(lerT(ARQ.aprendizadosJson));
  h.regras_ativas = [...Array.from({ length: 5 }, (_, i) => ({ regra: 'Nova regra da rodada ' + i + ' do aprendizado.', desde: 'agora' })), ...h.regras_ativas].slice(0, 25);
  fs.writeFileSync(ARQ.aprendizadosJson, JSON.stringify(h));
  L.sincronizarAprendizados();
  ok(linhas().length <= 25 && linhas().filter((l) => /\[lacuna /.test(l)).length === 10, 'limite: depois de uma rodada do aprender.mjs as regras de lacuna continuam lá', linhas().length + '/' + linhas().filter((l) => /\[lacuna /.test(l)).length);
  ok(linhas().some((l) => /Nova regra da rodada 0/.test(l)), 'limite: regras da rodada também sobrevivem');
}

// ============ 8. retorno ao cliente ============
{
  reset();
  const q = L.registrarLacuna({ chat: '6001@lid', nome1: 'Ana Lima', pergunta: 'Cada crédito vale uma tela só?', motivo: 'sem_informacao_no_base' });
  L.registrarLacuna({ chat: '6002@lid', nome1: 'Bruno', pergunta: 'cada crédito vale quantas telas?', motivo: 'sem_informacao_no_base' });
  L.registrarLacuna({ chat: '6003@lid', nome1: 'Carla', pergunta: 'o crédito vale uma tela?', motivo: 'sem_informacao_no_base' });
  ok(L.obter(q.id).ocorrencias === 3, 'retorno: 3 clientes na mesma lacuna');
  ok(L.proximosRetornos({ agora: new Date(2026, 10, 8, 10, 0) }).length === 0, 'retorno: nada antes de aprender');
  const c = L.concluirAprendida(q.id, { resposta: 'Cada crédito vale uma tela. Cliente com duas telas usa dois créditos.', regra: 'Cada crédito vale uma tela.', auto: true });
  ok(c.retornos === 3, 'retorno: 3 mensagens de retorno geradas', String(c.retornos));
  const lista = JSON.parse(lerT(ARQ.retornos));
  ok(lista.length === 3 && lista.every((r) => r.status === 'pendente' && r.mensagens.length <= 4 && /^Mestre, voltei/.test(r.mensagens[0])), 'retorno: mensagens "mestre", no máximo 4');
  ok(!lista.some((r) => r.mensagens.join(' ').match(/Ana|Bruno|Carla/)), 'retorno: nunca chama pelo nome');
  ok(lista.every((r) => !/[\u{1F300}-\u{1FAFF}*]/u.test(r.mensagens.join(' '))), 'retorno: sem emoji nem asterisco');
  const hora = (h, m = 0) => new Date(2026, 10, 8, h, m);
  ok(L.proximosRetornos({ agora: hora(8, 59) }).length === 0 && L.proximosRetornos({ agora: hora(20, 0) }).length === 0 && L.proximosRetornos({ agora: hora(23, 30) }).length === 0 && L.proximosRetornos({ agora: hora(3) }).length === 0, 'retorno: nada fora das 9h às 20h');
  const p1 = L.proximosRetornos({ agora: hora(10, 0) });
  ok(p1.length === 1, 'retorno: um por vez (ritmo calmo)');
  ok(L.confirmarRetorno(p1[0].id, { enviado: true }) === true, 'retorno: bot confirma o envio');
  { const e1 = JSON.parse(lerT(ARQ.estado)); e1.ultimo_retorno_em = hora(10, 0).toISOString(); fs.writeFileSync(ARQ.estado, JSON.stringify(e1)); }
  ok(L.proximosRetornos({ agora: hora(10, 2) }).length === 0, 'retorno: 2 min depois do último envio ainda espera (ritmo calmo)');
  ok(L.proximosRetornos({ agora: hora(10, 5) }).length === 1, 'retorno: 5 min depois libera o próximo');
  ok(L.pendentesParaResposta(q.id).length === 2, 'retorno: quem recebeu sai da espera');
  ok(L.cancelarRetornos('6002@lid') === 1 && L.pendentesParaResposta(q.id).length === 1, 'retorno: se o senhor respondeu na mão, cancela');
  const velho = JSON.parse(lerT(ARQ.retornos)); velho.find((r) => r.status === 'pendente').ate = '2020-01-01T00:00:00Z'; fs.writeFileSync(ARQ.retornos, JSON.stringify(velho));
  const e0 = JSON.parse(lerT(ARQ.estado)); e0.ultimo_retorno_em = null; fs.writeFileSync(ARQ.estado, JSON.stringify(e0));
  ok(L.proximosRetornos({ agora: hora(11, 0) }).length === 0 && JSON.parse(lerT(ARQ.retornos)).some((r) => r.status === 'expirado'), 'retorno: expira depois de 72 h');
  // precisa_senhor não manda nada; aprovar gera
  const w = L.registrarLacuna({ chat: '7001@lid', nome1: 'Dora', pergunta: 'Vocês trabalham com cartão de crédito parcelado?', motivo: 'sem_informacao_no_base' });
  L.marcar(w.id, 'precisa_senhor', { resposta_sugerida: 'Hoje o pagamento é por QR Code no painel.', tipo: 'precisa_senhor' });
  ok(L.gerarRetornos(w.id) === 0, 'retorno: precisa_senhor não gera retorno');
  L.aprovar(w.id, { resposta: 'Hoje o pagamento é pelo QR Code do painel.' });
  ok(JSON.parse(lerT(ARQ.retornos)).some((r) => r.lacuna === w.id && r.status === 'pendente'), 'retorno: ao aprovar, o retorno é gerado');
}

// ============ 8b. ordem da fila e espera entre tentativas ============
{
  reset();
  const a = L.registrarLacuna({ chat: 'f1@lid', nome1: 'A', pergunta: 'Como funciona o assunto raro unico?', motivo: 'sem_informacao_no_base' });
  const b = L.registrarLacuna({ chat: 'f2@lid', nome1: 'B', pergunta: 'Quanto tempo leva a ativação do painel novo?', motivo: 'sem_informacao_no_base' });
  L.registrarLacuna({ chat: 'f3@lid', nome1: 'C', pergunta: 'quanto tempo demora ativar o painel novo?', motivo: 'sem_informacao_no_base' });
  ok(L.proximaParaInvestigar() === b.id, 'fila: a lacuna com mais ocorrências é investigada primeiro');
  L.marcar(b.id, 'investigando', { tentativas: 1 }); L.marcar(b.id, 'nova', { tentativas: 1 });
  ok(L.proximaParaInvestigar() === a.id, 'fila: depois de uma falha espera 10 min antes de tentar de novo (passa a vez)');
  L.marcar(a.id, 'investigando', { tentativas: 1 });
  ok(L.proximaParaInvestigar() === null, 'fila: investigando não entra na fila de novo');
}

// ============ 9. concorrência entre processos (bot, servidor e agente escrevendo juntos) ============
{
  reset();
  const filho = (k) => new Promise((res) => {
    const cod = `process.env.LACUNAS_DIR=${JSON.stringify(process.env.LACUNAS_DIR)};process.env.LACUNAS_REL=${JSON.stringify(process.env.LACUNAS_REL)};import(${JSON.stringify('file:///' + path.join(PASTA, 'lacunas.mjs').replace(/\\/g, '/'))}).then(L=>{for(let i=0;i<20;i++)L.registrarLacuna({chat:'c'+${k}+'_'+i+'@lid',nome1:'P'+${k},pergunta:'palavraunica'+${k}+'x'+i+' outrotermo'+${k}+'x'+i+' terceiraideia'+${k}+'x'+i,motivo:'sem_informacao_no_base'})})`;
    const p = spawn(process.execPath, ['-e', cod], { stdio: 'ignore' }); p.on('close', res);
  });
  await Promise.all([0, 1, 2, 3].map(filho));
  const todas = L.listar({ limite: 1000 });
  ok(todas.length === 80, '4 processos gravando juntos: 80 lacunas, nenhuma perdida', String(todas.length));
  ok(new Set(todas.map((x) => x.id)).size === 80, 'ids únicos');
  ok(lerJ(ARQ.estado, null) !== null, 'estado.json continua íntegro');
}

// ============ 10. painel só leitura e arquivos sem segredo ============
{
  const lei = lerT(path.join(PASTA, 'painel-leitura.mjs')), fat = lerT(path.join(PASTA, 'painel-fatos.mjs'));
  ok(/setRequestInterception\(true\)/.test(lei) && /rq\.abort\(/.test(lei) && /m !== 'GET'/.test(lei), 'painel: escritas (POST/PUT/PATCH/DELETE) são abortadas no navegador');
  ok(/method: 'GET'/.test(lei) && !/method: '(POST|PUT|PATCH|DELETE)'/.test(lei + fat), 'painel: a função de leitura usa só GET');
  const pl = await import('file:///' + path.join(PASTA, 'painel-leitura.mjs').replace(/\\/g, '/'));
  let recusou = 0; for (const rota of ['/api/customers/abc/delete?x=1;rm', 'https://evil.example/api/x', '/logout', '/api/../etc']) { try { await pl.get({ evaluate: async () => ({}) }, rota); } catch { recusou++; } }
  ok(recusou === 4, 'painel: rotas fora de /api/ ou estranhas são recusadas', String(recusou));
  const lim = pl.limpar({ username: 'Maria Souza', password: 'x', token: 't', email: 'a@b.com', whatsapp: '5511999', data: [{ m3u_url: 'http://x', name: 'Pacote' }], texto: 'fale com joao@x.com 11999998888' });
  ok(!('password' in lim) && !('token' in lim) && !('email' in lim) && !('whatsapp' in lim) && !('m3u_url' in lim.data[0]) && lim.username === 'Maria' && !/joao@|11999998888/.test(JSON.stringify(lim)), 'painel: limpar() tira senha, token, e-mail, telefone e deixa só o primeiro nome');
  // arquivos reais de dados do agente (tudo menos aguardando/retornos, que guardam o chat para o bot responder)
  const real = path.join(PASTA, 'lacunas');
  const alvo = ['lacunas.jsonl', 'estado.json', 'eventos-lacunas.jsonl', 'mapa-do-painel.json', 'painel-cache.json', 'regras-lacunas.json'].map((f) => path.join(real, f)).concat(path.join(AQUI, 'web', 'mock', 'lacunas.json'), path.join(AQUI, 'aprendizados.md'));
  const ruim = /\d{9,}|senha\s*[:=]|bearer|password|@gmail|@hotmail|"token"|api[_-]?key/i;
  for (const f of alvo) { const t = lerT(f); if (t) ok(!ruim.test(t), 'sem telefone/senha/token em ' + path.basename(f), (t.match(ruim) || [''])[0]); }
  const mapa = lerJ(path.join(real, 'mapa-do-painel.json'), null);
  ok(mapa && mapa.rotas?.length > 20 && Array.isArray(mapa.escritas_bloqueadas) && mapa.escritas_bloqueadas.length === 0, 'mapa do painel existe, com páginas lidas e zero escritas', mapa ? mapa.rotas.length + ' páginas' : 'ausente');
}

// ============ 11. mock da tela ============
{
  const m = lerJ(path.join(AQUI, 'web', 'mock', 'lacunas.json'), null);
  ok(m && m.resumo && Array.isArray(m.itens) && m.itens.length >= 5 && ['novas', 'investigando', 'aprendidas', 'precisa_senhor', 'descartadas', 'ocorrencias_total'].every((k) => k in m.resumo), 'mock: relatorios\\web\\mock\\lacunas.json segue o contrato');
  const st = new Set((m?.itens || []).map((x) => x.status)); ok(['nova', 'investigando', 'aprendida', 'precisa_senhor', 'descartada'].every((s) => st.has(s)), 'mock: cobre os 5 estados');
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${passou} passaram, ${falhou} falharam`);
if (falhou) { console.log(falhas.map((f) => ' - ' + f).join('\n')); process.exit(1); }
