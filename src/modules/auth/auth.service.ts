import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import { UserRole, type User } from '../../generated/prisma/client.js';
import type { AuthenticatedUser } from '../../common/types/auth-user.type.js';
import { UsersService } from '../users/users.service.js';
import { AuthRepository } from './auth.repository.js';
import { TelegramInitDataService } from './services/telegram-init-data.service.js';
import {
  TokenService,
  type AccessTokenPayload,
  type RefreshTokenPayload,
} from './services/token.service.js';

interface AuthResult {
  body: Record<string, unknown>;
  refreshToken?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly authRepository: AuthRepository,
    private readonly telegramInitDataService: TelegramInitDataService,
    private readonly tokenService: TokenService,
  ) {}

  async authenticateCustomer(initData: string): Promise<AuthResult> {
    const telegramUser = this.telegramInitDataService.verify(initData);
    const user = await this.usersService.findByTelegramId(telegramUser.id);
    if (!user) {
      return { body: { registered: false, registrationRequired: true } };
    }
    if (user.isBlocked) {
      throw new ForbiddenException('User account is blocked');
    }
    if (!user.phone || !user.phoneVerifiedAt) {
      return { body: { registered: false, registrationRequired: true } };
    }
    return this.issueForUser(user);
  }

  async authenticateAdmin(initData: string): Promise<AuthResult> {
    const telegramUser = this.telegramInitDataService.verify(initData);
    const user = await this.usersService.findByTelegramId(telegramUser.id);
    if (
      !user ||
      user.isBlocked ||
      (user.role !== UserRole.ADMIN && user.role !== UserRole.SUPER_ADMIN)
    ) {
      throw new ForbiddenException('Admin access is not available');
    }
    return this.issueForUser(user);
  }

  async refresh(refreshToken: string): Promise<AuthResult> {
    const payload = await this.tokenService.verifyRefresh(refreshToken);
    if (!payload.sid) {
      throw new UnauthorizedException('Invalid refresh session');
    }
    const session = await this.authRepository.findRefreshSession(payload.sid);
    if (
      !session ||
      session.expiresAt <= new Date() ||
      session.userId !== payload.sub ||
      session.familyId !== payload.fid
    ) {
      throw new UnauthorizedException('Invalid refresh session');
    }
    if (!(await argon2.verify(session.tokenHash, refreshToken))) {
      throw new UnauthorizedException('Invalid refresh session');
    }
    if (session.revokedAt) {
      await this.authRepository.revokeRefreshFamily(
        session.familyId,
        session.userId,
      );
      throw new UnauthorizedException('Invalid refresh session');
    }
    const user = await this.usersService.findById(payload.sub);
    if (!user || user.isBlocked) {
      await this.authRepository.revokeRefreshFamily(
        session.familyId,
        session.userId,
      );
      throw new UnauthorizedException('Invalid refresh session');
    }
    const accessPayload = this.accessPayload(user);
    const replacement = await this.prepareRefreshSession(
      accessPayload,
      session.familyId,
      session.id,
    );
    const rotated = await this.authRepository.rotateRefreshSession(
      session.id,
      replacement.session,
    );
    // A request that observed an active token but lost the atomic consume race
    // must not revoke the successful concurrent request's replacement.
    if (!rotated) throw new UnauthorizedException('Invalid refresh session');
    return this.authResult(user, accessPayload, replacement.token);
  }

  async logout(refreshToken: string): Promise<void> {
    const payload = await this.tokenService.verifyRefresh(refreshToken);
    const session = await this.authRepository.findRefreshSession(payload.sid);
    if (
      session &&
      session.userId === payload.sub &&
      session.familyId === payload.fid &&
      (await argon2.verify(session.tokenHash, refreshToken))
    ) {
      await this.authRepository.revokeRefreshFamily(session.familyId, session.userId);
    }
  }

  async me(subject: AuthenticatedUser): Promise<Record<string, unknown>> {
    const user = await this.usersService.findById(subject.sub);
    if (!user || user.isBlocked) {
      throw new UnauthorizedException('Invalid access token');
    }
    return { user: this.presentUser(user) };
  }

  refreshCookieMaxAge(): number {
    return this.tokenService.refreshExpiresAt().getTime() - Date.now();
  }

  private async issueForUser(user: User): Promise<AuthResult> {
    const accessPayload = this.accessPayload(user);
    const refreshToken = await this.createRefreshToken(accessPayload);
    return this.authResult(user, accessPayload, refreshToken);
  }

  private accessPayload(user: User): AccessTokenPayload {
    return {
      sub: user.id,
      telegramId: user.telegramId.toString(),
      role: user.role,
    };
  }

  private async authResult(
    user: User,
    accessPayload: AccessTokenPayload,
    refreshToken: string,
  ): Promise<AuthResult> {
    return {
      refreshToken,
      body: {
        registered: true,
        accessToken: await this.tokenService.signAccess(accessPayload),
        user: this.presentUser(user),
      },
    };
  }

  private async createRefreshToken(
    accessPayload: AccessTokenPayload,
  ): Promise<string> {
    const prepared = await this.prepareRefreshSession(accessPayload);
    await this.authRepository.createRefreshSession(prepared.session);
    return prepared.token;
  }

  private async prepareRefreshSession(
    accessPayload: AccessTokenPayload,
    familyId?: string,
    parentId?: string,
  ) {
    const sid = randomUUID();
    const fid = familyId ?? sid;
    const payload: RefreshTokenPayload = { ...accessPayload, sid, fid };
    const token = await this.tokenService.signRefresh(payload);
    return {
      token,
      session: {
        id: sid,
        familyId: fid,
        parentId,
        tokenHash: await argon2.hash(token),
        expiresAt: this.tokenService.refreshExpiresAt(),
        userId: accessPayload.sub,
      },
    };
  }

  private presentUser(user: User): Record<string, unknown> {
    return {
      id: user.id,
      telegramId: user.telegramId.toString(),
      firstName: user.firstName,
      lastName: user.lastName,
      username: user.username,
      phone: user.phone,
      phoneVerifiedAt: user.phoneVerifiedAt,
      avatarUrl: user.avatarUrl,
      role: user.role,
      isBlocked: user.isBlocked,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
