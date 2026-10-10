import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import type { AuthenticatedUser } from '../../common/types/auth-user.type.js';
import { TelegramAuthDto } from './dto/telegram-auth.dto.js';
import { AuthService } from './auth.service.js';
import { getConfiguration } from '../../config/configuration.js';

const REFRESH_COOKIE = 'refresh_token';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Post('telegram')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async telegram(
    @Body() dto: TelegramAuthDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.authenticateCustomer(dto.initData);
    this.setRefreshCookie(response, result.refreshToken);
    return result.body;
  }

  @Post('admin/telegram')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async adminTelegram(
    @Body() dto: TelegramAuthDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.authenticateAdmin(dto.initData);
    this.setRefreshCookie(response, result.refreshToken);
    return result.body;
  }

  @Post('refresh')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.refresh(
      this.getRefreshToken(request),
    );
    this.setRefreshCookie(response, result.refreshToken);
    return result.body;
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    try {
      await this.authService.logout(this.getRefreshToken(request));
    } finally {
      response.clearCookie(REFRESH_COOKIE, this.cookieOptions());
    }
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.me(user);
  }

  private getRefreshToken(request: Request): string {
    const rawCookie = request.headers.cookie ?? '';
    const cookie = rawCookie
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${REFRESH_COOKIE}=`));
    if (!cookie) return '';
    try {
      return decodeURIComponent(cookie.slice(`${REFRESH_COOKIE}=`.length));
    } catch {
      throw new UnauthorizedException('Invalid refresh session');
    }
  }

  private setRefreshCookie(response: Response, token?: string): void {
    if (!token) return;
    response.cookie(REFRESH_COOKIE, token, {
      ...this.cookieOptions(),
      maxAge: this.authService.refreshCookieMaxAge(),
    });
  }

  private cookieOptions() {
    const config = getConfiguration(this.configService).app;
    return {
      httpOnly: true,
      secure: config.isProduction,
      sameSite: 'lax' as const,
      path: `/${config.apiPrefix}/auth`,
    };
  }
}
