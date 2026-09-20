import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthenticatedOnly } from '../../security/decorators/authenticated-only.decorator';
import { LifecycleRegistry } from './lifecycle.registry';

@ApiTags('Lifecycle')
@Controller('lifecycles')
export class LifecycleController {
  constructor(private readonly registry: LifecycleRegistry) {}

  @Get()
  @AuthenticatedOnly(
    'Son las reglas del producto, no datos de ningún inquilino: qué etapas tiene una orden de ' +
      'compra y en qué orden. Idénticas para todo el mundo, y ya visibles en cualquier pantalla ' +
      'que muestre un documento. Exigir un permiso para leerlas obligaría a la interfaz a ' +
      'reescribirlas por su cuenta, que es como se acaban teniendo dos versiones de la verdad.',
  )
  @ApiOperation({ summary: 'Los ciclos de vida declarados' })
  all() {
    return this.registry.all();
  }

  @Get(':documentType')
  @AuthenticatedOnly('Mismas reglas del producto que la lista completa, para un solo documento.')
  @ApiOperation({ summary: 'El ciclo de vida de un tipo de documento' })
  one(@Param('documentType') documentType: string) {
    const lifecycle = this.registry.get(documentType);
    if (!lifecycle) {
      // 404 y no una respuesta vacía: «este documento no declara su vida» y «este documento no
      // existe» son cosas distintas, y la interfaz decide distinto ante cada una.
      throw new NotFoundException(`Sin ciclo de vida declarado para "${documentType}"`);
    }
    return lifecycle;
  }
}
