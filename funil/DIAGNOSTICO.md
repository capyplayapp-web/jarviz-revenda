# Diagnóstico do funil da revenda (08/11/2026)

Base real: 235 conversas dos últimos 14 dias (backlog.json), 190 com mensagens lidas (export do WhatsApp até 08/11 08h + eventos do robô do dia). Só conta o que aconteceu ANTES do painel ser criado (o passo 4 pós-painel não entra como causa). Áudios não têm transcrição: o que o senhor explicou por áudio não aparece no texto, então "soube como funciona" e "recebeu o link" são piso. Refazer: `node funil\diagnostico.mjs` (sem IA, sem custo).

## Funil

| Etapa | 14 dias | % da anterior | Hoje (robô) | % da anterior |
|---|---|---|---|---|
| Entrou em contato | 190 | | 41 | |
| Soube como funciona | 147 | 77% | 37 | 90% |
| Recebeu o link do painel | 127 | 86% | 33 | 89% |
| Criou o painel | 71 | 56% | 18 | 55% |

Tempo (mediana): contato → explicação 5 min · contato → link 8 min · link → painel 8,5 min (só 14 casos com hora exata).

## Onde vaza

| Vazamento | Conversas |
|---|---|
| Nunca receberam o link (e não criaram) | 63 |
| ... dessas, mandaram só a frase do anúncio e sumiram | 26 |
| Receberam o link e não criaram | 56 |
| Criaram sem link visível no texto (link por áudio/fora do período) | 24 |

## Quem criou x quem esfriou (71 x 67)

| O que aconteceu antes do painel | Criou | Esfriou |
|---|---|---|
| Recebeu o link | 66% | 48% |
| Recebeu exemplo de conta (20 clientes = R$ 70) | 31% | 16% |
| Cliente mandou só a frase do anúncio | 32% | 57% |
| Tempo da nossa resposta (mediana) | 1,5 min | 5,6 min |
| Tamanho médio da nossa mensagem | 55 letras | 98 letras |
| Teve áudio nosso | 39% | 61% |
| Pergunta sem resposta em 30 min | 11% | 9% |
| Mensagem nossa repetida | 7% | 7,5% |
| Mensagens do cliente (mediana) | 2 | 1 |

Por origem: anúncio 40% (56/140) · direto 30% (15/50). Por perfil: já revende 40% · quer começar 38%. Dúvidas: quem falou de crédito/ativo 45%, preço/mínimo 41%, pagamento 40%, teste 37%, aparelho/app 33%, confiança (golpe, empresa) 0 de 5.

## Follow-ups

| Degrau | Enviados | Responderam em 48 h | Painel em 48 h |
|---|---|---|---|
| Escada 7 min | 17 | 8 (47%) | 4 |
| Escada 20 min | 1 | 1 | 0 |
| Escada 1 h e 3 h | 0 | 0 | 0 |
| Atrasado (conversas de 1 a 14 dias) | 15 | 2 (13%) | 0 |

Amostras pequenas: servem de direção, não de prova.

## As 5 conclusões mais acionáveis

1. **O maior vazamento é antes do link.** 63 conversas nunca receberam o link e nenhuma criou painel; 57% dos que esfriaram mandaram só a frase do anúncio. O link já sai na 2ª resposta desde hoje; a cadência D+1 agora retoma quem parou antes dele com pergunta de aparelho ou de conta, nunca repetindo a explicação.
2. **Velocidade fecha.** Quem criou teve resposta em 1,5 min (mediana); quem esfriou, 5,6 min. A vigia de leads responde qualquer conversa com a última palavra do cliente (3 min a 48 h) e mede isso.
3. **Curto vende mais.** Mensagem média de 55 letras em quem criou contra 98 em quem esfriou. Confirma a regra do dono (máximo 4 mensagens curtas); o filtro dos toques barra texto longo.
4. **Exemplo de conta dobra a chance.** 31% dos que criaram viram a conta (20 clientes = R$ 70) contra 16% dos que esfriaram. Quem fala de preço e crédito está comprando (41% a 45% criam): o toque D+3 da cadência é "prova com conta", só com os números do base.md.
5. **Lead quente responde, frio quase não.** Escada de 7 min: 47% respondem e 4 painéis em 48 h; atrasado (dias depois): 13% e nenhum painel até agora. Por isso a escada tem prioridade máxima na fila única e a cadência de dias usa ângulos diferentes (ajuda, prova, benefício, porta aberta) com teste A/B, em vez de repetir "ficou dúvida?".

Alerta: objeção de confiança (5 casos) fechou 0. Não há resposta pronta para "é golpe? tem CNPJ?" no base.md; fica como sugestão para o senhor.
