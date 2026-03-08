# Fórum Humanidades 2026 - GitHub Pages + Supabase

## 1) Configurar Supabase
1. Crie um projeto no Supabase.
2. Abra **SQL Editor** e execute o arquivo [supabase/schema.sql](./supabase/schema.sql).
3. Em **Project Settings > API**, copie:
- `Project URL`
- `anon public key`

## 2) Configurar o app
1. Edite [config.js](./config.js):
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
2. Salve no repositório (a anon key é pública e pode ficar no frontend).

## 3) Publicar no GitHub Pages
1. Suba este projeto no GitHub.
2. Em **Settings > Pages**:
- Source: Deploy from a branch
- Branch: `main` (ou a branch que você usar)
- Folder: `/ (root)`
3. Aguarde o deploy.

## 4) Observações
- O app agora é estático e não depende de `server.js` para funcionar no Pages.
- O banco fica no Supabase (tabela `forum_registrations`).
- Fluxos suportados:
  - Novo cadastro
  - Mudança de cadastro (com validação de e-mail e troca de cargo)
- As regras de vagas e cargos por turma são aplicadas no banco via funções RPC.
