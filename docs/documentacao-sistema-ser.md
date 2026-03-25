# Documentação Funcional — Sistema SER

## 1) Objetivo do sistema
O **Sistema SER (Separar-Executar-Revisar)** é um assistente operacional para rotina diária que une:
- agenda de tarefas;
- chat com IA no app;
- operação por WhatsApp (texto e áudio);
- lembretes automáticos e follow-up.

Objetivo principal: **reduzir esquecimentos e aumentar execução com previsibilidade**, principalmente em tarefas com horário, aprovações de clientes e follow-ups recorrentes.

---

## 2) Formatação e arquitetura atual

### Frontend
- Arquivo único: `src/App.jsx` (React 19 + Vite 6).
- Interface mobile-first com largura padrão até 600px e modo widescreen no dashboard.
- Persistência local de apoio via `localStorage`.
- Sincronização periódica com backend (`/api/agenda/tasks` + `/api/agenda/sync`).

### Backend
- Arquivo principal: `server.js` (Express).
- API para:
  - chat SER Coach (`/api/chat`);
  - parser de tarefas (`/api/parse-tasks`);
  - agenda (`/api/agenda/*`);
  - uso/custos (`/api/usage/summary`);
  - WhatsApp (`/api/whatsapp/*`);
  - healthcheck (`/api/health`).

### WhatsApp
- Módulo: `whatsapp.js` com `whatsapp-web.js`.
- Recursos:
  - QR code para conexão;
  - mensagens bidirecionais;
  - transcrição de áudio;
  - lembretes por horário e follow-up diário;
  - relatório de fim de dia e relatório semanal de custo.

### Storage
- Modo híbrido:
  - `file` (JSON local em `data/agenda.json` e `data/usage-log.json`);
  - `supabase` (quando credenciais existem);
  - `auto` com fallback para arquivo em caso de falha no Supabase.

---

## 3) Funcionalidades implementadas

### Agenda e operação diária
- Criar, editar, concluir, excluir e reagendar tarefas.
- Organização por frente:
  - `taka` (Estúdio Taka),
  - `haldan`,
  - `pessoal`.
- Tipos de tarefa com SOPs (reunião, SEO, conteúdo, etc.).
- Subtarefas com tempo estimado e progresso.
- Timeline/visão diária e semanal.

### IA no app
- SER Coach com respostas curtas e objetivas.
- Parser de tarefas em PT-BR para transformar texto livre em itens estruturados.
- Interpretação de datas/horários em linguagem natural.

### IA no WhatsApp
- Conversa natural com execução de ações na agenda.
- Ações suportadas:
  - `create`,
  - `update` (data/hora/frente),
  - `complete`,
  - `delete`,
  - `append_step`,
  - `list`.
- Recebe áudio, transcreve e processa como comando.
- Mensagens formatadas para escaneabilidade e tom profissional.

### Lembretes e acompanhamento
- Lembrete de tarefa com offsets configuráveis (ex.: 60 min antes e no horário).
- Follow-up diário para pendências de aprovação até conclusão.
- Bom dia automático (7h), check-in (13h), fechamento do dia (configurável), custo semanal (configurável).

### Custos e telemetria
- Registro de uso por tipo (`app_chat`, `app_parser`, `whatsapp_agent`, `transcribe`).
- Estimativa de custo em USD por evento.
- Consulta por períodos: hoje, últimos 7 dias, mês atual/anterior, histórico total.

---

## 4) Fluxos principais

### Fluxo A — App (dashboard)
1. Usuário cria/edita tarefas no app.
2. Frontend normaliza e salva localmente.
3. Frontend sincroniza com backend.
4. Backend mescla por `id` + `updatedAt` (última alteração vence).

### Fluxo B — WhatsApp (texto/áudio)
1. Mensagem chega no WhatsApp.
2. Se áudio, o sistema transcreve.
3. Backend identifica intenção e tenta atalhos sem IA (quando possível).
4. Se necessário, chama modelo de IA com contexto da agenda.
5. Ação é aplicada na agenda e persistida.
6. Resposta é enviada com status do que foi feito.

### Fluxo C — Lembretes automáticos
1. Scheduler roda a cada minuto.
2. Busca tarefas ativas com horário.
3. Dispara lembretes pelos offsets configurados.
4. Evita duplicidade usando chave de envio por tarefa/offset/data.
5. Registra evento de envio para custo e rastreio.

---

## 5) Endpoints principais

| Método | Endpoint | Finalidade |
|---|---|---|
| `POST` | `/api/chat` | SER Coach (conversa geral) |
| `POST` | `/api/parse-tasks` | Extrair/classificar tarefas |
| `GET` | `/api/usage/summary` | Resumo de uso/custos |
| `GET` | `/api/health` | Estado do servidor |
| `GET` | `/api/agenda/tasks` | Listar agenda |
| `POST` | `/api/agenda/sync` | Sincronizar snapshot do app |
| `POST` | `/api/agenda/tasks` | Criar tarefa por API |
| `PUT` | `/api/agenda/tasks/:id` | Atualizar tarefa |
| `DELETE` | `/api/agenda/tasks/:id` | Excluir tarefa |
| `GET` | `/api/whatsapp/qr` | Gerar QR do WhatsApp |
| `GET` | `/api/whatsapp/status` | Estado da sessão WhatsApp |
| `POST` | `/api/whatsapp/config` | Configurar número e lembretes |

Observação: endpoints de escrita usam validação por token quando `SER_ADMIN_TOKEN` está ativo.

---

## 6) Modelo de tarefa (resumo)
Campos principais persistidos:
- `id`, `title`, `detail`
- `frente` (`taka|haldan|pessoal`)
- `type`
- `date` (`YYYY-MM-DD`)
- `startTime` (`HH:MM` ou `null`)
- `steps[]` (`text`, `time`, `done`)
- `estimatedTime`
- `createdAt`, `updatedAt`, `completedAt`
- `followUpDaily`, `followUpTime`, `followUpClient`, `followUpSubject`
- `source` (`app|api|whatsapp`)

---

## 7) Estratégias anti-erro já aplicadas
- Normalização de texto/data/hora para reduzir falhas de interpretação.
- Inferência local de intenção para economizar tokens e ganhar velocidade.
- Resolução de tarefa por seletor (id curto/título/data/hora/frente).
- Quando há ambiguidade, o sistema pede confirmação objetiva antes de mutar.
- Limites de contexto/tokens por endpoint para evitar estouro e custo descontrolado.
- Cache de resposta OpenAI por TTL para mensagens repetidas.
- Fallback de storage (Supabase -> arquivo) para resiliência.
- Controle de duplicidade de lembretes por chave de envio.

---

## 8) Variáveis de ambiente mais importantes
- OpenAI/modelos:
  - `OPENAI_API_KEY`
  - `OPENAI_MODEL_CHAT`
  - `OPENAI_MODEL_PARSER`
  - `OPENAI_MODEL_WHATSAPP`
  - `OPENAI_MODEL_TRANSCRIBE`
- Custos/limites:
  - `OPENAI_MAX_TOKENS_CHAT`
  - `OPENAI_MAX_TOKENS_PARSER`
  - `OPENAI_MAX_TOKENS_WHATSAPP`
  - `OPENAI_CACHE_TTL_MS`
- WhatsApp:
  - `WHATSAPP_NUMBER`
  - `WHATSAPP_TASK_REMINDER_MINUTES`
  - `WHATSAPP_REMINDER_AT_TIME_ENABLED`
  - `WHATSAPP_DAILY_FOLLOWUP_DEFAULT_TIME`
- Storage:
  - `SER_STORAGE_MODE`
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`

---

## 9) Limites atuais (transparência)
- App usa arquivo único no frontend (`App.jsx`), o que aumenta acoplamento.
- Seleção por texto no WhatsApp ainda pode exigir desambiguação em tarefas parecidas.
- Estimativa de custo é aproximada (baseada em tokens/tempo estimado de áudio).
- Dependência do WhatsApp Web (sessão/QR/conexão do runtime).

---

## 10) Objetivo de negócio resumido
Para a operação da Haldan e do Estúdio Taka, o SER atua como:
- **memória operacional** (não esquecer pendências),
- **executor de agenda** (criar/alterar/concluir rápido),
- **motor de follow-up** (cobrança até conclusão),
- **camada de previsibilidade** (lembrar no momento certo e medir custo).
