import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AiSettings } from '@prisma/client';
import { pktToday, toDateKey } from '../budget/cycle';
import { PrismaService } from '../prisma/prisma.service';
import { ContextService } from './context.service';
import {
  AiChatMessage,
  AiProviderName,
  AiToolDef,
  callChat,
  providerKeySet,
} from './providers';
import { SnapshotsService } from './snapshots.service';

export interface EntryDraft {
  type: string;
  amount: number;
  currency: 'PKR' | 'USD';
  date: string;
  categoryName?: string;
  personName?: string;
  walletName?: string;
  note?: string;
}

export interface ChatResult {
  chatId: string;
  reply: string;
  draft: EntryDraft | null;
  remainingToday: number;
}

const TOOLS: AiToolDef[] = [
  {
    name: 'draft_entry',
    description:
      'Draft a ledger entry from what the user described (e.g. "ammi ko 300 diye" -> allowance). The user will confirm before anything is saved. Use the exact words the user used for person/shop names.',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['EXPENSE', 'INCOME', 'LEND', 'BORROW', 'REPAY_IN', 'REPAY_OUT', 'CHARITY'],
        },
        amount: { type: 'number' },
        currency: { type: 'string', enum: ['PKR', 'USD'] },
        date: { type: 'string', description: 'YYYY-MM-DD, default today' },
        categoryName: { type: 'string', description: 'e.g. Allowance, Fruits, Dining out' },
        personName: { type: 'string', description: 'The person exactly as the user said it' },
        note: { type: 'string' },
      },
      required: ['type', 'amount', 'currency'],
    },
  },
  {
    name: 'remember_note',
    description:
      'Save a short long-term fact about the user worth remembering across chats (goals, habits, constraints). One sentence.',
    parameters: {
      type: 'object',
      properties: { note: { type: 'string' } },
      required: ['note'],
    },
  },
];

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly context: ContextService,
    private readonly snapshots: SnapshotsService,
  ) {}

  async settings(): Promise<AiSettings> {
    return this.prisma.aiSettings.upsert({
      where: { id: 'global' },
      create: { id: 'global' },
      update: {},
    });
  }

  async status(userId: string): Promise<{
    enabled: boolean;
    configured: boolean;
    remainingToday: number;
    dailyLimit: number;
  }> {
    const [user, settings, usage] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { aiEnabled: true } }),
      this.settings(),
      this.prisma.aiUsage.findUnique({
        where: { userId_dateKey: { userId, dateKey: toDateKey(pktToday()) } },
      }),
    ]);
    return {
      enabled: Boolean(user?.aiEnabled),
      configured: providerKeySet(settings.provider as AiProviderName),
      remainingToday: Math.max(0, settings.dailyLimit - (usage?.count ?? 0)),
      dailyLimit: settings.dailyLimit,
    };
  }

  private systemPrompt(brief: string): string {
    return [
      'You are PAIS-e, the in-app financial analyst of a personal finance tracker used in Pakistan.',
      'Speak the way the user speaks: usually a natural Roman Urdu + English mix; mirror plain English if they use it.',
      'You are a neutral, precise analyst - warm but never theatrical. Keep answers short and concrete; numbers first.',
      'Every figure you state MUST come from the BRIEF below or from a tool result. Never invent or estimate numbers silently.',
      'Currencies never convert: rupees stay Rs, dollars stay $. Say "Rs 5,000 + $80" style when both exist.',
      'People appear as Person-N and shops as Shop-N tokens. Use those tokens verbatim in replies - the app replaces them with real names before the user sees them. Do not remark on the tokens.',
      'When the user describes money that moved ("ammi ko 300 diye", "spent 500 on fruit"), call draft_entry - the app shows it for confirmation. For person/shop, pass exactly the words the user used.',
      'When you learn a durable fact about the user (a goal, a habit, a constraint), call remember_note once.',
      'Investment questions: analyze scenarios with the user\'s own numbers, give pros and cons, and always end that discussion with: "Yeh analysis hai, licensed financial advice nahi."',
      'If asked about live prices or world events and you have no live data, say what you know is dated rather than guessing numbers.',
      '',
      'BRIEF (the user\'s complete, current financial picture; monthlySnapshots + patternProgress cover up to 12 past months):',
      brief,
    ].join('\n');
  }

  private async consumeQuota(userId: string, limit: number): Promise<number> {
    const dateKey = toDateKey(pktToday());
    const usage = await this.prisma.aiUsage.upsert({
      where: { userId_dateKey: { userId, dateKey } },
      create: { userId, dateKey, count: 1 },
      update: { count: { increment: 1 } },
    });
    if (usage.count > limit) {
      throw new BadRequestException('Daily AI limit reached - it resets tomorrow.');
    }
    return Math.max(0, limit - usage.count);
  }

  private async gate(userId: string): Promise<AiSettings> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { aiEnabled: true },
    });
    if (!user?.aiEnabled) {
      throw new ForbiddenException('AI Companion is not enabled for your account yet.');
    }
    const settings = await this.settings();
    if (!providerKeySet(settings.provider as AiProviderName)) {
      throw new ServiceUnavailableException(
        'The AI brain is not connected yet - the provider key is pending.',
      );
    }
    return settings;
  }

  async chat(userId: string, chatId: string | null, message: string): Promise<ChatResult> {
    const settings = await this.gate(userId);
    const remainingToday = await this.consumeQuota(userId, settings.dailyLimit);

    const chat = chatId
      ? await this.prisma.aiChat.findFirstOrThrow({ where: { id: chatId, userId } })
      : await this.prisma.aiChat.create({
          data: { userId, title: message.slice(0, 60) },
        });

    const history = await this.prisma.aiMessage.findMany({
      where: { chatId: chat.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    const { brief, reveal } = await this.context.build(userId);
    const maskedMessage = this.context.maskFreeText(message, reveal);

    const messages: AiChatMessage[] = [
      { role: 'system', content: this.systemPrompt(brief) },
      ...history.reverse().map((row) => ({
        role: row.role as 'user' | 'assistant',
        content: row.content,
      })),
      { role: 'user', content: maskedMessage },
    ];

    let draft: EntryDraft | null = null;
    let reply = '';
    const provider = settings.provider as AiProviderName;

    for (let round = 0; round < 4; round += 1) {
      const result = await callChat(provider, settings.model, messages, TOOLS);
      if (result.toolCalls.length === 0) {
        reply = result.content;
        break;
      }
      messages.push({
        role: 'assistant',
        content: result.content,
        toolCalls: result.toolCalls,
      });
      for (const call of result.toolCalls) {
        let toolResult = 'ok';
        if (call.name === 'draft_entry') {
          draft = this.validateDraft(call.arguments);
          toolResult = draft
            ? 'Draft prepared - it is being shown to the user for confirmation. Tell them to check and confirm it.'
            : 'Draft rejected: amount must be a positive number.';
        } else if (call.name === 'remember_note') {
          const note = String(call.arguments.note ?? '').slice(0, 300);
          if (note) {
            await this.prisma.aiMemoryNote.create({ data: { userId, note } });
            toolResult = 'Remembered.';
          }
        } else {
          toolResult = `Unknown tool ${call.name}`;
        }
        messages.push({ role: 'tool', content: toolResult, toolCallId: call.id });
      }
      reply = result.content;
    }

    const revealed = this.context.deanonymize(reply || '...', reveal);
    if (draft?.personName) draft.personName = this.context.deanonymize(draft.personName, reveal);
    if (draft?.note) draft.note = this.context.deanonymize(draft.note, reveal);

    await this.prisma.aiMessage.createMany({
      data: [
        { chatId: chat.id, role: 'user', content: message },
        { chatId: chat.id, role: 'assistant', content: revealed },
      ],
    });
    await this.prisma.aiChat.update({ where: { id: chat.id }, data: { updatedAt: new Date() } });

    return { chatId: chat.id, reply: revealed, draft, remainingToday };
  }

  private validateDraft(args: Record<string, unknown>): EntryDraft | null {
    const amount = Number(args.amount);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    const currency = args.currency === 'USD' ? 'USD' : 'PKR';
    const type = String(args.type ?? 'EXPENSE');
    const allowed = ['EXPENSE', 'INCOME', 'LEND', 'BORROW', 'REPAY_IN', 'REPAY_OUT', 'CHARITY'];
    return {
      type: allowed.includes(type) ? type : 'EXPENSE',
      amount: Math.round(amount * 100) / 100,
      currency,
      date:
        typeof args.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.date)
          ? args.date
          : toDateKey(pktToday()),
      categoryName: typeof args.categoryName === 'string' ? args.categoryName : undefined,
      personName: typeof args.personName === 'string' ? args.personName : undefined,
      note: typeof args.note === 'string' ? args.note.slice(0, 200) : undefined,
    };
  }

  /** The month-end deep dive: snapshot + deltas -> narrative verdict, archived forever. */
  async generateReport(userId: string, cycleKey?: string): Promise<{ cycleKey: string; report: string }> {
    const settings = await this.gate(userId);
    await this.snapshots.backfill(userId);
    const rows = await this.snapshots.list(userId);
    if (rows.length === 0) {
      throw new BadRequestException('No completed month to report on yet.');
    }
    const target = cycleKey ? rows.find((row) => row.cycleKey === cycleKey) : rows[0];
    if (!target) throw new BadRequestException('No snapshot for that cycle.');

    const { reveal } = await this.context.build(userId);
    const progress = this.snapshots.progress(rows);
    const prompt = [
      'Write the monthly money report for the cycle below. Structure: 1) Mahina kaisa raha (2-3 lines), 2) Pattern check - what improved vs 3/6/12 months (use patternProgress deltas verbatim), 3) Leaks - where money quietly went, 4) Agla mahina - ONE concrete fix. Keep it under 250 words, Roman Urdu + English mix, numbers exact.',
      `CYCLE SNAPSHOT: ${JSON.stringify(target)}`,
      `PATTERN PROGRESS: ${JSON.stringify(progress)}`,
      `PAST SNAPSHOTS (newest first): ${JSON.stringify(rows.slice(0, 12).map((row) => ({ cycle: row.cycleKey, spentPkr: row.data.spentPkr, incomePkr: row.data.incomePkr, savingsPkr: row.data.savingsPkr })))}`,
    ].join('\n\n');

    const result = await callChat(
      settings.provider as AiProviderName,
      settings.model,
      [
        { role: 'system', content: this.systemPrompt('(see report inputs in the user message)') },
        { role: 'user', content: prompt },
      ],
      [],
    );
    const report = this.context.deanonymize(result.content, reveal);
    await this.snapshots.saveReport(userId, target.cycleKey, report);
    return { cycleKey: target.cycleKey, report };
  }

  /** Nightly cron: keep snapshots fresh for AI users; write reports on cycle end. */
  async cronDaily(): Promise<{ users: number; reports: number }> {
    const users = await this.prisma.user.findMany({
      where: { aiEnabled: true },
      select: { id: true },
    });
    let reports = 0;
    const settings = await this.settings();
    const keyReady = providerKeySet(settings.provider as AiProviderName);
    for (const user of users) {
      try {
        await this.snapshots.backfill(user.id);
        if (!keyReady) continue;
        const rows = await this.snapshots.list(user.id);
        const latest = rows[0];
        // A cycle that ended within the last 2 days and has no report yet.
        if (latest && !latest.report) {
          const end = new Date(`${latest.cycleEnd}T00:00:00.000Z`).getTime();
          if (Date.now() - end < 2 * 24 * 60 * 60 * 1000) {
            await this.generateReport(user.id, latest.cycleKey);
            reports += 1;
          }
        }
      } catch (error) {
        this.logger.warn(`cron for ${user.id} failed: ${(error as Error).message}`);
      }
    }
    return { users: users.length, reports };
  }
}
