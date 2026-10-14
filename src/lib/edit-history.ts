import { prisma } from "./prisma";

/**
 * Save edit history for undo/revert (30-day retention)
 */
export async function saveEditHistory(params: {
  entity: string;
  entityId: string;
  field: string;
  oldValue: string | null | undefined;
  newValue: string | null | undefined;
  userId: string;
  projectId: string;
}) {
  // Don't save if values are the same
  const oldStr = params.oldValue?.toString() ?? null;
  const newStr = params.newValue?.toString() ?? null;
  if (oldStr === newStr) return null;

  try {
    return await prisma.editHistory.create({
      data: {
        entity: params.entity,
        entityId: params.entityId,
        field: params.field,
        oldValue: oldStr,
        newValue: newStr,
        userId: params.userId,
        projectId: params.projectId,
      },
    });
  } catch {
    // Edit history should never fail the main operation
    console.error("Failed to save edit history", params);
    return null;
  }
}

/**
 * Save multiple field changes at once
 */
export async function saveEditHistoryBatch(params: {
  entity: string;
  entityId: string;
  changes: Record<string, { old: any; new: any }>;
  userId: string;
  projectId: string;
}) {
  const promises = Object.entries(params.changes).map(([field, { old: oldVal, new: newVal }]) =>
    saveEditHistory({
      entity: params.entity,
      entityId: params.entityId,
      field,
      oldValue: oldVal?.toString(),
      newValue: newVal?.toString(),
      userId: params.userId,
      projectId: params.projectId,
    })
  );
  await Promise.allSettled(promises);
}
