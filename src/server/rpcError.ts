export class RpcError extends Error {
  constructor(public code: number, message: string, public data?: unknown) { super(message); }
}
export const rpcError = (id: unknown, code: number, message: string, data?: unknown) => ({ jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } });
