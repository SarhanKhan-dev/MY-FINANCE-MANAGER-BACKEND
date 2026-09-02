import { ApiProperty } from '@nestjs/swagger';
import { Role, UserStatus } from '@prisma/client';
import { SafeUser } from '../../common/types/safe-user';

export class UserDto {
  @ApiProperty() id: string;
  @ApiProperty({ example: 'shams123@' }) username: string;
  @ApiProperty({ type: String, nullable: true, description: 'Used only for notification emails' })
  email: string | null;
  @ApiProperty() name: string;
  @ApiProperty({ enum: Role }) role: Role;
  @ApiProperty({ enum: UserStatus }) status: UserStatus;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  onboardedAt: Date | null;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  lastLoginAt: Date | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
  @ApiProperty() aiEnabled: boolean;

  static from(user: SafeUser): UserDto {
    const dto = new UserDto();
    dto.id = user.id;
    dto.username = user.username;
    dto.email = user.email;
    dto.name = user.name;
    dto.role = user.role;
    dto.status = user.status;
    dto.onboardedAt = user.onboardedAt;
    dto.lastLoginAt = user.lastLoginAt;
    dto.createdAt = user.createdAt;
    dto.aiEnabled = user.aiEnabled;
    return dto;
  }
}
