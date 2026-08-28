import { ApiProperty } from '@nestjs/swagger';
import { UserDto } from './user.dto';

export class CreatedUserResponseDto {
  @ApiProperty({ type: UserDto }) user: UserDto;
  @ApiProperty({
    description:
      'Set-password link for the new user — sent by email automatically once email sending is live; until then share it with them yourself',
  })
  setPasswordLink: string;
}

export class ResetPasswordResponseDto {
  @ApiProperty({ description: 'Password reset link — single use, expires in 24 hours' })
  setPasswordLink: string;
}

export class AuditEntryDto {
  @ApiProperty() id: string;
  @ApiProperty() actorEmail: string;
  @ApiProperty() action: string;
  @ApiProperty() targetEmail: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
}
