import { Injectable } from '@nestjs/common';
import { UsersService } from '../users/users.service.js';

@Injectable()
export class PresenceService {
  constructor(private readonly usersService: UsersService) {}

  async ping(userId: string) {
    await this.usersService.ping(userId);
    return { success: true };
  }
}
