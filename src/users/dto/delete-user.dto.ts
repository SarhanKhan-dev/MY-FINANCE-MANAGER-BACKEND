import { ApiProperty } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';

export class DeleteUserDto {
  @ApiProperty({ description: "The account's exact email, typed again to confirm" })
  @IsEmail()
  confirmEmail: string;
}
