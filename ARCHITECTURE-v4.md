# ARQUITETURA SISTEMA SER v4.0 — Esquadrão de Agentes

## Visão Geral do Roteamento de Modelos

```
 WHATSAPP (mensagem entra)
          │
          ▼
┌──────────────────────────┐
│      MAESTRO             │  ← SEM IA (regex + regras)
│   Roteador Inteligente   │     Custo: $0 por mensagem
│                          │     Resolve 70-80% dos casos
│   "ok" → responde direto │     sozinho sem gastar token
│   "agenda" → busca DB    │
│   complexo → aciona IA   │
└──────────┬───────────────┘
           │
           │ (só 20-30% das mensagens chegam aqui)
           │
    ┌──────┴──────────────────────────┐
    │                                 │
    ▼                                 ▼
┌────────────────┐   ┌─────────────────────────┐
│   TRIAGEM      │   │   RESPOSTA DIRETA       │
│  GPT-4.1-mini  │   │   (Maestro respondeu    │
│  $0.40/MTok    │   │    sem gastar token)    │
│                │   └─────────────────────────┘
│ Entende input  │
│ bagunçado,     │
│ extrai dados,  │
│ infere energia │
└───────┬────────┘
        │
        ▼
┌────────────────┐
│  ORGANIZADOR   │  ← GPT-4o-mini (o mais barato)
│  GPT-4o-mini   │     $0.15/MTok
│  $0.15/MTok    │     Só faz matemática de agenda
│                │     Input estruturado (JSON)
│ Encaixa tarefa │     Não precisa ser "inteligente"
│ nos horários   │
│ livres         │
└───────┬────────┘
        │
        ▼
┌────────────────┐
│   GUARDIÃO     │  ← Claude (o mais empático)
│  Claude Haiku  │     $1.00/MTok
│   4.5          │     Só é acionado quando:
│                │     - Dia está sobrecarregado
│ Analisa carga  │     - Tarefa pesada após 18h
│ Veta excessos  │     - 3+ pesadas seguidas
│ Fatia tarefas  │     - Usuário parece cansado
│ Protege saúde  │
└───────┬────────┘
        │
        ▼
   RESPOSTA FINAL
   (formatada pro WhatsApp)
```

---

## TABELA DE CUSTOS POR AGENTE

| Agente | Modelo | Input $/MTok | Output $/MTok | Quando é acionado | % das msgs |
|---|---|---|---|---|---|
| **Maestro** | NENHUM (regex) | $0 | $0 | SEMPRE (100%) | 100% |
| **Triagem** | GPT-4.1-mini | $0.40 | $1.60 | Mensagens que precisam interpretar (criar, mover, editar tarefa) | ~25% |
| **Organizador** | GPT-4o-mini | $0.15 | $0.60 | Quando precisa encaixar tarefa na agenda | ~20% |
| **Guardião** | Claude Haiku 4.5 | $1.00 | $5.00 | Quando detecta risco de sobrecarga | ~5% |
| **Resposta WA** | GPT-4.1-mini | $0.40 | $1.60 | Quando precisa gerar texto humanizado | ~25% |

**Custo estimado por 100 mensagens/dia:**
- 70 msgs resolvidas pelo Maestro (regex): $0
- 25 msgs processadas pela Triagem: ~$0.015
- 20 msgs passam pelo Organizador: ~$0.004
- 5 msgs acionam o Guardião: ~$0.008
- 25 msgs geram resposta humanizada: ~$0.015
- **TOTAL: ~$0.042/dia = ~$1.26/mês para 100 msgs/dia**

Compare com o modelo atual (GPT-4o-mini para TUDO): ~$3-8/mês para 100 msgs/dia.
**Economia de 60-85%.**

---

## DETALHAMENTO DE CADA AGENTE

### AGENTE 0: MAESTRO (Roteador — SEM IA)

**Modelo**: NENHUM
**Custo**: $0
**Linguagem**: JavaScript puro (regex, maps, condicionais)

**O que resolve sozinho (sem gastar token):**

```javascript
// ═══════════════════════════════════════════════
// MAESTRO — Roteador Central
// Resolve 70-80% das mensagens sem usar IA
// ═══════════════════════════════════════════════

const MAESTRO_ROUTES = {
  // ── SAUDAÇÕES (resposta fixa) ──
  greetings: {
    patterns: [
      /^(oi|ola|eai|fala|bom dia|boa tarde|boa noite|hey|hello)\b/i,
    ],
    handler: 'greeting_response', // Responde com briefing do dia
    needsAI: false,
  },

  // ── CONFIRMAÇÕES (resposta fixa) ──
  acknowledgements: {
    patterns: [
      /^(ok|okay|blz|beleza|valeu|obrigado|obg|show|perfeito|fechado|certo|entendi|ta bom|tudo certo)\s*[.!]?$/i,
    ],
    handler: 'ack_response', // "Fechado, senhor."
    needsAI: false,
  },

  // ── CONSULTA DE AGENDA (busca no banco) ──
  agenda_query: {
    patterns: [
      /\b(agenda|tarefas?|compromissos?|o que tenho|o que falta|pendente)\b/i,
    ],
    handler: 'agenda_list', // Busca DB, formata lista
    needsAI: false,
    extractDate: true, // Usa inferDateFromText() local
  },

  // ── CONCLUSÃO RÁPIDA (atualiza banco) ──
  quick_complete: {
    patterns: [
      /\b(conclu[ií]|finalize[i]?|terminei|feito|pronto|acabei)\b/i,
    ],
    handler: 'complete_task', // Marca tarefa como concluída
    needsAI: false,
    needsSelector: true, // Precisa identificar QUAL tarefa
  },

  // ── MOVER RÁPIDO (atualiza banco) ──
  quick_move: {
    patterns: [
      /\b(mover?|jog[ao]|pass[ao]|adia|reagend)\b.*\b(amanha|segunda|terca|quarta|quinta|sexta|sabado|domingo)\b/i,
    ],
    handler: 'move_task', // Move tarefa de dia
    needsAI: false,
    extractDate: true,
    needsSelector: true,
  },

  // ── PEDIDO DE PRIORIDADES (lógica local) ──
  priorities: {
    patterns: [
      /\b(prioridade|priorizar|urgente|o que fa[cç]o primeiro|foco de hoje)\b/i,
    ],
    handler: 'priority_list', // Ordena por energia + deadline
    needsAI: false,
  },

  // ── STATUS/ENERGIA (resposta + registro) ──
  energy_checkin: {
    patterns: [
      /\b(cansado|exausto|esgotado|sem energia|disposto|animado|energia alta|energia baixa|travado)\b/i,
    ],
    handler: 'energy_checkin', // Registra energia + adapta sugestões
    needsAI: false,
  },

  // ── CUSTOS/GASTOS (cálculo local) ──
  usage_query: {
    patterns: [
      /\b(gasto|gastamos|custo|tokens?|consumo)\b/i,
    ],
    handler: 'usage_summary', // Calcula do log local
    needsAI: false,
  },

  // ── TUDO MAIS → ACIONA TRIAGEM (IA) ──
  // Se nenhum pattern bateu, manda pro Agente de Triagem
};

function maestroRoute(text) {
  const normalized = normalizeText(text);

  for (const [routeName, route] of Object.entries(MAESTRO_ROUTES)) {
    for (const pattern of route.patterns) {
      if (pattern.test(normalized) || pattern.test(text)) {
        return {
          route: routeName,
          handler: route.handler,
          needsAI: route.needsAI,
          extractDate: route.extractDate || false,
          needsSelector: route.needsSelector || false,
        };
      }
    }
  }

  // Nenhum pattern bateu → precisa de IA
  return { route: 'ai_triage', handler: 'triage_agent', needsAI: true };
}
```

**Handlers do Maestro (sem IA):**

```javascript
const MAESTRO_HANDLERS = {
  // Saudação → Briefing automático do dia
  async greeting_response(context) {
    const { tasks, today } = context;
    const dayTasks = tasks.filter(t => !t.completedAt && t.date === today);

    if (dayTasks.length === 0) {
      return { text: 'Bom dia, senhor. Agenda limpa hoje. Quer criar alguma tarefa?' };
    }

    const totalMin = dayTasks.reduce((s, t) => s + (t.estimatedTime || 30), 0);
    const heavy = dayTasks.filter(t => t.energyLevel === 'pesada').length;
    const withTime = dayTasks.filter(t => t.startTime).sort((a, b) => a.startTime.localeCompare(b.startTime));

    let msg = `Bom dia, senhor. Hoje: ${dayTasks.length} tarefa${dayTasks.length > 1 ? 's' : ''}, ~${(totalMin / 60).toFixed(1)}h.`;
    if (heavy >= 3) msg += '\nAtenção: 3 tarefas pesadas hoje. Considere redistribuir.';
    if (withTime.length > 0) {
      msg += `\nPrimeiro compromisso: ${withTime[0].startTime} — ${withTime[0].title}.`;
    }

    return { text: msg, reaction: '👋' };
  },

  // Confirmação → Resposta curta
  async ack_response() {
    return { text: 'Fechado, senhor.', reaction: '👍' };
  },

  // Agenda → Lista do banco
  async agenda_list(context) {
    const { tasks, targetDate } = context;
    const dayTasks = tasks
      .filter(t => !t.completedAt && t.date === targetDate)
      .sort((a, b) => (a.startTime || '99:99').localeCompare(b.startTime || '99:99'));

    if (dayTasks.length === 0) {
      return { text: `Sem tarefas para ${formatDatePt(targetDate)}, senhor.`, reaction: '📋' };
    }

    const lines = dayTasks.map((t, i) => {
      const time = t.startTime || '--:--';
      const energy = { leve: '🟢', media: '🟡', pesada: '🔴' }[t.energyLevel] || '⚪';
      return `${i + 1}. ${time} ${energy} ${t.title} [${t.frente}]`;
    });

    return {
      text: `Agenda ${formatDatePt(targetDate)}:\n${lines.join('\n')}`,
      reaction: '📋',
    };
  },

  // Conclusão rápida → Marca no banco
  async complete_task(context) {
    const { taskMatch } = context;
    if (!taskMatch) return { text: 'Qual tarefa o senhor concluiu? Me manda o nome ou código.', reaction: '❓' };
    // Marcar como concluída no DB
    return { text: `Concluída: "${taskMatch.title}". Boa, senhor!`, reaction: '✅' };
  },

  // Mover rápido → Atualiza data no banco
  async move_task(context) {
    const { taskMatch, targetDate } = context;
    if (!taskMatch) return { text: 'Qual tarefa quer mover? Me manda o nome.', reaction: '❓' };
    // Atualizar data no DB
    return { text: `"${taskMatch.title}" movida para ${formatDatePt(targetDate)}.`, reaction: '🔄' };
  },

  // Prioridades → Ordenação local por energia + deadline
  async priority_list(context) {
    const { tasks, today } = context;
    const pending = tasks.filter(t => !t.completedAt && t.date <= today);

    // Ordenar: pesada primeiro (energia alta agora > depois), depois por deadline
    const sorted = pending.sort((a, b) => {
      const energyOrder = { pesada: 0, media: 1, leve: 2 };
      const ea = energyOrder[a.energyLevel] ?? 1;
      const eb = energyOrder[b.energyLevel] ?? 1;
      if (ea !== eb) return ea - eb;
      return (a.startTime || '99:99').localeCompare(b.startTime || '99:99');
    });

    const lines = sorted.slice(0, 5).map((t, i) => {
      const energy = { leve: '🟢', media: '🟡', pesada: '🔴' }[t.energyLevel] || '⚪';
      return `${i + 1}. ${energy} ${t.title} (~${t.estimatedTime || 30}min)`;
    });

    return { text: `Prioridades de hoje:\n${lines.join('\n')}`, reaction: '🎯' };
  },

  // Check-in de energia → Registra + adapta
  async energy_checkin(context) {
    const { energyLevel } = context;
    // Salvar no banco
    const responses = {
      baixa: 'Entendi, senhor. Energia baixa. Vou sugerir só tarefas leves agora. Beba água e faz um alongamento de 5 min.',
      media: 'Energia ok. Bora manter o ritmo, senhor.',
      alta: 'Energia alta! Hora de atacar as tarefas mais pesadas.',
    };
    return { text: responses[energyLevel] || responses.media, reaction: '⚡' };
  },
};
```

---

### AGENTE 1: TRIAGEM (GPT-4.1-mini — $0.40/MTok)

**Quando é acionado**: Maestro não conseguiu resolver via regex (mensagem complexa, criação de tarefa, pedido ambíguo).

**O que faz**:
1. Recebe texto/áudio bagunçado do usuário
2. Extrai: título, data, horário, duração estimada, prazo (deadline), nível de energia
3. Classifica a frente (taka/haldan/pessoal) e tipo
4. Retorna JSON estruturado pro Organizador

**Prompt do Triagem:**

```javascript
const TRIAGE_AGENT_PROMPT = `Você é o Agente de Triagem do Sistema SER.

OBJETIVO: Interpretar a mensagem do Sergio e extrair dados estruturados para a agenda.

VOCÊ DEVE INFERIR AUTOMATICAMENTE:
1. energyLevel — Quanta carga mental a tarefa exige:
   - "pesada": reuniões importantes, decisões complexas, propostas, apresentações, negociações
   - "media": follow-ups, SEO, conteúdo, organização, treino
   - "leve": emails, confirmações, tarefas administrativas, compras, casa

2. estimatedTime — Quanto tempo em minutos:
   - Reunião padrão: 60min
   - Follow-up/email: 15min
   - SEO/conteúdo: 45-90min
   - Treino: 60min
   - Tarefa administrativa: 20min

3. deadline — Se o usuário mencionou prazo ("até sexta", "precisa ser hoje"), extrair como YYYY-MM-DD. Se não mencionou, null.

CONTEXTO:
- Frentes: "taka" (Estúdio Taka, agência marketing, clientes médicos), "haldan" (gerência Haldan), "pessoal" (casa, saúde, Mari)
- Tipos: Reunião|SEO|WordPress|Conteúdo|Follow-up|Proposta|Gestão equipe|Alimentação|Esporte|Casa|Outro

RETORNE APENAS JSON (sem markdown):
{
  "understood": true,
  "tasks": [
    {
      "title": "texto limpo da tarefa",
      "frente": "taka|haldan|pessoal",
      "type": "tipo",
      "date": "YYYY-MM-DD",
      "startTime": "HH:MM" ou null,
      "estimatedTime": 30,
      "energyLevel": "leve|media|pesada",
      "deadline": "YYYY-MM-DD" ou null,
      "detail": "contexto extra" ou null
    }
  ],
  "clarification": null ou "pergunta se algo não ficou claro"
}

Se NÃO entender, retorne: {"understood": false, "clarification": "pergunta específica"}
Se o texto NÃO é um pedido de tarefa, retorne: {"understood": true, "tasks": [], "intent": "conversa|duvida|desabafo", "reply": "resposta curta e humana"}`;
```

**Chamada da Triagem:**
```javascript
async function callTriageAgent(userText, context) {
  const today = todayLocalISO();
  const prompt = `${TRIAGE_AGENT_PROMPT}

DATA_ATUAL: ${today}
DIA_DA_SEMANA: ${getDayName(today)}`;

  const result = await callOpenAI(prompt, [
    { role: 'user', content: userText }
  ], 500, {
    model: 'gpt-4.1-mini',      // ← Modelo inteligente mas acessível
    expectJson: true,
    temperature: 0,
    usageKind: 'triage_agent',
  });

  return parseJSONFromLLM(result);
}
```

---

### AGENTE 2: ORGANIZADOR (GPT-4o-mini — $0.15/MTok)

**Quando é acionado**: Triagem extraiu os dados da tarefa, agora precisa encaixar na agenda.

**O que faz**:
1. Recebe dados estruturados (JSON) da Triagem
2. Consulta agenda do dia via banco de dados
3. Consulta Google Calendar via MCP (horários ocupados)
4. Calcula gaps de tempo disponível
5. Sugere melhor horário

**Por que GPT-4o-mini**: Recebe input 100% estruturado (JSON), só precisa fazer "matemática de encaixe". Não precisa de inteligência linguística.

**Prompt do Organizador:**

```javascript
const ORGANIZER_AGENT_PROMPT = `Você é o Agente Organizador do Sistema SER.

OBJETIVO: Encaixar tarefas nos horários livres da agenda.

REGRAS DE AGENDAMENTO:
1. Horário de trabalho: 06:00 às 20:00
2. NUNCA agendar 2 tarefas no mesmo horário
3. Deixar 15min de intervalo entre tarefas
4. Tarefas "pesadas" preferencialmente de manhã (06:00-12:00)
5. Tarefas "leves" podem ir à tarde (14:00-18:00)
6. Pausa de almoço: 12:00-13:00 (NUNCA agendar aqui)
7. Se o dia está cheio, sugerir próximo dia com espaço
8. Respeitar deadline: se tem prazo, priorizar antes dele

INPUT: Recebe JSON com tarefa a encaixar + agenda atual + calendar events
OUTPUT: Retorne APENAS JSON:
{
  "scheduled": true,
  "date": "YYYY-MM-DD",
  "startTime": "HH:MM",
  "endTime": "HH:MM",
  "conflicts": [],
  "alternativeSlots": ["HH:MM", "HH:MM"],
  "warnings": ["aviso se dia pesado"]
}

Se NÃO COUBER no dia solicitado:
{
  "scheduled": false,
  "reason": "explicação curta",
  "suggestion": { "date": "YYYY-MM-DD", "startTime": "HH:MM" },
  "alternativeDates": ["YYYY-MM-DD"]
}`;
```

**Chamada do Organizador:**
```javascript
async function callOrganizerAgent(taskData, existingAgenda, calendarEvents) {
  const prompt = `${ORGANIZER_AGENT_PROMPT}

TAREFA A ENCAIXAR:
${JSON.stringify(taskData)}

AGENDA DO DIA (${taskData.date}):
${existingAgenda.map(t => `${t.startTime || '--:--'}-${t.endTime || '--:--'} ${t.title} [${t.energyLevel}]`).join('\n') || '(vazio)'}

EVENTOS DO GOOGLE CALENDAR (${taskData.date}):
${calendarEvents.map(e => `${e.start}-${e.end} ${e.title}`).join('\n') || '(nenhum)'}

HORÁRIO ATUAL: ${getCurrentTime()}`;

  const result = await callOpenAI(prompt, [
    { role: 'user', content: 'Encaixe esta tarefa na melhor posição.' }
  ], 300, {
    model: 'gpt-4o-mini',        // ← O mais barato — só faz math
    expectJson: true,
    temperature: 0,
    usageKind: 'organizer_agent',
  });

  return parseJSONFromLLM(result);
}
```

---

### AGENTE 3: GUARDIÃO (Claude Haiku 4.5 — $1.00/MTok)

**Quando é acionado** (APENAS nestas situações):
- Dia tem >6h de tarefas agendadas
- 3+ tarefas "pesada" no mesmo dia
- Tarefa pesada agendada após 18h
- Usuário reportou energia "baixa" e tem tarefa pesada em <2h
- Hook detectou que tarefa está atrasada >15min
- Score de burnout > 60

**O que faz**:
1. Analisa a agenda como um todo (não tarefa individual)
2. Pode VETAR agendamento (retorna bloqueio)
3. Sugere redistribuição
4. Fatia tarefa pesada em micro-passos
5. Gera mensagem empática e motivadora

**Por que Claude**: O Guardião precisa de inteligência emocional. Claude é reconhecido como o modelo mais empático e natural em conversação. Ele precisa entender quando o Sergio está prestes a se sobrecarregar e comunicar isso com cuidado.

**Prompt do Guardião:**

```javascript
const GUARDIAN_AGENT_PROMPT = `Você é o Agente Guardião do Sistema SER — o protetor da saúde e bem-estar do Sergio.

QUEM É SERGIO: Empreendedor que gerencia 3 frentes (Taka, Haldan, Pessoal). Parceira: Mari, esperando um filho. Tende a se sobrecarregar e não sabe dizer "não" para compromissos.

SEU PAPEL: Você é o terapeuta ocupacional dele. Sua palavra é FINAL sobre carga de trabalho.

REGRAS INEGOCIÁVEIS:
1. MAX 8 horas produtivas por dia. Passou disso → VETO.
2. MAX 2 tarefas "pesada" consecutivas. Na terceira → inserir pausa obrigatória de 30min.
3. NENHUMA tarefa pesada após 18h. Noite é para tarefas leves e vida pessoal.
4. Pausa de almoço (12:00-13:00) é SAGRADA. Nunca agendar nada.
5. Se energia está "baixa" → só liberar tarefas "leve" nas próximas 2h.
6. Se tem tarefa atrasada >30min → perguntar gentilmente, não pressionar. Oferecer: reagendar, fatiar, ou trocar por algo mais leve.

QUANDO VETAR:
- Retorne veto=true + motivo + sugestão de redistribuição
- Sugira EXATAMENTE quais tarefas mover e para quando

QUANDO FATIAR TAREFA:
- Quebre em 3-5 passos de MAX 15 minutos cada
- Cada passo deve ser uma ação concreta e específica
- O primeiro passo deve ser o mais fácil (reduz ansiedade)

TOM: Firme mas acolhedor. Trate como "senhor". Sem emojis. Frases curtas. Você protege, não pune.

RETORNE JSON:
{
  "approved": true/false,
  "veto": {
    "reason": "motivo do veto",
    "redistribute": [
      {"taskId": "...", "moveToDate": "YYYY-MM-DD", "reason": "explicação"}
    ]
  },
  "warnings": ["avisos sobre a carga"],
  "message": "mensagem para o Sergio",
  "slicedSteps": [
    {"text": "passo 1", "time": 10},
    {"text": "passo 2", "time": 15}
  ],
  "mandatoryBreak": {
    "afterTask": "taskId",
    "duration": 30,
    "suggestion": "Levanta, bebe água, 5 min de alongamento."
  }
}`;
```

**Chamada do Guardião:**
```javascript
async function callGuardianAgent(fullDayAgenda, newTask, userEnergy, burnoutScore) {
  const prompt = `${GUARDIAN_AGENT_PROMPT}

AGENDA COMPLETA DO DIA:
${fullDayAgenda.map(t => {
  const energy = { leve: '🟢L', media: '🟡M', pesada: '🔴P' }[t.energyLevel] || '?';
  return `${t.startTime || '--:--'} [${energy}] ${t.title} (${t.estimatedTime}min)`;
}).join('\n')}

NOVA TAREFA PROPOSTA:
${JSON.stringify(newTask)}

ENERGIA ATUAL DO SERGIO: ${userEnergy || 'não informada'}
SCORE DE BURNOUT: ${burnoutScore}/100
HORA ATUAL: ${getCurrentTime()}`;

  // ── CHAMADA PARA CLAUDE (Anthropic API) ──
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',  // ← Claude para empatia
      max_tokens: 600,
      system: prompt,
      messages: [{ role: 'user', content: 'Analise esta agenda e a nova tarefa proposta.' }],
    }),
  });

  const data = await response.json();
  return parseJSONFromLLM(data.content[0].text);
}
```

---

### FLUXO COMPLETO (exemplo real)

**Sergio manda no WhatsApp**: "Preciso fechar a proposta do Dr. Marcos até sexta e ainda tenho reunião com a equipe Haldan às 15h"

```
PASSO 1 — MAESTRO (regex, $0)
├── Texto não bate com nenhum pattern simples
├── Tem verbo de ação ("fechar", "tenho") + referências temporais
└── DECISÃO: Enviar pro TRIAGEM

PASSO 2 — TRIAGEM (GPT-4.1-mini, ~150 tokens)
├── INPUT: texto cru do Sergio
├── OUTPUT:
│   {
│     "tasks": [
│       {
│         "title": "Fechar proposta Dr. Marcos",
│         "frente": "taka",
│         "type": "Proposta",
│         "date": "2026-03-27",      ← hoje (encaixar antes da deadline)
│         "startTime": null,
│         "estimatedTime": 90,
│         "energyLevel": "pesada",    ← proposta = carga alta
│         "deadline": "2026-03-27"    ← "até sexta" = sexta
│       },
│       {
│         "title": "Reunião equipe Haldan",
│         "frente": "haldan",
│         "type": "Reunião",
│         "date": "2026-03-26",       ← hoje
│         "startTime": "15:00",
│         "estimatedTime": 60,
│         "energyLevel": "pesada",    ← reunião = carga alta
│         "deadline": null
│       }
│     ]
│   }
└── ENVIA pro ORGANIZADOR

PASSO 3 — ORGANIZADOR (GPT-4o-mini, ~100 tokens cada)
├── Tarefa 1 (Proposta Dr. Marcos):
│   ├── Consulta agenda de hoje: já tem 5h agendadas
│   ├── Consulta Google Calendar: 10:00-11:00 ocupado
│   ├── Gap disponível: 08:00-10:00 (2h) ← cabe 90min!
│   └── OUTPUT: { scheduled: true, date: "2026-03-26", startTime: "08:00" }
│
├── Tarefa 2 (Reunião Haldan):
│   ├── Horário fixo 15:00 ← já definido pelo usuário
│   └── OUTPUT: { scheduled: true, date: "2026-03-26", startTime: "15:00" }
│
└── TOTAL DO DIA PÓS-AGENDAMENTO: 7.5h, 3 tarefas pesadas
    └── ACIONA GUARDIÃO (>6h E 3+ pesadas)

PASSO 4 — GUARDIÃO (Claude Haiku, ~200 tokens)
├── Analisa: 7.5h total, 3 pesadas (manhã + tarde + tarde)
├── DECISÃO: Aprovar MAS com pausa obrigatória
├── OUTPUT:
│   {
│     "approved": true,
│     "warnings": ["3 tarefas pesadas hoje. Inserindo pausa."],
│     "mandatoryBreak": {
│       "afterTask": "proposta-dr-marcos-id",
│       "duration": 30,
│       "suggestion": "Levanta, alonga, bebe água. 30 min sem tela."
│     },
│     "message": "Senhor, dia pesado mas possível. Proposta às 8h,
│                  pausa obrigatória às 9h30, reunião às 15h.
│                  Se a energia cair, me avisa que a gente redistribui."
│   }

PASSO 5 — RESPOSTA NO WHATSAPP
├── Formata mensagem do Guardião
├── Adiciona typing indicator (3s)
├── Envia:
│   "Agendado:
│    08:00 🔴 Proposta Dr. Marcos (90min) [taka]
│    09:30 ☕ Pausa obrigatória (30min)
│    15:00 🔴 Reunião equipe Haldan (60min) [haldan]
│
│    Dia pesado mas possível, senhor.
│    Se a energia cair, me avisa que redistribuo."
└── React: 📝
```

**Custo total desta interação**: ~$0.0015 (~R$0.008)

---

## CONFIGURAÇÃO DO .env

```env
# ═══ MODELOS POR AGENTE ═══
# Maestro: sem IA (regex)
TRIAGE_MODEL=gpt-4.1-mini
ORGANIZER_MODEL=gpt-4o-mini
GUARDIAN_MODEL=claude-haiku-4-5-20251001
RESPONSE_MODEL=gpt-4.1-mini

# ═══ TOKENS MÁXIMOS POR AGENTE ═══
TRIAGE_MAX_TOKENS=500
ORGANIZER_MAX_TOKENS=300
GUARDIAN_MAX_TOKENS=600
RESPONSE_MAX_TOKENS=400

# ═══ API KEYS ═══
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...

# ═══ GUARDIÃO — LIMITES ═══
GUARDIAN_MAX_DAILY_HOURS=8
GUARDIAN_MAX_CONSECUTIVE_HEAVY=2
GUARDIAN_HEAVY_CUTOFF_HOUR=18
GUARDIAN_BURNOUT_THRESHOLD=60

# ═══ GOOGLE CALENDAR MCP ═══
GOOGLE_CALENDAR_ENABLED=true
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REFRESH_TOKEN=...
GOOGLE_CALENDAR_ID=primary
```

---

## SCHEMA DA TAREFA (atualizado com energyLevel)

```javascript
{
  id: "uuid",
  title: "Fechar proposta Dr. Marcos",
  detail: "Proposta comercial para implantes",
  frente: "taka",                    // taka | haldan | pessoal
  type: "Proposta",                  // Reunião, SEO, etc.
  date: "2026-03-26",               // YYYY-MM-DD
  startTime: "08:00",               // HH:MM ou null
  endTime: "09:30",                  // ← NOVO: calculado
  estimatedTime: 90,                 // minutos
  actualTime: 0,                     // ← NOVO: tempo real gasto
  energyLevel: "pesada",             // ← NOVO: leve | media | pesada
  deadline: "2026-03-27",            // ← NOVO: prazo inegociável
  status: "pendente",                // ← NOVO: pendente | em_andamento | concluida | atrasada
  pomodorosCompleted: 0,             // ← NOVO: pomodoros feitos
  steps: [],                         // sub-tarefas
  followUpDaily: false,
  source: "whatsapp",                // app | whatsapp | api
  createdAt: "2026-03-26T08:00:00Z",
  updatedAt: "2026-03-26T08:00:00Z",
  completedAt: null,
}
```

---

## MCP — GOOGLE CALENDAR

**Integração bidirecional:**
- LER: Buscar eventos do Google Calendar para saber horários ocupados
- ESCREVER: Criar eventos no Google Calendar quando tarefa é agendada no SER

```javascript
// ═══ MCP Google Calendar ═══
import { google } from 'googleapis';

const calendar = google.calendar('v3');

// Autenticação OAuth2
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
);
oauth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
});

// LER eventos do dia
async function getCalendarEvents(date) {
  const res = await calendar.events.list({
    auth: oauth2Client,
    calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',
    timeMin: `${date}T00:00:00-03:00`,
    timeMax: `${date}T23:59:59-03:00`,
    singleEvents: true,
    orderBy: 'startTime',
  });

  return (res.data.items || []).map(event => ({
    id: event.id,
    title: event.summary || 'Sem título',
    start: event.start?.dateTime?.slice(11, 16) || '00:00',
    end: event.end?.dateTime?.slice(11, 16) || '23:59',
    allDay: Boolean(event.start?.date),
  }));
}

// ESCREVER evento quando tarefa é agendada
async function createCalendarEvent(task) {
  if (!task.startTime || !task.date) return null;

  const startMinutes = timeToMinutes(task.startTime);
  const endMinutes = startMinutes + (task.estimatedTime || 30);
  const endTime = minutesToHHMM(endMinutes);

  const event = {
    summary: `[SER] ${task.title}`,
    description: `Frente: ${task.frente}\nTipo: ${task.type}\nEnergia: ${task.energyLevel}`,
    start: {
      dateTime: `${task.date}T${task.startTime}:00-03:00`,
      timeZone: 'America/Sao_Paulo',
    },
    end: {
      dateTime: `${task.date}T${endTime}:00-03:00`,
      timeZone: 'America/Sao_Paulo',
    },
    colorId: { taka: '11', haldan: '10', pessoal: '3' }[task.frente] || '7',
  };

  const res = await calendar.events.insert({
    auth: oauth2Client,
    calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',
    resource: event,
  });

  return res.data.id;
}
```

---

## HOOKS (Vigias — sem IA, $0)

```javascript
// ═══ HOOKS — Timers que monitoram sem usar IA ═══

// Hook 1: Tarefa atrasada (verifica a cada 1 min)
setInterval(async () => {
  const now = new Date();
  const today = todayLocalISO();
  const currentTime = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

  const agenda = await readAgendaData();
  const overdueTasks = agenda.tasks.filter(t =>
    t.date === today &&
    t.startTime &&
    t.startTime < currentTime &&
    t.status === 'pendente' &&
    !t.completedAt
  );

  for (const task of overdueTasks) {
    const delayMinutes = timeToMinutes(currentTime) - timeToMinutes(task.startTime);

    // 15min atrasada → lembrete gentil (sem IA)
    if (delayMinutes === 15) {
      await sendWhatsAppMessage(
        `Senhor, "${task.title}" era pras ${task.startTime}. Tudo bem? Quer começar agora ou reagendar?`
      );
    }

    // 30min+ atrasada → aciona Guardião (com IA)
    if (delayMinutes === 30) {
      const guardianResponse = await callGuardianAgent(
        agenda.tasks.filter(t => t.date === today),
        task,
        lastEnergyLevel,
        await calculateBurnoutScore()
      );
      await sendWhatsAppMessage(guardianResponse.message);
    }
  }
}, 60 * 1000);

// Hook 2: Score de burnout (verifica a cada 30 min)
setInterval(async () => {
  const score = await calculateBurnoutScore();

  if (score.score > 70 && !burnoutAlertSentToday) {
    // Aciona Guardião
    const response = await callGuardianAgent(/* ... */);
    await sendWhatsAppMessage(response.message);
    burnoutAlertSentToday = true;
  }
}, 30 * 60 * 1000);

// Hook 3: Transição de energia (verifica a cada 2h)
// Se passou 3h sem check-in de energia, perguntar
setInterval(async () => {
  const lastCheckin = await getLastEnergyCheckin();
  const hoursSince = lastCheckin
    ? (Date.now() - new Date(lastCheckin.createdAt).getTime()) / 3600000
    : 99;

  if (hoursSince > 3 && isWorkingHours()) {
    await sendWhatsAppMessage(
      'Senhor, como está a energia? Me responde: alta, média ou baixa.'
    );
  }
}, 2 * 60 * 60 * 1000);
```

---

## RESUMO DA ARQUITETURA

| Camada | Tecnologia | Modelo IA | Custo |
|---|---|---|---|
| Roteamento | Maestro (regex JS) | Nenhum | $0 |
| Interpretação | Triagem | GPT-4.1-mini | $0.40/MTok |
| Agendamento | Organizador | GPT-4o-mini | $0.15/MTok |
| Proteção | Guardião | Claude Haiku 4.5 | $1.00/MTok |
| Resposta final | Formatador | GPT-4.1-mini | $0.40/MTok |
| Monitoramento | Hooks (timers) | Nenhum | $0 |
| Dados externos | MCP (Google Calendar) | Nenhum | $0 |
| Banco de dados | PostgreSQL (Supabase) | Nenhum | $0-25/mês |

**Custo total estimado: ~R$8-25/mês para uso pessoal (100 msgs/dia)**
**Custo por usuário SaaS: ~R$2-5/mês por usuário ativo**
