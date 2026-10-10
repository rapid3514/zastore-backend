import { request } from 'node:https';
import type { TelegramApiResponse } from './telegram.types.js';

interface TelegramHttpResponse<T> {
  statusCode: number;
  payload: TelegramApiResponse<T>;
}

export function postTelegram<T>(
  token: string,
  method: string,
  body: Record<string, unknown>,
): Promise<TelegramHttpResponse<T>> {
  return postOnce(token, method, body);
}

function postOnce<T>(
  token: string,
  method: string,
  body: Record<string, unknown>,
): Promise<TelegramHttpResponse<T>> {
  const data = JSON.stringify(body);

  return new Promise((resolve, reject) => {
    const apiRequest = request(
      {
        hostname: 'api.telegram.org',
        path: `/bot${token}/${method}`,
        method: 'POST',
        family: 4,
        timeout: 8_000,
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(data),
        },
      },
      (response) => {
        response.setEncoding('utf8');
        let responseBody = '';

        response.on('data', (chunk: string) => {
          responseBody += chunk;
          if (Buffer.byteLength(responseBody) > 1024 * 1024) apiRequest.destroy(new Error('Telegram response exceeds limit'));
        });
        response.on('error', reject);
        response.on('end', () => {
          try {
            resolve({
              statusCode: response.statusCode ?? 502,
              payload: JSON.parse(responseBody) as TelegramApiResponse<T>,
            });
          } catch (error) {
            reject(error);
          }
        });
      },
    );

    apiRequest.on('timeout', () => {
      apiRequest.destroy(new Error('Telegram API request timed out'));
    });
    apiRequest.on('error', reject);
    apiRequest.end(data);
  });
}
