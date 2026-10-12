import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class OrderItemDto {
  @IsString()
  @IsNotEmpty()
  sku = '';

  @IsInt()
  @Min(1)
  qty = 0;

  @IsInt()
  @Min(1)
  priceCents = 0;
}

export class CreateOrderDto {
  @IsString()
  @IsNotEmpty()
  customerId = '';

  @IsString()
  @IsNotEmpty()
  address = '';

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[] = [];
}
