import type { RequestOpts, Response } from './types.js';
export class Client {
  constructor(public opts: RequestOpts) {}
  request(_method: string, _path: string, _body?: unknown): Promise<Response> { return Promise.resolve({} as Response); }
  close() {}
}
