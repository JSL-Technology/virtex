import { IsString, IsOptional, IsArray, IsObject } from 'class-validator';
import { Transform } from 'class-transformer';


const CommaSeparatedToArray = () => {
  return Transform(({ value }) => {
    if (typeof value === 'string') {
      return value.split(',').map(item => item.trim());
    }
    return value;
  });
};


const JsonStringToObject = () => {
    return Transform(({ value }) => {
        if (typeof value === 'string') {
            try {
                return JSON.parse(value);
            } catch (e) {
                return undefined;
            }
        }
        return value;
    });
}

export class SalesQueryDto {
  @IsArray()
  @IsString({ each: true })
  @CommaSeparatedToArray()
  dimensions: string[];

  @IsArray()
  @IsString({ each: true })
  @CommaSeparatedToArray()
  measures: string[];

  @IsOptional()
  @IsObject()
  @JsonStringToObject()
  filters?: { [key: string]: any };
}
