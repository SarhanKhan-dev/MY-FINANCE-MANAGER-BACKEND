import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, Length, Matches } from 'class-validator';

export class CreateUserDto {
  @ApiProperty({ example: 'sarhan321@', minLength: 3, maxLength: 32 })
  @IsString()
  @Length(3, 32)
  @Matches(/^\S+$/, { message: 'Username cannot contain spaces' })
  username: string;

  @ApiProperty({ minLength: 1, maxLength: 80 })
  @IsString()
  @Length(1, 80)
  name: string;

  @ApiProperty({ description: 'Login email — also receives notifications and the PIN' })
  @IsEmail()
  email: string;
}
