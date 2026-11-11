# Proposta de textos: jornada pós-painel rumo à primeira venda (10/11/2026)

Só proposta. Nada foi alterado no robô. Para aplicar, trocar as strings em `funil/motor.js` (JORNADA_TXT, linha ~324, e ANGULO_TXT.ajuda.sumiu_depois_do_link, linha ~310) e colar o bloco do item 3 no `base.md`.

Pontos que valem para todas:
- Cada toque traz um passo só, já pronto para fazer, e termina numa pergunta de sim ou não. Assim cabe no Estilo A e no Estilo B que o `pedidoToque` acrescenta.
- Os passos vêm do base.md: banners e vídeos no canal, Escola do Revendedor, campanha de anúncios para quem termina a Escola e teste no painel (o contorno "Já criou seu primeiro cliente ou teste no painel?").
- O único número novo é "5 contatos". Ele é uma meta de ação, não um fato, e o 5 já aparece no base.md (dia 5), então passa no filtro. Se o senhor preferir, troco por "alguns contatos".
- Nenhuma usa as palavras barradas pelo filtro (desconto, promoção, cupom, bônus, garantia, reembolso, vagas, urgência, depoimento) nem %.

---

## 1. JORNADA_TXT

```js
const JORNADA_TXT = {
  checkin_d1: 'O revendedor criou o painel ontem e ainda não vendeu. Dê UM passo para o primeiro cliente: criar no painel um teste para alguém de casa ou um amigo e deixar essa pessoa assistir na TV dela. Pergunte se ele já pensou em quem vai ser esse primeiro. Se a conversa ou o dado do painel mostrar que ele já cadastrou cliente, em vez disso sugira pegar um banner pronto no canal https://t.me/capyplayoficial para divulgar.',
```
Por quê: no primeiro dia a barreira é não saber por onde começar. Alguém de casa é o cliente mais fácil e ensina o caminho todo: painel, app e TV.

```js
  checkin_d3: 'Três dias de painel. Dê UM passo para a primeira venda: pegar um banner ou vídeo pronto no canal https://t.me/capyplayoficial e mandar para 5 contatos no WhatsApp ou postar no status. Pergunte se ele já sabe para quem vai mandar. Use só esse link. Se a conversa mostrar que ele já divulgou, pergunte se alguém respondeu e ofereça ajuda para fechar.',
```
Por quê: depois do teste em casa, o que falta é gente sabendo que ele vende. O banner pronto tira a desculpa de não ter material, e "5 contatos" é uma meta pequena que dá para cumprir hoje.

```js
  checkin_d7: 'Uma semana de painel. Pergunte, leve, se ele já fez a primeira venda. Se não fez, indique o caminho mais curto: as aulas da Escola do Revendedor (https://escola.capyapp.net), que ensinam do painel até a primeira venda, e conte que quem termina ganha uma campanha de anúncios feita por nós. Se o dado do painel mostrar cliente cadastrado, não fale da Escola: pergunte se esse cliente já pagou e se ele quer ajuda para achar o próximo.',
```
Por quê: na primeira semana a pergunta "como estão as vendas" vira cobrança. A campanha da Escola é o único benefício concreto do base.md que traz cliente sem ele saber anunciar, então é o que mais pesa nesse ponto.

```js
  checkin: 'Check-in de rotina, leve. Se ele ainda não vendeu, sugira UM passo que ainda não apareceu na conversa, nesta ordem: teste no painel para alguém de casa; banner ou vídeo pronto do canal https://t.me/capyplayoficial para 5 contatos; aulas da Escola do Revendedor (https://escola.capyapp.net). Se ele já vende, pergunte se precisa de ajuda com algum cliente. No máximo um link.',
```
Por quê: o "tudo certo? como está indo?" não pede nada e recebe "tudo certo" de volta. Com a ordem fixa e a regra de não repetir, cada toque de rotina leva um passo novo.

```js
  ajuda_sem_uso: 'O painel dele ainda não tem cliente cadastrado (dado do painel). Diga que o primeiro cliente pode ser alguém de casa: criar um teste no painel e ver funcionando na TV da pessoa. Indique a aula de cadastrar clientes da Escola do Revendedor (https://escola.capyapp.net) e pergunte em qual passo ele travou: entrar no painel, cadastrar o cliente ou instalar o app. Não diga números.',
  reconhecimento: '(sem mudança)',
  fechamento_vendas: '(sem mudança)',
  fechamento_pagamento: '(sem mudança)',
};
```
Por quê: são os 14 painéis parados. Painel vazio quase sempre é trava, não falta de vontade. Os três passos são os mesmos do contorno que já existe no base.md, então a pessoa só escolhe um. A aula entra como apoio, não como dever de casa.

---

## 2. ANGULO_TXT.ajuda.sumiu_depois_do_link

```js
    sumiu_depois_do_link: 'AJUDA PRÁTICA para criar o painel: ele recebeu o link e não criou. Lembre, em uma frase, que abrir não custa nada (é pós-pago e o painel já vem com 500 créditos) e que o link continua logo acima na conversa. Pergunte em qual tela ele parou e diga que pode mandar um print que você ajuda. Não mande o link de novo e não cobre.',
```
Por quê: quem não criou ou travou numa tela do cadastro ou ficou com medo de pagar algo. Esse toque responde aos dois sem mandar o link de novo: tira o medo com um fato do base.md e pede o print, como manda a regra de 10/11. Se o print mostrar "e-mail já em uso", o robô já sabe o que fazer pela regra que existe.

---

## 3. Duas respostas para o base.md

Colar logo depois da seção "Guia quando não acha o app na TV":

```md
# Dúvidas rápidas de TV (regra do dono, 10/11/2026)
- "Como saber se minha TV é Android?": peça para olhar a tela inicial da TV. Se tiver a Google Play Store (a loja do triângulo colorido), a TV é Android e o app é o Lotus, código 546750. Se não tiver a Play Store, pergunte a marca e siga "Guia quando não acha o app na TV". Exemplo: "Olha a tela inicial da TV, mestre." / "Se aparecer a Google Play Store, ela é Android."
- "O app não aparece na Play Store da TV": peça a marca e o modelo da TV (está na etiqueta atrás) e um print da busca na loja. Com isso, escolha o guia certo; se for o Lotus que não aparece, indique o RX Purple, código 56075066. Exemplo: "Me passa a marca e o modelo da TV, mestre? Fica na etiqueta atrás." / "E manda um print da busca na loja, por favor."
```
Por quê: as duas dúvidas param a primeira instalação, e sem resposta o robô chuta ou chama o responsável. A primeira usa um sinal que dá para ver na tela, sem termo técnico. A segunda segue a regra do print e usa só o app e o código que já estão no base.md.
