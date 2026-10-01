import { ROOM } from '@orb/shared';

/**
 * Fixed one-second window per socket. Honest clients send ~2-10 msgs/s
 * (input changes only), so the limits are generous but stop floods.
 */
export class RateLimiter {
  private windowStart = 0;
  private count = 0;

  constructor(
    private readonly soft = ROOM.maxMessagesPerSecond,
    private readonly hard = ROOM.kickMessagesPerSecond,
  ) {}

  hit(now: number): 'ok' | 'drop' | 'kick' {
    if (now - this.windowStart >= 1000) {
      this.windowStart = now;
      this.count = 0;
    }
    this.count++;
    if (this.count > this.hard) return 'kick';
    if (this.count > this.soft) return 'drop';
    return 'ok';
  }
}
