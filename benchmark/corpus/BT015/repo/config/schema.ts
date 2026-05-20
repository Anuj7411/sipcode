export type Config = { region: string; log_level: 'debug'|'info'|'warn'|'error'; retry_max: number; cache_ttl: number; queue_depth: number; sampling_rate: number; concurrency: number };
