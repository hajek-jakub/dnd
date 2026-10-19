-- AI pomocník DM (Claude API): konverzace, zprávy přesně v tvaru API, návrhy do lootu a evidence útraty.
-- IF NOT EXISTS: po chybě v půlce jde migrace pustit znovu.
CREATE TABLE IF NOT EXISTS ai_conversations (
  id CHAR(36) NOT NULL PRIMARY KEY,
  campaign_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  title VARCHAR(120) NOT NULL DEFAULT '',
  -- kolik volání modelu proběhlo od poslední zprávy DM (pojistka proti nekonečné smyčce nástrojů)
  steps INT NOT NULL DEFAULT 0,
  -- velikost kontextu při posledním volání (dlouhé konverzace jsou drahé, od limitu se musí začít nová)
  last_input_tokens INT NOT NULL DEFAULT 0,
  -- zámek proti dvěma souběžným voláním modelu nad jednou konverzací
  busy_until DATETIME NULL,
  -- proč se AI zastavila (odmítnutí, moc kroků, dlouhý kontext); další krok čeká na novou zprávu DM, ať se nic neopakuje dokola
  halted VARCHAR(300) NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  KEY ai_conversations_owner_idx (campaign_id, user_id, updated_at),
  CONSTRAINT ai_conversations_campaign_fk FOREIGN KEY (campaign_id) REFERENCES campaigns (id) ON DELETE CASCADE,
  CONSTRAINT ai_conversations_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_messages (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  conversation_id CHAR(36) NOT NULL,
  role ENUM('user', 'assistant') NOT NULL,
  -- JSON pole bloků přesně tak, jak šlo do API nebo z něj přišlo (historie se jen přidává, nikdy nepřepisuje)
  content MEDIUMTEXT NOT NULL,
  -- text, který napsal DM (u výsledků nástrojů NULL)
  display_text TEXT NULL,
  stop_reason VARCHAR(30) NULL,
  created_at DATETIME NOT NULL,
  KEY ai_messages_conversation_idx (conversation_id, id),
  CONSTRAINT ai_messages_conversation_fk FOREIGN KEY (conversation_id) REFERENCES ai_conversations (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_proposals (
  id CHAR(36) NOT NULL PRIMARY KEY,
  conversation_id CHAR(36) NOT NULL,
  tool_use_id VARCHAR(100) NOT NULL,
  title VARCHAR(200) NOT NULL,
  -- ověřené položky ve tvaru vstupu lootu (cesta složek, vstup, popisek pro kartu)
  data MEDIUMTEXT NOT NULL,
  status ENUM('pending', 'applied', 'discarded') NOT NULL DEFAULT 'pending',
  -- jestli už AI v další zprávě dostala vědět, jak DM rozhodl
  reported TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL,
  decided_at DATETIME NULL,
  KEY ai_proposals_conversation_idx (conversation_id, created_at),
  CONSTRAINT ai_proposals_conversation_fk FOREIGN KEY (conversation_id) REFERENCES ai_conversations (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Útrata za volání modelu. Záměrně bez cizích klíčů: smazání konverzace ani kampaně nesmí vynulovat měsíční rozpočet.
CREATE TABLE IF NOT EXISTS ai_calls (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id CHAR(36) NULL,
  campaign_id CHAR(36) NULL,
  conversation_id CHAR(36) NULL,
  model VARCHAR(60) NOT NULL,
  input_tokens INT NOT NULL DEFAULT 0,
  cache_write_tokens INT NOT NULL DEFAULT 0,
  cache_read_tokens INT NOT NULL DEFAULT 0,
  output_tokens INT NOT NULL DEFAULT 0,
  cost_microusd BIGINT NOT NULL DEFAULT 0,
  stop_reason VARCHAR(30) NULL,
  created_at DATETIME NOT NULL,
  KEY ai_calls_created_idx (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
