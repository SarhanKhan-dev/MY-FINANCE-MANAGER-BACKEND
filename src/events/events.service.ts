import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventType } from './event-types';

export interface RecordEventParams {
  userId: string;
  type: EventType;
  entityType: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  tx?: Prisma.TransactionClient;
}

@Injectable()
export class EventsService {
  constructor(private readonly prisma: PrismaService) {}

  async record(params: RecordEventParams): Promise<void> {
    const db = params.tx ?? this.prisma;
    await db.eventLog.create({
      data: {
        userId: params.userId,
        type: params.type,
        entityType: params.entityType,
        entityId: params.entityId,
        before:
          params.before === undefined ? undefined : (params.before as Prisma.InputJsonValue),
        after: params.after === undefined ? undefined : (params.after as Prisma.InputJsonValue),
      },
    });
  }
}
