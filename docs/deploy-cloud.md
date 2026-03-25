# Deploy em nuvem (híbrido: Supabase opcional + backend always-on)

## Objetivo
Rodar o SER sem depender do computador local:
- Backend sempre online (Express + WhatsApp + IA)
- Frontend estático (Vite)
- Storage em modo híbrido:
  - `SER_STORAGE_MODE=auto` (recomendado): usa Supabase se disponível, com fallback para arquivo local.
  - `SER_STORAGE_MODE=supabase`: exige Supabase.
  - `SER_STORAGE_MODE=file`: somente arquivo local no backend.

## Arquitetura recomendada
1. Backend Node em Render/Railway/Fly com volume persistente para sessão WhatsApp.
2. Frontend em Vercel/Netlify (ou static site no próprio provedor).
3. Supabase opcional para persistência central (tarefas + custos), sem ser obrigatório.

## 1) Preparar Supabase (opcional, mas recomendado)
1. Crie um projeto no Supabase.
2. Rode `supabase/schema.sql` no SQL Editor.
3. Guarde:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`

## 2) Migrar dados locais (se for usar Supabase)
```bash
npm run migrate:supabase
```

Esse comando envia `data/agenda.json` e `data/usage-log.json` para o Supabase.

## 3) Subir o backend em nuvem
Use:
- `Dockerfile` (container de produção)
- `render.yaml` (blueprint pronto para Render)

Antes de subir:
```bash
npm run check:env
```

### Variáveis mínimas (backend)
- `OPENAI_API_KEY`
- `OPENAI_MODEL_CHAT=gpt-4o-mini`
- `OPENAI_MODEL_PARSER=gpt-4o-mini`
- `OPENAI_MODEL_WHATSAPP=gpt-4o-mini`
- `OPENAI_MODEL_TRANSCRIBE=gpt-4o-mini-transcribe`
- `PORT=3101`
- `CORS_ORIGIN=https://seu-frontend.com`
- `SER_ADMIN_TOKEN=...` (fortemente recomendado)
- `APP_CHAT_HISTORY_LIMIT=5` (recomendado para reduzir custo)
- `APP_CHAT_MAX_CHARS_PER_MESSAGE=650` (recomendado para reduzir custo)
- `OPENAI_CACHE_TTL_MS=300000` (cache de 5 minutos)
- `OPENAI_CACHE_MAX_ITEMS=600`
- `WHATSAPP_LLM_HISTORY_TURNS=1` (contexto curto com baixo custo)
- `WHATSAPP_LLM_HISTORY_TTL_MS=900000`

### Variáveis de storage
- `SER_STORAGE_MODE=auto` (recomendado)
- `SER_REQUIRE_AUTH_FOR_READ=false` (deixe `true` para exigir token também em leitura)
- Se usar Supabase:
  - `SUPABASE_URL=...`
  - `SUPABASE_SERVICE_ROLE_KEY=...`
  - `SUPABASE_TASKS_TABLE=ser_tasks`
  - `SUPABASE_USAGE_TABLE=ser_usage_events`

### Variáveis do WhatsApp
- `WHATSAPP_NUMBER=55...` (opcional para restringir envio)
- `WHATSAPP_AUTH_PATH=/app/persist/whatsapp_auth`
- `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium`
- `WHATSAPP_AUTO_RECONNECT=true`
- `WHATSAPP_RECONNECT_BASE_MS=5000`
- `WHATSAPP_RECONNECT_MAX_MS=60000`

### Volumes persistentes obrigatórios
- monte 1 volume em `/app/persist`
- configure `SER_DATA_DIR=/app/persist/data`
- configure `WHATSAPP_AUTH_PATH=/app/persist/whatsapp_auth`

## 4) Subir o frontend em nuvem
No ambiente de build do frontend:
- `VITE_API_BASE_URL=https://seu-backend.com`
- `VITE_SER_ADMIN_TOKEN=...` (mesmo valor de `SER_ADMIN_TOKEN`, se backend estiver protegido)

Comandos:
```bash
npm install
npm run build
```

Diretório publicado: `dist`

## 5) Healthcheck e verificação
Depois do deploy, valide:
1. `GET /api/health` retorna `ok: true`.
2. `storage.backend` mostra `supabase` (quando disponível) ou `file` (fallback).
3. QR do WhatsApp conecta uma vez e mantém sessão após restart.
4. Mensagens do WhatsApp criam/alteram tarefas e aparecem no dashboard.
5. Lembretes chegam no horário e 1h antes (quando habilitado).

## 6) Checklist rápido de produção
1. CORS fechado no domínio real.
2. Chaves só no backend (`SUPABASE_SERVICE_ROLE_KEY` nunca no frontend).
3. `SER_STORAGE_MODE=auto` para tolerância a falhas.
4. Volume persistente do WhatsApp ativo.
5. Endpoint `/api/health` monitorado pelo provedor.
