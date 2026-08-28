import { ApiProperty } from '@nestjs/swagger';
import { UserDto } from '../../users/dto/user.dto';

export class LoginResponseDto {
  @ApiProperty() accessToken: string;
  @ApiProperty({ type: UserDto }) user: UserDto;
}
