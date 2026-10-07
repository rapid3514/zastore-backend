import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  UseGuards,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { UserRole } from '../../generated/prisma/client.js';
import { MediaService } from './media.service.js';

@Controller('media/imagekit')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Get('upload-auth')
  getUploadAuth() {
    return this.mediaService.getImageKitUploadAuth();
  }

  @Delete(':fileId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeUnassigned(@Param('fileId') fileId: string) {
    return this.mediaService.deleteUnassignedImage(fileId);
  }
}
