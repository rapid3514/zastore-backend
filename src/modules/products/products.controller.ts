import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { UserRole } from '../../generated/prisma/client.js';
import { CreateProductDto } from './dto/create-product.dto.js';
import { QueryProductsDto } from './dto/query-products.dto.js';
import { UpdateProductDto } from './dto/update-product.dto.js';
import { ProductsService } from './products.service.js';

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  findPublic(@Query() query: QueryProductsDto) {
    return this.productsService.findPublic(query);
  }

  @Get('manage')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  findForAdmin(@Query() query: QueryProductsDto) {
    return this.productsService.findForAdmin(query);
  }

  @Get('manage/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  findOneForAdmin(@Param('id', ParseUUIDPipe) id: string) {
    return this.productsService.findOneForAdmin(id);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  create(@Body() input: CreateProductDto) {
    return this.productsService.create(input);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: UpdateProductDto,
  ) {
    return this.productsService.update(id, input);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.productsService.remove(id);
  }

  @Get(':id')
  findOnePublic(@Param('id', ParseUUIDPipe) id: string) {
    return this.productsService.findOnePublic(id);
  }
}
