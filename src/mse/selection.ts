export const MAX_MSE_SELECTED_TASKS = 500;

export function normalizeMseTasks(tasks: readonly string[] | undefined): string[] {
  if (tasks === undefined) return [];
  return [...new Set(tasks.map((item) => item.trim()).filter(Boolean))].sort();
}
