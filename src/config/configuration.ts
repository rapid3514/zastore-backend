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
});
