import { Module } from '@nestjs/common';
import { RabbitPublisher } from './rabbit.publisher';

@Module({
  providers: [RabbitPublisher],
  exports: [RabbitPublisher],
})
export class MessagingModule {}
