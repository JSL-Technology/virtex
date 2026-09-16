/**
 * Barrel re-export for backward compatibility.
 *
 * `Location`, `StockItem`, and `StockMovement` now live in supply-chain/entities/ because they
 * describe warehouse state, not the product catalogue. Imports that still reference this path
 * continue to work. New code should import directly from supply-chain/entities/.
 */
export { Location } from '../../supply-chain/entities/location.entity';
export { StockItem } from '../../supply-chain/entities/stock-item.entity';
export { StockMovement } from '../../supply-chain/entities/stock-movement.entity';
