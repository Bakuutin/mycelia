export function getToggledWorkerFilter(
  allSelected: boolean,
  selectedTypes: Set<string>,
  workerType: string,
): { allSelected: boolean; selectedTypes: Set<string> } {
  if (
    !allSelected && selectedTypes.size === 1 && selectedTypes.has(workerType)
  ) {
    return { allSelected: true, selectedTypes: new Set() };
  }
  return { allSelected: false, selectedTypes: new Set([workerType]) };
}
