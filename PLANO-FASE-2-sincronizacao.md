# Plano — Fase 2 da Sincronização Patrimônio ↔ Controle de Renda

> Continuação da Fase 1 (chave global + card de status + ações em massa, já entregue).
> Objetivo da Fase 2: ligar ao Controle de Renda as movimentações que **ainda não** geram lançamentos — compras, parcelas/financiamentos, consórcios, vendas e aportes recorrentes — **sem contar nada em dobro**.

---

## 1. Como o sistema conta dinheiro hoje (a base de tudo)

São três camadas independentes. Entender isso é o que evita bug de duplicidade:

- **Ledger do Controle de Renda (`RS.income` / `RS.expenses`)** — é o que `calcIncome` e `calcExpense` somam. Alimenta os KPIs de Renda, o Fluxo de Caixa e os Relatórios. Hoje contém: lançamentos manuais + aluguel sincronizado + custo mensal sincronizado (Fase 1).
- **Calendário (`getMonthEvents`)** — NÃO lê o ledger `RS`. Ele remonta os eventos lendo direto de 7 fontes do patrimônio: parcelas, custos, recorrentes, renda dos ativos, cartões, empréstimos e despesas fixas. É uma visão unificada, paralela ao ledger.
- **Projeções (`renderProjecoesView`)** — soma `calcExpense` **+** `calcDividasKpis().faturaTotal` (cartões/empréstimos/despesas fixas entram aqui por fora do ledger).

**Conclusão:** parcelas e dívidas aparecem no calendário e nas projeções, mas **não** estão no ledger `RS`. Sincronizar = colocá-las no ledger — com regras claras pra não duplicar onde elas já são contadas.

---

## 2. Estratégia escolhida

Manter o padrão da Fase 1: **gerar lançamentos reais no `RS`**, cada um com uma **tag de origem** (`_assetId`, `_parcelaId`, `_consorcioId`, `_aporteId`, `_vendaId`, `_dividaId`). Vantagens: consistente com o que já existe, o usuário **vê** os lançamentos na lista de Renda, e o contador "lançamentos gerados" fica real. Cada lançamento sincronizado respeita a regra **global × individual** (só entra se a chave global estiver ON **e** o item estiver marcado pra sincronizar).

---

## 3. Mapeamento por tipo de movimentação

| Movimentação | Origem no app | Vira | Quando / data | Valor | Tag | Regra anti-duplicidade |
|---|---|---|---|---|---|---|
| **Parcela / financiamento** | `state.parcelas` (por ativo) | Saída | data de vencimento de cada parcela | `valorPago` ou `valorPrevisto` | `_parcelaId` | Sincroniza no nível da **parcela**. NÃO sincronizar também a "compra" do mesmo ativo financiado. |
| **Consórcio** | ativo consórcio + suas parcelas | Saída | vencimento mensal | `parcelaMensal` | `_parcelaId` | É o mesmo caminho da parcela. Um consórcio = suas parcelas; nunca os dois. |
| **Compra de ativo (à vista)** | `asset.purchaseValue` sem parcelas | Saída única | data de aquisição | `purchaseValue` | `_compraId` | Só para ativos **sem** parcelas. Ativo financiado → conta pelas parcelas. |
| **Venda de ativo** | novo fluxo "marcar como vendido" | Entrada única | data da venda | valor de venda | `_vendaId` | Exige fluxo novo (hoje só existe status "À venda" + meta de lucro). |
| **Aporte recorrente** | `asset.aporte` (campo novo estruturado) | Saída | dia do mês | `valorMensal` | `_aporteId` | Hoje "aporte" é texto livre na meta; precisa virar campo estruturado. |
| **Dívidas** (cartões, empréstimos, despesas fixas) | módulo Dívidas | Saída | vencimento | valor da fatura/parcela | `_dividaId` | **Cuidado:** já entram nas projeções via `calcDividasKpis`. Ver seção 4. |
| **Custo / aluguel** | já sincronizado (Fase 1) | — | — | — | `_assetId` | Sem mudança. |

---

## 4. O problema das Dívidas (a parte mais delicada)

Cartões, empréstimos e despesas fixas **já são somados nas projeções** por `calcDividasKpis().faturaTotal`, por fora do ledger. Se eu também criar lançamentos `RS.expenses` pra eles, as projeções passam a contar **duas vezes**.

Solução proposta: quando a dívida for sincronizada (vira lançamento no `RS`), **parar de somá-la** em `calcDividasKpis` para as projeções — ou seja, a projeção passa a confiar só no ledger para itens sincronizados, e mantém o cálculo paralelo só para os não sincronizados. Isso precisa de um ajuste cirúrgico em `renderProjecoesView` e em `calcDividasKpis` (filtrar por flag de sincronização). É o ponto que mais exige teste.

Recomendação: deixar **Dívidas por último** (sub-fase 2c), depois que parcelas/compras/aportes/vendas estiverem estáveis.

---

## 5. O que precisa ser criado de novo

- **Campo de aporte estruturado** (`asset.aporte = {ativa, valorMensal, dia}`) no modal de editar ativo, espelhando o que já existe para `asset.renda`. Sem isso não dá pra gerar aporte recorrente confiável (hoje é texto livre).
- **Fluxo de venda** — uma ação "Marcar como vendido" no card/modal do ativo, capturando valor e data da venda, gerando a entrada única e (opcional) baixando o ativo do patrimônio ativo.
- **Toggle individual por item** — para parcelas/consórcios/aportes, um marcador de "sincronizar este item" (default = segue a global). Para ativos isso já existe via `renda.ativa`; replicar a ideia.

---

## 6. Ações em massa e contadores (extensão da Fase 1)

- `applySyncOn('all')` passa a gerar também parcelas/aportes/compras do mês, não só aluguel.
- `applySyncOff('remove')` passa a limpar todas as tags de origem (`_parcelaId`, `_aporteId`, etc.), mantendo os já realizados.
- O card de status ganha o contador real de **dívidas sincronizadas** (hoje marcado "Fase 2").

---

## 7. Sub-fases sugeridas (entrega incremental e testável)

- **2a — Parcelas, consórcios e compras à vista** → saídas. Núcleo do valor, baixo risco de duplicidade (não colidem com o ledger atual). Inclui o toggle individual por item.
- **2b — Aportes recorrentes e vendas** → exige os campos/fluxos novos (seção 5).
- **2c — Dívidas** → exige o ajuste anti-duplicidade das projeções (seção 4). Mais sensível, por último.

Cada sub-fase é validada isolada (sintaxe + harness de lógica + conferência de que os totais de fluxo/projeção batem antes e depois).

---

## 8. Decisões abertas (com recomendação)

1. **Compra financiada** — contar pelas parcelas (recomendado) e a compra à vista como saída única. Confirmar.
2. **Venda baixa o ativo?** — ao vender, manter o ativo no histórico mas tirar do patrimônio ativo (recomendado), ou só registrar a entrada.
3. **Conta padrão dos lançamentos** — usar a primeira conta (Conta Corrente) como hoje, ou deixar o usuário escolher por tipo.
4. **Ordem** — seguir 2a → 2b → 2c (recomendado).

---

## 9. Riscos e validação

- **Dupla contagem** (dívidas) — principal risco; mitigado pela seção 4 e por deixar dívidas por último.
- **Migração de dados existentes** — ao ligar, gerar lançamentos retroativos só do mês atual (como na Fase 1), não do histórico inteiro, pra não inflar números passados.
- **Validação** — para cada sub-fase: checagem de sintaxe, teste de lógica isolado, e comparação dos totais de Fluxo/Projeções/Relatórios antes e depois (devem bater, sem duplicar).
