/** Compile-time exhaustiveness guard. If a new union member is added and left
 * unhandled, the call site stops type-checking (its argument is no longer `never`). */
export function assertNever(x: never): never {
  throw new Error(`Unhandled union member: ${JSON.stringify(x)}`);
}
