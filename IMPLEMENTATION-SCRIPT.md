# SCRIPT DE IMPLEMENTAÇÃO — SISTEMA SER v4.0
## Para execução pelo Codex / IA de desenvolvimento

> **CONTEXTO**: Este é o Sistema SER (Separar-Executar-Revisar), um assistente de produtividade pessoal para o Sergio, que gerencia 3 frentes de trabalho (Taka, Haldan, Pessoal). O sistema já tem: agenda com CRUD, chat IA, WhatsApp integrado, Pomodoro, notas, e lembretes. Este script detalha as NOVAS features a implementar.

> **REGRA DE OURO**: Não quebre o que já funciona. Leia o código existente antes de modificar. Mantenha compatibilidade com a estrutura atual.

---

## PARTE 0 — TROCA DE MODELO DE IA

### 0.1 Migrar de GPT-4o-mini para GPT-4.1-mini

**Por quê**: O GPT-4.1-mini é 50% mais rápido (latência), tem conversação mais natural, melhor PT-BR, e custa apenas $0.40/$1.60 por MTok (vs $0.15/$0.60 do 4o-mini). O custo sobe ~2.7x mas a qualidade conversacional é significativamente melhor, especialmente para o tom de "coach pessoal" que o SER precisa.

**Alternativa budget**: Se o custo for preocupação, Gemini 2.5 Flash-Lite ($0.10/$0.40) é mais barato que o 4o-mini atual, com qualidade comparável.

**Referências de benchmark**:
- https://artificialanalysis.ai/models (comparação interativa de modelos)
- https://promptaa.com/blog/4-o-mini-vs-4-1-mini (4o-mini vs 4.1-mini direto)
- https://intuitionlabs.ai/articles/low-cost-llm-comparison (comparação low-cost)

**Arquivos a modificar**:
- `.env` → Mudar `OPENAI_MODEL=gpt-4.1-mini` (afeta todas as constantes DEFAULT_MODEL, CHAT_MODEL, PARSER_MODEL, WHATSAPP_MODEL)
- `.env.example` → Atualizar modelo padrão
- `server.js` linha ~24-27 → As constantes já leem de env, então a mudança é só no `.env`

**Validação**: O modelo `gpt-4.1-mini` usa a mesma API da OpenAI (`/v1/chat/completions`), mesmo formato de mensagens, mesmo `response_format: json_object`. Zero mudança de código na função `callOpenAI()`.

**AÇÃO**:
```env
# .env
OPENAI_MODEL=gpt-4.1-mini
```

Isso é tudo. A função `callOpenAI()` em server.js (linha ~1842) já suporta qualquer modelo OpenAI. A única exceção é se o modelo for `gpt-5*`, que tem tratamento especial (`max_completion_tokens` vs `max_tokens`) — `gpt-4.1-mini` usa `max_tokens` normalmente.

---

## PARTE 1 — HUMANIZAÇÃO DO WHATSAPP

### Objetivo
Transformar o WhatsApp de "bot que responde" para "assistente que conversa como humano". Referências de código:

**Repositórios de referência**:
- `https://github.com/pedroslopez/whatsapp-web.js` (15K+ stars) — A lib base. Documentação da API de typing, seen, reactions
- `https://github.com/askrella/whatsapp-chatgpt` (~3K stars) — Integração GPT + WhatsApp com contexto de conversa
- Buscar no GitHub: `whatsapp-web.js AI bot` filtrado por "Most stars" e "Recently updated"

### 1.1 Indicador de "digitando..." (Typing Indicator)

**O que faz**: Antes de responder, o bot mostra "digitando..." por um tempo proporcional ao tamanho da resposta. Isso faz parecer que alguém está realmente escrevendo.

**Arquivo**: `whatsapp.js`
**Onde**: Dentro de `client.on('message', async (msg))` (linha ~607), ANTES de chamar `msg.reply(replyText)`

**Implementação**:
```javascript
// Dentro de client.on('message'), APÓS obter replyText e ANTES de msg.reply()

// Simula digitação humana: 30-50ms por caractere, min 1.5s, max 8s
async function simulateTyping(chatId, textLength) {
  if (!client || connectionStatus !== 'connected') return;
  try {
    const chat = await client.getChatById(chatId);
    await chat.sendStateTyping();

    // Tempo proporcional ao texto (humanos digitam ~40 chars/seg)
    const typingMs = Math.min(8000, Math.max(1500, textLength * 35));
    await new Promise(resolve => setTimeout(resolve, typingMs));

    await chat.clearState();
  } catch (err) {
    // Silencioso - typing indicator é cosmético
  }
}

// Uso (dentro do handler de mensagem):
if (replyText) {
  await simulateTyping(msg.from, replyText.length);
  await msg.reply(replyText);
}
```

**API reference**: `chat.sendStateTyping()` — https://docs.wwebjs.dev/Chat.html#sendStateTyping

### 1.2 Marcar mensagens como lidas (Read Receipts)

**O que faz**: Marca a mensagem do usuário como "lida" (dois tiques azuis) assim que recebe, antes de processar.

**Arquivo**: `whatsapp.js`
**Onde**: No início do `client.on('message')` handler (linha ~607), logo após o filtro de `msg.fromMe`

**Implementação**:
```javascript
// Logo no início do handler, após filtrar msg.fromMe e grupos:
try {
  const chat = await client.getChatById(msg.from);
  await chat.sendSeen();
} catch (err) {
  // Silencioso
}
```

**API reference**: `chat.sendSeen()` — https://docs.wwebjs.dev/Chat.html#sendSeen

### 1.3 Reações a mensagens (Message Reactions)

**O que faz**: Reage à mensagem do usuário com emoji antes de responder (ex: 👀 ao receber, ✅ ao completar tarefa, 📝 ao agendar).

**Arquivo**: `whatsapp.js` (no handler de mensagem) e `server.js` (no `processWhatsAppMessage`)

**Implementação**:
```javascript
// Reagir ao receber a mensagem (no handler do whatsapp.js):
try {
  await msg.react('👀'); // "Estou vendo sua mensagem"
} catch (err) {}

// Após processar com sucesso (reagir baseado na ação):
// Passar a reação como parte do retorno de processWhatsAppMessage
// No server.js, retornar: { text: '...', reaction: '✅' }
// No whatsapp.js, após receber response:
if (response?.reaction) {
  try {
    await msg.react(response.reaction);
  } catch (err) {}
}
```

**Mapeamento de reações por tipo de ação**:
```javascript
const ACTION_REACTIONS = {
  create: '📝',    // Tarefa criada
  complete: '✅',  // Tarefa concluída
  update: '🔄',    // Tarefa atualizada
  delete: '🗑️',    // Tarefa deletada
  list: '📋',      // Listou agenda
  default: '👍',   // Resposta geral
};
```

**API reference**: `message.react(emoji)` — https://docs.wwebjs.dev/Message.html#react

### 1.4 Memória de conversa no WhatsApp (Conversation Context)

**Problema atual**: Cada mensagem do WhatsApp é processada isoladamente (`[{ role: 'user', content: userPayload }]`). O coach não lembra o que o Sergio disse há 2 minutos.

**Arquivo**: `server.js`
**Onde**: Na função `processWhatsAppMessage()` (linha ~3446)

**Implementação**:
```javascript
// No topo do server.js, após as constantes:
const WHATSAPP_CONTEXT_MESSAGES = Number(process.env.WHATSAPP_CONTEXT_MESSAGES || 6);
const whatsappConversationHistory = new Map(); // key: senderNumber, value: [{role, content, timestamp}]
const WHATSAPP_CONTEXT_TTL_MS = 30 * 60 * 1000; // 30 minutos

function getWhatsAppHistory(senderNumber) {
  const history = whatsappConversationHistory.get(senderNumber) || [];
  const now = Date.now();
  // Remove mensagens antigas (>30min)
  const recent = history.filter(msg => (now - msg.timestamp) < WHATSAPP_CONTEXT_TTL_MS);
  whatsappConversationHistory.set(senderNumber, recent);
  return recent.slice(-WHATSAPP_CONTEXT_MESSAGES).map(({ role, content }) => ({ role, content }));
}

function addWhatsAppHistory(senderNumber, role, content) {
  const history = whatsappConversationHistory.get(senderNumber) || [];
  history.push({ role, content, timestamp: Date.now() });
  // Manter no máximo 20 mensagens em memória
  if (history.length > 20) history.splice(0, history.length - 20);
  whatsappConversationHistory.set(senderNumber, history);
}

// Dentro de processWhatsAppMessage(), ao chamar callOpenAI:
// ANTES (linha ~2760):
// const raw = await callOpenAI(prompt, [{ role: 'user', content: userPayload }], ...);
//
// DEPOIS:
addWhatsAppHistory(senderNumber, 'user', userPayload);
const contextMessages = getWhatsAppHistory(senderNumber);
const raw = await callOpenAI(prompt, contextMessages, WHATSAPP_AGENT_MAX_TOKENS, { ... });

// Após obter a resposta:
const replyText = parsed?.reply || '';
if (replyText) {
  addWhatsAppHistory(senderNumber, 'assistant', replyText);
}
```

**Impacto em tokens**: Adiciona ~4-6 mensagens de contexto (~400-800 tokens extras de input). Com GPT-4.1-mini a $0.40/MTok, isso custa ~$0.0003 a mais por mensagem. Negligível.

### 1.5 Respostas divididas em múltiplas mensagens

**O que faz**: Em vez de mandar um textão, divide em mensagens menores com pausas entre elas. Mais natural.

**Arquivo**: `whatsapp.js`
**Onde**: Na parte que envia `msg.reply(replyText)`

**Implementação**:
```javascript
async function sendHumanLikeReply(msg, text) {
  if (!text || !text.trim()) return;

  // Divide em parágrafos (respeita \n\n como separador)
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim());

  // Se tem 1-2 parágrafos, manda tudo junto
  if (paragraphs.length <= 2) {
    const chat = await client.getChatById(msg.from);
    await chat.sendStateTyping();
    await new Promise(r => setTimeout(r, Math.min(5000, text.length * 30)));
    await chat.clearState();
    await msg.reply(text);
    return;
  }

  // Se tem 3+ parágrafos, manda em blocos
  for (let i = 0; i < paragraphs.length; i++) {
    const chunk = paragraphs[i].trim();
    if (!chunk) continue;

    const chat = await client.getChatById(msg.from);
    await chat.sendStateTyping();
    await new Promise(r => setTimeout(r, Math.min(4000, chunk.length * 35)));
    await chat.clearState();

    if (i === 0) {
      await msg.reply(chunk);
    } else {
      await client.sendMessage(msg.from, chunk);
    }

    // Pausa entre mensagens (simula leitura + digitação)
    if (i < paragraphs.length - 1) {
      await new Promise(r => setTimeout(r, 800 + Math.random() * 1200));
    }
  }
}
```

### 1.6 Reescrever o WHATSAPP_AGENT_PROMPT para tom mais humano

**Problema atual**: O prompt atual (server.js ~3417) é muito técnico/operacional. O coach soa como um bot.

**Arquivo**: `server.js`
**Onde**: Constante `WHATSAPP_AGENT_PROMPT` (linha ~3417)

**Novo prompt** (substitui o existente):
```javascript
const WHATSAPP_AGENT_PROMPT = `Você é o SER Coach no WhatsApp — assistente pessoal de produtividade do Sergio.

PERSONALIDADE:
- Fale como um colega experiente e atencioso, não como um robô
- Use frases curtas e naturais, como numa conversa real de WhatsApp
- Trate Sergio como "senhor" mas com naturalidade, sem excesso de formalidade
- Use no máximo 1 emoji por mensagem, e só quando fizer sentido emocional
- Nunca use markdown (sem *, **, #, etc.) — WhatsApp não renderiza
- Respostas de 1-4 linhas no máximo para conversas normais
- Pode usar até 8 linhas quando estiver listando agenda ou quebrando tarefa

CONTEXTO DO SERGIO:
- Gerencia 3 frentes: Estúdio Taka (agência de marketing), Haldan (gerência), Pessoal (casa/saúde/Mari)
- Tem parceira (Mari), esperando um filho
- Tende a se sobrecarregar — proteja-o disso
- Usa Pomodoro (25min foco + 5min pausa)

COMO AGIR:
- Se ele pedir algo da agenda → execute via actions
- Se ele parecer cansado/frustrado → sugira pausa, não mais trabalho
- Se ele disser "bom dia" → responda naturalmente, diga quantas tarefas tem hoje
- Se ele confirmar algo ("ok", "beleza") → responda brevemente ("Fechado, senhor.")
- Se ele perguntar algo fora de produtividade → redirecione com leveza

RETORNE APENAS JSON (sem markdown, sem backticks):
{"reply":"sua resposta ao Sergio","actions":[{"type":"create|update|append_step|delete|complete|list","task":{},"selector":{},"updates":{},"step":{"text":"string","time":15},"date":"YYYY-MM-DD"}],"ask":null}

REGRAS DE AÇÕES:
- create: precisa de task.title, task.date (YYYY-MM-DD), task.startTime (HH:MM ou null), task.frente, task.type
- update: precisa de selector.id ou selector.title + updates com os campos a mudar
- complete/delete: precisa de selector.id ou selector.title
- list: precisa de date (YYYY-MM-DD) para listar agenda do dia
- Se não souber qual tarefa o senhor quer mexer, NÃO invente — pergunte
- Frentes: taka|haldan|pessoal
- Tipos: Reunião|SEO|WordPress|Conteúdo|Follow-up|Proposta|Gestão equipe|Alimentação|Esporte|Casa|Outro`;
```

### 1.7 Reescrever o SER_COACH_PROMPT (chat do app) — mais conciso

**Problema**: O prompt atual (~650 tokens) é enviado em CADA mensagem. Condensar para ~400 tokens economiza ~250 tokens/chamada.

**Arquivo**: `server.js`
**Onde**: Constante `SER_COACH_PROMPT` (linha ~3399)

**Novo prompt** (substitui o existente):
```javascript
const SER_COACH_PROMPT = `Você é o SER Coach — coach de produtividade e bem-estar do Sergio.

QUEM É SERGIO: Gerencia 3 frentes (Estúdio Taka, Haldan, Pessoal). Parceira: Mari, esperando um filho. Tende a se sobrecarregar. Usa Pomodoro (25/5).

COMO AGIR:
- Algo difícil → "Pausa 5min. Água. Alonga. Depois quebramos isso em partes menores."
- Travado → Pergunte: "É falta de informação, decisão ou energia?" e ajude conforme a causa
- Quer desistir → "Mais 10 minutos? Se continuar ruim, reagenda sem culpa."
- Completou tarefa → Celebre brevemente: "Boa! Mais uma riscada."
- +8h de tarefas → "Pesado demais. Prioriza 3, resto vai pra amanhã."
- Após 20h → "Já deu por hoje. Descansa."
- Sem pausa → "Quando foi a última pausa? Respeita o Pomodoro."

TOM: Direto, curto (2-4 linhas), profissional e acolhedor. Trate como "senhor", nunca "você". Max 1 emoji/msg. PT-BR claro. Foco em PRODUTIVIDADE e BEM-ESTAR — redirecione o resto.`;
```

**Economia**: De ~650 tokens para ~400 tokens = **-250 tokens por chamada** = ~R$0.30/mês a menos (uso moderado).

---

## PARTE 2 — RITUAL DE PLANEJAMENTO DIÁRIO

### Referência
Inspirado em Sunsama (https://sunsama.com/) — daily planning ritual que guia o usuário a planejar o dia e revisar no fim.

### 2.1 Briefing matinal inteligente (via WhatsApp)

**O que faz**: Todo dia às 7h, o coach manda uma mensagem estruturada com:
- Saudação personalizada
- Quantas tarefas tem hoje + horas estimadas
- Top 3 prioridades
- Alerta se dia está sobrecarregado (>8h)
- Pergunta se quer ajustar algo

**Arquivo**: `whatsapp.js`
**Onde**: Substituir a função `buildMorningBriefMessage()` (linha ~400)

**Implementação**:
```javascript
async function buildMorningBriefMessage() {
  const today = localDateISO();
  const tasks = typeof getAgendaTasksFn === 'function' ? await getAgendaTasksFn() : [];
  const dayTasks = tasks.filter(t => !t.completedAt && t.date === today);

  if (dayTasks.length === 0) {
    return ensureFollowUpStyle(
      'Bom dia, senhor. Agenda limpa hoje. Quer que eu crie alguma tarefa?',
      { appendQuestion: false }
    );
  }

  const totalMinutes = dayTasks.reduce((sum, t) => sum + (t.estimatedTime || 30), 0);
  const totalHours = (totalMinutes / 60).toFixed(1);
  const withTime = dayTasks.filter(t => t.startTime).sort((a, b) => a.startTime.localeCompare(b.startTime));
  const withoutTime = dayTasks.filter(t => !t.startTime);

  const lines = [`Bom dia, senhor. Hoje tem ${dayTasks.length} tarefa${dayTasks.length > 1 ? 's' : ''}, ~${totalHours}h estimadas.`];

  if (totalMinutes > 480) {
    lines.push(`Atenção: isso passa de 8h. Vamos priorizar o essencial.`);
  }

  if (withTime.length > 0) {
    lines.push('');
    lines.push('Compromissos fixos:');
    withTime.slice(0, 5).forEach(t => {
      lines.push(`${t.startTime} — ${t.title} [${t.frente}]`);
    });
  }

  if (withoutTime.length > 0) {
    lines.push('');
    lines.push('Sem horário definido:');
    withoutTime.slice(0, 5).forEach(t => {
      lines.push(`- ${t.title} [${t.frente}]`);
    });
  }

  lines.push('');
  lines.push('Quer ajustar algo antes de começar?');

  return formatWhatsAppCoreText(lines.join('\n'));
}
```

### 2.2 Check-in do meio do dia (melhorar o existente)

**Arquivo**: `whatsapp.js`
**Onde**: Substituir `buildMiddayCheckinMessage()` (linha ~410)

**Implementação**:
```javascript
async function buildMiddayCheckinMessage() {
  const today = localDateISO();
  const tasks = typeof getAgendaTasksFn === 'function' ? await getAgendaTasksFn() : [];
  const dayTasks = tasks.filter(t => t.date === today);
  const completed = dayTasks.filter(t => t.completedAt);
  const pending = dayTasks.filter(t => !t.completedAt);

  if (dayTasks.length === 0) {
    return ensureFollowUpStyle('Meio do dia, senhor. Agenda continua limpa.');
  }

  const lines = [];

  if (completed.length > 0) {
    lines.push(`Metade do dia. Já concluiu ${completed.length} de ${dayTasks.length} tarefa${dayTasks.length > 1 ? 's' : ''}.`);
  } else {
    lines.push(`Metade do dia, senhor. Ainda nenhuma tarefa concluída de ${dayTasks.length}.`);
  }

  if (pending.length > 0) {
    const next = pending.find(t => t.startTime) || pending[0];
    lines.push(`Próximo foco: ${next.startTime ? `${next.startTime} ` : ''}${next.title}.`);

    if (pending.length > 3) {
      lines.push(`Ainda tem ${pending.length} pendentes. Precisa repriorizar?`);
    }
  } else {
    lines.push('Tudo concluído! Pode descansar ou adiantar o de amanhã.');
  }

  return ensureFollowUpStyle(lines.join('\n'));
}
```

### 2.3 Shutdown ritual (fim do dia)

**O que faz**: Às 20h, o coach manda um resumo do dia + pergunta o que fica pra amanhã.

**Arquivo**: `server.js`
**Onde**: A função `buildEndOfDayReportMessage()` já existe mas precisa ser melhorada

**Implementação**:
```javascript
async function buildEndOfDayReportMessage() {
  const today = todayLocalISO();
  const agenda = await readAgendaData();
  const dayTasks = agenda.tasks.filter(t => t.date === today);
  const completed = dayTasks.filter(t => t.completedAt);
  const pending = dayTasks.filter(t => !t.completedAt);

  const lines = [];

  if (completed.length > 0) {
    lines.push(`Fim do expediente, senhor. Hoje foram ${completed.length} tarefa${completed.length > 1 ? 's' : ''} concluída${completed.length > 1 ? 's' : ''}.`);
  } else {
    lines.push('Fim do expediente, senhor.');
  }

  if (pending.length > 0) {
    lines.push(`Ficaram ${pending.length} pendente${pending.length > 1 ? 's' : ''}:`);
    pending.slice(0, 5).forEach(t => {
      lines.push(`- ${t.title}`);
    });
    lines.push('Quer que eu mova pra amanhã?');
  } else {
    lines.push('Tudo concluído! Descansa tranquilo.');
  }

  return ensureWhatsAppResponseStyle(lines.join('\n'), { appendQuestion: false });
}
```

---

## PARTE 3 — CHECK-IN DE ENERGIA/HUMOR

### Referência
Inspirado em Fabulous app (https://www.thefabulous.co/) — mood/energy check-ins que ajustam recomendações.

### 3.1 Schema do banco (Supabase)

**Arquivo**: `supabase/schema.sql` — ADICIONAR:
```sql
CREATE TABLE IF NOT EXISTS public.ser_energy_checkins (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  date text NOT NULL,          -- YYYY-MM-DD
  time text NOT NULL,          -- HH:MM
  energy_level text NOT NULL,  -- 'alta', 'media', 'baixa'
  mood text,                   -- 'bem', 'normal', 'cansado', 'estressado'
  note text,                   -- observação livre
  source text DEFAULT 'whatsapp', -- 'app' ou 'whatsapp'
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_energy_date ON public.ser_energy_checkins(date DESC);
```

### 3.2 Backend — Endpoints de energia

**Arquivo**: `server.js` — ADICIONAR após os endpoints de agenda:
```javascript
// ─── Energy Check-ins ───
app.post('/api/energy/checkin', async (req, res) => {
  try {
    const { energyLevel, mood, note, source } = req.body;
    const validLevels = new Set(['alta', 'media', 'baixa']);
    const level = validLevels.has(energyLevel) ? energyLevel : 'media';

    const now = new Date();
    const checkin = {
      id: crypto.randomUUID(),
      date: todayLocalISO(),
      time: `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`,
      energyLevel: level,
      mood: mood || null,
      note: note || null,
      source: source || 'app',
      createdAt: now.toISOString(),
    };

    // Persistir (Supabase ou local)
    // ... (seguir padrão de readAgendaData/writeAgendaData)

    res.json({ ok: true, checkin });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/energy/today', async (_req, res) => {
  try {
    const today = todayLocalISO();
    // Buscar check-ins do dia
    // Retornar array de check-ins + última energia registrada
    res.json({ checkins: [], lastEnergy: null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

### 3.3 WhatsApp — Coach pergunta energia e adapta sugestões

**Arquivo**: `server.js`
**Onde**: Na `processWhatsAppMessage()`, adicionar detecção de check-in de energia

**Implementação**:
```javascript
// Detecção de energia na mensagem
function detectEnergyCheckin(text) {
  const n = normalizeText(text);

  // Respostas diretas: "energia alta", "tô cansado", "baixa"
  if (/\b(energia alta|disposto|animado|produtivo|focado)\b/.test(n)) return { energyLevel: 'alta' };
  if (/\b(energia media|normal|ok|tranquilo|mais ou menos)\b/.test(n)) return { energyLevel: 'media' };
  if (/\b(energia baixa|cansado|exausto|esgotado|sem energia|travado|desanimado)\b/.test(n)) return { energyLevel: 'baixa' };

  return null;
}

// Dentro de processWhatsAppMessage(), ANTES de chamar a IA:
const energyCheckin = detectEnergyCheckin(userText);
if (energyCheckin) {
  // Salvar check-in
  // Adaptar resposta baseada na energia
  if (energyCheckin.energyLevel === 'baixa') {
    return ensureWhatsAppResponseStyle(
      'Entendi, senhor. Energia baixa agora. Sugiro tarefas leves — algo administrativo ou rápido. Quer que eu sugira o que fazer agora?',
      { question: 'Quer ver as tarefas mais leves do dia?' }
    );
  }
  if (energyCheckin.energyLevel === 'alta') {
    return ensureWhatsAppResponseStyle(
      'Boa! Energia alta é hora de atacar o mais importante. Quer que eu mostre as tarefas prioritárias?'
    );
  }
}

// Incluir energia atual no prompt da IA quando disponível:
// No WHATSAPP_AGENT_PROMPT dinâmico, adicionar:
// ENERGIA_ATUAL: ${lastEnergyLevel || 'não informada'}
```

### 3.4 Frontend — Componente de check-in

**Arquivo**: `src/App.jsx`
**Onde**: No dashboard principal, adicionar um widget rápido

**Implementação**: Adicionar um componente `EnergyCheckin` que mostra 3 botões (⚡ Alta | 😊 Normal | 😴 Baixa) no topo do dashboard. Ao clicar, salva o check-in e o coach adapta sugestões.

---

## PARTE 4 — POMODORO VINCULADO À TAREFA + TIME TRACKING

### Referência
Inspirado em TickTick (https://ticktick.com/) — cada tarefa tem timer integrado que registra tempo real gasto.

### 4.1 Schema do banco (Supabase)

**Arquivo**: `supabase/schema.sql` — ADICIONAR:
```sql
CREATE TABLE IF NOT EXISTS public.ser_time_logs (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  task_id text NOT NULL REFERENCES public.ser_tasks(id) ON DELETE CASCADE,
  date text NOT NULL,            -- YYYY-MM-DD
  start_time timestamptz NOT NULL,
  end_time timestamptz,
  duration_minutes integer,      -- duração em minutos (calculada)
  type text DEFAULT 'pomodoro',  -- 'pomodoro', 'manual', 'timer'
  completed boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_timelog_task ON public.ser_time_logs(task_id);
CREATE INDEX idx_timelog_date ON public.ser_time_logs(date DESC);
```

### 4.2 Modificar campo de tarefa existente

**Arquivo**: `server.js`
**Na função `normalizeTaskInput()`** (linha ~348), adicionar campos:
```javascript
// Adicionar ao retorno de normalizeTaskInput():
actualTime: task.actualTime ?? fallback.actualTime ?? 0,  // minutos reais gastos
pomodorosCompleted: task.pomodorosCompleted ?? fallback.pomodorosCompleted ?? 0,
```

### 4.3 Backend — Endpoints de time tracking

**Arquivo**: `server.js` — ADICIONAR:
```javascript
app.post('/api/time/start', async (req, res) => {
  const { taskId, type } = req.body; // type: 'pomodoro' | 'timer'
  // Criar entrada de time log com start_time = agora
  // Retornar o log criado
});

app.post('/api/time/stop', async (req, res) => {
  const { logId } = req.body;
  // Atualizar end_time = agora, calcular duration_minutes
  // Atualizar task.actualTime += duration
  // Atualizar task.pomodorosCompleted++ se tipo = pomodoro
});

app.get('/api/time/summary', async (req, res) => {
  const { period, groupBy } = req.query; // period: 'today'|'week'|'month', groupBy: 'frente'|'type'|'task'
  // Retornar tempo total por agrupamento
});
```

### 4.4 Frontend — Pomodoro vinculado

**Arquivo**: `src/App.jsx`
**Onde**: No componente PomodoroCompact, adicionar seletor de tarefa

**Implementação**:
- Antes de iniciar o Pomodoro, mostrar dropdown com tarefas do dia
- Ao completar o Pomodoro, registrar via `/api/time/stop`
- Mostrar na TaskCard: "⏱ 2/4 Pomodoros (50min de 120min estimados)"

---

## PARTE 5 — SISTEMA DE XP, NÍVEIS E CONQUISTAS (GAMIFICAÇÃO)

### Referência
Inspirado em Todoist Karma (https://todoist.com/productivity-methods/karma-system) + Forest app (https://www.forestapp.cc/).

### 5.1 Schema do banco (Supabase)

**Arquivo**: `supabase/schema.sql` — ADICIONAR:
```sql
CREATE TABLE IF NOT EXISTS public.ser_gamification (
  id text PRIMARY KEY DEFAULT 'sergio',  -- single-user
  xp integer DEFAULT 0,
  level integer DEFAULT 1,
  current_streak integer DEFAULT 0,
  best_streak integer DEFAULT 0,
  last_active_date text,          -- YYYY-MM-DD
  streak_freezes_remaining integer DEFAULT 1,
  badges jsonb DEFAULT '[]',      -- [{id, name, unlockedAt}]
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ser_xp_events (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  event_type text NOT NULL,       -- 'task_complete', 'pomodoro', 'streak', 'checkin', etc
  xp_amount integer NOT NULL,
  description text,
  created_at timestamptz DEFAULT now()
);
```

### 5.2 Regras de XP

```javascript
const XP_RULES = {
  task_complete: 10,           // Completar tarefa
  task_complete_hard: 25,      // Completar tarefa com >60min estimados
  task_complete_ontime: 15,    // Completar tarefa antes do horário
  pomodoro_complete: 5,        // Completar 1 Pomodoro
  streak_day: 20,              // Manter streak +1 dia
  streak_7: 100,               // 7 dias seguidos (bonus)
  streak_30: 500,              // 30 dias seguidos (bonus)
  energy_checkin: 3,           // Fazer check-in de energia
  daily_plan_complete: 15,     // Completar todas as tarefas do dia
  morning_start: 5,            // Primeira tarefa antes das 9h
};

const LEVELS = [
  { level: 1, xpRequired: 0, title: 'Iniciante' },
  { level: 2, xpRequired: 100, title: 'Aprendiz' },
  { level: 3, xpRequired: 300, title: 'Focado' },
  { level: 4, xpRequired: 600, title: 'Produtivo' },
  { level: 5, xpRequired: 1000, title: 'Consistente' },
  { level: 6, xpRequired: 1500, title: 'Disciplinado' },
  { level: 7, xpRequired: 2500, title: 'Expert' },
  { level: 8, xpRequired: 4000, title: 'Mestre SER' },
  { level: 9, xpRequired: 6000, title: 'Lenda' },
  { level: 10, xpRequired: 10000, title: 'Transcendente' },
];

const BADGES = [
  { id: 'first_task', name: 'Primeira Tarefa', condition: 'Completar 1 tarefa' },
  { id: 'streak_7', name: 'Semana Firme', condition: '7 dias seguidos produtivo' },
  { id: 'streak_30', name: 'Mês de Ouro', condition: '30 dias seguidos' },
  { id: 'pomodoro_100', name: 'Centurião', condition: '100 Pomodoros completados' },
  { id: 'zero_overdue', name: 'Pontual', condition: 'Mês sem tarefas atrasadas' },
  { id: 'all_frentes', name: 'Equilibrista', condition: 'Tarefas em todas as 3 frentes no mesmo dia' },
  { id: 'early_bird', name: 'Madrugador', condition: 'Completar tarefa antes das 7h' },
  { id: 'night_off', name: 'Vida Pessoal', condition: 'Nenhuma tarefa após 20h por 7 dias' },
];
```

### 5.3 Frontend — Widget de progresso

**Arquivo**: `src/App.jsx`
**Onde**: No dashboard, adicionar barra de XP + nível + streak

**Elementos visuais**:
- Barra de progresso XP (animated, cor da frente mais ativa)
- Nível atual com título: "Nível 4 — Produtivo"
- Streak: "🔥 12 dias"
- Último badge desbloqueado com animação
- Som de "level up" quando sobe de nível (usar SoundEngine existente)

---

## PARTE 6 — SUGESTÃO DE TAREFAS POR CONTEXTO

### Referência
Inspirado em Motion (https://www.usemotion.com/) + Reclaim.ai (https://reclaim.ai/) — sugere o que fazer baseado no tempo disponível.

### 6.1 Endpoint de sugestão

**Arquivo**: `server.js` — ADICIONAR:
```javascript
app.get('/api/suggest/next', async (req, res) => {
  try {
    const agenda = await readAgendaData();
    const today = todayLocalISO();
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    const dayTasks = sortAgendaTasks(
      agenda.tasks.filter(t => !t.completedAt && t.date === today)
    );

    // Encontrar próximo compromisso fixo
    const nextFixed = dayTasks.find(t => {
      if (!t.startTime) return false;
      const [h, m] = t.startTime.split(':').map(Number);
      return (h * 60 + m) > currentMinutes;
    });

    // Calcular tempo disponível até o próximo compromisso
    let availableMinutes = 120; // default 2h
    if (nextFixed) {
      const [h, m] = nextFixed.startTime.split(':').map(Number);
      availableMinutes = (h * 60 + m) - currentMinutes;
    }

    // Filtrar tarefas que cabem no tempo disponível
    const flexible = dayTasks.filter(t => !t.startTime && (t.estimatedTime || 30) <= availableMinutes);

    // Ordenar por prioridade (tarefas mais importantes primeiro)
    // Critérios: tipo (Reunião > Follow-up > SEO > ...), frente com mais pendências, estimatedTime

    res.json({
      availableMinutes,
      nextFixed: nextFixed ? { title: nextFixed.title, startTime: nextFixed.startTime } : null,
      suggestions: flexible.slice(0, 3),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

### 6.2 WhatsApp — Coach sugere proativamente

**Onde**: No `runSmartRemindersTick()` do `whatsapp.js`, adicionar lógica para sugerir tarefas em gaps

```javascript
// A cada 30 minutos, verificar se há um gap de >45min sem tarefa agendada
// Se sim, e se há tarefas flexíveis, mandar:
// "Senhor, o próximo compromisso é só às 15h. Tem 45 minutos livres. Que tal atacar [tarefa]?"
```

---

## PARTE 7 — REVISÃO SEMANAL COM NARRATIVA DA IA

### Referência
Inspirado em Sunsama weekly review (https://sunsama.com/) — AI gera um resumo narrativo da semana.

### 7.1 Endpoint de revisão semanal

**Arquivo**: `server.js` — ADICIONAR:
```javascript
app.get('/api/review/weekly', async (req, res) => {
  try {
    const today = todayLocalISO();
    const weekStart = getMonday(today); // Calcular segunda-feira da semana
    const agenda = await readAgendaData();

    // Métricas da semana
    const weekTasks = agenda.tasks.filter(t => t.date >= weekStart && t.date <= today);
    const completed = weekTasks.filter(t => t.completedAt);
    const pending = weekTasks.filter(t => !t.completedAt);

    // Tempo por frente
    const timeByFrente = { taka: 0, haldan: 0, pessoal: 0 };
    completed.forEach(t => {
      timeByFrente[t.frente] = (timeByFrente[t.frente] || 0) + (t.estimatedTime || 30);
    });

    // Gerar narrativa via IA
    const prompt = `Gere um resumo semanal de produtividade em 5-8 linhas para o Sergio.
Dados: ${completed.length} concluídas, ${pending.length} pendentes.
Tempo por frente: Taka ${(timeByFrente.taka/60).toFixed(1)}h, Haldan ${(timeByFrente.haldan/60).toFixed(1)}h, Pessoal ${(timeByFrente.pessoal/60).toFixed(1)}h.
Tom: coach incentivador, direto, trate como "senhor". Destaque pontos fortes e sugira 1 ajuste.`;

    const narrative = await callOpenAI(SER_COACH_PROMPT, [{ role: 'user', content: prompt }], 300);

    res.json({
      weekStart,
      completed: completed.length,
      pending: pending.length,
      timeByFrente,
      narrative,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

### 7.2 WhatsApp — Relatório semanal automático

**Onde**: Já existe `buildWeeklyCostReportMessage()` — expandir para incluir produtividade, não só custos.

---

## PARTE 8 — SCORE DE RISCO DE BURNOUT

### Referência
Inspirado em Sunsama workload guardrails + Clockwise focus time optimization.

### 8.1 Cálculo do score

**Arquivo**: `server.js` — ADICIONAR:
```javascript
async function calculateBurnoutScore() {
  const today = todayLocalISO();
  const agenda = await readAgendaData();

  let score = 0; // 0 = tranquilo, 100 = burnout iminente

  // Fator 1: Horas planejadas hoje (>8h = +30)
  const todayTasks = agenda.tasks.filter(t => !t.completedAt && t.date === today);
  const todayMinutes = todayTasks.reduce((sum, t) => sum + (t.estimatedTime || 30), 0);
  if (todayMinutes > 480) score += 30;
  else if (todayMinutes > 360) score += 15;

  // Fator 2: Tarefas atrasadas (+5 por tarefa, max 25)
  const overdue = agenda.tasks.filter(t => !t.completedAt && t.date < today);
  score += Math.min(25, overdue.length * 5);

  // Fator 3: Tarefas após 20h nos últimos 7 dias (+10)
  // (verificar completedAt após 20h)

  // Fator 4: Sem dia de descanso nos últimos 7 dias (+15)
  // (verificar se houve pelo menos 1 dia sem tarefas)

  // Fator 5: Streak de dias com >6h de trabalho (+2 por dia, max 20)

  return {
    score: Math.min(100, score),
    level: score > 70 ? 'critico' : score > 40 ? 'atencao' : 'saudavel',
    factors: [], // Lista de fatores contribuindo
    suggestion: score > 70
      ? 'Sergio, o senhor precisa desacelerar. Sugiro cancelar tarefas não-essenciais hoje.'
      : score > 40
      ? 'Carga um pouco pesada. Quer que eu redistribua algo pra amanhã?'
      : 'Tudo sob controle. Bora!',
  };
}

app.get('/api/burnout/score', async (_req, res) => {
  try {
    const result = await calculateBurnoutScore();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

### 8.2 Frontend — Indicador visual

**Arquivo**: `src/App.jsx`
**Onde**: No dashboard, mostrar um indicador discreto

**Visual**: Semáforo pequeno no canto:
- 🟢 Saudável (0-40)
- 🟡 Atenção (41-70)
- 🔴 Crítico (71-100)

---

## PARTE 9 — ANALYTICS (PLANNED vs ACTUAL)

### Referência
Inspirado em Sunsama analytics + TickTick statistics.

### 9.1 Dashboard de analytics

**Arquivo**: `src/App.jsx` — NOVA ABA ou seção em Config

**Métricas**:
- Tarefas concluídas por dia/semana/mês (gráfico de barras)
- Tempo estimado vs. real (se time tracking implementado)
- Distribuição por frente (pizza: Taka X%, Haldan Y%, Pessoal Z%)
- Streak atual e histórico
- Taxa de conclusão (completadas / total criadas)

### 9.2 Endpoint de analytics

**Arquivo**: `server.js` — ADICIONAR:
```javascript
app.get('/api/analytics', async (req, res) => {
  const { period } = req.query; // 'week', 'month', 'quarter'
  const agenda = await readAgendaData();

  // Calcular métricas
  // Retornar dados estruturados para gráficos no frontend
});
```

---

## ORDEM DE IMPLEMENTAÇÃO RECOMENDADA

1. **PARTE 0** — Trocar modelo para GPT-4.1-mini (1 linha no .env)
2. **PARTE 1.1-1.3** — Typing, read receipts, reactions (UX imediata)
3. **PARTE 1.4** — Memória de conversa WhatsApp (melhora significativa)
4. **PARTE 1.6-1.7** — Reescrever prompts (tom + economia)
5. **PARTE 1.5** — Mensagens divididas (polish)
6. **PARTE 2** — Ritual diário (briefing matinal, check-in, shutdown)
7. **PARTE 5** — Gamificação XP/Níveis (motivação)
8. **PARTE 3** — Check-in de energia
9. **PARTE 4** — Pomodoro vinculado + time tracking
10. **PARTE 6** — Sugestões por contexto
11. **PARTE 7** — Revisão semanal
12. **PARTE 8** — Score de burnout
13. **PARTE 9** — Analytics

---

## REGRAS GERAIS PARA O CODEX

1. **NÃO mude a estrutura de arquivos** — App.jsx continua sendo arquivo único, server.js continua monolítico
2. **NÃO quebre endpoints existentes** — Apenas adicione novos ou modifique os existentes de forma retrocompatível
3. **NÃO mude o schema do Supabase sem migração** — Adicione tabelas novas, não altere as existentes
4. **TESTE CADA FEATURE** antes de seguir pra próxima — Rode `npm run dev` e teste via WhatsApp e via browser
5. **MANTENHA O TOM EM PT-BR** — Tudo em português brasileiro, inclusive nomes de variáveis em comentários
6. **SONS** — Adicione sons do SoundEngine para: level up, badge desbloqueado, streak, check-in de energia
7. **MAX-WIDTH 600px** — Mantenha o layout mobile-first em todos os novos componentes
8. **COMMITS FREQUENTES** — Um commit por PARTE implementada, com mensagem clara

---

## REFERÊNCIAS

### Repositórios GitHub
- whatsapp-web.js (lib base): https://github.com/pedroslopez/whatsapp-web.js
- whatsapp-chatgpt (referência AI+WA): https://github.com/askrella/whatsapp-chatgpt
- chatgpt-whatsapp (referência): https://github.com/noelzappy/chatgpt-whatsapp

### APIs e Docs
- whatsapp-web.js API docs: https://docs.wwebjs.dev/
- OpenAI API (chat completions): https://platform.openai.com/docs/api-reference/chat
- Supabase JS client: https://supabase.com/docs/reference/javascript/introduction

### Apps de referência (inspiração de features)
- Sunsama (daily planning ritual): https://sunsama.com/
- Motion (AI auto-scheduling): https://www.usemotion.com/
- Reclaim.ai (smart scheduling): https://reclaim.ai/
- TickTick (pomodoro per task): https://ticktick.com/
- Todoist (karma/gamification): https://todoist.com/
- Fabulous (energy/habits): https://www.thefabulous.co/
- Forest (focus gamification): https://www.forestapp.cc/
- Coach.me (coaching app): https://www.coach.me/

### Comparação de modelos IA
- Artificial Analysis: https://artificialanalysis.ai/models
- GPT-4.1-mini vs 4o-mini: https://promptaa.com/blog/4-o-mini-vs-4-1-mini
- LLM pricing 2025: https://intuitionlabs.ai/articles/llm-api-pricing-comparison-2025

---

*Script gerado em 2026-03-24 para execução pelo Codex.*
*Versão do Sistema SER ao gerar: server.js 4196 linhas, App.jsx 1437 linhas, whatsapp.js 904 linhas.*
