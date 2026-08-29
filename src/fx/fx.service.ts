import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

const CACHE_TTL_MS = 60 * 60 * 1000;
const SOURCE_URL = 'https://open.er-api.com/v6/latest/USD';

interface CachedRate {
  rate: number;
  fetchedAt: Date;
}

@Injectable()
export class FxService {
  private readonly logger = new Logger(FxService.name);
  private cached: CachedRate | null = null;

  async usdToPkr(): Promise<CachedRate> {
    if (this.cached && Date.now() - this.cached.fetchedAt.getTime() < CACHE_TTL_MS) {
      return this.cached;
    }
    try {
      const response = await fetch(SOURCE_URL, { signal: AbortSignal.timeout(6000) });
      const body = (await response.json()) as { rates?: { PKR?: number } };
      const rate = body.rates?.PKR;
      if (!rate || !Number.isFinite(rate)) {
        throw new Error('No PKR rate in response');
      }
      this.cached = { rate, fetchedAt: new Date() };
      return this.cached;
    } catch (error) {
      this.logger.warn(`FX fetch failed: ${error instanceof Error ? error.message : error}`);
      if (this.cached) return this.cached;
      throw new ServiceUnavailableException('Rate unavailable — enter it yourself');
    }
  }

  /** Best-effort rate for display math; null when nothing is available. */
  async usdToPkrOrNull(): Promise<number | null> {
    try {
      return (await this.usdToPkr()).rate;
    } catch {
      return null;
    }
  }
}
