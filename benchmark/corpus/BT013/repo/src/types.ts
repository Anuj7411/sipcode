export type RequestOpts = { timeout?: number; retries?: number; auth?: { token: string } };
export type Response = { status: number; body: unknown };
export type RetryPolicy = { max: number; backoff: 'linear' | 'exp' };
