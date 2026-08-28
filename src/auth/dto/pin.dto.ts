import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class VerifyPinDto {
  @ApiProperty({ example: '1234' })
  @IsString()
  @Matches(/^\d{4}$/, { message: 'PIN must be 4 digits' })
  pin: string;
}

export class ChangePinDto {
  @ApiProperty({ description: 'Your account password' })
  @IsString()
  @IsNotEmpty()
  password: string;

  @ApiProperty({ example: '1234' })
  @IsString()
  @Matches(/^\d{4}$/, { message: 'PIN must be 4 digits' })
  newPin: string;
}
