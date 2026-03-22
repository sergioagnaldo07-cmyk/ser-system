import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import {
  createInstance,
  startReminders,
  getStatus,
  setPhoneNumber,
  setRemindersEnabled,
} from './whatsapp.js';

const app = express();
app.use(cors());
app.use(express.json());

const API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

async function callOpenAI(systemPrompt, messages, maxTokens = 1500) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages,
      ],
      max_tokens: maxTokens,
      temperature: 0.3,
    }),
  });

  const data = await response.json();

  if (data.error) {
    throw new Error(data.error.message);
  }

  return data.choices?.[0]?.message?.content || '';
}

// ─── System Prompt compartilhado (SER Coach) ───
const SER_COACH_PROMPT = `Você é o SER Coach — o coach pessoal de produtividade e bem-estar do Sergio dentro do Sistema SER.

QUEM VOCÊ É:
- Você é como um gestor de RH pessoal: cuida da produtividade E do bem-estar do Sergio
- Você conhece a rotina dele: gerencia 3 frentes (Estúdio Taka, Haldan, Pessoal)
- Ele tem uma parceira (Mari), está se preparando para a chegada de um filho
- Ele usa o método Pomodoro (25min foco + 5min pausa)
- Ele tende a se sobrecarregar e superestimar o que consegue fazer no dia

SEU OBJETIVO PRINCIPAL:
Garantir que o Sergio conclua todas as tarefas do dia, mantendo a saúde mental e física.

COMO VOCÊ AGE:

1. QUANDO ELE DIZ QUE ALGO ESTÁ DIFÍCIL:
   - Nunca diga "é fácil" ou minimize
   - Sugira: "Para 5 minutos. Bebe uma água. Levanta, alonga. Quando voltar, a gente quebra isso em partes menores."
   - Quebre a tarefa em micro-passos de 10-15 minutos cada
   - Se continuar difícil, sugira uma abordagem diferente

2. QUANDO ELE ESTÁ TRAVADO:
   - Pergunte: "O que exatamente está travando? É falta de informação, decisão ou energia?"
   - Se for energia → sugira pausa + água + alongamento
   - Se for decisão → ajude a decidir com prós e contras rápidos
   - Se for informação → sugira onde buscar ou quem perguntar

3. QUANDO ELE QUER DESISTIR DE UMA TAREFA:
   - Não deixe desistir fácil, mas também não force
   - "Vamos tentar só mais 10 minutos? Se depois ainda estiver ruim, a gente reagenda pra amanhã sem culpa."

4. INCENTIVO:
   - Celebre cada tarefa concluída: "Boa! Mais uma riscada. Tá rendendo!"
   - No início do dia: "Bora! Hoje tem X tarefas, Y horas estimadas. Começar pelo mais importante."
   - No meio do dia: "Metade do dia e você já fez X. Tá no ritmo!"
   - Se ele completou tudo: "Dia limpo! Descansa que você mereceu."

5. LIMITES:
   - Se ele tem mais de 8h de tarefas, avise: "Sergio, isso tá pesado demais pra um dia. Vamos priorizar 3 e o resto vai pra amanhã."
   - Depois das 20h: "Já deu por hoje. O que não fez, vai pra amanhã. Descansa."
   - Se ele está trabalhando sem pausa: "Ei, quando foi a última pausa? Pomodoro = 25 foco + 5 descanso. Respeita o método."

TOM DE VOZ:
- Direto, curto, sem enrolação
- Masculino, como um amigo mais velho que manja
- Usa "bora", "boa", "tamo junto"
- NUNCA use emojis em excesso (no máximo 1 por mensagem)
- Respostas curtas: 2-4 linhas no máximo, a menos que esteja quebrando uma tarefa em passos
- Português brasileiro informal

IMPORTANTE: Você NÃO é um chatbot genérico. Você é focado em PRODUTIVIDADE e BEM-ESTAR. Se ele perguntar algo fora disso, redirecione: "Isso foge do meu escopo, mas se quiser foco na próxima tarefa, bora."`;

// ─── Chat do assistente IA (consultas gerais) ───
app.post('/api/chat', async (req, res) => {
  try {
    const { messages } = req.body;
    const text = await callOpenAI(SER_COACH_PROMPT, messages);
    res.json({ text });
  } catch (err) {
    console.error('Erro na API OpenAI:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Chat do inbox (classificação de tarefas) ───
app.post('/api/parse-tasks', async (req, res) => {
  try {
    const { text, sopKeys } = req.body;

    const now = new Date();
    const today = now.toISOString().slice(0,10);
    const dayNames = ['domingo','segunda-feira','terça-feira','quarta-feira','quinta-feira','sexta-feira','sábado'];
    const todayDow = dayNames[now.getDay()];
    // Build explicit day-to-date mapping for the next 7 days
    const dayMap = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() + i);
      const name = dayNames[d.getDay()];
      const dateStr = d.toISOString().slice(0,10);
      const label = i === 0 ? `${name} (hoje)` : i === 1 ? `${name} (amanhã)` : name;
      dayMap.push(`- "${name}" ou "${name.split('-')[0]}" = ${dateStr} (${label})`);
    }

    const systemPrompt = `Você é o assistente do Sistema SER do Sergio. Três frentes: "taka" (Estúdio Taka, agência), "haldan" (gerência), "pessoal" (casa/saúde).
Tipos: ${sopKeys}.
HOJE: ${today} (${todayDow}).
Extraia tarefas e retorne APENAS JSON válido, sem markdown, sem backticks:
{"tasks":[{"title":"...","frente":"taka|haldan|pessoal","type":"...","estimatedTime":30,"detail":"...","date":"YYYY-MM-DD","startTime":"HH:MM ou null"}],"message":"<resumo do que foi agendado, ex: Agendei reunião pra segunda e treino pra sexta>"}

MAPEAMENTO EXATO DOS DIAS DA SEMANA:
${dayMap.join('\n')}

REGRAS DE DATA:
- "hoje" = ${today}
- "amanhã" = dia seguinte a ${today}
- Use EXATAMENTE o mapeamento acima para dias da semana. NÃO calcule, use a tabela.
- "semana que vem" = segunda-feira da próxima semana
- Se não mencionar data, use ${today}

REGRAS DE HORÁRIO:
- Se o usuário mencionar horário (ex: "às 14h", "10:30", "de manhã"), coloque em startTime no formato "HH:MM"
- "de manhã" = "08:00", "à tarde" = "14:00", "à noite" = "19:00"
- Se NÃO mencionar horário, startTime = null

REGRAS DE FRENTE:
- Clientes médicos (Dr/Dra), SEO, conteúdo, propostas = "taka"
- Equipe/alinhamento interno, Haldan = "haldan"
- Treino/comida/casa/saúde/Mari = "pessoal"
Agrupe frases que descrevem a MESMA tarefa.
Se não for lista de tarefas, responda normalmente ao Sergio dentro do campo message: {"tasks":[],"message":"<escreva aqui sua resposta real ao que o Sergio disse>"}
IMPORTANTE: O campo "message" deve conter uma resposta REAL e PERSONALIZADA ao que o Sergio escreveu. NUNCA escreva literalmente "sua resposta" ou "confirmação curta" — escreva de fato o que quer dizer.
RETORNE APENAS JSON PURO, nada mais.`;

    const raw = await callOpenAI(systemPrompt, [{ role: 'user', content: text }], 2000);

    const cleaned = raw.replace(/```json\s?|```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    res.json(parsed);
  } catch (err) {
    console.error('Erro no parse de tarefas:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// WHATSAPP — Endpoints (whatsapp-web.js)
// ═══════════════════════════════════════════════════════════════

// GET /api/whatsapp/qr — Inicializar e retornar QR code
app.get('/api/whatsapp/qr', async (req, res) => {
  try {
    const result = await createInstance();
    res.json(result);
  } catch (err) {
    console.error('Erro ao gerar QR WhatsApp:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/whatsapp/status — Status da conexão
app.get('/api/whatsapp/status', async (req, res) => {
  try {
    res.json(getStatus());
  } catch (err) {
    res.json({ status: 'disconnected' });
  }
});

// POST /api/whatsapp/config — Salvar configurações (número, lembretes)
app.post('/api/whatsapp/config', (req, res) => {
  const { phoneNumber, remindersEnabled: remEnabled } = req.body;

  if (phoneNumber !== undefined) {
    setPhoneNumber(phoneNumber);
  }
  if (remEnabled !== undefined) {
    setRemindersEnabled(remEnabled);
    if (remEnabled) {
      startReminders(callOpenAI, SER_COACH_PROMPT);
    }
  }

  res.json(getStatus());
});

// ═══════════════════════════════════════════════════════════════

const PORT = 3001;
app.listen(PORT, () => {
  console.log('');
  console.log('═══════════════════════════════════════════════');
  console.log('  SISTEMA SER — Servidor rodando!');
  console.log('═══════════════════════════════════════════════');
  console.log('');
  console.log(`  Frontend: http://localhost:3000`);
  console.log(`  Backend:  http://localhost:${PORT}`);
  console.log(`  Modelo:   ${MODEL}`);
  console.log(`  API Key:  ${API_KEY ? API_KEY.slice(0, 12) + '...' : 'NAO CONFIGURADA'}`);
  console.log('');
  console.log('  WhatsApp: whatsapp-web.js (sem Docker)');
  console.log('');
  console.log('  Ctrl+C para parar');
  console.log('');

  // Inicia lembretes se número configurado
  if (process.env.WHATSAPP_NUMBER) {
    setPhoneNumber(process.env.WHATSAPP_NUMBER);
    startReminders(callOpenAI, SER_COACH_PROMPT);
  }
});
