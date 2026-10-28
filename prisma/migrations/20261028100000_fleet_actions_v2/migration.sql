-- Operational fleet actions (28/10/2026): proxy check / replace, recreate, SDK capture. Additive: same table, wider CHECK.
ALTER TABLE "FleetCommand" DROP CONSTRAINT IF EXISTS "FleetCommand_action_check";
ALTER TABLE "FleetCommand" ADD CONSTRAINT "FleetCommand_action_check" CHECK ("action" IN ('START_VM','SHUTDOWN_VM','POWER_OFF_VM','CHECK_HEALTH','CHECK_PROXY','REPLACE_PROXY','RECREATE_VM','READ_SDK'));
