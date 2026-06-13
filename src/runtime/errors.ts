export class SkeinError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkeinError";
  }
}

export class ConflictError extends SkeinError {
  constructor(
    public path: string,
    public existing: unknown,
    public incoming: unknown,
    public suggestion?: string,
  ) {
    const msg = [
      `Conflict at ${path}:`,
      `  Value 1: ${JSON.stringify(existing)}`,
      `  Value 2: ${JSON.stringify(incoming)}`,
      suggestion ? `\nHint: ${suggestion}` : "",
    ].join("\n");
    super(msg);
    this.name = "ConflictError";
  }
}

export class ReferenceError extends SkeinError {
  constructor(
    public sourceId: string,
    public targetId: string,
  ) {
    super(
      `Resource "${sourceId}" references "${targetId}" which does not exist in the template.\n` +
      `Hint: ensure "${targetId}" is created via a generator, or is a parameter/pseudo-parameter.`,
    );
    this.name = "ReferenceError";
  }
}

export class CycleError extends SkeinError {
  constructor(public involvedId: string, public cycle: string[]) {
    const cycleStr = cycle.length > 0
      ? `\n  Cycle: ${cycle.join(" → ")}`
      : "";
    super(`Circular dependency detected involving "${involvedId}".${cycleStr}`);
    this.name = "CycleError";
  }
}

export class ValidationError extends SkeinError {
  constructor(message: string, public logicalId?: string) {
    super(logicalId ? `[${logicalId}] ${message}` : message);
    this.name = "ValidationError";
  }
}
