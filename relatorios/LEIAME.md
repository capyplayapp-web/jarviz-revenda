# Relatórios do robô da revenda

**Abrir:** http://127.0.0.1:8811/ (só no PC do senhor, nada vai para a internet).

## O que tem aqui
- `server.mjs`: servidor local (127.0.0.1:8811). Serve a pasta `web\` e a API: `GET /api/resumo?dias=1|7`, `GET /api/revendedores`, `GET /api/ping`, `POST /api/aprender`.
- `aprender.mjs`: lê as últimas 2 h de conversa e gera os aprendizados (uma chamada ao Haiku). Sob demanda: `node relatorios\aprender.mjs --agora` ou o botão da tela.
- `historico.mjs`: refaz os eventos de um dia a partir do `conversas.log` (`node relatorios\historico.mjs 2026-11-08`).
- `testar.mjs`: valida o contrato da API com os dados reais e confere que não há senha nos arquivos.
- `lib.mjs`: leitura dos dados e cálculo do resumo.
- Versão do robô (09/11/2026): `GET /api/versoes` devolve `..\versoes.json` (lido a cada chamada); o selo `v…` no cabeçalho abre o histórico com o estado da revisão (`web\versoes.js` e `versoes.css`). **A cada mudança no robô, subir `"atual"` e incluir a entrada nova (versao, data, titulo, mudancas, arquivos) no topo de `versoes.json`;** o revisor acrescenta `"revisao"` depois.

## Onde ficam os dados (pasta do robô, `..\`)
- `eventos.jsonl`: um evento por linha, gravado pelo bot (mensagem do cliente, resposta, follow-up, passou ao senhor, teste, painel fechado, senhor escreveu, repetição bloqueada, erro, conversa nova). Senha nunca entra.
- `eventos-historico.jsonl`: o dia reconstruído do log (`origem: "historico"`). Vale só até o primeiro evento ao vivo.
- `revendedores.json`: quem fechou painel (nome, telefone, usuário, quando, `painel_id`, `painel_numero`). Sem senha.
- `relatorios\aprendizados.json`: histórico de cada leitura de 2 h. `relatorios\aprendizados.md`: regras aprovadas (até 25, as mais novas primeiro), que o bot junta ao `base.md` no prompt do Haiku.
- Nota do cofre, atualizada sozinha pelo servidor: `D:\CAPY\CapyPlay_Obsidian\07 Atendimento WPP\12 Revendedores que fecharam painel.md`.

## Como liga
O `bot.js` confere a cada minuto se o servidor responde em `/api/ping` e, se não, liga `relatorios\server.mjs` sozinho (processo separado, sobrevive a reinício do robô). Para reiniciar só o servidor: encerre o `node` que roda `server.mjs`; o robô o religa em até 1 minuto. Mudou o `server.mjs` ou o `lib.mjs`? Faça isso.

## Leitura de 2 h
O bot chama `aprender.mjs --auto` a cada 10 min; ele só roda se passou o intervalo e houve conversa nova. Mudar o intervalo: crie `relatorios\config.json` com `{"intervalo_horas": 2, "janela_horas": 2}`. Regras que falam de preço, prazo, link, pagamento ou política não entram sozinhas: ficam em `sugestoes_para_o_senhor`.

## Painéis fechados
Conta quando o cliente manda "Usuário/Senha" do painel que criou, ou quando o robô marca a etapa "painel criado". O id e o número vêm da lista de revendedores do painel (somente leitura, pelo Chrome logado do robô); `painel_numero` é a ordem de criação (1 = o mais antigo) e `painel_id` é o identificador do painel (não existe número simples). O contato é salvo no WhatsApp como "Nome · painel N".

## Limites
- Tempo da primeira resposta no histórico de hoje é aproximado (o log marca a hora do processamento, não da chegada).
- A tela de hoje antes do bot novo vem do histórico; a partir do reinício vem dos eventos ao vivo.

## Backlog de follow-ups (08/11/2026)
Conversas antigas (até 14 dias) mapeadas, cadastradas, renomeadas e com um follow-up por conversa elegível, enviado **devagar e com travas**. Código em `..\backlog.js` (o `bot.js` carrega e recarrega sozinho quando o arquivo muda) e API em `backlog-lib.mjs`.

**Arquivos (pasta do robô):** `backlog.json` (mapa), `backlog-fila.json` (fila: `na_fila|enviado|respondeu|fechou_painel|descartado`), `backlog-config.json` (`{"modo":"piloto"|"completo"}`), `backlog-estado.json` (estado do motor), `backlog-comando.json` (pedido de mapeamento), `backlog-pausado` (se existir, nada é enviado), `backlog-classificar.md` (instrução do Haiku). Eventos: `followup_backlog` (cada envio), `backlog_respondeu`, `backlog_fechou_painel` em `eventos.jsonl`.

**Travas (não mudam por configuração):** só entre 9h e 20h; 1 envio a cada 60 a 120 s (sorteado); no máximo 120 por dia; "digitando..." antes de cada envio; 3 erros de envio seguidos criam `backlog-pausado` e avisam o senhor no Telegram; nunca envia para quem fechou painel, disse que não quer, é suporte/cliente final/pagamento, equipe/parceiro, grupo, contato que o senhor salvou com nome próprio, quem o senhor atendeu na mão nos últimos 3 dias ou quem já recebeu follow-up do backlog. Antes de cada envio a conversa é lida de novo: se a pessoa voltou sozinha ou alguém falou depois do mapa, não envia. Segundo e último follow-up só depois de 24 h sem resposta (a escada ao vivo 7/20/60/180 min não vale para o backlog). Em modo `piloto` só saem os itens com `piloto:true`.

**Como usar:**
- Mapear de novo: `POST /api/backlog/mapear` com `{"dias":14}` (ou gravar `backlog-comando.json` = `{"acao":"mapear","dias":14}`). Leva uns 15 min (leitura, Haiku em lotes de 5, renomeio e texto). Não envia nada. Acompanhe em `GET /api/backlog` (`estado.mapeamento`).
- Pausar: `POST /api/backlog/pausar` ou criar `backlog-pausado`. Retomar: `POST /api/backlog/retomar` (libera o modo completo; `{"modo":"piloto"}` retoma só o piloto) ou apagar `backlog-pausado` e trocar o modo em `backlog-config.json`.
- Os POST exigem `Content-Type: application/json` e (se houver) `Origin` local: uma página qualquer do navegador não consegue liberar os envios.
- Rotas de leitura: `GET /api/followups?dias=1|7` (contrato combinado com a tela) e `GET /api/backlog` (estado, contagens, mapa e fila). Telefone sempre mascarado (`•••• 1234`) e sem o id da conversa.
- Testes: `node relatorios\testar-backlog.mjs` (dados simulados, nenhum envio real).
- Mudou `server.mjs` ou `backlog-lib.mjs`? Reinicie o servidor (encerre o `node` do `server.mjs`; o robô religa em 1 min). Mudou só o `backlog.js`? Não precisa reiniciar nada.
