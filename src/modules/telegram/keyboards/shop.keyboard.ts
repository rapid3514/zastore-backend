export function shopKeyboard(miniAppUrl: string): Record<string, unknown> {
  return {
    inline_keyboard: [
      [
        {
          text: '🛒 Mini App ni ochish',
          web_app: { url: miniAppUrl },
        },
      ],
    ],
  };
}
