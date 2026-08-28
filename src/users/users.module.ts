import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminController } from './admin.controller';
import { UsersService } from './users.service';

@Module({
  imports: [AuthModule],
  controllers: [AdminController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
