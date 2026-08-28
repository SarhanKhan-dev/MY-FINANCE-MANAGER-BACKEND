import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class DeleteUserDto {
  @ApiProperty({ description: "The account's exact username, typed again to confirm" })
  @IsString()
  @IsNotEmpty()
  confirmUsername: string;
}
