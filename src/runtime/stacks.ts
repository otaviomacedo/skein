const stackAssignments = new Map<string, string>();

export function assignStack(logicalId: string, stackName: string): void {
  stackAssignments.set(logicalId, stackName);
}

export function getStackAssignments(): Map<string, string> {
  return stackAssignments;
}

export function resetStacks(): void {
  stackAssignments.clear();
}
