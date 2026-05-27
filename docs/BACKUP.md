# Backup do Banco de Dados

## Visao geral

Backup automatizado do PostgreSQL de producao (Railway) para Cloudflare R2, com encriptacao GPG, rotacao automatica e alerta por email em caso de falha.

- **Frequencia:** Diario, meia-noite BRT (3h UTC)
- **Workflow:** `.github/workflows/backup-db.yml`
- **Destino:** Cloudflare R2, bucket `cloupone-backups`
- **Encriptacao:** AES-256 via GPG (senha simetrica)
- **Alerta de falha:** Email via Mailgun

## Como funciona

1. GitHub Actions roda o workflow via cron (ou manualmente)
2. `pg_dump` conecta no Postgres do Railway e gera o dump
3. Dump e validado (deve ter > 1KB)
4. Compactado com gzip e encriptado com GPG
5. Upload para Cloudflare R2
6. Backups antigos sao removidos conforme politica de retencao
7. Se qualquer step falhar, envia email de alerta

## Retencao

| Tipo | Quando | Retencao |
|------|--------|----------|
| Diario | Seg a Sab (exceto dia 1) | 7 dias |
| Semanal | Domingos | 30 dias |
| Mensal | Dia 1 de cada mes | 6 meses |

Nomenclatura dos arquivos: `cloupone_YYYY-MM-DD_HHMMSS_{tipo}.sql.gz.gpg`

## Secrets (GitHub Actions)

Configuradas em **Settings > Secrets and variables > Actions**:

| Secret | Descricao |
|--------|-----------|
| `DATABASE_URL` | Connection string do PostgreSQL (Railway) |
| `GPG_PASSPHRASE` | Senha para encriptar/decriptar os backups |
| `R2_ACCESS_KEY` | Access key da API do Cloudflare R2 |
| `R2_SECRET_KEY` | Secret key da API do Cloudflare R2 |
| `R2_ENDPOINT` | Endpoint S3 do R2: `https://<account-id>.r2.cloudflarestorage.com` |
| `MAILGUN_API_KEY` | API key do Mailgun |
| `MAILGUN_DOMAIN` | Dominio configurado no Mailgun |
| `ALERT_EMAIL` | Email(s) para alerta de falha (separar por virgula) |

## Executar backup manualmente

No GitHub: **Actions > Database Backup > Run workflow > Selecionar branch > Run workflow**

## Restaurar backup

### Pre-requisitos

- AWS CLI configurado com credenciais do R2
- GPG instalado
- Acesso a um servidor PostgreSQL (local ou remoto)

### Passo a passo

**1. Baixar o backup do R2**

```bash
aws s3 cp s3://cloupone-backups/cloupone_YYYY-MM-DD_HHMMSS_tipo.sql.gz.gpg backup.sql.gz.gpg \
  --endpoint-url https://<account-id>.r2.cloudflarestorage.com
```

Para listar backups disponiveis:

```bash
aws s3 ls s3://cloupone-backups/ --endpoint-url https://<account-id>.r2.cloudflarestorage.com
```

**2. Decriptar e descompactar**

```bash
gpg --batch --passphrase "SUA_GPG_PASSPHRASE" -d backup.sql.gz.gpg | gunzip > backup.sql
```

**3. Restaurar no banco**

Em um banco local (Docker):

```bash
# Criar banco temporario
docker exec -e PGPASSWORD=postgres cloup-one-db psql -U postgres -c "CREATE DATABASE cloupone_restore;"

# Restaurar
docker cp backup.sql cloup-one-db:/tmp/backup.sql
docker exec -e PGPASSWORD=postgres cloup-one-db psql -U postgres -d cloupone_restore -f /tmp/backup.sql
```

Em um banco remoto (novo Railway, Neon, etc.):

```bash
psql "postgresql://user:password@host:port/database" < backup.sql
```

**4. Validar**

```bash
# Verificar se as tabelas foram criadas
docker exec -e PGPASSWORD=postgres cloup-one-db psql -U postgres -d cloupone_restore -c "\dt"

# Verificar contagem de registros em tabelas principais
docker exec -e PGPASSWORD=postgres cloup-one-db psql -U postgres -d cloupone_restore -c "SELECT 'users' as tabela, count(*) FROM users UNION ALL SELECT 'projects', count(*) FROM projects UNION ALL SELECT 'clients', count(*) FROM clients;"
```

## Disaster recovery

Se perder acesso ao Railway (banco + backend):

1. Provisionar novo PostgreSQL (Neon, Supabase, Render, ou outro Railway)
2. Baixar ultimo backup do R2
3. Decriptar e restaurar no novo banco (passos acima)
4. Atualizar `DATABASE_URL` no novo deploy do backend
5. Redeploy do backend apontando para o novo banco
6. Frontend (Cloudflare Workers) nao precisa mudar, apenas o DNS do backend se o dominio mudar

## Manutencao

- **Testar restore mensalmente** para garantir que os backups estao funcionando
- **GPG passphrase** deve estar salva no password manager (se perder, nao restaura os backups)
- **Monitorar emails de alerta** - se parar de receber, verificar se o workflow esta rodando no GitHub Actions
