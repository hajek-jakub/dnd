-- Soukromý chat dvou hráčů: vlákno 'pm:<id hráče>:<id hráče>' (id seřazená) má 76 znaků, původních 60 nestačí.
ALTER TABLE messages MODIFY thread VARCHAR(80) NOT NULL;
ALTER TABLE message_reads MODIFY thread VARCHAR(80) NOT NULL;
