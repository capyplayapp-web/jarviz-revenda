# Lacunas de conhecimento: o robô aprende o que não sabia (08/11/2026)

Pedido do senhor por Telegram em 08/11/2026: "quando ele não entender alguma coisa ou não tiver informação tem que ir para uma área que automaticamente ele chama um agente para aprender sobre aquilo, usando a API do painel, para aprimorar o atendimento."

Status: **construído e testado, NÃO ligado**. Nada em `bot.js`, `base.md`, `relatorios\server.mjs` ou `relatorios\web\` foi alterado. Os passos abaixo são para quem for o dono desses arquivos aplicar.

## Como funciona (resumo)

```
cliente pergunta algo que o robô não sabe
   -> bot.js detecta (campo "lacuna", avisar "não está aqui" ou "não tenho essa informação")
   -> lacunas.mjs registrarLacuna()   [dedupe: perguntas iguais viram UMA lacuna com contador e lista de espera]
   -> aprender-lacuna.mjs (em segundo plano, 1 por vez)
        dossiê = pergunta + contexto + base.md + regras aprendidas + fatos do painel (só leitura)
        Sonnet devolve JSON {resposta, fatos+fonte, confiança, tipo, regra}
        guarda: dinheiro, desconto, prazo, política, promessa ou link que NÃO está no base.md => precisa_senhor
   -> regra_segura (confiança >= 0,8, confirmada) : entra em relatorios\aprendizados.md e gera o retorno aos clientes que esperavam
   -> precisa_senhor                               : fica na área "Lacunas" do Dashboard; o senhor aprova, edita ou descarta
   -> bot manda o retorno (só 9h às 20h, um por vez, "mestre")
```

## Arquivos

| Arquivo | Para quê |
|---|---|
| `lacunas.mjs` | Registro, dedupe, estados, API (`resumoLacunas`, `aprovar`, `descartar`, `reinvestigar`), retornos, fila, regras. Síncrono e seguro entre processos. |
| `aprender-lacuna.mjs` | O agente: `node aprender-lacuna.mjs L12 [--avisar] [--forcar] [--dry]`. Imprime um JSON na última linha. |
| `painel-leitura.mjs` | Sessão de leitura do painel (cópia do perfil, só GET, escritas bloqueadas). |
| `painel-fatos.mjs` | As 14 fontes de fatos do painel e o mapa (`--mapear`, `--fatos`). |
| `lacunas\prompt-lacuna.md` | Instrução do Sonnet. |
| `lacunas\lacunas.jsonl` | Cada ocorrência (uma linha). `lacunas\estado.json`: índice por lacuna. |
| `lacunas\aguardando.json` e `respostas-pendentes.json` | Os ÚNICOS arquivos com o id do chat (o bot precisa para responder). Todo o resto guarda só o primeiro nome. |
| `lacunas\regras-lacunas.json` | Regras aprendidas pelas lacunas (as 10 mais novas entram no prompt). |
| `lacunas\mapa-do-painel.json` | O que cada página do painel mostra e qual chamada de leitura ela faz (43 páginas, 26 abertas, 17 deliberadamente não abertas). |
| `lacunas\painel-cache.json` | Fatos lidos (resumidos, sem dados pessoais), validade 3 h. |
| `lacunas\eventos-lacunas.jsonl` | Eventos para o relatório: lacuna_registrada, lacuna_repetida, lacuna_investigando, lacuna_aprendida, lacuna_precisa_senhor, lacuna_descartada, retornos_gerados, retorno_enviado. |
| `relatorios\testar-lacunas.mjs` | 115 testes com modelo e painel simulados. |
| `relatorios\web\mock\lacunas.json` | Dados fictícios para a tela. |

## Passo a passo de integração

### 1. base.md (quem edita o base.md)

a) No "Formato da sua saída", acrescentar o campo `"lacuna": ""` ao JSON:

```
{"mensagens": ["primeira mensagem"], "videos": [], "teste": false, "depois": [], "guia": "", "memoria": {"etapa": "explicando", "resumo": "..."}, "avisar": false, "motivo": "", "lacuna": ""}
```

b) Nova seção (antes de "Quando chamar o responsável"):

```
# Lacunas (quando você não sabe)
- Se a pessoa perguntar algo que NÃO está neste texto, ou se você não entender o que ela quer, preencha "lacuna" com a pergunta dela resumida em UMA frase curta, sem nome, sem telefone e sem senha. Exemplo: "Funciona com pré-pago?".
- Nunca preencha "lacuna" quando for recarga, comprovante, problema técnico, reclamação ou pessoa brava (esses seguem "avisar"), nem quando você souber responder.
- Quando preencher "lacuna", não invente a resposta. Diga com honestidade que vai confirmar (ex.: "Vou confirmar isso, mestre."). O retorno com a resposta chega depois, sozinho.
```

Modo A (recomendado para começar): manter `avisar = true` em "Perguntou algo que não está aqui". O senhor continua sendo avisado e a conversa fica quieta como hoje; a lacuna é registrada em paralelo, sem mudar o comportamento. Modo B (depois de confiar): para dúvida só de informação, `lacuna` preenchida e `avisar = false` (sem silêncio de 5 min); o retorno vem quando a lacuna for aprendida ou aprovada.

### 2. bot.js (quem é dono do bot.js)

2.1 Junto dos outros `require` do topo (Node 24 carrega o `.mjs` com `require`; testado):

```js
const lac = require('./lacunas.mjs');                             // lacunas de conhecimento (LACUNAS.md)
```

2.2 Detecção e registro. Dentro de `atenderCore`, logo antes de `salvarFichas();` do final (hoje na linha `if (r.avisar) { ficha(chatId).ultimo_aviso = r.motivo || ''; }`), cobre as três situações (campo `lacuna`, `avisar` com "não está aqui", resposta "não tenho essa informação"), e nunca para recarga, comprovante ou pessoa brava:

```js
  // Lacunas de conhecimento (08/11/2026): registra e chama o agente em segundo plano, sem bloquear a conversa.
  try {
    const det = lac.detectarLacuna({ r, mensagens: lista, ultimaMensagem: ultima._textoAudio || ultima.body || '' });
    if (det) {
      const reg = lac.registrarLacuna({ chat: chatId, nome1: nome, pergunta: det.pergunta, contexto: texto.split('\n').slice(-6), motivo: det.motivo, origem: 'bot' });
      if (reg.id) { evento('lacuna_registrada', chatId, nome, { id: reg.id, motivo: det.motivo, nova: reg.nova, ocorrencias: reg.ocorrencias }); lac.drenarFila(); }
    }
  } catch (e) { log('lacuna não registrada: ' + e.message); }
```

2.3 Tick de 1 minuto: libera a fila de investigação (no máximo uma por vez, 6 por dia), mantém as regras no `aprendizados.md` e manda os retornos (só 9h às 20h, um por vez, 4 min entre eles). Colocar junto dos outros `setInterval`:

```js
setInterval(async () => {
  try {
    lac.drenarFila();                                              // sincroniza regras e começa a próxima investigação
    if (fs.existsSync(PAUSADO)) return;
    for (const rt of lac.proximosRetornos({ max: 1 })) {
      if (atendendo.has(rt.chat) || (quieto.get(rt.chat) || 0) > Date.now()) continue;
      try {
        const chat = await client.getChatById(rt.chat);
        for (const m of rt.mensagens) { await enviar(chat, limpar(m), rt.chat, { lacuna: rt.lacuna, retorno: true }); log(`robô -> ${rt.chat}: [retorno da lacuna ${rt.lacuna}] ${m}`); }
        lac.confirmarRetorno(rt.id, { enviado: true });
      } catch (e) { lac.confirmarRetorno(rt.id, { enviado: false, erro: e.message }); log('retorno de lacuna falhou: ' + e.message); }
    }
  } catch (e) { log('lacunas: ' + e.message); }
}, 60000);
```

2.4 Quando o senhor responde na mão, cancelar o retorno daquela pessoa (no mesmo ponto onde já grava `evento('senhor_escreveu', ...)`, perto da linha 268):

```js
  try { lac.cancelarRetornos(msg.to); } catch {}
```

### 3. relatorios\server.mjs (quem é dono do server)

Import no topo: `import * as lac from '../lacunas.mjs';`. Rotas, junto das outras `if (rota === ...)`:

```js
    if (rota === '/api/lacunas' && req.method === 'GET') return json(res, 200, lac.resumoLacunas({ limite: 100 }));
    if (rota.startsWith('/api/lacunas/') && req.method === 'POST') {
      const partes = []; let tam = 0;
      for await (const p of req) { tam += p.length; if (tam > 4096) return json(res, 413, { erro: 'corpo grande demais' }); partes.push(p); }
      let corpo = {}; try { corpo = JSON.parse(Buffer.concat(partes).toString('utf8') || '{}'); } catch { return json(res, 400, { erro: 'JSON inválido' }); }
      const acao = rota.slice('/api/lacunas/'.length);
      if (!lac.ehId(corpo.id)) return json(res, 400, { erro: 'id inválido' });
      try {
        if (acao === 'aprovar') lac.aprovar(corpo.id, { resposta: typeof corpo.resposta === 'string' ? corpo.resposta.slice(0, 600) : undefined });
        else if (acao === 'descartar') lac.descartar(corpo.id);
        else if (acao === 'reinvestigar') { lac.reinvestigar(corpo.id); lac.drenarFila({ avisar: false }); }
        else return json(res, 404, { erro: 'ação desconhecida' });
        return json(res, 200, { ok: true, item: lac.obter(corpo.id) });
      } catch (e) { return json(res, 400, { erro: String(e.message || e) }); }
    }
```

O servidor escuta só em 127.0.0.1; não liberar essas rotas de POST na nuvem sem login.

### 4. Tela (quem edita relatorios\web)

Contrato (igual ao mock `relatorios\web\mock\lacunas.json`):

`GET /api/lacunas` retorna `{ gerado_em, resumo: { novas, investigando, aprendidas, precisa_senhor, descartadas, ocorrencias_total, custo_usd_total }, itens: [{ id, quando, pergunta, ocorrencias, clientes_aguardando, motivo, status, resposta_sugerida, fatos_do_painel: [{ fato, fonte }], confianca, tipo, regra_para_base, motivo_precisa_senhor, resolvido_em }] }`. Ordem já vem pronta: precisa_senhor, nova, investigando, aprendida, descartada.

Ações: `POST /api/lacunas/aprovar {id, resposta?}` (a resposta editada vira a regra e o retorno), `/descartar {id}`, `/reinvestigar {id}`.

Sugestão de tela (padrão do app): área "A aprender" com contador de `precisa_senhor` em destaque; cada cartão mostra a pergunta, quantos clientes esperam, a resposta sugerida editável, os fatos do painel com a fonte e três botões (Aprovar, Editar e aprovar, Descartar). Estado vazio: "Nenhuma dúvida nova. O robô respondeu tudo que perguntaram."

### 5. Nó no mapa (grafo.mjs, de outro agente, não editado)

`lacunas\estado.json` tem `itens` com `status`, `ocorrencias`, `clientes` (`atendido`), `pergunta_canonica` e `resultado.regra_para_base`. O `grafo.mjs` já mostra as regras de `aprendizados.json`, e as regras vindas de lacunas entram lá com `origem: "lacuna"` (aparecem como "regra aprendida" sozinhas). Para mostrar a lacuna ANTES de resolver, acrescentar perto do bloco "Regras aprendidas" (~linha 427):

```js
  // Lacunas de conhecimento: "A aprender" até resolver; depois viram regra aprendida (o nó de regra já vem do aprendizados.json)
  const lacEst = lerJson(path.join(PASTA, 'lacunas', 'estado.json'), { itens: {} });
  for (const it of Object.values(lacEst.itens || {})) {
    if (it.status === 'descartada' || it.status === 'aprendida') continue;
    const id = 'lac:' + it.id, espera = (it.clientes || []).filter((c) => !c.atendido).length;
    no({ id, tipo: 'lacuna', rotulo: limpar(it.pergunta_canonica || it.pergunta, 90), peso: Math.max(1, it.ocorrencias), desde: iso(it.criado_em), grupo: it.status === 'precisa_senhor' ? 'a_aprender_senhor' : 'a_aprender',
      detalhe: it.status === 'precisa_senhor' ? 'O agente achou uma resposta, mas só o senhor pode aprovar (envolve preço, prazo ou política).' : 'O robô não soube responder; o agente está aprendendo.',
      fatos: [['Perguntaram', it.ocorrencias], ['Esperando resposta', espera], ['Situação', it.status]] });
    liga(id, /painel|criar|link|cadastr/i.test(it.pergunta) ? 'etapa:link' : /pag|acerto|renov|vence/i.test(it.pergunta) ? 'etapa:criou' : 'etapa:soube', 'acontece_em', it.ocorrencias);
  }
```

Quando a lacuna vira `aprendida`, o nó `lac:` some e a regra aparece como "regra aprendida" (grupo `aprovada`), ligada ao tema pelo mesmo mecanismo das outras regras. Para ligar a regra à lacuna de origem, o texto da regra começa com `[lacuna N]`.

### 6. Versão celular (nuvem), opcional

Para a tela do celular, incluir `lac.resumoLacunas()` no snapshot de `sync-nuvem.mjs` (campo `lacunas`). Aprovar pelo celular exige um comando novo na fila de comandos da nuvem; não faz parte desta entrega.

## O que o agente lê no painel (somente leitura)

Painel Sigma `painel.capyplay.site`, conta mestre, pela sessão do Chrome do robô. Como o bot usa o mesmo perfil `perfil-painel` para o teste grátis, o agente trabalha numa CÓPIA mínima do perfil (só login), apagada ao final: nunca briga com o bot pelo Chrome. Só GET em `/api/*`; qualquer POST/PUT/PATCH/DELETE é abortado no navegador (nas 26 páginas mapeadas: 0 escritas do painel, só telemetria do Cloudflare).

Fontes de fatos (cada uma é um GET): planos mensalistas (R$ 3,50 e R$ 3,00 por faixa, dia 5), link de cadastro (modelo, 500 créditos iniciais, visitas e cadastros), preço dos créditos avulsos, faixas de preço, pedidos de crédito (só totais), pacotes e testes (6 h, 0 crédito), avisos do painel, regras para revendedores e para clientes, servidores, lista padrão (DNS), integrações, total de revendedores, configuração pública. Páginas com dados pessoais (clientes, revendedores, logins, sessões, auditoria) NÃO são abertas; estão no mapa com o motivo.

Se a sessão do painel cair, o agente não chuta: marca `painel_erro` e manda a lacuna ao senhor com a explicação. Conserto: no PC do senhor, `node teste-gratis.js --login`, entrar no painel na janela que abrir e fechar a janela (é o mesmo login do teste grátis; serve aos dois).

## Guardas (o que nunca entra sozinho)

- Qualquer R$, link, prazo (dias, horas, meses, %), data ou palavra de política (desconto, promoção, cupom, garantia, reembolso, promessa, bônus, multa, juros) que NÃO esteja literalmente no `base.md` ou nas regras já aprovadas vira `precisa_senhor`, mesmo que o painel confirme e o modelo jure que é seguro.
- Confiança abaixo de 0,80, resposta que contradiz o base, ausência de fato do painel ou do base confirmando, ou fato com fonte/número inventado: `precisa_senhor`.
- Para `precisa_senhor` nada é enviado a cliente. Ao aprovar, a regra entra e o retorno é gerado.
- No máximo 2 tentativas por lacuna (espera de 10 min entre elas), 1 investigação por vez, 6 por dia, timeout de 6 min. Pergunta sem conteúdo é descartada sem gastar modelo.
- Se uma lacuna já aprendida volta 3 vezes, ela é reaberta como `precisa_senhor` (a regra não resolveu).
- As regras de lacuna ocupam no máximo 10 das 25 linhas do `aprendizados.md`; `drenarFila()` (a cada minuto) as recoloca se uma rodada do `aprender.mjs` empurrar para fora.

## Custo

Sonnet, uma chamada por lacuna nova e relevante. Dossiê de ~16 mil caracteres (~9 mil tokens de entrada). Execução real: US$ 0,043 por lacuna (6 s). Estimativa antes de rodar: `node aprender-lacuna.mjs L12 --dry` (US$ 0,040 para a mesma lacuna). No teto de 6 por dia: até US$ 0,26 por dia. O robô e as leituras de 2 h continuam no Haiku. Leitura do painel: sem custo de crédito.

## Comandos úteis

```
node relatorios\testar-lacunas.mjs            testes (sem token, sem Chrome, sem tocar nos dados reais)
node aprender-lacuna.mjs L1 --dry             só mostra tamanho e custo estimado
node aprender-lacuna.mjs L1 --forcar          reinvestiga mesmo resolvida
node painel-fatos.mjs --fatos                 lê as fontes do painel (resumo)
node painel-fatos.mjs --mapear                refaz lacunas\mapa-do-painel.json
```

Opcional: `lac.importarDeAprendizados()` transforma as `perguntas_nao_cobertas` das leituras de 2 h em lacunas (sem cliente esperando). Fica desligado por padrão (cada uma vira uma investigação paga).

## Limites conhecidos

- A deduplicação é por palavras (com radicais e sinônimos como pré-pago/antecipado, preço/valor/custa). Perguntas iguais com palavras muito diferentes ("posso abrir e fazer uns testes?" e "o painel pode ser testado sem custo?") ainda podem virar duas lacunas; a pergunta canônica que o agente grava reduz isso nas próximas.
- A cópia do perfil leva ~1 s a mais por investigação; o cache de 3 h evita abrir o Chrome de novo em lacunas seguidas.
- `aprender.mjs` não tem trava de gravação em `aprendizados.json`; se rodar no mesmo segundo que uma aprovação, uma das duas escritas pode se perder (a regra de lacuna volta no minuto seguinte, pois está em `regras-lacunas.json`).
