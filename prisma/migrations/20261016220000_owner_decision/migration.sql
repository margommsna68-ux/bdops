-- Owner decision 16/10/2026: operators may change the class of any proxy (TUT / Chung mooon–Genjy / Genjy riêng / own groups)
-- through the checked registry edit (preview, revision, journal, undo). The decision is recorded on the identity so Genjy
-- refreshes keep it. Ownership stays permanent for every other write: only a transaction that set the local flag may change it.
ALTER TABLE "ProxyIdentity" ADD COLUMN "ownerDecidedAt" TIMESTAMP(3), ADD COLUMN "ownerDecidedBy" TEXT;
CREATE OR REPLACE FUNCTION preserve_genjy_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('moneytohome.owner_change', true) = 'on' OR current_setting('moneytohome.shared_classification_undo', true) = 'on' THEN
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
