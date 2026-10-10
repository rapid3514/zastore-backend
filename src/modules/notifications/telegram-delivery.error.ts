export type TelegramDeliveryOutcome = 'retryable' | 'permanent' | 'uncertain';

export class TelegramDeliveryError extends Error {
  constructor(
    readonly outcome: TelegramDeliveryOutcome,
    readonly code: string,
    readonly retryAfterSeconds?: number,
  ) {
    super('Telegram delivery failed');
    this.name = 'TelegramDeliveryError';
  }
}
