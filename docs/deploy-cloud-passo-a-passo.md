# SER na nuvem (passo a passo para leigo)

Este guia coloca o sistema para rodar sem depender do seu computador.

## Resultado final
- Backend online 24h (API + WhatsApp + IA)
- Frontend online (dashboard no navegador)
- Dados em Supabase (recomendado)

## O que eu já deixei pronto no projeto
- Arquivo de backend: `.env.backend.cloud.example`
- Arquivo de frontend: `.env.frontend.cloud.example`
- Infra base: `Dockerfile` e `render.yaml`
- Banco: `supabase/schema.sql`
- Migração local -> Supabase: `scripts/migrate-local-to-supabase.mjs`

## O que o senhor precisa criar nas plataformas
1. Uma conta no Supabase
2. Uma conta no Render (backend)
3. Uma conta no Vercel (frontend)

---

## 1) Criar o banco no Supabase
1. Entre no Supabase e clique em `New project`.
2. Após criar, abra `SQL Editor`.
3. Copie e execute o conteúdo de `supabase/schema.sql`.
4. Em `Project Settings > API`, copie:
   - `Project URL` (vira `SUPABASE_URL`)
   - `service_role` key (vira `SUPABASE_SERVICE_ROLE_KEY`)

---

## 2) Subir o backend no Render
1. No Render, clique `New +` -> `Web Service`.
2. Conecte o repositório `ser-system`.
3. Escolha `Docker` (ele vai usar o `Dockerfile` do projeto).
4. Em `Environment Variables`, cole os valores do arquivo `.env.backend.cloud.example`.
5. Ajuste estes campos obrigatórios:
   - `OPENAI_API_KEY`
   - `CORS_ORIGIN` (URL do frontend Vercel)
   - `SER_ADMIN_TOKEN` (um token forte criado por você)
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
6. Em `Disks`, adicione 1 disco persistente:
   - `Mount Path`: `/app/persist`
   - `Size`: `1GB` (mínimo)
7. Faça o deploy.

### Teste rápido do backend
Abra no navegador:
- `https://SEU_BACKEND/api/health`

Precisa aparecer `ok: true`.

---

## 3) Subir o frontend no Vercel
1. No Vercel, clique `Add New` -> `Project`.
2. Selecione o mesmo repositório.
3. Configure variáveis do frontend com base em `.env.frontend.cloud.example`:
   - `VITE_API_BASE_URL=https://SEU_BACKEND`
   - `VITE_SER_ADMIN_TOKEN=...` (mesmo token de `SER_ADMIN_TOKEN`, se protegido)
4. Deploy.

---

## 4) Migrar seus dados locais para o Supabase (uma vez)
No seu computador, dentro da pasta do projeto:

```bash
cd /Users/sergio_taka/Documents/Codex/ser-system
node scripts/migrate-local-to-supabase.mjs
```

Antes, garanta que `.env` local tenha:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Esse comando envia:
- tarefas (`data/agenda.json`)
- custos/eventos (`data/usage-log.json`)

---

## 5) Conectar WhatsApp em produção
1. Com backend online, abra o dashboard.
2. Vá em `Config > WhatsApp`.
3. Escaneie o QR code.
4. Aguarde status `connected`.
5. Reinicie o backend uma vez e confirme que continua conectado.

Se continuar conectado após reinício, o disco persistente está correto.

---

## 6) Checklist final
1. `GET /api/health` com `ok: true`
2. WhatsApp conectado
3. Criar tarefa via WhatsApp
4. Confirmar tarefa no dashboard
5. Testar lembrete (horário exato)

---

## O que eu posso fazer por você agora
Eu consigo:
1. Revisar e ajustar código do projeto
2. Preparar variáveis e arquivos para deploy
3. Validar fluxos e corrigir bugs
4. Te guiar passo a passo durante publicação

Eu não consigo sozinho:
1. Entrar na sua conta Supabase/Render/Vercel
2. Clicar botões por você nessas plataformas
3. Escanear o QR do seu WhatsApp

