export function requireDeletedProject(projectId: string, deletedRows: { id: string }[] | null): void {
  if (deletedRows?.length !== 1 || deletedRows[0]?.id !== projectId) {
    throw new Error("No project was deleted. Your access may not allow deletion, or the project is no longer available. Reload and try again.");
  }
}