# Especificação UX/UI: Registo de Horas a Projetos
## Aplicação Fiori em SAP BTP, perfil consultor

**Versão** 1.0
**Data** 15 de setembro de 2026
**Autor** Tiago Leal, Axians
**Estado** Pronta para refinamento com a equipa de desenvolvimento

---

## 1. Objetivo e âmbito

Especificar a experiência de uma aplicação de registo de horas contra projetos, destinada a consultores de serviços profissionais, construída como extensão Fiori em SAP BTP e integrada com o registo de tempo do S/4HANA (CATS e Manage My Timesheet) ou com SuccessFactors Time Tracking.

**Dentro do âmbito**
- Registo individual de horas por projeto, WBS e tipo de atividade
- Sugestão automática de entradas a partir de calendário e sistemas de trabalho
- Leitura das ausências do pedido de ausência, com bloqueio dos dias e ajuste da capacidade
- Assistente conversacional para registo e consulta, no padrão Joule
- Validação, submissão e correção após rejeição
- Aprovação por gestor de projeto e acompanhamento de omissões pelo PMO

**Fora do âmbito**
- Registo de presença e assiduidade, turnos e regras de trabalho
- Despesas e gestão do pedido de ausência. As ausências são lidas, nunca criadas nem alteradas aqui
- Faturação, faturabilidade e reconhecimento de receita, endereçados noutro módulo

**Métrica de sucesso primária**
Tempo médio para registar uma semana completa abaixo de 90 segundos, com taxa de rejeição em aprovação abaixo de 5 por cento.

---

## 2. Princípios de design

1. **Confirmar em vez de preencher.** O sistema propõe o rascunho da semana a partir de sinais existentes. A ação do consultor é revisar, corrigir e submeter, não escrever de zero.
2. **O custo do registo tem de ser menor que o custo de o evitar.** Qualquer interação que exija mais de dois cliques para um caso comum é candidata a eliminação.
3. **A duração é a unidade mental, não a hora de início.** Início e fim são opcionais e só relevantes quando há regras de assiduidade.
4. **Validar cedo, junto ao campo.** Nenhum erro aparece só no momento da submissão.
5. **Um só modelo de dados, várias vistas.** Grelha semanal, calendário e lista mostram o mesmo dado, sem conversões nem perdas.
6. **A privacidade é requisito funcional, não uma nota de rodapé.** A captura de sinais é privada ao utilizador até ele a converter em entrada de timesheet.
7. **Fiori é o sistema de design, não uma decoração.** Floorplans, controlos e tema Horizon conforme as SAP Fiori Design Guidelines, para que a aplicação não pareça um corpo estranho no launchpad.

---

## 3. Personas e contextos de uso

### P1. Consultor (utilizador primário)
Registo em vários projetos por semana, muitas vezes em cliente, frequentemente em mobilidade. Registo real acontece às sextas ao fim do dia ou na segunda seguinte. Motivação para registar corretamente é baixa e a consequência do erro recai sobre outros. Prioridade: velocidade e memória assistida.

### P2. Gestor de projeto (aprovador)
Revê dezenas de entradas por semana, quer ver desvios e não linhas. Precisa de contexto de orçamento e de esforço planeado contra real. Prioridade: aprovação em massa com exceções em destaque.

### P3. PMO e gestão de recursos
Precisa de cobertura completa do registo para medir utilização e imputar custos. Prioridade: quem falta registar, e capacidade de registar em nome de terceiros com trilho de auditoria.

### P4. Parceiro externo e freelancer (secundário)
Acesso restrito, sem visibilidade de tarifas, registo apenas nos projetos onde está alocado.

---

## 4. Arquitetura de informação e mapa de ecrãs

Mapeamento para floorplans Fiori:

| Ecrã | Floorplan Fiori | Utilizador |
|---|---|---|
| E1. A minha semana (grelha) | Custom page com tabela de grelha, cabeçalho dinâmico | P1 |
| E2. Vista dia e calendário | Planning Calendar | P1 |
| E3. Registo rápido (quick add) | Diálogo com input de linguagem natural | P1 |
| E4. Sugestões da semana | Painel lateral com lista de cartões | P1 |
| E5. Detalhe da entrada | Object Page em modo diálogo | P1, P2 |
| E6. Submissão e resumo | Diálogo de confirmação com resumo por projeto | P1 |
| E7. Aprovação de timesheets | List Report com seleção múltipla, integrado com My Inbox e SAP Task Center | P2 |
| E8. Cobertura de registo | Analytical List Page | P3 |
| E9. Registo em nome de | Reutiliza E1 com contexto de colaborador e banner de auditoria | P3 |
| E10. Ausências da semana | Marcadores no cabeçalho do dia, alimentados pelo Leave Request | P1 |
| E11. Assistente conversacional | Ecrã de entrada, com painel flutuante nos restantes ecrãs, padrão Joule | P1, P2 |
| E15. Leave Request | List Report sobre o serviço standard, com diálogo de pedido e fila de aprovação da chefia direta | P1, chefia direta |
| E16. Entrada pelo assistente | Página com a conversa como área principal e a semana e as ausências como coluna secundária | P1, chefia direta |

Entrada na aplicação: tile no launchpad com KPI dinâmico, mostrando horas registadas contra horas esperadas na semana corrente. O estado do tile é o primeiro nudge, antes de qualquer email.

A aplicação abre no assistente (E16). A conversa é a forma principal de registar horas e pedir ausências, e os dados ficam visíveis no mesmo ecrã, numa coluna secundária que se atualiza a cada ação. A grelha, o calendário e o ecrã de ausências continuam disponíveis para quem quer consultar ou editar diretamente, mas deixam de ser o ponto de partida.

---

## 5. Modelo de dados da entrada de tempo

| Campo | Obrigatório | Default | Notas UX |
|---|---|---|---|
| Data | Sim | Dia selecionado | Nunca pedir duas vezes na mesma interação |
| Duração | Sim | Vazio | Incrementos de 15 minutos, entrada livre em texto aceite (`1,5`, `1:30`, `90m`) |
| Projeto e WBS | Sim | Último usado no dia, senão o mais frequente nas últimas 4 semanas | Pesquisa por código e por nome do cliente, com favoritos no topo |
| Tipo de atividade | Sim | Derivado do papel do consultor no projeto | Esconder quando só existe um valor possível |
| Descrição | Condicional | Vazio | Obrigatória nas entradas de projeto. Limite 300 caracteres, dos quais os primeiros 40 seguem para o campo standard |
| Centro de custo | Não | Do colaborador | Só visível em entradas não projeto |
| Local de trabalho | Condicional | Último usado | Só se configurado, relevante para deslocações |
| Início e fim | Não | Vazio | Apenas quando o país ou o cliente exigem registo de janela horária |
| Origem da entrada | Sistema | Manual, sugerida, copiada, em nome de | Não editável, visível no detalhe, base do trilho de auditoria |

**Regras de negócio a expor na UI**
- Máximo de 24 horas por dia, alinhado com o standard SAP
- Bloqueio de períodos fechados ou já transferidos para os objetos recetores, com a linha em modo leitura e tooltip com a razão
- Notação decimal ou de relógio conforme preferência do utilizador, persistida no perfil

---

## 6. E1. A minha semana (ecrã principal)

### Layout
- **Cabeçalho dinâmico:** navegação de semana (setas e seletor de data), total da semana contra esperado (por exemplo `32,5 / 40 h`), barra de progresso do registo, botão `Submeter`.
- **Corpo:** grelha onde cada linha é uma combinação projeto, WBS e tipo de atividade, e cada coluna é um dia. A última coluna é o total da linha. A última linha é o total do dia, com destaque quando o dia está a zero num dia útil.
- **Rodapé da grelha:** ação `Adicionar linha`, `Copiar semana anterior`, `Aplicar template`.
- **Painel lateral colapsável:** sugestões da semana (ver E4).

### Interações
- Clique numa célula coloca o cursor em edição direta, sem abrir diálogo. Enter confirma e desce para o dia seguinte da mesma linha. Tab avança na horizontal.
- Copiar e colar entre células e de um bloco de Excel para a grelha.
- Arrastar o canto de uma célula preenchida replica o valor pelos dias úteis restantes.
- Clique com o botão direito numa linha: duplicar, remover, fixar como favorito, abrir detalhe.
- Alternância de vista `Grelha / Calendário` no canto superior direito, mantendo a semana selecionada.

### Atalhos de teclado
| Atalho | Ação |
|---|---|
| `J` | Abrir e fechar o assistente |
| `N` | Nova entrada rápida |
| `C` | Copiar semana anterior |
| `→` e `←` | Semana seguinte e anterior |
| `Ctrl + Enter` | Submeter semana |
| `Ctrl + Z` | Desfazer última alteração |
| `?` | Mostrar lista de atalhos |

### Estados vazios
Primeira utilização: grelha vazia com três ações sugeridas em cartões, `Copiar a semana passada`, `Rever 6 sugestões do calendário`, `Adicionar o primeiro projeto`. Nunca uma grelha vazia sem caminho.

---

## 7. E2. Vista dia e calendário

Baseada no controlo Planning Calendar. Cada dia mostra blocos coloridos por projeto, com ausências e feriados em fundo cinzento e não editáveis.

- Arrastar sobre uma faixa horária cria uma entrada com a duração correspondente, arredondada a 15 minutos.
- Redimensionar um bloco altera a duração, com confirmação reversível (toast com `Desfazer` durante 8 segundos).
- Sobreposição de blocos é permitida mas sinalizada, porque o total do dia é o que conta.
- Eventos do calendário corporativo aparecem numa faixa superior, em cinzento, com ação `Converter em entrada`.
- Fuso horário sempre explícito no cabeçalho quando o consultor está fora do fuso do contrato.

---

## 8. E3. Registo rápido e linguagem natural

Campo único, acessível por atalho `N` em qualquer ecrã e por um botão flutuante em mobile.

**Entrada aceita**
```
3h CGD análise de requisitos ontem
1,5 RTL reunião de acompanhamento com o cliente
30m admin formação interna
```

**Comportamento**
1. À medida que escreve, o sistema faz o parse e mostra um cartão de pré-visualização com os campos resolvidos: data, duração, projeto, WBS e tipo de atividade.
2. Cada campo resolvido é um chip clicável, editável sem sair do campo de texto.
3. Ambiguidade nunca bloqueia: o sistema escolhe a interpretação mais provável, marca o chip com estado de atenção e o utilizador corrige com um clique.
4. `Enter` grava, `Shift + Enter` grava e mantém o campo aberto para a entrada seguinte.

**Fallback obrigatório.** Se o parse falhar, o texto passa para a descrição e os campos ficam por preencher. Nunca perder o que o utilizador escreveu.

---

## 9. E4. Sugestões da semana (o núcleo do "confirmar em vez de preencher")

Painel lateral com cartões, um por bloco de tempo inferido. Cada cartão mostra:

- Duração proposta e dia
- Projeto e WBS propostos, com o motivo da proposta em texto curto (`3 reuniões com CGD no calendário`, `12 commits no repositório do projeto Vesi`, `4 tickets tratados em Jira`)
- Nível de confiança em três estados (alta, média, baixa), com tratamento visual distinto e nunca só por cor
- Ações `Aceitar`, `Editar`, `Dispensar`

**Regras**
- Nada entra na timesheet sem uma ação explícita do utilizador. Não existe auto submissão.
- `Aceitar tudo` só está disponível para o grupo de confiança alta, e mostra sempre o resumo antes de aplicar.
- Dispensar um cartão alimenta o modelo de sugestão, e essa aprendizagem é por utilizador.
- O painel indica quantos sinais foram usados e oferece o link `O que é recolhido e onde fica` (ver secção 14).

**Fontes de sinal por ordem de valor e de aceitabilidade**
1. Calendário corporativo (reuniões com participantes externos mapeados a clientes)
2. Sistema de tickets e de gestão de projeto (Jira, Azure DevOps, SAP Cloud ALM)
3. Repositórios de código e documentos, ao nível do projeto e não do ficheiro
4. Localização apenas ao nível de "em cliente" ou "remoto", opt in explícito

---

## 10. E5. Detalhe da entrada

Diálogo em Object Page, aberto a partir de qualquer vista. Secções: dados da entrada, contexto do projeto (orçamento consumido, esforço planeado contra real), histórico da entrada (criada por, alterada por, origem), mensagens de validação.

Em modo leitura quando o período está bloqueado, sempre com a razão visível.

---

## 11. E6. Validação e submissão

### Validação contínua, três severidades

| Severidade | Exemplos | Comportamento |
|---|---|---|
| Erro (bloqueia) | Dia acima de 24 h, WBS inválida ou fechada, período bloqueado, entrada de projeto sem descrição, horas em dia com ausência aprovada, total acima da capacidade do dia | Célula ou campo marcado, submissão bloqueada, mensagem junto ao campo |
| Aviso (não bloqueia) | Dia útil a zero, semana abaixo do esperado, descrição com menos de 10 caracteres, entrada fora do padrão habitual do projeto, dia com pedido de ausência pendente e horas registadas | Ícone discreto, agrupado no resumo de submissão |
| Informação | Sugestões não revistas, semana anterior ainda em rascunho | Chip no cabeçalho |

### Diálogo de submissão
Resumo por projeto e objeto recetor com totais, lista de avisos com opção `Submeter assim mesmo` e caixa de justificação quando o desvio ao esperado excede o limite configurado. Após submissão, a semana passa a leitura com estado `Em aprovação`, e a cor de estado segue o standard SAP (azul em processamento, verde aprovado, vermelho rejeitado).

### Rejeição
Notificação com o motivo e ação direta para a célula em causa, já em edição. A correção nunca obriga a reconstruir a semana.

---

## 12. E7. Aprovação (gestor de projeto)

List Report com seleção múltipla, integrado com My Inbox e SAP Task Center para não criar uma segunda caixa de entrada.

- Agrupamento por colaborador ou por projeto, à escolha
- Colunas: colaborador, semana, total, horas em projeto, desvio ao planeado, número de avisos
- Filtros pré definidos: `Com avisos`, `Acima do planeado`, `Primeiros registos no projeto`
- Aprovação em massa das linhas sem avisos, com as exceções separadas visualmente
- Rejeição exige motivo, selecionável em massa, conforme o padrão do standard SAP
- Delegação e substituição durante ausências, configurável pelo próprio

---

## 13. E8. Cobertura de registo (PMO)

Analytical List Page com o cruzamento colaborador por semana, semáforo de cobertura, e ação `Notificar` que envia o pedido pelo canal que o colaborador usa (notificação no launchpad, Teams, email, por esta ordem de preferência). Ação `Registar em nome de` disponível a partir da célula, com banner permanente de auditoria no ecrã de registo.

---

## 13A. E10. Ausências da semana

As ausências chegam do pedido de ausência e são **leitura apenas** na timesheet. Nunca se cria nem se altera uma ausência a partir da grelha ou do calendário. O pedido é feito no ecrã de ausências (E15) ou pelo assistente, e ambos usam o serviço standard do Leave Request com o seu workflow de aprovação, por isso continua a existir um só processo de aprovação, o do Time Management.

Um pedido aparece na timesheet assim que é enviado, como pendente. Quando a chefia direta o aprova passa a aprovado e fecha o dia, ou reduz a capacidade se for parte do dia. Rejeitado ou retirado, desaparece. A timesheet não espera pelo lançamento no IT2001 para refletir a aprovação.

### Modelo de capacidade

A capacidade do dia substitui o valor fixo de 8 horas, e o esperado da semana passa a ser a soma das capacidades dos dias úteis:

| Situação | Capacidade do dia | Comportamento na interface |
|---|---|---|
| Sem ausência | 8 h, ou o plano de trabalho do colaborador | Registo normal |
| Ausência aprovada de dia inteiro | 0 h | Células desativadas com padrão visual próprio, tooltip com o tipo de ausência, calendário mostra o bloco e a faixa `dia não disponível` |
| Ausência parcial aprovada | 8 h menos as horas de ausência | Registo permitido até à capacidade. Acima disso é erro, não aviso |
| Pedido de ausência pendente | 8 h | Não bloqueia. Marcador `pendente` no cabeçalho do dia e aviso quando o dia tem horas registadas |
| Feriado e fim de semana | 0 h | Não conta para os dias úteis a zero |

### Regras

- Um dia fechado por ausência deixa de contar como `dia útil a zero`. Sem isto, a aplicação acusa falhas em dias de férias, que é a forma mais rápida de perder a confiança do utilizador
- As sugestões do assistente não propõem entradas em dias de ausência aprovada, e a interface diz quantas foram descartadas por esse motivo
- O total esperado no cabeçalho mostra sempre o valor já descontado, com um KPI separado a indicar as horas de ausência da semana

### Conflito por aprovação posterior

O caso que tem de estar desenhado antes do desenvolvimento: o colaborador registou horas num dia e o pedido de ausência desse dia é aprovado depois. A entrada não pode desaparecer sem o utilizador saber.

1. O sistema marca as horas desse dia como conflito, com severidade de erro, e a submissão fica bloqueada
2. A mensagem oferece a ação `resolver, mover as horas`, que transfere as horas para o primeiro dia com capacidade livre
3. Não havendo dia livre, as horas são retiradas e a mensagem diz que foram retiradas, nunca em silêncio
4. Se a semana já tiver sido submetida, a resolução segue o caminho de correção com referência ao registo original

---

## 13B. E11. Assistente conversacional, padrão Joule

O assistente é a porta de entrada da aplicação (E16): ao abrir, a conversa ocupa a área principal e a semana e as ausências ficam numa coluna secundária no mesmo ecrã. Nos restantes ecrãs volta a ser o painel flutuante, aberto pelo botão no canto inferior direito ou pela tecla `J`, com a mesma conversa. A grelha não desaparece: é para quem prefere consultar ou editar diretamente.

### Capacidades

| Intenção | Exemplo de frase | Resultado |
|---|---|---|
| Registar horas | `2h BNK testes de folha ontem` | Cartão de confirmação com dia, duração, projeto, objeto recetor, tipo de atividade e descrição |
| Consultar a semana | `quantas horas tenho` | Total registado contra esperado, com as ausências descontadas, e número de erros |
| Consultar ausências | `as minhas ausências` | Lista da semana com tipo, dia, horas e estado |
| Copiar semana | `copiar a semana passada` | Confirmação e criação das linhas sem durações |
| Aplicar sugestões | `aplicar as de confiança alta` | Confirmação com a lista antes de aplicar |
| Submeter | `submeter a semana` | Valida primeiro. Com erros, explica o primeiro e não submete |
| Pedir ausência | `férias de 3 a 6 de novembro`, `consulta amanhã das 14h às 17h` | Cartão com tipo de ausência (pelo nome, sem códigos SAP), período, duração, saldo depois e aprovador. Só envia depois de confirmar. Os códigos técnicos (AWART, LeaveRequestSet, IT2001) ficam no mapeamento SAP, nas Definições |
| Consultar pedidos e saldo | `os meus pedidos de ausência`, `quantos dias de férias me restam` | Pedidos marcados e pendentes, saldo de férias |
| Retirar ou cancelar | `cancela a consulta de amanhã` | Pendente: retira logo. Aprovado: pede o cancelamento, que volta à chefia |
| Alertas da chefia | `o que tenho para aprovar` | Pedidos de ausência e timesheets à espera, com o mais próximo em destaque. Também na saudação, ao abrir |
| Aprovar ou rejeitar ausências | `aprova o pedido da Ana`, `rejeita o do Bruno porque` | Cartão com as sobreposições na equipa. A rejeição exige motivo |

### Regras não negociáveis

1. **Confirmação antes de qualquer escrita.** O assistente propõe, a pessoa confirma. Nenhum caminho do desenho permite gravar sem clique explícito
2. **Mostra o que vai gravar em linguagem de negócio e em termos SAP.** O cartão apresenta o projeto e também o objeto recetor e o tipo de atividade, para que o erro seja visível antes de existir
3. **Respeita as ausências.** Um pedido para um dia fechado é recusado, com proposta do dia livre seguinte
4. **Avisa ao exceder a capacidade** sem impedir, porque a decisão é da pessoa e o erro aparece na submissão
5. **Origem marcada.** As entradas criadas pelo assistente ficam com origem `Joule`, para auditoria e para medir adoção
6. **Nunca inventa códigos.** Só aceita projetos onde a pessoa está alocada. Se não reconhecer o projeto, pede em vez de adivinhar
7. **Passa pelas mesmas validações** da entrada manual. O assistente é um canal, não um atalho às regras

### Nota de produto

No cenário SAP, isto deve ser exposto como capacidade do Joule, com o Joule Studio no SAP Build, e não como um chat próprio dentro da aplicação. A pessoa deve ter um assistente no launchpad, não um por aplicação. O protótipo imita o padrão de interação para o poder validar com utilizadores antes de investir na integração.

---

## 13C. E15. Leave Request, máscara sobre o standard

A aplicação não tem lógica própria de ausências. É uma interface sobre o Leave Request standard do S/4HANA, transação de administração `PTARQ`, e usa os mesmos serviços da app standard My Leave Requests:

| Ação | Serviço standard |
|---|---|
| Criar, consultar e retirar pedidos, ler tipos de ausência e saldos | `HCMFAB_LEAVE_REQUEST_CR_SRV` |
| Aprovar ou rejeitar | Workflow standard `WS12300111`, um passo, decisão pelo `TASKPROCESSING` (My Inbox) |
| Lançamento no infotipo de ausências | Report `RPTARQPOST`, de `APPROVED` para `POSTED`, escreve o `IT2001` |

### Regras

- **Aprovador:** a chefia direta na estrutura organizativa (OM), num só nível. Não é o responsável do projeto: esse âmbito é o das horas
- **Validação no pedido, não só no envio:** sobreposição com outro pedido, saldo de férias, período fechado, parte do dia só num dia e só para tipos que a permitem, com as três severidades da timesheet
- **Parte do dia segue o perfil da empresa:** `Z_CONS` regista horas, `Z_BSRV` regista hora de início e de fim, coerente com o registo de horas
- **Cancelar um pedido aprovado é também um pedido,** decidido pela mesma chefia no mesmo passo do workflow
- **Alertas:** a chefia vê o que tem para aprovar na saudação do assistente e num contador no separador de ausências. O colaborador é avisado da decisão na próxima vez que usa a aplicação

---

## 14. Privacidade e RGPD (requisitos funcionais)

A captura de sinais para sugestão é tratamento de dados do trabalhador. O consentimento não é base legal válida no contexto laboral, pelo desequilíbrio de poder, logo a base tem de ser interesse legítimo ou execução do contrato, com avaliação de impacto e informação prévia. Traduz se em requisitos de produto:

| Requisito | Implementação |
|---|---|
| Minimização | Só metadados de projeto. Nunca conteúdo de emails, nunca screenshots, nunca URLs completos |
| Controlo do titular | Modo privado com pausa de captura, por sessão ou por período, sem justificação |
| Transparência | Indicador permanente de captura ativa, e ecrã `Os meus dados` com a timeline bruta e ação de eliminação |
| Separação de âmbitos | A timeline bruta é visível apenas ao próprio. A organização vê apenas entradas de timesheet confirmadas |
| Retenção | Timeline bruta eliminada automaticamente após 14 dias ou após confirmação da semana, o que ocorrer primeiro |
| Agregação | Relatórios de gestão sempre por projeto e por período, nunca por aplicação usada |
| Registo de acessos | Trilho de auditoria de quem consultou ou alterou entradas de terceiros |

Esta secção deve ser validada pelo DPO antes do início do desenvolvimento, e a avaliação de impacto tem de estar concluída antes do primeiro piloto com utilizadores reais.

---

## 15. Acessibilidade

Alvo WCAG 2.2 nível AA, além do que o SAPUI5 já garante por controlo.

- Navegação completa por teclado na grelha, incluindo entrada e saída do modo de edição de célula
- Nenhum estado transmitido apenas por cor. Estados de entrada e níveis de confiança sempre com ícone e texto
- Etiquetas de leitor de ecrã explícitas nos campos temporais (`Duração em horas, projeto CGD, quarta-feira`)
- Contraste mínimo 4,5 para 1 em texto, verificado no tema Horizon claro e escuro
- Alvos de toque de 44 por 44 pixels em mobile
- Anúncio das mensagens de validação por região live, não apenas visual

---

## 16. Mobile e offline

- Captura rápida em mobile, revisão e submissão pensadas para ecrã grande
- Registo funcional offline com fila de sincronização e indicador de pendentes
- Widget e atalho de sistema para `Registo rápido`
- Sem grelha completa em telemóvel. Em mobile a vista primária é a lista do dia

---

## 17. Componentes SAPUI5 a usar

| Necessidade | Controlo |
|---|---|
| Grelha semanal | `sap.ui.table.Table` com colunas por dia e edição inline |
| Calendário | `sap.m.PlanningCalendar` |
| Cabeçalho com KPI | `sap.f.DynamicPage` com `sap.m.ObjectStatus` e `sap.m.ProgressIndicator` |
| Pesquisa de projeto e WBS | `sap.m.Input` com value help e sugestões, favoritos no `suggestionRows` |
| Diálogo de detalhe | `sap.m.Dialog` com layout de Object Page |
| Sugestões | `sap.f.Cards` em `sap.f.FlexibleColumnLayout` |
| Mensagens | `sap.m.MessageView` e `MessageStrip` junto ao campo |
| Aprovação | Fiori elements List Report sobre serviço OData V4 |
| Tema | Horizon (`sap_horizon` e `sap_horizon_dark`), sem exceções |

**Modelo de desenvolvimento recomendado**
Fiori elements para os ecrãs de aprovação e de cobertura, onde o padrão é lista e detalhe. Freestyle SAPUI5 para E1 a E4, porque a grelha editável, o quick add e as sugestões estão fora do que as annotations cobrem. Backend em CAP, exposto em OData V4 para a interface, com integração ao registo de tempo por BAPI_CATIMESHEETMGR do S/4HANA (único mecanismo com o CATS, sem serviço OData alternativo) ou pelo Time Tracking do SuccessFactors quando o cliente não usa CATS.

---

## 18. Microcópia (PT e EN)

| Situação | Português | Inglês |
|---|---|---|
| Estado vazio | `Ainda sem horas nesta semana` | `No hours recorded this week` |
| Botão principal | `Submeter semana` | `Submit week` |
| Sugestão | `3 reuniões com o cliente no calendário` | `3 client meetings in your calendar` |
| Aviso de dia a zero | `Quarta-feira está a zero` | `Wednesday is empty` |
| Erro de descrição | `Entradas de projeto precisam de descrição` | `Project entries need a description` |
| Bloqueio | `Semana fechada, já transferida` | `Week closed, already transferred` |
| Captura ativa | `Sugestões ativas. Só o Tiago vê esta linha temporal` | `Suggestions on. Only you see this timeline` |

Tom: direto, na segunda pessoa, sem linguagem de culpa. Nunca `Não se esqueça de`, nunca `Falhou o registo`.

---

## 19. Telemetria e KPIs de UX

| KPI | Alvo |
|---|---|
| Tempo mediano para registar uma semana | Abaixo de 90 segundos |
| Percentagem de entradas criadas a partir de sugestão | Acima de 50 por cento aos 3 meses |
| Semanas submetidas até à segunda feira seguinte | Acima de 90 por cento |
| Taxa de rejeição em aprovação | Abaixo de 5 por cento |
| Entradas corrigidas após submissão | Abaixo de 8 por cento |
| Utilização do modo privado | Monitorizar, não otimizar. Subida acentuada é sinal de desconfiança |

Instrumentar eventos de produto no início, não no fim. Sem estes dados não há forma de justificar a fase 2.

---

## 20. Critérios de aceitação (amostra por ecrã)

**E1**
- Dado um consultor com a semana anterior submetida, quando aciona `Copiar semana anterior`, então as linhas são recriadas sem as durações, com o foco na primeira célula
- Dada uma célula em edição, quando introduz `1,5`, `1:30` ou `90m`, então o valor gravado é 1,5 horas
- Dada uma semana com um dia acima de 24 horas, quando tenta submeter, então a submissão é bloqueada e a célula em causa recebe foco

**E3**
- Dado o texto `3h CGD ontem`, quando pressiona Enter, então é criada uma entrada de 3 horas no projeto CGD com a data do dia anterior
- Dado um texto que o parser não resolve, quando pressiona Enter, então o texto é preservado na descrição e nenhum campo é inventado

**E4**
- Dada uma sugestão de confiança baixa, quando o utilizador aciona `Aceitar tudo`, então essa sugestão não é aplicada
- Dada a ação `Dispensar`, quando repetida três vezes para o mesmo padrão, então o padrão deixa de ser sugerido a esse utilizador

**E7**
- Dadas 20 timesheets sem avisos, quando o gestor aprova em massa, então todas transitam para aprovado numa única chamada e o resultado é confirmado por mensagem

---

## 21. Backlog priorizado

### MVP (fase 1)
E1 grelha semanal com edição inline e copiar semana, E3 quick add sem linguagem natural (campos estruturados), E5 detalhe, E6 validação e submissão, E7 aprovação em massa, E10 ausências com bloqueio de dia e capacidade, tema Horizon, acessibilidade AA, mobile em vista lista.

As ausências entram no MVP e não numa fase posterior. Uma timesheet que acusa dias em falta durante as férias de quem a usa perde a confiança do utilizador na primeira semana, e essa confiança não se recupera com uma correção no sprint seguinte.

### Fase 2
E4 sugestões a partir do calendário, linguagem natural no quick add, E2 calendário com arrastamento, offline, E8 cobertura e registo em nome de, E11 assistente com as intenções de consulta.

### Fase 3
Sugestões a partir de tickets e repositórios, deteção de anomalias na entrada antes da submissão, E11 com motor de linguagem real e escrita por conversa, integração conversacional em Teams, aprendizagem por utilizador.

Regra de sequência: nada da fase 2 entra antes de o MVP atingir os KPIs de tempo de registo e de submissão pontual. As sugestões só compensam sobre uma base de registo já rápida.

---

## 22. Riscos e decisões abertas

| Tema | Risco | Mitigação ou decisão pendente |
|---|---|---|
| Base legal da captura | Sem avaliação de impacto não há fase 2 | Envolver DPO na fase 1, ainda antes do desenho técnico |
| Aceitação sindical e de trabalhadores | Percepção de vigilância mata a adoção | Comunicar como assistente privado, com o modo privado visível desde o primeiro ecrã |
| Standard contra extensão | Divergência do standard SAP dificulta upgrades | Manter o registo no standard, extensão apenas na camada de experiência |
| Incrementos de tempo | O standard SAP trabalha até 30 minutos em certos cenários, a especificação assume 15 | Confirmar customizing antes do desenvolvimento |
| Qualidade da sugestão | Sugestão errada é pior que sugestão nenhuma | Lançar apenas acima de um limiar de precisão medido em piloto |
| Sincronização das ausências | Ausência aprovada depois do registo cria conflito silencioso | Conflito explícito com resolução assistida, ver E10. Leitura das ausências em tempo real, não em cópia diária |
| Assistente sem grounding | Um modelo sem a lista de alocações inventa códigos de projeto | Function calling com esquema fechado e validação dos argumentos antes de executar |
| Leave Request com lógica própria | Duplicar regras de ausência fora do standard cria dois processos de aprovação | Máscara sobre `HCMFAB_LEAVE_REQUEST_CR_SRV` e o workflow `WS12300111`, sem tabelas próprias. Confirmar nomes de entidades e campos no `$metadata` do cliente |
| Multi país | Regras de janela horária em alguns países | Início e fim como campos condicionais por país desde o modelo de dados |

---

## 23. Referências

- SAP Fiori Design Guidelines, floorplans e quando usar cada um: https://www.sap.com/design-system/fiori-design-web/v1-136/page-types/floorplans/when-to-use-which-floorplan
- Boas práticas de desenho de aplicações Fiori: https://www.sap.com/design-system/fiori-design-web/v1-96/discover/sap-products/sap-s4hana-only/best-practices-for-designing-sap-fiori-apps
- Registo de tempo e aprovações em S/4HANA Cloud para serviços profissionais: https://learning.sap.com/courses/managing-projects-and-resources-in-sap-s-4hana-cloud-public-edition-professional-services/managing-time-recording-and-approvals
- Approve Timesheets (Version 3, Fiori 2.0): https://help.sap.com/docs/SAP_FIORI/d59d9f81f4884bf9b115936b92c27202/bfc4c78fb3fa49b39c2ade7bf78b814e.html
- Tema Horizon, estado de utilização produtiva: https://community.sap.com/t5/technology-blog-posts-by-sap/horizon-theme-of-sap-fiori-update-on-productive-usage-for-web-applications/ba-p/13531459
- Padrões de input temporal e tendências 2026: https://www.eleken.co/blog-posts/time-picker-ux
- Padrões de calendário e agendamento em SaaS: https://www.saasui.design/blog/saas-calendar-scheduling-ux-patterns
- Ferramentas de registo automático e o que fazem na interface: https://thedigitalprojectmanager.com/tools/best-ai-time-tracking-software/
- Automação de timesheets em serviços profissionais: https://birdviewpsa.com/blog/timesheet-automation-professional-services/
- Monitorização de trabalhadores na UE, perguntas frequentes: https://www.worktime.com/blog/legal-aspects/12-most-asked-questions-on-eu-employee-monitoring-laws
- Checklist de conformidade RGPD em monitorização: https://gstride.ai/blog/gdpr-compliant-employee-monitoring/
