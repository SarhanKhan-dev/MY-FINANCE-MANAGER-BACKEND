import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Length, Matches } from 'class-validator';
import { UserDto } from '../../users/dto/user.dto';

export class SignupDto {
  @ApiProperty({ example: 'Ayesha Khan', minLength: 1, maxLength: 60 })
  @IsString()
  @Length(1, 60)
  name: string;

  @ApiProperty({ example: 'ayesha_k', minLength: 3, maxLength: 30 })
  @IsString()
  @Length(3, 30)
  @Matches(/^[a-z0-9@._-]+$/i, {
    message: 'Username can use letters, numbers and @ . _ -',
  })
  username: string;

  @ApiProperty({ example: 'ayesha@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ minLength: 8, maxLength: 72 })
  @IsString()
  @Length(8, 72)
  password: string;
}

export class SignupResponseDto {
  @ApiProperty({ type: UserDto })
  user: UserDto;

  @ApiProperty({ description: 'The 4-digit PIN, shown exactly once' })
  pin: string;
}

export class RequestResetDto {
  @ApiProperty({ description: 'Username or email' })
  @IsString()
  @Length(1, 120)
  identifier: string;
}

export class ChangeEmailDto {
  @ApiProperty()
  @IsString()
  @Length(1, 72)
  password: string;

  @ApiProperty()
  @IsEmail()
  newEmail: string;
}
