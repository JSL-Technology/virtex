import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateProductDto } from './create-product.dto';

/**
 * Editing the catalogue entry — never what is held.
 *
 * `stock` stays accepted only so an old client gets a clear refusal rather than a schema error:
 * changing the quantity on hand is an inventory adjustment, a document with a warehouse, a reason
 * and its own entry (`POST /inventory/adjustments`). The unit cost likewise, once there is stock
 * to revalue. See `InventoryService.update`.
 */
export class UpdateProductDto extends PartialType(OmitType(CreateProductDto, ['warehouseId'] as const)) {}
