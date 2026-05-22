
import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UnitOfMeasure } from '../../units-of-measure/entities/unit-of-measure.entity';

@Injectable()
export class UomSeederService implements OnModuleInit {
  constructor(
    @InjectRepository(UnitOfMeasure)
    private readonly uomRepository: Repository<UnitOfMeasure>,
  ) {}

  async onModuleInit() {
    const count = await this.uomRepository.count();
    if (count === 0) {
      await this.seed();
    }
  }

  async seed() {
    const units = [

      { symbol: 'g', category: 'Weight', nameKey: 'uom.weight.gram' },
      { symbol: 'kg', category: 'Weight', nameKey: 'uom.weight.kilogram' },
      { symbol: 'lb', category: 'Weight', nameKey: 'uom.weight.pound' },
      { symbol: 'oz', category: 'Weight', nameKey: 'uom.weight.ounce' },


      { symbol: 'm', category: 'Length', nameKey: 'uom.length.meter' },
      { symbol: 'cm', category: 'Length', nameKey: 'uom.length.centimeter' },
      { symbol: 'in', category: 'Length', nameKey: 'uom.length.inch' },
      { symbol: 'ft', category: 'Length', nameKey: 'uom.length.foot' },
      

      { symbol: 'l', category: 'Volume', nameKey: 'uom.volume.liter' },
      { symbol: 'ml', category: 'Volume', nameKey: 'uom.volume.milliliter' },
      { symbol: 'gal', category: 'Volume', nameKey: 'uom.volume.gallon' },
      

      { symbol: 'unit', category: 'Units', nameKey: 'uom.units.unit' },
      { symbol: 'dozen', category: 'Units', nameKey: 'uom.units.dozen' },
      { symbol: 'box', category: 'Units', nameKey: 'uom.units.box' },
      { symbol: 'pack', category: 'Units', nameKey: 'uom.units.pack' },
      { symbol: 'pair', category: 'Units', nameKey: 'uom.units.pair' },
      { symbol: 'set', category: 'Units', nameKey: 'uom.units.set' },


      { symbol: 'hr', category: 'Time', nameKey: 'uom.time.hour' },
      { symbol: 'day', category: 'Time', nameKey: 'uom.time.day' },
    ];

    for (const unitData of units) {
      const uom = this.uomRepository.create(unitData);
      await this.uomRepository.save(uom);
    }
  }
}