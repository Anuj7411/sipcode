/**
 * Clock seam — pure code receives a Clock; tests inject FakeClock for
 * deterministic dates.
 */
export interface Clock {
  now(): Date;
}

export class RealClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class FakeClock implements Clock {
  constructor(private current: Date) {}
  now(): Date {
    return new Date(this.current.getTime());
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
  set(d: Date): void {
    this.current = new Date(d.getTime());
  }
}
