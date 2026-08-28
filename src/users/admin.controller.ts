import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Role, UserStatus } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { SafeUser } from '../common/types/safe-user';
import {
  AuditEntryDto,
  CreatedUserResponseDto,
  ResetPasswordResponseDto,
} from './dto/admin-responses.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { DeleteUserDto } from './dto/delete-user.dto';
import { UserDto } from './dto/user.dto';
import { UsersService } from './users.service';

@ApiTags('admin')
@ApiBearerAuth()
@Roles(Role.SUPERADMIN)
@Controller('admin')
export class AdminController {
  constructor(private readonly usersService: UsersService) {}

  @Get('users')
  @ApiOkResponse({ type: UserDto, isArray: true })
  async listUsers(): Promise<UserDto[]> {
    const users = await this.usersService.listUsers();
    return users.map(UserDto.from);
  }

  @Post('users')
  @ApiOkResponse({ type: CreatedUserResponseDto })
  async createUser(
    @CurrentUser() actor: SafeUser,
    @Body() dto: CreateUserDto,
  ): Promise<CreatedUserResponseDto> {
    const { user, setPasswordLink, initialPin } = await this.usersService.createUser(
      actor,
      dto.username,
      dto.name,
      dto.email,
    );
    return { user: UserDto.from(user), setPasswordLink, initialPin };
  }

  @Patch('users/:id/deactivate')
  @ApiOkResponse({ type: UserDto })
  async deactivate(
    @CurrentUser() actor: SafeUser,
    @Param('id') id: string,
  ): Promise<UserDto> {
    return UserDto.from(await this.usersService.setStatus(actor, id, UserStatus.DEACTIVATED));
  }

  @Patch('users/:id/reactivate')
  @ApiOkResponse({ type: UserDto })
  async reactivate(
    @CurrentUser() actor: SafeUser,
    @Param('id') id: string,
  ): Promise<UserDto> {
    return UserDto.from(await this.usersService.setStatus(actor, id, UserStatus.ACTIVE));
  }

  @Post('users/:id/reset-password')
  @HttpCode(200)
  @ApiOkResponse({ type: ResetPasswordResponseDto })
  resetPassword(
    @CurrentUser() actor: SafeUser,
    @Param('id') id: string,
  ): Promise<ResetPasswordResponseDto> {
    return this.usersService.resetPassword(actor, id);
  }

  @Delete('users/:id')
  @HttpCode(200)
  async deleteUser(
    @CurrentUser() actor: SafeUser,
    @Param('id') id: string,
    @Body() dto: DeleteUserDto,
  ): Promise<{ ok: true }> {
    await this.usersService.deleteUser(actor, id, dto.confirmUsername);
    return { ok: true };
  }

  @Get('audit-log')
  @ApiOkResponse({ type: AuditEntryDto, isArray: true })
  listAuditLog() {
    return this.usersService.listAuditLog();
  }
}
