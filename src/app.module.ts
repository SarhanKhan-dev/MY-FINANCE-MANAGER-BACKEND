import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { BillsModule } from './bills/bills.module';
import { BudgetModule } from './budget/budget.module';
import { CategoriesModule } from './categories/categories.module';
import { CommitteesModule } from './committees/committees.module';
import { DebtsModule } from './debts/debts.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { EventsModule } from './events/events.module';
import { FxModule } from './fx/fx.module';
import { GiftsModule } from './gifts/gifts.module';
import { GoalsModule } from './goals/goals.module';
import { GoldModule } from './gold/gold.module';
import { InvestmentsModule } from './investments/investments.module';
import { MerchantsModule } from './merchants/merchants.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PeopleModule } from './people/people.module';
import { MailModule } from './mail/mail.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProductsModule } from './products/products.module';
import { ReportsModule } from './reports/reports.module';
import { SettingsModule } from './settings/settings.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { TransactionsModule } from './transactions/transactions.module';
import { UsersModule } from './users/users.module';
import { WalletsModule } from './wallets/wallets.module';
import { ZakatModule } from './zakat/zakat.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    MailModule,
    EventsModule,
    AuthModule,
    UsersModule,
    SettingsModule,
    WalletsModule,
    CategoriesModule,
    MerchantsModule,
    PeopleModule,
    TransactionsModule,
    BudgetModule,
    DebtsModule,
    FxModule,
    ProductsModule,
    BillsModule,
    SubscriptionsModule,
    InvestmentsModule,
    GoldModule,
    CommitteesModule,
    GoalsModule,
    GiftsModule,
    ZakatModule,
    ReportsModule,
    NotificationsModule,
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
})
export class AppModule {}
