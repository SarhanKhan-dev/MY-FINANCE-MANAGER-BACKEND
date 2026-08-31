import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiProperty, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SafeUser } from '../common/types/safe-user';
import {
  NotificationItem,
  NotificationKind,
  NotificationSeverity,
  NotificationsService,
  NotificationsView,
} from './notifications.service';

class NotificationItemDto implements NotificationItem {
  @ApiProperty() id: string;
  @ApiProperty({ enum: ['DEBT_OWE', 'DEBT_OWED', 'BUDGET', 'COMMITTEE', 'ZAKAT'] })
  kind: NotificationKind;
  @ApiProperty({ enum: ['info', 'warn', 'alert'] }) severity: NotificationSeverity;
  @ApiProperty() title: string;
  @ApiProperty() body: string;
  @ApiProperty() href: string;
}

class NotificationsViewDto implements NotificationsView {
  @ApiProperty({ type: NotificationItemDto, isArray: true }) items: NotificationItemDto[];
}

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOkResponse({ type: NotificationsViewDto })
  view(@CurrentUser() user: SafeUser): Promise<NotificationsViewDto> {
    return this.notificationsService.view(user.id);
  }
}
