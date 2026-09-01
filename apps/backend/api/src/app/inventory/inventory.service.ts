import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { Product } from './entities/product.entity';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

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
      throw new NotFoundException(`Producto con ID "${id}" no encontrado.`);
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

  /**
   * Move stock out, under a row lock and scoped to the tenant.
   *
   * Two defects fixed together. It read the product with `findOneBy`, checked the balance and saved
   * — a read-modify-write with no lock, so two concurrent sales of the last unit both saw stock and
   * both succeeded, overselling it. And it did not filter by organization, so the caller's tenant
   * scoping was the only thing standing between a product id and another tenant's inventory.
   *
   * `SELECT … FOR UPDATE` serialises the two transactions; the second waits and then sees the
   * decremented balance.
   */
  async decreaseStock(
    productId: string,
    quantity: number,
    manager: EntityManager,
    organizationId: string,
  ): Promise<void> {
    const product = await this.lockProduct(productId, organizationId, manager);

    const available = Number(product.stock);
    if (available < quantity) {
      throw new BadRequestException(
        `Stock insuficiente para "${product.name}": disponibles ${available}, solicitadas ${quantity}.`,
      );
    }

    product.stock = available - quantity;
    await manager.save(Product, product);
  }

  /** Move stock back in — a return, a credit note that restocks — under the same lock. */
  async increaseStock(
    productId: string,
    quantity: number,
    manager: EntityManager,
    organizationId: string,
  ): Promise<void> {
    const product = await this.lockProduct(productId, organizationId, manager);
    product.stock = Number(product.stock) + quantity;
    await manager.save(Product, product);
  }

  private async lockProduct(
    productId: string,
    organizationId: string,
    manager: EntityManager,
  ): Promise<Product> {
    const product = await manager
      .createQueryBuilder(Product, 'product')
      .where('product.id = :productId', { productId })
      .andWhere('product.organizationId = :organizationId', { organizationId })
      .setLock('pessimistic_write')
      .getOne();

    if (!product) {
      throw new NotFoundException(
        `Producto con ID "${productId}" no encontrado en esta organización.`,
      );
    }
    return product;
  }
}
