import { Resource } from "./resource.js";

export type Condition = {
  readonly __kind: "condition";
  readonly name: string;
  readonly expression: unknown;
};

export type ConditionRef = {
  readonly __kind: "conditionRef";
  readonly conditionName: string;
  readonly trueValue: unknown;
  readonly falseValue: unknown;
};

const conditions = new Map<string, unknown>();

export function mkCondition(name: string, expression: unknown): Condition {
  conditions.set(name, expression);
  return { __kind: "condition", name, expression };
}

export function fnEquals(value1: unknown, value2: unknown): unknown {
  return { "Fn::Equals": [value1, value2] };
}

export function fnAnd(...conds: Condition[]): unknown {
  return { "Fn::And": conds.map((c) => ({ Condition: c.name })) };
}

export function fnOr(...conds: Condition[]): unknown {
  return { "Fn::Or": conds.map((c) => ({ Condition: c.name })) };
}

export function fnNot(cond: Condition): unknown {
  return { "Fn::Not": [{ Condition: cond.name }] };
}

export function fnIf(condition: Condition, trueValue: unknown, falseValue: unknown): ConditionRef {
  return { __kind: "conditionRef", conditionName: condition.name, trueValue, falseValue };
}

export function isConditionRef(value: unknown): value is ConditionRef {
  return (
    value !== null &&
    typeof value === "object" &&
    "__kind" in (value as object) &&
    (value as ConditionRef).__kind === "conditionRef"
  );
}

export function getConditions(): Map<string, unknown> {
  return conditions;
}

export function resetConditions(): void {
  conditions.clear();
}
