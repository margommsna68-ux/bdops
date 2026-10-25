-- Historical jobs and clients without a slot remain in the original slot 1.
ALTER TABLE "AppleCheckJob" ADD COLUMN "claimSlot" INTEGER NOT NULL DEFAULT 1;
