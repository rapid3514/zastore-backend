export default () => ({
  app: {
    port: Number(process.env.PORT),
    apiPrefix: process.env.API_PREFIX ?? 'api/v1',
    corsOrigins: (process.env.CORS_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  },
  auth: {
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN,
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN,
  },
  imageKit: {
    publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
    urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT,
    productFolder: process.env.IMAGEKIT_PRODUCT_FOLDER ?? '/products',
    // Deprecated compatibility value. Provider/account limits are authoritative.
    maxImageBytes: Number(process.env.IMAGEKIT_MAX_IMAGE_BYTES ?? 0),
  },
  telegram: {
    channelId: process.env.TELEGRAM_CHANNEL_ID,
    shopUrl: process.env.TELEGRAM_SHOP_URL,
    botUsername: process.env.TELEGRAM_BOT_USERNAME,
    miniAppShortName: process.env.TELEGRAM_MINI_APP_SHORT_NAME,
    miniAppUseMain: process.env.TELEGRAM_MINI_APP_USE_MAIN === 'true',
  },
});
