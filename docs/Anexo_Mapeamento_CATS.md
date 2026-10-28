# Anexo A: Mapeamento da UX para os conceitos SAP e passagem para o CATS

**Documento pai** Especificação UX/UI, Registo de Horas a Projetos, versão 1.0
**Versão** 1.0
**Data** 15 de setembro de 2026

---

## 1. Objetivo

Traduzir cada elemento do protótipo em conceitos SAP, definir onde vive cada dado e fixar o contrato de passagem das entradas para o Cross Application Time Sheet (CATS), até aos objetos recetores que suportam a imputação de custos.

Fora do âmbito: faturação, faturabilidade e reconhecimento de receita, endereçados noutro módulo. Este anexo trata apenas do registo do tempo e da sua imputação.

Princípio que governa todo o anexo: **o registo continua a ser standard SAP**. A extensão em BTP é camada de experiência e de assistência, nunca um segundo repositório de tempo.

---

## 2. Arquitetura de camadas

```
 1. UI Fiori (SAPUI5 freestyle + Fiori elements), launchpad em BTP
    grelha semanal, calendário, quick add, sugestões, aprovação. Mantém
    o padrão que o cliente já usa, pessoas a aceder ao S/4 por app Fiori
              |
 2. Camada de experiência em BTP (CAP, OData V4, HANA Cloud)
    metadados do assistente: sinais, sugestões, confiança, dispensas,
    favoritos, templates, rascunhos ainda não submetidos. Só isto,
    já não é quem escreve no CATS
              |
 3. Serviço OData/RAP embutido no S/4HANA Private Cloud
    ABAP Cloud on-stack, no mesmo sistema que o CATS. Chama
    BAPI_CATIMESHEETMGR_INSERT / _CHANGE / _DELETE localmente, sem
    Cloud Connector no caminho da escrita. Único mecanismo de
    integração com o CATS, sem WorkforceTimesheetService. O frontend
    em BTP fala com este serviço diretamente, não pela camada 2
              |
 4. CATSDB, a tabela de base do CATS
    estados, aprovação, campos cliente via include CI_CATSDB
              |
 5. Transferência para os componentes recetores
    CATA (todos), CAT7 (CO), CAT5 (PS), CAT9 (PM e CS), CATM (serviços), CAT6 (HR)
              |
 6. Consumo a jusante
    imputação de custos aos objetos recetores,
    utilização e esforço real contra planeado por projeto
```

Regra de fronteira: nada que seja específico do assistente entra na camada 4. A camada 2 guarda o "porquê" da entrada, a camada 4 guarda o "quê". Assim o core mantém-se limpo e os upgrades não ficam presos à extensão.

Regra de fronteira entre a 2 e a 3: a camada 2 nunca escreve no CATS, mesmo quando tecnicamente poderia. A escrita é sempre pedida à camada 3, mesmo quando quem pede é o assistente (ver secção 8B), para que exista um único caminho de escrita a auditar.

---

## 3. Mapeamento campo a campo

Legenda da coluna "onde": **CATS** vai para CATSDB, **BTP** fica na camada de experiência, **CI** exige campo cliente no include CI_CATSDB.

| Elemento na UI | Conceito SAP | Campo CATSDB | Onde | Notas |
|---|---|---|---|---|
| Colaborador do registo | Número de pessoa | `PERNR` | CATS | Determinado pelo utilizador autenticado. No registo em nome de, o `PERNR` é do colaborador e o autor fica no trilho de auditoria |
| Coluna do dia na grelha | Data do trabalho | `WORKDATE` | CATS | Uma entrada por dia, nunca agregada à semana |
| Valor da célula (duração) | Horas registadas | `CATSHOURS` | CATS | Unidade em `UNIT`, normalmente `H`. O arredondamento a 15 minutos é regra de UI, tem de ser coerente com o perfil de entrada |
| Início e fim, quando exigidos | Hora de início e de fim | `BEGUZ`, `ENDUZ` | CATS | Só ativos quando o país ou o cliente exigem janela horária |
| Projeto e WBS da linha | Elemento PEP recetor | `RPROJ` | CATS | Campo numérico com conversão, a UI mostra sempre a máscara externa |
| Ordem, quando o recetor é ordem | Ordem recetora | `RAUFNR` | CATS | Cenários de manutenção, CAPEX ou ordens internas |
| Rede e operação | Rede e operação | `RNPLNR`, `RAUFPL`, `RAPLZL` | CATS | Só em cenários com planeamento por rede |
| Tipo de atividade | Tipo de atividade CO | `LSTAR` | CATS | Chave da valorização. Esconder na UI quando o papel do consultor no projeto só admite um valor |
| Centro de custo do colaborador | Centro de custo emissor | `SKOSTL` | CATS | Derivado dos dados mestre, nunca introduzido à mão |
| Centro de custo recetor | Centro de custo recetor | `RKOSTL` | CATS | Usado nas entradas internas sem projeto |
| Descrição da entrada | Texto breve | `LTXA1` | CATS | **40 caracteres** em CATSDB. A UI permite 300 e trunca para `LTXA1`, guardando o texto completo em BTP ou em texto longo |
| Ausências e presenças no calendário e na grelha | Tipo de ausência ou presença | `AWART` | CATS | Lidas do pedido de ausência, leitura apenas. O registo de ausências continua no Time Management |
| Bloqueio do dia por ausência | Capacidade diária do colaborador | plano de trabalho e infotipo de ausências | CATS | Dia inteiro aprovado fecha o dia ao registo, ausência parcial reduz a capacidade. A aplicação lê, nunca escreve |
| Pedido de ausência pendente | Pedido em aprovação | workflow do pedido de ausência | CATS | Não bloqueia, gera aviso. Se for aprovado depois do registo, as horas do dia entram em conflito e exigem resolução |
| Entradas criadas pelo assistente | Sem equivalente standard | `ZZORIGIN` com valor `Joule` | BTP, CI se necessário | Passam pelas mesmas validações. A marca serve auditoria e medição de adoção |
| Tipo de remuneração | Tipo de salário | `LGART` | CATS | Cenários com horas extraordinárias ou prémios |
| Classificação de tarefa | Task type, level e component | `TASKTYPE`, `TASKLEVEL`, `TASKCOMPONENT` | CATS | Só usado quando o cenário integra gestão de portefólio e projetos. Confirmar antes de mapear |
| Estado da semana na UI | Estado de processamento | `STATUS` | CATS | Ver secção 5 |
| Aprovador e data de aprovação | Aprovação | `APNAM`, `APDAT` | CATS | Preenchidos pelo processo de aprovação, nunca pela UI |
| Sistema lógico | Sistema lógico | `LOGSYS` | CATS | Relevante em paisagens distribuídas |
| Correção de uma entrada submetida | Referência ao registo alterado | `REFCOUNTER` | CATS | A alteração cria novo registo que aponta ao anterior, o histórico não se perde |
| Identificador técnico da entrada | Contador do registo | `COUNTER` | CATS | Gerado pelo sistema, a UI guarda-o para alterações e estornos |
| Origem da entrada (manual, sugerida, copiada, em nome de) | Sem equivalente standard | `ZZORIGIN` em `CI_CATSDB` | BTP, CI se necessário | Recomendação: manter em BTP. Serve telemetria de adoção, não a contabilidade |
| Nível de confiança da sugestão | Sem equivalente | nenhum | BTP | Nunca sai da camada de experiência |
| Linha temporal bruta dos sinais | Sem equivalente | nenhum | BTP | Retenção de 14 dias, ver secção de privacidade da especificação |
| Favoritos e templates de linha | Worklist do CATS | tabelas de worklist | CATS quando possível | Preferir a worklist standard, que já deriva das alocações, em vez de uma lista paralela em BTP |
| Justificação do desvio na submissão | Sem equivalente | nenhum | BTP | Fica no histórico da semana, visível ao aprovador |

---

## 4. O que fica fora do CATS, e porquê

Três dados do protótipo não têm lugar no modelo CATS e a tentação de os forçar é o erro mais comum nestas extensões:

1. **Origem da entrada e confiança da sugestão** servem a medição da adoção, não a contabilidade. Vivem em BTP, ligados por `PERNR`, `WORKDATE` e `COUNTER`.
2. **Linha temporal bruta dos sinais** é dado pessoal com retenção curta. Entrar no core seria criar um arquivo de vigilância com a retenção do core, exatamente o que a avaliação de impacto não vai aceitar.
3. **Descrição completa acima de 40 caracteres.** `LTXA1` é curto por desenho. Truncar para o campo e guardar o texto completo fora, ou usar texto longo. Confirmar com o cliente quais os consumidores a jusante do `LTXA1`, porque isso decide qual dos dois textos é o que conta.

---

## 5. Ciclo de estados e o que a UI mostra

| Estado técnico | Significado | Estado na UI | Editável |
|---|---|---|---|
| Registo apenas em BTP | Rascunho antes de submeter | `Rascunho` | Sim, livremente |
| Pedido síncrono em curso ao serviço no S/4 | Enviado, a aguardar resposta | `A gravar…`, estado só de UI, não persiste | Não, campos bloqueados até responder |
| `STATUS` de entrada em processamento | Gravado no CATS, ainda não libertado | `Gravado` | Sim |
| `STATUS` libertado para aprovação | Submetido, à espera do gestor | `Em aprovação` | Não, só por correção com `REFCOUNTER` |
| `STATUS` aprovado | Aprovado, pronto a transferir | `Aprovado` | Não |
| Transferido para os recetores | Documentos criados nos componentes | `Contabilizado` | Não, apenas estorno |
| Rejeitado | Devolvido com motivo | `Rejeitado` | Sim, com o motivo visível junto à célula |

O domínio de estados do CATS tem valores adicionais, nomeadamente para alterações após aprovação. **Confirmar no sistema do cliente os valores exatos do domínio antes de fixar a semântica visual**, porque o mapeamento dos chips depende disso e uma cor errada aqui destrói a confiança na aplicação.

`A gravar…` não é um valor do domínio `STATUS` do CATS nem um estado persistido, é só o estado do ecrã enquanto o pedido síncrono está em curso (ver secção 9 para a decisão de ser síncrono). Assim que o serviço no S/4 responde, a linha passa diretamente a `Gravado` ou a `Rejeitado`, nunca fica pendurada num estado intermédio guardado.

Regra de UI que decorre do modelo: a partir de `Em aprovação`, editar não é alterar, é criar um registo de correção. A interface tem de o dizer em linguagem simples, por exemplo `esta alteração cria uma correção que volta a aprovação`, em vez de expor `REFCOUNTER`.

---

## 6. Transferência para os componentes recetores

| Transação | Destino |
|---|---|
| `CATA` | Transferência para todos os componentes de destino |
| `CAT7` | Controlling |
| `CAT5` | Project System |
| `CAT9` | Plant Maintenance e Customer Service |
| `CATM` | Serviços externos, folha de serviços |
| `CAT6` | Gestão de tempos do HR |
| `CADO` | Visualização dos dados do registo |
| `CATC` | Verificação de consistência com o HR |

Implicações diretas para a experiência:

- O bloqueio de período (`time log locking`) na UI tem de refletir o que já foi transferido, não apenas o que foi aprovado. Uma célula transferida fica em leitura com a razão visível.
- A correção de uma entrada já transferida gera estorno mais novo registo. A UI deve tratar isto como uma ação com consequências, com confirmação explícita e sem linguagem técnica.
- A transferência corre em job. O estado `Aprovado` pode durar horas antes de `Contabilizado`. A UI não deve fingir imediatismo, mostra a data prevista do próximo ciclo.

---

## 7. Governo do customizing

A extensão lê o customizing, nunca o contradiz:

| Customizing | O que governa | Consequência na UI |
|---|---|---|
| Perfil de entrada de dados (`CAC1`) | Períodos, unidades, aprovação, agregação | A UI pede o perfil do utilizador ao arrancar e adapta colunas, incrementos e regras de submissão |
| Seleção de campos (`CAC2`) | Campos visíveis e obrigatórios | Determina dinamicamente o formulário de detalhe. Nunca um formulário fixo em código |
| Worklist | Objetos propostos ao colaborador | Alimenta os favoritos e o copiar semana, em vez de uma lista mantida à parte |
| Exits e BAdIs do CATS | Valores por omissão e verificações no core | A UI antecipa as mesmas verificações, mas o core é a autoridade final. Ver KBA 2103586 para a lista de exits disponíveis |

Consequência de projeto: a matriz de campos do capítulo 5 da especificação tem de ser confrontada com `CAC1` e `CAC2` do cliente antes do desenvolvimento. Se divergirem, ganha o customizing.

---

## 8. Onde cada validação é executada

| Regra | UI | BTP | Core CATS |
|---|---|---|---|
| Formato da duração, `1,5`, `1:30`, `90m` | sim | | |
| Arredondamento a 15 minutos | sim | | confirmar com o perfil |
| Máximo de 24 horas por dia | sim | sim | sim |
| Descrição obrigatória em entradas de projeto | sim | sim | via exit, se for regra do cliente |
| WBS válida, aberta e com alocação | sugestão e pesquisa | cache de leitura | autoridade |
| Período bloqueado ou já transferido | leitura do estado | | autoridade |
| Perfil de entrada e seleção de campos | aplica | | autoridade |

Nenhuma verificação existe apenas na UI quando tem impacto contabilístico. A UI antecipa para dar resposta imediata, o core decide.

---

## 8A. Integração com as ausências

A leitura das ausências não é um extra de conveniência, é o que evita que a aplicação acuse falhas de registo a quem está de férias.

| Decisão | Opção escolhida | Porquê |
|---|---|---|
| Direção do fluxo | Leitura apenas, do Time Management para a timesheet. O pedido é feito pelo serviço standard do Leave Request, no ecrã de ausências ou pelo assistente, nunca pela grelha | Um só processo de aprovação de ausências, o workflow standard. A aplicação é uma máscara sobre ele |
| Pedido de ausência | `HCMFAB_LEAVE_REQUEST_CR_SRV` para criar, ler, retirar, saldos e tipos; `WS12300111` com decisão pelo `TASKPROCESSING`; `RPTARQPOST` para o `IT2001` | São os serviços da app standard My Leave Requests. Nenhuma tabela é escrita diretamente |
| Momento da leitura | Em tempo real na abertura da semana, não por cópia diária | Uma cópia diária deixa passar aprovações do próprio dia, que é exatamente quando o conflito aparece |
| Granularidade | Dia inteiro e parcial, com capacidade por dia | Meio dia de ausência é o caso comum, e um modelo só de dia inteiro força o utilizador a mentir no registo |
| Pedidos pendentes | Visíveis assim que enviados, não bloqueiam | Bloquear com base num pedido não aprovado impede registo legítimo |
| Pedido aprovado ainda por lançar | Fecha o dia logo na aprovação, sem esperar pelo `RPTARQPOST` | O job corre em ciclos, e uma aprovação do próprio dia não pode ficar invisível até ao ciclo seguinte |
| Conflito por aprovação posterior | Erro explícito com resolução assistida | O silêncio aqui produz horas perdidas e discussões de utilização impossíveis de reconstituir |

Objetos envolvidos: pedido de ausência e respetivo workflow, infotipo de ausências, plano de trabalho do colaborador para a capacidade, e o calendário de fábrica para feriados. Confirmar no cliente se a capacidade vem do plano de trabalho ou de uma regra própria, porque isso decide o cálculo do esperado da semana.

---

## 8B. O assistente conversacional na arquitetura

O assistente é um canal de entrada, não um caminho alternativo às regras. Na arquitetura de camadas fica na camada 2, em BTP, e usa exatamente as mesmas operações da camada 3 que a interface usa.

| Peça | Onde vive | Nota |
|---|---|---|
| Interpretação da linguagem | BTP, com motor de inferência | No cenário SAP, SAP AI Core com Generative AI Hub |
| Esquema de funções | BTP | Function calling fechado: `registar_horas`, `consultar_semana`, `listar_ausencias`, `copiar_semana`, `submeter_semana` |
| Grounding | BTP, por leitura da camada 3 | Projetos onde a pessoa está alocada, ausências, capacidade, estado da semana |
| Escrita | Camada 3, serviço embutido no S/4 | O assistente nunca escreve em `CATSDB`, chama o mesmo serviço síncrono que a interface usa |
| Confirmação | Interface | Obrigatória. O modelo propõe, a pessoa confirma |
| Marca de origem | BTP, `ZZORIGIN` se tiver de viajar | Permite medir adoção e auditar o que foi criado por conversa |

Decisão de produto a tomar antes do desenvolvimento: chat dentro da aplicação, ou capacidade exposta ao Joule com o Joule Studio no SAP Build. A segunda opção é a recomendada, porque dá à pessoa um só assistente no launchpad em vez de um por aplicação, e porque a camada de conversa deixa de ser responsabilidade desta equipa.

---

## 9. Contrato de integração

**Operações**
- Criar entradas de um dia: uma chamada por semana, em lote, com resposta por linha
- Alterar: nova entrada com `REFCOUNTER` a apontar ao `COUNTER` original
- Eliminar: apenas em estado editável, caso contrário estorno
- Libertar para aprovação: ação de submissão da semana
- Aprovar e rejeitar: pelo canal standard, integrado com My Inbox e SAP Task Center, sem uma segunda caixa de entrada

**Mecanismo único, BAPI** `BAPI_CATIMESHEETMGR_INSERT`, `_CHANGE` e `_DELETE`, com `BAPI_TRANSACTION_COMMIT` explícito. Sem WorkforceTimesheetService, sem OData, sem cenário alternativo por tipo de deployment: a integração com o CATS é sempre por esta via, cloud ou on premise. Testar o comportamento de erro parcial no lote, que é a principal fonte de inconsistência nestas integrações.

**Síncrono ou assíncrono, decisão revista** Com o serviço a correr embutido no S/4 (camada 3), a chamada BAPI passa a ser local ao sistema, não atravessa o Cloud Connector. O único salto de rede é do frontend em BTP até este serviço, uma vez por pedido, não uma vez por linha. Por isso a submissão passa a ser **síncrona**: o pedido fica à espera da resposta do serviço, que faz o loop de chamadas BAPI localmente e devolve o resultado linha a linha, dentro do mesmo pedido. Isto substitui a decisão anterior de fila de jobs assíncrona em BTP, que fazia sentido só enquanto era a camada 2 a chamar a BAPI, com um salto de Cloud Connector por linha.

Continua a valer testar o comportamento de erro parcial no lote. Para lotes muito grandes no mass entry, confirmar o timeout do pedido OData entre BTP e o serviço no S/4 (item 9 da secção 11), e considerar paginar o pedido, por exemplo gravar pessoa a pessoa em vez de a equipa toda numa só chamada, se esse limite for demasiado apertado.

**Robustez**
- Idempotência por chave lógica `PERNR` mais `WORKDATE` mais objeto recetor mais `LSTAR`, com identificador de pedido gerado pelo cliente, para que um reenvio após timeout não duplique horas
- Reconciliação diária entre a camada 2 (as leituras que alimentam o assistente) e `CATSDB`, com relatório de divergências
- Nenhuma escrita direta em `CATSDB`. Sempre pela BAPI, porque só ela garante as verificações e o trilho

---

## 10. Cenário alternativo sem CATS

Quando o cliente corre a gestão de tempos em SuccessFactors, o destino é Time Tracking com replicação para Employee Central Payroll, e o mapeamento muda de objeto: `PERNR` passa a `userId` e `personIdExternal`, a duração vai para os registos de tempo por tipo, e a imputação a projeto deixa de existir no mesmo nível de detalhe do CATS. Para registo contra projetos com valorização, o cenário continua a exigir CATS ou uma solução de PSA no S/4HANA.

Se o cliente tiver os dois, a decisão tem de ser tomada antes do desenho técnico: um só sistema de registo de tempo é requisito, não preferência. Dois sistemas de registo produzem duas verdades de utilização, e a discussão a jusante passa a ser sobre qual dos números está certo.

---

## 11. Confirmações pendentes no sistema do cliente

Lista objetiva para a equipa funcional, antes do primeiro sprint:

1. Valores do domínio de estado do CATS e a semântica de cada um após alteração
2. Perfis de entrada de dados (`CAC1`) aplicáveis aos consultores, com incrementos e regras de aprovação
3. Seleção de campos (`CAC2`) por perfil, para fixar o formulário de detalhe
4. Existência e conteúdo de campos cliente em `CI_CATSDB`
5. Objetos recetores em uso: só PEP, ou também ordens e redes
6. Calendário de execução da transferência (`CATA` ou transações por componente)
7. Release do sistema e disponibilidade confirmada de `BAPI_CATIMESHEETMGR_INSERT` / `_CHANGE` / `_DELETE` no ambiente do cliente
8. Disponibilidade de extensibilidade embutida (ABAP Cloud, RAP on-stack) no S/4HANA Private Cloud do cliente, e o caminho de rede entre o frontend em BTP e esse serviço: destino direto, principal propagation, ou rede gerida do RISE
9. Timeout do pedido OData entre o frontend em BTP e o serviço no S/4, para fixar o maior lote aceitável em síncrono no mass entry antes de precisar de paginar
10. Política de estorno e de correção após transferência
11. Consumidores a jusante do campo `LTXA1`
12. Origem da capacidade diária, plano de trabalho ou regra própria, e tipos de ausência que fecham o dia
13. Disponibilidade do Joule no cliente e licenciamento, para decidir entre capacidade Joule e chat próprio
14. Base legal e avaliação de impacto para a captura de sinais, com o DPO
15. Versão do Leave Request ativa no cliente (HCM Fiori apps bundle, `HCMFAB_LEAVE_REQUEST_CR_SRV`), nomes de entidades e campos no `$metadata`, grupo de regras (`WEBMO`), workflow de aprovação em uso e periodicidade do `RPTARQPOST`

---

## 12. Referências

- CATSDB, tabela de base do registo de tempo, lista de campos: https://leanx.eu/en/sap/table/catsdb.html
- CATSDB, campos com domínios e conversões: https://www.se80.co.uk/saptables/c/cats/catsdb.htm
- CATA, transferência para os componentes de destino: https://www.tcodesearch.com/sap-tcodes/CATA
- CAT7, transferência para Controlling: https://www.erpyourself.net/en/sap-transaction-codes/CAT7.html
- CAT9, transferência para PM e CS: https://erpyourself.net/en/sap-transaction-codes/CAT9.html
- BAPI_CATIMESHEETMGR_CHANGE, alteração de registos: https://www.tcodesearch.com/sap-fms/BAPI_CATIMESHEETMGR_CHANGE
- Registo de tempo e aprovações em S/4HANA Cloud para serviços profissionais: https://learning.sap.com/courses/managing-projects-and-resources-in-sap-s-4hana-cloud-public-edition-professional-services/managing-time-recording-and-approvals
- Aprovação de timesheets, app Fiori 2.0 versão 3: https://help.sap.com/docs/SAP_FIORI/d59d9f81f4884bf9b115936b92c27202/bfc4c78fb3fa49b39c2ade7bf78b814e.html
- KBA 2103586, exits disponíveis no Cross Application Time Sheet: https://userapps.support.sap.com/sap/support/knowledge/en/2103586
