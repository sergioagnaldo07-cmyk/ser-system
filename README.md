# Sistema SER

Sistema de agenda com IA + WhatsApp para operação diária (Separar, Executar, Revisar).

## Documentação funcional
- [`docs/documentacao-sistema-ser.md`](./docs/documentacao-sistema-ser.md)
- [`docs/apresentacao-haldan-ser-system.md`](./docs/apresentacao-haldan-ser-system.md)

## Rodar local
1. Copie `.env.example` para `.env` e preencha `OPENAI_API_KEY`.
2. Instale dependências:
   ```bash
   npm install
   ```
3. Inicie frontend + backend:
   ```bash
   npm run dev
   ```
4. Abra:
   - Frontend: `http://localhost:3100`
   - Backend: `http://localhost:3101`

## Validação de ambiente
Antes do deploy:
```bash
npm run check:env
```

## Endpoints importantes
- Healthcheck: `GET /api/health`
- Agenda: `GET /api/agenda/tasks`
- WhatsApp status: `GET /api/whatsapp/status`

## Segurança recomendada
- Defina `SER_ADMIN_TOKEN` no backend.
- Se o frontend precisar acessar endpoints protegidos, use `VITE_SER_ADMIN_TOKEN` com o mesmo valor.

## Custo (recomendado)
- `APP_CHAT_HISTORY_LIMIT=5`
- `APP_CHAT_MAX_CHARS_PER_MESSAGE=650`
- `OPENAI_CACHE_TTL_MS=300000` (5 min)
- `WHATSAPP_LLM_HISTORY_TURNS=1`

## Deploy em nuvem
Guia completo:
- [`docs/deploy-cloud.md`](./docs/deploy-cloud.md)
- Guia passo a passo (modo leigo):
- [`docs/deploy-cloud-passo-a-passo.md`](./docs/deploy-cloud-passo-a-passo.md)

Arquivos de infraestrutura já prontos:
- `Dockerfile`
- `docker-compose.yml`
- `render.yaml`
- `supabase/schema.sql`
- `scripts/migrate-local-to-supabase.mjs`
- `.env.backend.cloud.example`
- `.env.frontend.cloud.example`
