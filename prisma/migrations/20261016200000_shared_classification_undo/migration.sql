-- "PC chung" now means proxies mooon and Genjy invest in together (16/10/2026). The owner's confirmed list can move an identity
-- into that class (TUT -> GENJY/PC_CHUNG, Genjy riêng -> PC_CHUNG). Ownership stays permanent for every other write; only the
-- undo of that exact classification, inside its own transaction, may put the previous owner/subgroup back. The undo service sets
-- the transaction-local flag and has already checked the operation's before/after images.
CREATE OR REPLACE FUNCTION preserve_genjy_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('moneytohome.shared_classification_undo', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF OLD."owner" = 'GENJY' AND NEW."owner" <> 'GENJY' THEN
    RAISE EXCEPTION 'GENJY ownership is permanent';
  END IF;
  IF OLD."subgroup" = 'PC_CHUNG' AND NEW."subgroup" IS DISTINCT FROM 'PC_CHUNG' THEN
    RAISE EXCEPTION 'PC_CHUNG classification is permanent';
  END IF;
  RETURN NEW;
END;
$$;
