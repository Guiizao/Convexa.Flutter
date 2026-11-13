-- Roda só na primeira vez que o volume do Postgres é criado.
-- "convexa" (ConvexaAPI) já é criado pelo POSTGRES_DB.
CREATE DATABASE convexa_automacao OWNER convexa;
CREATE DATABASE n8n OWNER convexa;
