import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

function corsOrigin(): (
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
) => void {
  const entries = (process.env.FRONTEND_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  return (origin, callback) => {
    if (!origin) {
      callback(null, true);
      return;
    }
    const allowed = entries.some((entry) => {
      if (entry.includes('*')) {
        const suffix = entry.slice(entry.indexOf('*') + 1);
        const prefix = entry.slice(0, entry.indexOf('*'));
        return origin.startsWith(prefix) && origin.endsWith(suffix);
      }
      return entry === origin;
    });
    callback(null, allowed);
  };
}

export function configureApp(app: INestApplication): void {
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  app.enableCors({
    origin: corsOrigin(),
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'x-cron-secret'],
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('PAIS-ë API')
    .setDescription('REST API for PAIS-ë, the personal finance tracker by DataBlox')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);
}
