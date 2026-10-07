import ImageKit, {
  NotFoundError,
  type ImageKit as ImageKitTypes,
} from '@imagekit/nodejs';
import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const imageNotFound = () =>
  new NotFoundException({
    error: 'IMAGE_NOT_FOUND',
    message: 'ImageKit fayli topilmadi',
  });

@Injectable()
export class ImageKitService {
  private readonly logger = new Logger(ImageKitService.name);
  private readonly client?: ImageKit;

  constructor(private readonly configService: ConfigService) {
    const privateKey = this.configService.get<string>('IMAGEKIT_PRIVATE_KEY');
    if (privateKey) {
      this.client = new ImageKit({
        privateKey,
        timeout: 8_000,
        maxRetries: 2,
        logLevel: 'off',
      });
    }
  }

  getUploadAuthentication() {
    const client = this.getClient();
    const expire = Math.floor(Date.now() / 1000) + 5 * 60;
    return client.helper.getAuthenticationParameters(undefined, expire);
  }

  async getFile(fileId: string): Promise<ImageKitTypes.File> {
    try {
      return await this.getClient().files.get(fileId);
    } catch (error) {
      if (
        error instanceof NotFoundError ||
        (typeof error === 'object' &&
          error !== null &&
          'status' in error &&
          error.status === 404)
      ) {
        throw imageNotFound();
      }
      this.logger.error('ImageKit asset lookup failed');
      throw new ServiceUnavailableException({
        error: 'IMAGEKIT_UNAVAILABLE',
        message: 'ImageKit xizmati vaqtincha ishlamayapti',
      });
    }
  }

  async deleteFile(fileId: string): Promise<void> {
    try {
      await this.getClient().files.delete(fileId);
    } catch (error) {
      if (
        error instanceof NotFoundError ||
        (typeof error === 'object' &&
          error !== null &&
          'status' in error &&
          error.status === 404)
      ) {
        throw imageNotFound();
      }
      this.logger.error('ImageKit asset delete failed');
      throw new ServiceUnavailableException({
        error: 'IMAGEKIT_UNAVAILABLE',
        message: 'ImageKit xizmati vaqtincha ishlamayapti',
      });
    }
  }

  private getClient(): ImageKit {
    if (!this.client) {
      throw new ServiceUnavailableException({
        error: 'IMAGEKIT_NOT_CONFIGURED',
        message: 'ImageKit konfiguratsiyasi mavjud emas',
      });
    }
    return this.client;
  }
}
