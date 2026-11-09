# Estratégia de funil do robô da revenda (ligada em 08/11/2026)

Pedido do senhor: "fecharmos os painéis, nunca deixar um lead para trás, ir aprendendo e criando estratégia de funil" e (20h59) "jornada com os revendas que têm painel". Tudo roda dentro do `bot.js`, pelo motor `funil\motor.js` (recarregado sozinho quando o arquivo muda; o bot espera 3 min depois de ligar antes de qualquer envio proativo).

## Peças

| Peça | Onde | O que faz |
|---|---|---|
| Vigia de leads | `motor.js` `vigia()` a cada 2 min | Dá estado e PRÓXIMO PASSO a cada lead (21 dias). KPI "leads sem próximo passo" (meta 0); alerta no Telegram se ficar > 0 por mais de 1 h (no máximo a cada 3 h). Responde conversa com a última palavra do cliente (3 min a 48 h). Lembrete agrupado ao senhor (passou ao senhor há 2 h+, 1 mensagem com nomes, no máximo a cada 2 h, 9h-21h). Se ninguém pegar em 24 h, o robô retoma com uma mensagem útil. |
| Cadência de dias | `motor.js` + `nucleo.js` | D+1 ajuda prática (por sinal: preço, sumiu depois do link, testando, sem aparelho, pergunta aberta), D+3 prova com conta, D+7 benefício (canal e Escola), D+14 porta aberta, depois adormecido. Máximo 5 toques de dias em 21 dias (o 1º toque do atrasado conta). Para na hora se ele responder, fechar painel ou pedir para parar. |
| Jornada do revendedor | `motor.js` + `nucleo.js` | Quem tem painel: D+1 (primeiro cliente?), D+3, D+7, depois 1 check-in a cada 7-10 dias; fechamento do mês: dia 25 (vendeu?) e dia 3 (dúvida no pagamento? acerto dia 5; nunca manda link de pagamento). Uso real do painel (só leitura: saldo de créditos e último acesso) muda o toque: sem uso = ajuda; bom uso = reconhecimento. "Tudo certo" pausa até a próxima janela. Resposta classificada (vendeu, sem vendas, dúvida de pagamento, problema, tudo certo) na ficha. |
| Portão (fila única) | `motor.js` `pode()`/`registrar()` | Teto TOTAL de 120 proativos/dia (escada ao vivo + atrasado + cadência + jornada + retomada + retorno de lacuna); os de baixa prioridade param em 105 (15 ficam para a escada). Nunca 2 proativos a menos de 60 s. Ritmo uniforme (tempo que resta / o que falta, entre 60 s e 6 min, ±30%). Prioridade: ao vivo > retomada > lacuna > cadência > jornada > atrasado. Cliente sendo respondido segura os proativos. Janela 9h-20h (a escada ao vivo segue a regra antiga do senhor, 8h-21h). |
| Filtro contra invenção | `nucleo.js` `filtrarTexto()` | Barra: sem "mestre", nome da pessoa, emoji, formatação, mais de 3 frases, link fora do base.md, número/valor fora do base.md, % e palavras proibidas (relatório do revendedor, programa/top revendas, desconto, promoção, cupom, bônus, garantia, reembolso, vagas, urgência, depoimento...). Contra repetição: igual ou parecido (trigramas 60%) com textos já mandados ao lead ou a outros, e abertura igual aos 10 últimos envios. Até 3 tentativas com o motivo. A escada ao vivo também passa pelo filtro. |
| A/B | `nucleo.js` `varianteDe()`/`compararAB()` | 2 variantes por degrau (escada 7/20/60/180 e cada ângulo da cadência e da jornada), sorteio fixo por lead. Mede resposta e painel em 48 h. Só declara vencedor com 30+ envios por variante E intervalo de confiança da diferença sem cruzar o zero; aí a pior é desligada sozinha (`ab.json`). |
| Livro de jogadas | `jogadas.mjs` | Toda noite a partir das 21h (Haiku, ~US$ 0,03) e sob demanda. Grava `jogadas.json` e `jogadas.md`. Regra de jeito segura entra no `relatorios\aprendizados.md`; preço, prazo, política e link novo viram sugestão para o senhor. `--sonnet` usa Sonnet (custo ~3x). `--simular` mostra o custo antes. |
| Lacunas (modo A) | `lacunas.mjs` (já existia) | Ligado: o robô avisa o senhor como antes e registra a lacuna (campo "lacuna" no JSON do Haiku); retornos aos clientes passam pelo portão. Rotas `/api/lacunas*`. |
| Etiquetas do WhatsApp | `motor.js` | Número é Business. Criadas em 08/11: Revendedor, Lead, Teste, Esfriou, Suporte, Precisa do senhor, Atrasado. Uma etiqueta de estado por conversa, aplicada devagar (1 a cada 10 s, só mudanças), preservando etiquetas que não são do robô. |
| Diagnóstico | `diagnostico.mjs` | Funil e comparação fechou x esfriou com dados reais. `DIAGNOSTICO.md`. |

## Arquivos de estado (pasta funil)

`estado.json` (toques, respostas, lembretes), `leads.json` e `jornada.json` (fotos para o Dashboard), `ab.json`, `etiquetas.json`, `jogadas.json`, `config.json` (opcional: `{"cadencia":false}`, `"jornada"`, `"etiquetas"`, `"vigia_responde"`, `"lembretes"`, `"retomada"`, `"encerra_bloqueia"`, `"jogadas"`).

## Pausar

- Só a cadência: criar `funil\pausado` (ou botão no Dashboard / `POST /api/funil/pausar`).
- Só a jornada: `funil\jornada-pausada` (ou `POST /api/jornada/pausar`).
- Só as etiquetas: `funil\etiquetas-pausadas`.
- Tudo do robô: arquivo `pausado` na pasta do robô (o portão também fecha).

## API (servidor de relatórios, 127.0.0.1:8811)

`GET /api/funil?dias=1|7`, `GET /api/jornada`, `GET /api/etiquetas`, `/api/resumo` ganhou `funil_estrategia`. POST (Content-Type JSON): `/api/funil/pausar|retomar|jogadas|vigia`, `/api/jornada/pausar|retomar`, `/api/jornada/tocar {"ref","confirmar":true}`. Telefones mascarados, sem id de conversa.

## Regras de bloqueio (nunca recebe toque)

Já fechou painel (cadência), pediu para parar/disse que não quer, suporte/equipe/irrelevante, contato pessoal do senhor, o senhor escreveu nas últimas 48 h, o senhor respondeu por último há menos de 72 h, conversa que o cliente encerrou com "ok/blz/obrigado" (regra do coordenador; desligável com `"encerra_bloqueia": false`), conversa em silêncio, a leitura do backlog julgou que não cabe toque.

## Testes

`node funil\testar-funil.mjs` (137 testes; WhatsApp, Haiku e painel simulados; nada é enviado). `node relatorios\testar-backlog.mjs` (179) e `node relatorios\testar-lacunas.mjs` (115) continuam passando.

## Desfazer

Cópias `*.antes-funil` de bot.js, backlog.js, base.md, painel-revendedores.js, relatorios\server.mjs, relatorios\lib.mjs, relatorios\testar-backlog.mjs. O 2º follow-up do atrasado foi DESLIGADO (`segundo_ativo: false` no backlog.js): a cadência assume depois do 1º.
