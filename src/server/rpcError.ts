export class RpcError extends Error {
  constructor(public code: number, message: string) { super(message); }
}
export const rpcError = (id: unknown, code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } });
