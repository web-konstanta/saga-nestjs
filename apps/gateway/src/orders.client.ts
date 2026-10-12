import {
  BadGatewayException,
  HttpException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const REQUEST_TIMEOUT_MS = 5_000;

/**
 * Client for the orders read side (GET /sagas). orders is an internal service:
 * the browser never talks to it, only the gateway does.
 *
 * Errors from orders (404, 400) are passed through with their status and body;
 * an unreachable orders becomes 502.
 */
@Injectable()
export class OrdersClient {
  private readonly logger = new Logger(OrdersClient.name);
  private readonly baseUrl: string;

  constructor(config: ConfigService) {
    this.baseUrl = config.get('ORDERS_URL', 'http://localhost:3001');
  }

  async get<T>(path: string): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (e) {
      this.logger.warn(`GET ${path}: orders unreachable (${String(e)})`);
      throw new BadGatewayException('orders service is unavailable');
    }

    const body: unknown = await res.json().catch(() => undefined);

    if (!res.ok) {
      throw new HttpException(
        (body as Record<string, unknown> | undefined) ?? res.statusText,
        res.status,
      );
    }

    return body as T;
  }
}
