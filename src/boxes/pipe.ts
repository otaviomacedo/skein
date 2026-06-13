import { Resource } from "../runtime/resource.js";

type AnyFn = (...args: any[]) => any;

type PipeBuilder<T> = {
  to<Args extends unknown[], Out>(
    fn: (primary: T, ...args: Args) => Out,
    ...args: Args
  ): PipeBuilder<PrimaryOf<Out>>;
  done(): T;
};

type PrimaryOf<T> = T extends [infer First, ...any[]] ? First : T;

function extractPrimary<T>(result: T): PrimaryOf<T> {
  if (Array.isArray(result)) return result[0] as PrimaryOf<T>;
  return result as PrimaryOf<T>;
}

export function pipe<T>(initial: T): PipeBuilder<T> {
  let current: any = initial;

  const builder: PipeBuilder<T> = {
    to(fn, ...args) {
      const result = fn(current, ...args);
      current = extractPrimary(result);
      return builder as any;
    },
    done() {
      return current;
    },
  };

  return builder;
}
