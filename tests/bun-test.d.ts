declare module 'bun:test' {
  export const afterEach: (fn: () => void | Promise<void>) => void;
  export const describe: (name: string, fn: () => void) => void;
  export const expect: (value: unknown) => {
    toBe(expected: unknown): void;
    toBeDefined(): void;
    toBeGreaterThan(expected: number): void;
    toContain(expected: string): void;
    toEqual(expected: unknown): void;
    not: { toContain(expected: string): void; toThrow(): void };
  };
  export const test: {
    (name: string, fn: () => void | Promise<void>, timeout?: number): void;
    skip(name: string, fn: () => void | Promise<void>): void;
  };
}
