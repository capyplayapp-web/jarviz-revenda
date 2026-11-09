# Aprimoramentos: feito e proposto

Atualizado em 09/11/2026. O diário completo, dia a dia, está em `HISTORICO.md`.

## Já no ar

**Robô (WhatsApp da revenda)**
- Atende sozinho com o Haiku, curto, sem emoji, no tom de "criança de 10 anos entende". Pós-pago com 500 créditos, pagamento em 05/12.
- Passa ao senhor no Telegram quando não sabe, quando há comprovante ou painel para abrir, e fica 30 min quieto. `#robo` devolve a conversa ao robô.
- Teste grátis automático (usuário, senha e DNS), guias por aparelho, catálogo do que tem disponível.
- Áudio do cliente transcrito (faster-whisper); primeira resposta em voz (VoiceStudio, voz do Pretchia), teste A/B de voz contra texto.
- Atrasados (backlog): responde quem ficou sem resposta, dentro da janela 9h às 20h, com intervalo espaçado.
- Lacunas: o que o robô não soube vira investigação e sugestão de resposta.
- Aprender: lê as conversas e propõe regras de comportamento (até 25 aprovadas).

**Funil**
- Vigia de leads a cada 2 min, próximo passo de cada lead, cadência para quem esfriou (teto 120 toques por dia), leads frios com "atender todos de novo".
- Jornada dos revendedores depois do painel, etiquetas, releitura das últimas horas, livro de jogadas.

**Relatórios no PC (127.0.0.1:8811)**
- Escritório do Jarvis (pixel art), Painel, Follow-ups, Mapa, Funil, Jornada, Tráfego, Gasto de IA, Versões, Voz.

**Nuvem (jarviz.copythief.men)**
- 09/11/2026: passou a ter **todas** as abas do PC (antes faltavam Escritório, Funil, Jornada, Releitura, Gasto de IA, Versões, Voz, Backlog e Lacunas).
- Os botões (pausar ou retomar cadência e jornada, atender frios, ler jogadas, releitura, modo da voz, atrasados) viram pedido na fila: o PC executa e devolve. Nada roda na nuvem; o PC não abre porta.
- Login por senha (cookie de 30 dias), bloqueio crescente contra tentativa, sem indexação, sem script de fora.

## Propostas (ainda não feitas)

Em ordem de quanto ajudam a fechar painel.

1. **Custo por lead da Meta na aba Tráfego.** Ligar a API de anúncios para mostrar gasto, custo por lead e custo por painel fechado ao lado do funil. Hoje a aba mede os leads, mas não o dinheiro.
2. **Conferir a origem do anúncio.** O robô grava `origem_anuncio` desde 09/11 às 15h; conferir em `anuncio-debug.json` se os campos reais chegam (Facebook, Instagram), senão a divisão por canal fica "sem registro".
3. **Atualização mais rápida na nuvem.** No plano grátis do KV o celular vê os dados com 1 a 3 min de atraso. Com o plano de US$ 5/mês dá para baixar para 15 a 30 s e ter o Escritório quase ao vivo.
4. **Aprovar lacunas pela tela.** A API já aprova, descarta e reinvestiga (`/api/lacunas/...`), mas não há botão. Uma fila de "o robô não soube" com aprovar em um toque.
5. **Aba "Slava Roboto" na ILHA** mostrando o andamento das mensagens (pedido de 07/11, para quando o robô estiver redondo).
6. **Credencial de leitura do painel para o catálogo** (`catalogo/credencial.json`, uma linha de cliente de validade longa). Sem ela o catálogo não atualiza sozinho.
7. **Cobrança do Zé.** Entender o bot de cobrança e avisar o revendedor dos créditos usados no mês antes do dia 05.
8. **Renomear contatos em lotes de 30 por hora.** O WhatsApp recusa depois de ~45 seguidos; hoje há pendentes.
9. **DNS de operadora.** Filmes saem por um domínio que alguns DNS não resolvem; guia já orienta, falta reproduzir num cliente real.
10. **Salvar no GitHub sozinho.** Um commit automático por dia (sem custo de IA) para nada se perder mesmo se o senhor esquecer.

## Slava (produto)
Modelo de negócio em `vendas/MODELO-DE-NEGOCIO.md`, site em `vendas/site/`. Pendências do senhor antes de publicar: preços (sugeridos 147, 297 e 697), domínio, número do botão da lista de espera e se pode citar o resultado da revenda. O produto usa a chave de API da Anthropic do próprio cliente e a Cloud API oficial da Meta.
