import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { Product } from './entities/product.entity';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { BadRequestError, NotFoundError } from '../i18n/localized.exception';

@Injectable()
export class InventoryService {
  constructor(
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
  ) {}

  create(createProductDto: CreateProductDto, organizationId: string): Promise<Product> {
    const product = this.productRepository.create({
      ...createProductDto,
      organizationId,
    });
    return this.productRepository.save(product);
  }

  findAll(organizationId: string): Promise<Product[]> {
    return this.productRepository.find({
      where: { organizationId },
      order: { name: 'ASC' },
    });
  }

  async findOne(id: string, organizationId: string): Promise<Product> {
    const product = await this.productRepository.findOne({
      where: { id, organizationId },
    });
    if (!product) {
      throw new NotFoundError('INVENTORY.PRODUCTO_ID_NO_ENCONTRADO', { id });
    }
    return product;
  }

  async update(id: string, updateProductDto: UpdateProductDto, organizationId: string): Promise<Product> {
    const product = await this.findOne(id, organizationId);
    const updatedProduct = this.productRepository.merge(
      product,
      updateProductDto,
    );
    return this.productRepository.save(updatedProduct);
  }

  async remove(id: string, organizationId: string): Promise<void> {
    const product = await this.findOne(id, organizationId);
    await this.productRepository.remove(product);
  }

  async decreaseStock(productId: string, quantity: number, manager: EntityManager): Promise<void> {
    const product = await manager.findOneBy(Product, { id: productId });

    if (!product) {
      throw new NotFoundError('INVENTORY.PRODUCTO_ID_NO_ENCONTRADO_TRANSACCION', { productId });
    }

    if (product.stock < quantity) {
      throw new BadRequestError('INVENTORY.STOCK_INSUFICIENTE_PRODUCTO', { name: product.name });
    }

    product.stock -= quantity;
    await manager.save(Product, product);
  }

  async increaseStock(productId: string, quantity: number, manager: EntityManager): Promise<void> {
      const product = await manager.findOneBy(Product, { id: productId });

      if (!product) {
          throw new NotFoundError('INVENTORY.PRODUCTO_ID_NO_ENCONTRADO_TRANSACCION', { productId });
      }

      product.stock += quantity;
      await manager.save(Product, product);
  }
}