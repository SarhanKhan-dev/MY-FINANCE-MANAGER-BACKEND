import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Person } from '@prisma/client';
import { EventTypes } from '../events/event-types';
import { EventsService } from '../events/events.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PeopleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  list(userId: string): Promise<Person[]> {
    return this.prisma.person.findMany({
      where: { userId, archivedAt: null },
      orderBy: { name: 'asc' },
    });
  }

  async create(userId: string, name: string, phone?: string): Promise<Person> {
    const existing = await this.prisma.person.findFirst({
      where: { userId, name: { equals: name, mode: 'insensitive' } },
    });
    if (existing) {
      throw new ConflictException('This person already exists');
    }
    const person = await this.prisma.person.create({ data: { userId, name, phone } });
    await this.events.record({
      userId,
      type: EventTypes.PERSON_CREATED,
      entityType: 'Person',
      entityId: person.id,
      after: { name },
    });
    return person;
  }

  async findOrFail(userId: string, personId: string): Promise<Person> {
    const person = await this.prisma.person.findFirst({ where: { id: personId, userId } });
    if (!person) {
      throw new NotFoundException('Person not found');
    }
    return person;
  }
}
