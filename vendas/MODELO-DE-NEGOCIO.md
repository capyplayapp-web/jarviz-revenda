# Slava: modelo de negócio

Versão 1, 08/11/2026. Base: o robô da revenda CapyPlay (`C:\Users\gusta\Scripts\robo-revenda`), que já atende sozinho, lembra de cada cliente, faz follow-up em escada, passa ao dono quando não sabe e aprende com as conversas.

## 1. O que é

O Slava é um atendente de WhatsApp Business por assinatura. Ele responde cada cliente um a um, pensando a resposta na hora com base no que o dono do negócio ensinou (preços, regras, jeito de falar). Não tem menu nem mensagem pronta.

Promessa: **atendimento 1x1, especializado na dor de cada cliente.**

Mascote: o robozinho Slava (amarelo-girassol, rosto de tela, antena com luz). Tom amigável, direto, sem jargão.

## 2. Ponto que mudou do pedido original (importante)

O pedido era "o cliente loga com o Claude Code e o Slava usa os limites da conta dele". **A Anthropic proíbe isso.** Texto da documentação oficial do Agent SDK (conferido em 08/11/2026):

> "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK. Use the API key authentication methods described in the Quickstart instead."

Riscos se fizéssemos assim: a Anthropic já bloqueou ferramentas de terceiros que usavam o login da assinatura (Pro/Max). O produto pode parar do dia para a noite, e a conta do cliente pode ser suspensa.

**Caminho permitido, com a mesma lógica econômica:** o cliente cria uma conta na Anthropic (console.anthropic.com), gera uma chave de API e cola no Slava. O custo da IA cai direto na conta dele, e ele mesmo define o teto de gasto mensal no console da Anthropic. Para nós, o resultado é o mesmo: **não pagamos IA e não temos risco de custo.** O uso fica sob os Termos Comerciais da Anthropic, que permitem revender produto feito em cima da API.

Se o senhor quiser mesmo o login da assinatura, o único caminho é pedir aprovação à Anthropic (contato comercial). Não recomendo começar por aí.

Marca: podemos dizer "Slava, movido pelo Claude" / "funciona com o Claude, da Anthropic". Não podemos usar "Claude Code" no nome nem imitar a identidade da Anthropic.

## 3. WhatsApp: login oficial da Meta

O robô da revenda usa `whatsapp-web.js` (lê o WhatsApp Web por QR code). Isso é não oficial: para uso próprio dá, mas **num produto vendido o número do cliente corre risco de banimento** e a gente responde por isso.

O Slava usa a **WhatsApp Business Platform (Cloud API)** com o **Cadastro Incorporado da Meta** (Embedded Signup): o cliente clica em "Entrar com o Facebook", escolhe a conta Business e o número, e pronto. Com a **coexistência**, ele continua usando o app WhatsApp Business no celular no mesmo número.

Regras da Meta que mexem no produto:
- Desde 15/01/2026 a Meta proíbe chatbot de IA de uso geral na plataforma. Atendimento de um negócio específico continua permitido. O Slava só fala do negócio do cliente, e isso fica travado no prompt.
- Responder quem chamou (janela de 24 h): mensagens de serviço são gratuitas.
- Follow-up depois de 24 h de silêncio: só com modelo aprovado pela Meta (utilidade ou marketing), cobrado por mensagem pela Meta, na conta do cliente. A escada de follow-up do robô da revenda (7 min, 20 min, 1 h, 3 h) cabe dentro das 24 h. O resto vira modelo aprovado.

Para nós: verificar a empresa no Business Manager e virar **Tech Provider** da Meta (app com revisão). Leva de algumas semanas a dois meses. É o caminho crítico do lançamento.

## 4. Como funciona para o cliente

1. Cria a conta no site e assina (7 dias grátis).
2. Conecta a conta do Claude: cola a chave da Anthropic. O site ensina a gerar a chave e a definir o teto de gasto.
3. Entra com o WhatsApp Business (login oficial da Meta).
4. Ensina o Slava: preços, regras, perguntas frequentes, o tom. Pode subir PDF, colar texto ou responder um questionário guiado.
5. Ativa. Acompanha tudo no painel: conversas, quem passou para ele, o que o Slava aprendeu e precisa de aprovação.

## 5. Arquitetura (segura)

```
Cliente final ──WhatsApp──► Meta Cloud API ──webhook assinado──► Slava (nuvem)
                                                                 │
                         base do negócio + ficha do cliente ─────┤
                                                                 ▼
                                        API da Anthropic (chave do assinante)
                                                                 │
                     filtro contra invenção (preço, prazo, link) ┤
                                                                 ▼
                                                Meta Cloud API ──► Cliente final
```

- Hospedagem: Cloudflare Workers + D1 (banco) + Queues (fila de mensagens) + R2 (arquivos da base). Já usamos Cloudflare no copythief e na escola.
- Uma conversa por vez por contato (lição do robô da revenda: duas respostas em paralelo = mensagem em dobro).
- Resposta curta, em várias mensagens pequenas, com teto por resposta.
- Modelo padrão: Haiku (barato e rápido). Sonnet só para casos difíceis e para o "aprender" das lacunas.

### Segurança

| Ponto | Como fica |
|---|---|
| Login do assinante | E-mail + senha com hash forte (Argon2id) ou link mágico, e 2FA opcional. Sessão em cookie `HttpOnly`, `Secure`, `SameSite=Lax`. |
| Chave da Anthropic | Criptografada no banco (envelope: chave por assinante, chave mestra fora do banco, em segredo do Worker). Nunca volta para a tela, só os 4 últimos dígitos. Testada na hora de salvar. |
| Token da Meta | Mesmo tratamento da chave. Renovação automática. |
| Webhook da Meta | Assinatura `X-Hub-Signature-256` conferida em toda chamada; o que não confere é descartado. |
| Isolamento | Cada consulta filtra pelo id do assinante. Teste automático tentando ler dado de outro assinante. |
| Golpe pelo chat (prompt injection) | O Slava não tem ferramenta perigosa: só responde e marca etiqueta. Preço, prazo e link só saem se estiverem na base (filtro `filtrarTexto` do robô da revenda). |
| Quando não sabe | Passa para o dono, avisa no app e fica quieto naquela conversa até o dono responder ou liberar. |
| LGPD | Termo de uso + contrato de tratamento de dados (o assinante é o controlador, o Slava é o operador). Conversas guardadas por 90 dias por padrão, apagáveis. Exportação e exclusão a pedido. |
| Equipe | Ninguém da equipe lê conversa sem pedido do assinante (acesso de suporte com registro). |
| Cobrança | Asaas ou Mercado Pago (Pix recorrente + cartão). Nunca guardamos dado de cartão. Atraso de pagamento: aviso, 5 dias de carência, depois pausa (não apaga). |

## 6. Preço (sugestão, a definir pelo senhor)

| Plano | Preço/mês | Para quem | O que tem |
|---|---|---|---|
| Essencial | R$ 147 | Autônomo, loja pequena | 1 número, base até 50 páginas, passa para você, ficha de cada cliente |
| Profissional | R$ 297 | Negócio com fluxo diário | Tudo do Essencial + follow-up automático, aprende com as conversas, relatórios, etiquetas |
| Equipe | R$ 697 | Agência, rede, revenda | Até 5 números, vários atendentes humanos, relatório por número |

- 7 dias grátis, sem cartão no teste.
- IA paga direto na conta da Anthropic do assinante, sem margem nossa. Estimativa a medir: pegar o custo real de um mês do robô da revenda (eventos.jsonl) e dividir por conversa antes de colocar um número no site.
- Mensagens de modelo da Meta (follow-up fora das 24 h) também caem na conta do assinante.

Margem: quase 100% do preço é nosso (o custo de nuvem por assinante na Cloudflare fica em centavos). O custo real está no suporte e na integração inicial da base.

## 7. Diferenciais para a venda

1. Sem mensagem pronta: cada resposta é pensada para aquele cliente, naquele momento.
2. Lembra de cada pessoa (ficha por contato): não pergunta duas vezes.
3. Sabe quando não sabe: passa para o dono em vez de inventar.
4. Aprende com as conversas, mas o dono aprova antes de virar regra.
5. Número seguro: login oficial da Meta, sem QR code pirata.
6. A IA é do assinante: transparência total do gasto, teto definido por ele.
7. Nasceu dentro de um negócio real (revenda CapyPlay) e não num laboratório.

## 8. Fases

| Fase | O que | Depende de |
|---|---|---|
| 0 (feito hoje) | Modelo de negócio + site de apresentação local | — |
| 1 | Verificação da empresa na Meta, app Tech Provider, domínio (ex.: slava.capyapp.net ou domínio próprio), conta no Asaas | Senhor: CNPJ, Business Manager, escolha do domínio |
| 2 | Núcleo: login, assinatura, cofre de chaves, webhook Meta, motor de resposta (portado do bot.js), filtro, passa-para-você | Fase 1 |
| 3 | Painel do assinante (conversas, aprovações, base), questionário guiado da base | Fase 2 |
| 4 | Piloto fechado com 3 a 5 negócios conhecidos, de graça, por 30 dias | Fase 3 |
| 5 | Lançamento pago + tráfego | Piloto aprovado |

## 9. O que eu preciso do senhor

1. Preços e nome dos planos (a tabela acima é sugestão).
2. Domínio e número/contato para o botão "Quero o Slava" do site.
3. Pode citar no site o resultado da revenda ("11 vendas fechadas sozinho em um dia, 08/11/2026")?
