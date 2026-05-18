/**
 * Process / environment seam — env vars, home dir, platform.
 */
export interface ProcessEnv {
  /** Returns the value of an env var, or undefined if unset / empty. */
  get(name: string): string | undefined;
  /** "win32" | "darwin" | "linux" | "freebsd" | "openbsd" | ... */
  platform(): NodeJS.Platform;
  /** User's home directory. */
  homeDir(): string;
}

export class RealProcessEnv implements ProcessEnv {
  get(name: string): string | undefined {
    const v = process.env[name];
    return v && v.length > 0 ? v : undefined;
  }
  platform(): NodeJS.Platform {
    return process.platform;
  }
  homeDir(): string {
    const home = process.env["HOME"] ?? process.env["USERPROFILE"];
    if (home && home.length > 0) return home;
    // Fallback to os.homedir() — imported lazily so tests stay isolated.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("node:os").homedir() as string;
  }
}

export interface FakeProcessEnvInit {
  vars?: Record<string, string>;
  platform?: NodeJS.Platform;
  homeDir?: string;
}

export class FakeProcessEnv implements ProcessEnv {
  private vars: Map<string, string>;
  private _platform: NodeJS.Platform;
  private _homeDir: string;

  constructor(init: FakeProcessEnvInit = {}) {
    this.vars = new Map(Object.entries(init.vars ?? {}));
    this._platform = init.platform ?? "linux";
    this._homeDir = init.homeDir ?? "/home/test";
  }
  get(name: string): string | undefined {
    return this.vars.get(name);
  }
  set(name: string, value: string): void {
    this.vars.set(name, value);
  }
  platform(): NodeJS.Platform {
    return this._platform;
  }
  homeDir(): string {
    return this._homeDir;
  }
}
