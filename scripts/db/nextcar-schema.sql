CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE SCHEMA IF NOT EXISTS "nextcar";
SET search_path = "nextcar", public;

CREATE TABLE "nextcar"."leads" (
	"id" uuid DEFAULT uuid_generate_v4() NOT NULL,
	"email_id" varchar(500) NOT NULL CONSTRAINT "leads_email_id_uniq" UNIQUE,
	"remetente" varchar(255) NOT NULL,
	"email_remetente" varchar(255) NOT NULL,
	"assunto" varchar(500),
	"telefone" varchar(20),
	"nome" varchar(100),
	"veiculo_interesse" varchar(255),
	"mensagem" text,
	"origem" varchar(50) DEFAULT 'Email',
	"status" varchar(20) DEFAULT 'novo',
	"prioridade" varchar(10) DEFAULT 'media',
	"data_recebimento" timestamp DEFAULT now(),
	"data_contato" timestamp,
	"observacoes" text,
	"vendedor_id" uuid,
	"metadata" jsonb DEFAULT '{}',
	"score" integer DEFAULT 0,
	"tags" varchar(50)[] DEFAULT '{}',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"deleted_at" timestamp,
	"vendedor_whatsapp" varchar(20),
	"result_text" varchar(255),
	CONSTRAINT "leads_prioridade_check" CHECK (((prioridade)::text = ANY (ARRAY[('alta'::character varying)::text, ('media'::character varying)::text, ('baixa'::character varying)::text]))),
	CONSTRAINT "leads_score_check" CHECK (((score >= 0) AND (score <= 100))),
	CONSTRAINT "leads_status_check" CHECK (((status)::text = ANY (ARRAY[('novo'::character varying)::text, ('contatado'::character varying)::text, ('agendado'::character varying)::text, ('vendido'::character varying)::text, ('perdido'::character varying)::text])))
);
CREATE TABLE "nextcar"."marketing_costs_monthly" (
	"plataforma" text PRIMARY KEY,
	"custo_mensal" numeric(12, 2) NOT NULL
);
CREATE TABLE "nextcar"."marketing_spend_daily" (
	"id" bigserial PRIMARY KEY,
	"schema_name" text NOT NULL,
	"spend_date" date NOT NULL,
	"plataforma" text NOT NULL,
	"spend" numeric(12, 2) DEFAULT '0' NOT NULL
);
CREATE TABLE "nextcar"."tab_agenda" (
	"seq_registro" serial,
	"titulo" varchar(100),
	"hora" varchar(20),
	"dia" varchar(30),
	"descricao" varchar(100),
	"concluido" boolean,
	"seq_veiculo" integer,
	"ind_cancelado" boolean DEFAULT false,
	"motivo_cancelamento" varchar(255)
);
CREATE TABLE "nextcar"."tab_alocador_despesa_veiculo" (
	"seq_registro" serial PRIMARY KEY,
	"des_movimento" varchar(255),
	"val_movimento" numeric(15, 2),
	"dta_movimento" varchar(30),
	"seq_veiculo" integer,
	"des_observacao" varchar(255),
	"ind_alocato" boolean DEFAULT false,
	"seq_movimentacao" integer
);
CREATE TABLE "nextcar"."tab_apuracao_saldo_banco" (
	"seq_registro" serial,
	"seq_banco" integer,
	"des_banco" varchar(20),
	"saldo_dia" numeric(15, 2),
	"dta_saldo" varchar(30)
);
CREATE TABLE "nextcar"."tab_cartao" (
	"seq_registro" serial,
	"final_cartao" varchar(4),
	"ind_status" boolean DEFAULT true,
	"bandeira" varchar(30),
	"vencimento" integer,
	"fechamento" integer
);
CREATE TABLE "nextcar"."tab_cliente" (
	"seq_registro" serial,
	"nom_cliente" varchar(500),
	"num_cpf_cnpj" varchar(30),
	"des_logradouro" varchar(500),
	"complemento" varchar(50),
	"cep" varchar(20),
	"telefone" varchar(20),
	"dta_nascimento" varchar(30),
	"img_capa" bytea,
	"dta_cadastro" varchar(30),
	"cidade" varchar(50),
	"uf" varchar(50),
	"email" varchar(200),
	"bairro" varchar(50)
);
CREATE TABLE "nextcar"."tab_conta_banco" (
	"seq_registro" serial,
	"des_banco" varchar(30),
	"agencia" varchar(20),
	"conta_corrente" varchar(20),
	"ind_status" boolean DEFAULT true,
	"saldo_inicial" numeric(15, 2),
	"dta_saldo" varchar(30)
);
CREATE TABLE "nextcar"."tab_conta_parceiro" (
	"seq_registro" serial,
	"des_movimento" varchar(255),
	"val_movimento" numeric(15, 2),
	"tipo_movimento" char(1),
	"dta_movimento" varchar(30),
	"observacao" varchar(255),
	"cod_parceiro" integer,
	"nom_parceiro" varchar(30),
	"cod_banco" integer,
	"des_banco" varchar(255)
);
CREATE TABLE "nextcar"."tab_conta_receber" (
	"seq_registro" serial,
	"des_receita" varchar(100),
	"dta_receita" varchar(30),
	"val_receita" numeric(15, 2),
	"ind_pago" boolean DEFAULT false,
	"seq_veiculo" integer,
	"dta_recebimento" varchar(30),
	"cod_banco" integer,
	"cod_tipo" integer,
	"des_veiculo" varchar(100),
	"ind_excluido" boolean DEFAULT false,
	"motivo_exclusao" varchar(255),
	"cod_cliente" integer,
	"tipo_movimento" char(1)
);
CREATE TABLE "nextcar"."tab_despesa_fixas" (
	"des_despesa" varchar(100),
	"seq_registro" serial PRIMARY KEY,
	"val_despesa" numeric(15, 2),
	"dta_despesa" varchar(30),
	"cod_tipo_despesa" integer,
	"des_tipo_despesa" varchar(50),
	"ind_status" boolean DEFAULT false
);
CREATE TABLE "nextcar"."tab_despesa_operacional" (
	"des_despesa" varchar(100),
	"seq_registro" serial,
	"val_despesa" numeric(15, 2),
	"dta_despesa" varchar(30),
	"cod_tipo_despesa" integer,
	"des_tipo_despesa" varchar(50),
	"cod_banco" integer,
	"cod_cartao" integer,
	"parcela" integer
);
CREATE TABLE "nextcar"."tab_despesa_veiculo" (
	"seq_registro" serial,
	"seq_veiculo" integer,
	"des_despesa" varchar(100),
	"cod_tipo_despesa" integer,
	"des_tipo_despesa" varchar(50),
	"cod_banco" integer,
	"cod_cartao" integer,
	"dta_despesa" varchar(30),
	"ind_excluido" boolean DEFAULT false,
	"val_despesa" numeric(15, 2),
	"des_veiculo_garantia" varchar(50),
	"seq_veiculo_garantia" integer,
	"parcela" integer
);
CREATE TABLE "nextcar"."tab_empresa" (
	"seq_registro" serial,
	"nome_fantasia" varchar(100),
	"razao_social" varchar(100),
	"cnpj" varchar(20),
	"endereco" varchar(200),
	"cep" varchar(20),
	"telefone" varchar(20),
	"email" varchar(100),
	"logo_empresa" bytea,
	"site" varchar(100),
	"whatsapp" varchar(20),
	"inscricao_estadual" varchar(30),
	"numero" varchar(20),
	"bairro" varchar(50),
	"cidade" varchar(50),
	"estado" varchar(20),
	"dta_cadastro" varchar(30),
	"dta_alteracao" varchar(30),
	"inscricao_municipal" varchar(50),
	"email_leads" varchar(100),
	"observacoes" varchar(500),
	"complemento" varchar(100)
);
CREATE TABLE "nextcar"."tab_fatura_cartao" (
	"seq_registro" serial,
	"cod_cartao" integer,
	"val_fatura" numeric(15, 2),
	"dta_vencimento" varchar(30),
	"dta_pagamento" varchar(30),
	"cod_banco" integer,
	"ind_pago" boolean DEFAULT false,
	"val_pago" numeric(15, 2),
	"seq_movimento_cartao" varchar(1000)
);
CREATE TABLE "nextcar"."tab_financeiras" (
	"seq_registro" serial,
	"des_financeira" varchar(50),
	"cod_banco" integer
);
CREATE TABLE "nextcar"."tab_integradores" (
	"seq_registro" serial,
	"nome_integrador" varchar(50),
	"usuario" varchar(100),
	"senha" varchar(100),
	"mensagem_predefinida" boolean DEFAULT false,
	"ind_status" boolean DEFAULT false,
	"connected" boolean DEFAULT false,
	"token" varchar
);
CREATE TABLE "nextcar"."tab_modelo_contrato" (
	"seq_registro" serial,
	"des_contrato" varchar(50),
	"tipo_contrato" char(1) DEFAULT NULL,
	"clausulas_contrato" varchar,
	"observacoes" varchar,
	"ind_padrao" boolean DEFAULT false,
	"ind_principal" boolean DEFAULT false
);
CREATE TABLE "nextcar"."tab_movimentacao" (
	"seq_registro" serial PRIMARY KEY,
	"tipo_movimento" char(1),
	"dta_movimento" varchar(30),
	"des_movimento" varchar(100),
	"ind_conciliado" boolean DEFAULT false,
	"dta_conciliado" varchar(30),
	"ind_excluido" boolean DEFAULT false,
	"ind_alterado" boolean DEFAULT false,
	"seq_veiculo" integer,
	"des_origem" varchar(50),
	"cod_banco" integer,
	"des_movimento_detalhado" varchar(200),
	"cod_cartao" integer,
	"des_observacao" varchar(300),
	"val_movimento" numeric(15, 2),
	"descricao_mov_ofx" varchar(1000),
	"cod_banco_ofx" integer,
	"id_unico" varchar(150),
	"cod_categoria_movimento" integer,
	"des_categoria_movimento" varchar(50),
	"parcela" integer,
	"seq_despesa" integer,
	"ind_faturado" boolean DEFAULT false,
	"seq_fatura" integer,
	"ind_cartao_pago" boolean DEFAULT false,
	"cod_parceiro" integer,
	"nom_parceiro" varchar(200),
	"cod_banco_destino" integer,
	"des_banco_destino" varchar(120),
	"criterio_conciliacao" varchar(80),
	"origem_importacao" varchar(40),
	"hash_conciliacao" varchar(120),
	"seq_movimentacao_relacionada" integer,
	"ind_ofx" boolean DEFAULT false,
	"des_status_validacao" varchar(120)
);
CREATE TABLE "nextcar"."tab_parceiros" (
	"seq_registro" integer DEFAULT nextval('tab_parceiros_cod_parceiro_seq'::regclass) NOT NULL,
	"nom_parceiro" varchar(50),
	"ind_tipo" char(1),
	"percentual_lucro" integer,
	"ind_status" boolean DEFAULT true
);
CREATE TABLE "nextcar"."tab_veiculo" (
	"seq_veiculo" serial PRIMARY KEY,
	"des_veiculo" varchar(100),
	"val_compra" numeric(15, 2),
	"val_venda" numeric(15, 2),
	"observacoes" text,
	"ind_status" char(1),
	"dta_compra" varchar(30),
	"dta_venda" varchar(30),
	"dta_lancamento" varchar(30),
	"ind_troca" char(1),
	"seq_veiculo_origem" integer,
	"img_veiculo_capa" bytea,
	"val_lucro" numeric(15, 2),
	"ind_retorno_vinculado" boolean DEFAULT false,
	"ind_tipo_veiculo" char(1),
	"des_proprietario" varchar(50),
	"ind_financiado" boolean DEFAULT false,
	"cod_usuario_vinculado" integer,
	"ind_ocorrencia_aberta" boolean DEFAULT false,
	"val_venda_esperado" numeric(15, 2),
	"cod_vendedor" integer,
	"cod_parceiro" integer,
	"km" varchar(20),
	"ano_fabricacao" varchar(15),
	"ano_modelo" varchar(15),
	"des_veiculo_completa" varchar(100),
	"ind_ajustado_importacao" boolean,
	"placa" varchar(8),
	"renavam" varchar(50),
	"chassis" varchar(100),
	"crv" varchar(100),
	"cor" varchar(20),
	"motorizacao" varchar(5),
	"combustivel" varchar(30),
	"portas" integer,
	"cambio" varchar(25),
	"cod_banco" integer,
	"valor_venda_contrato" integer,
	"observacao_venda" varchar(1000),
	"img_contrato" bytea,
	"seq_contrato" integer,
	"origem_venda" varchar(15),
	"modelo" varchar(50),
	"documento" bytea,
	"nome_documento" varchar(200),
	"id_integracao" varchar(15),
	"status" varchar(100),
	"ind_veiculo_investidor" boolean,
	"valor_investido_proprio" numeric(15, 2),
	"valor_investido_investidor" numeric(15, 2),
	"img_veiculo_autoscar" varchar(1000),
	"quitacao" numeric(15, 2),
	"val_financiado" numeric(15, 2),
	"garantia_terceiros" bytea,
	"motivo_exclusao" varchar(100),
	"des_veiculo_personalizado" varchar(255),
	"marca" varchar(50),
	"modelo_completo" varchar(100),
	"dta_ultima_alteracao" varchar(30),
	"financeiro_incluso" boolean DEFAULT false,
	"cod_movimentacao" integer,
	"cod_banco_entrada" integer,
	"cod_financeira" integer,
	"dados_consorcio" varchar,
	"des_veiculo_entrada" varchar(100),
	"total_prazo" integer,
	"val_consorcio" numeric(15, 2),
	"val_entrada_cartao" numeric(15, 2),
	"val_entrada_especie" numeric(15, 2),
	"val_veiculo_entrada" numeric(15, 2),
	"valor_prazo" numeric(15, 2),
	"motivo_cancelamento" varchar(255),
	"ind_importado" boolean DEFAULT false,
	"id_importacao" integer,
	"ind_excluido_garage" boolean DEFAULT false,
	"img_veiculo_capa_url" text
);
CREATE TABLE "nextcar"."tab_veiculo_imagem" (
	"seq_registro" serial,
	"seq_veiculo" integer,
	"img_1" bytea,
	"img_2" bytea,
	"img_3" bytea,
	"img_4" bytea,
	"img_5" bytea,
	"img_6" bytea,
	"img_7" bytea,
	"img_8" bytea,
	"img_9" bytea,
	"img_10" bytea,
	"img_11" bytea,
	"img_12" bytea,
	"posicao" integer,
	"pre_cadastro" boolean DEFAULT false,
	"img_1_url" text,
	"img_2_url" text,
	"img_3_url" text,
	"img_4_url" text,
	"img_5_url" text,
	"img_6_url" text,
	"img_7_url" text,
	"img_8_url" text,
	"img_9_url" text,
	"img_10_url" text,
	"img_11_url" text,
	"img_12_url" text
);
CREATE TABLE "nextcar"."tab_vendedores" (
	"seq_registro" serial,
	"nom_vendedor" varchar(50),
	"ind_ativo" boolean DEFAULT true,
	"val_comissao" numeric(15, 2),
	"val_fixo" numeric(15, 2),
	"dta_padrao_pagamento" varchar(30),
	"tipo_pagamento" char(1)
);
CREATE INDEX "idx_leads_data_recebimento" ON "nextcar"."leads" ("data_recebimento");
CREATE INDEX "idx_leads_email_remetente" ON "nextcar"."leads" ("email_remetente");
CREATE INDEX "idx_leads_metadata" ON "nextcar"."leads" USING gin ("metadata");
CREATE INDEX "idx_leads_origem" ON "nextcar"."leads" ("origem");
CREATE INDEX "idx_leads_prioridade" ON "nextcar"."leads" ("prioridade");
CREATE INDEX "idx_leads_status" ON "nextcar"."leads" ("status");
CREATE INDEX "idx_leads_tags" ON "nextcar"."leads" USING gin ("tags");
CREATE INDEX "idx_leads_vendedor_id" ON "nextcar"."leads" ("vendedor_id");
CREATE INDEX "leads_search_idx" ON "nextcar"."leads" USING gin (to_tsvector('portuguese'::regconfig, COALESCE(assunto, '') || ' ' || COALESCE(mensagem, '') || ' ' || COALESCE(veiculo_interesse, '')));
CREATE INDEX "marketing_spend_daily_idx" ON "nextcar"."marketing_spend_daily" ("schema_name","spend_date","plataforma");
