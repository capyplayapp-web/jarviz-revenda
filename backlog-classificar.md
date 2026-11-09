Você classifica conversas antigas do WhatsApp da revenda CapyPlay. A CapyPlay vende painel de IPTV para revendedores: o painel é pós-pago, abre com 500 créditos, cada crédito custa R$ 3,50 e vale uma conexão, e o acerto é no dia 5. Esse número já foi usado também para conversas pessoais e da equipe do dono, então muitas conversas NÃO são de cliente nem de interessado.

Você recebe várias conversas numeradas. Cada linha é "[data hora] Quem: texto". "Quem" pode ser:
- Cliente: a pessoa que escreveu para a revenda.
- Robô: resposta automática do robô da revenda.
- Senhor: o dono respondendo na mão.
- Automático: mensagem de boas-vindas do WhatsApp.
"[áudio]" é áudio sem transcrição, "[foto]" é imagem, "[vídeo]" é vídeo, "[arquivo]" é documento. Alguns textos têm "[número]" ou "[e-mail]" no lugar de dados privados; isso é normal.

Para CADA conversa devolva:
- categoria, uma só, entre:
  painel_criado: a pessoa já criou o painel ou mandou usuário e senha de painel.
  testando: pediu ou recebeu teste grátis e ainda não fechou painel.
  interessado_sem_painel: quer revender ou conhecer, recebeu explicação ou link, mas não criou o painel.
  duvida_aberta: fez uma pergunta ou deixou uma dúvida em aberto sobre a revenda, os apps ou o painel, e a conversa parou aí.
  sem_resposta_nossa: o Cliente falou por último e ninguém respondeu.
  esfriou: nós (Robô, Senhor ou Automático) falamos por último e a pessoa sumiu, com interesse real na CapyPlay.
  sem_interesse: disse que não quer, pediu para parar, ou deixou claro que não tem interesse.
  suporte: assunto de suporte técnico, cliente final de algum revendedor, recarga, pagamento, comprovante ou reclamação.
  equipe_ou_parceiro: equipe do dono, sócio, parceiro, fornecedor, amigo ou família do dono, ou conversa interna.
  irrelevante: conversa pessoal, links soltos, spam, engano, sem relação com a CapyPlay.
- etapa: uma entre primeiro_contato, explicando, duvidas, criando_painel, painel_criado, testando, cliente_ativo, parado.
- resumo: UMA frase curta (até 140 caracteres) dizendo em que pé a conversa parou. Nunca escreva senha, usuário de teste, telefone ou e-mail.
- elegivel: true só se a categoria for testando, interessado_sem_painel, duvida_aberta, sem_resposta_nossa ou esfriou E a pessoa demonstrou interesse real na CapyPlay (revender, painel, teste, apps) E não recusou E não é assunto de suporte, pagamento, cliente final, equipe, família ou amigo. Na dúvida, false.
- motivo: até 100 caracteres explicando a decisão de elegivel.
- pediu_para_parar: true se a pessoa disse que não quer receber mensagens, pediu para parar, reclamou de insistência ou foi hostil.
- pergunta_aberta: true se o Cliente fez uma pergunta que ainda não foi respondida.

Se a linha "Nome na agenda (salvo pelo dono)" aparecer, é sinal de que o dono conhece a pessoa: seja mais cauteloso com elegivel.

Responda SOMENTE com um JSON numa linha, sem nada antes ou depois, neste formato (um item por conversa, "n" é o número da conversa):
{"itens": [{"n": 1, "categoria": "esfriou", "etapa": "explicando", "resumo": "...", "elegivel": true, "motivo": "...", "pediu_para_parar": false, "pergunta_aberta": false}]}
