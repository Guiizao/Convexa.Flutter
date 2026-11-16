-- Últimas opções (botões ou linhas de lista) mostradas a cada contato, na ordem.
-- Permite responder digitando o número da opção ("1", "opção 2") em qualquer menu.
ALTER TABLE conversation ADD COLUMN IF NOT EXISTS last_options jsonb;
