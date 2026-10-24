import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';
import { User } from '../entities/user.entity/user.entity';

/**
 * Un destino del menú que una persona marcó como favorito en una empresa.
 *
 * Solo la ruta y su posición: el rótulo y el icono los pone el cliente desde el manifiesto, así
 * que se traducen y siguen a la pantalla si cambia de nombre. Ver la migración
 * `UserNavigationFavorites1789140200000` para el porqué de una fila por favorito.
 */
@Entity({ name: 'user_navigation_favorites' })
@Unique('UQ_user_navigation_favorites_owner_route', ['organizationId', 'userId', 'route'])
@Index('IDX_user_navigation_favorites_owner_position', ['organizationId', 'userId', 'position'])
export class UserNavigationFavorite {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @TenantOwned('FK_user_navigation_favorites_organization')
  organization?: TenantRef;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'FK_user_navigation_favorites_user' })
  user?: User;

  /** La ruta del menú, sin la empresa: `/accounting/journals`. */
  @Column({ type: 'varchar', length: 200 })
  route: string;

  @Column({ type: 'int' })
  position: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
