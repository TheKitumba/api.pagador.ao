import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';

import { ACCESS_COOKIE } from './auth.guard';

export const API_TAGS: { name: string; description: string }[] = [
  { name: 'Auth', description: 'Sessão, 2FA, OTP por SMS e recuperação de acesso' },
  { name: 'Utilizadores', description: 'Utilizadores, convites e papéis da conta' },
  { name: 'Organização', description: 'Empresa, estabelecimentos, unidades, cargos e centros de custo' },
  { name: 'Trabalhadores', description: 'Dossiê do trabalhador, dados bancários e documentos' },
  { name: 'Contratos', description: 'Contratos, renovações e períodos experimentais' },
  { name: 'Cessações', description: 'Cessações e acerto final de contas' },
  { name: 'Assiduidade', description: 'Marcações, correcções e fecho do período' },
  { name: 'Escalas', description: 'Horários e escalas de turnos' },
  { name: 'Férias e faltas', description: 'Pedidos, saldos e mapa de férias' },
  { name: 'Horas extra', description: 'Pedidos e limites legais' },
  { name: 'Folhas de horas', description: 'Horas por projecto' },
  { name: 'Aprovações', description: 'Caixa de aprovações e fluxos configuráveis' },
  { name: 'Folha de pagamento', description: 'Rubricas, tabelas legais, períodos, processamentos e recibos' },
  { name: 'Compensação', description: 'Benefícios, empréstimos, adiantamentos e reembolsos' },
  { name: 'Pagamentos', description: 'Lotes de pagamento e ficheiros bancários' },
  { name: 'Obrigações fiscais', description: 'IRT (AGT) e folha de remunerações (INSS)' },
  { name: 'Prestadores', description: 'Facturas de prestadores e retenção na fonte' },
  { name: 'Recrutamento', description: 'Vagas, candidatos e página de carreiras' },
  { name: 'Desempenho', description: 'Ciclos de avaliação, objectivos e feedback' },
  { name: 'Formação', description: 'Acções de formação e inscrições' },
  { name: 'Relações laborais', description: 'Disciplina, exames médicos e acidentes' },
  { name: 'Comunicação', description: 'Notificações, mensagens e comunicados' },
  { name: 'Relatórios', description: 'Dashboard, indicadores e relatórios' },
  { name: 'Auditoria', description: 'Registo de auditoria' },
  { name: 'Portal', description: 'Dados do próprio trabalhador (self-service)' },
  { name: 'Público', description: 'Endpoints sem autenticação' },
];

/** OpenAPI document served at /v1/docs (UI) and /v1/openapi.json (docs/09, 9.11). */
export function setupSwagger(app: INestApplication) {
  const builder = new DocumentBuilder()
    .setTitle('pagador.ao API')
    .setDescription(
      [
        'API de recursos humanos e folha de pagamento para empresas angolanas.',
        '',
        '**Autenticação:** a interface usa cookies `HttpOnly` (`access_token`, renovado com `POST /v1/auth/refresh`). ',
        'Integrações podem enviar o mesmo token JWT (RS256) no cabeçalho `Authorization: Bearer`.',
        '',
        '**Convenções:** datas ISO 8601, valores monetários como string decimal (`"371800.70"`), paginação por cursor ',
        '(`?cursor=&limit=`), erros no formato RFC 9457 *Problem Details* com `code` estável.',
      ].join('\n'),
    )
    .setVersion('1.0.0')
    .addServer('/', 'Este servidor')
    .addCookieAuth(ACCESS_COOKIE, { type: 'apiKey', in: 'cookie', name: ACCESS_COOKIE })
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT (RS256)' });
  for (const tag of API_TAGS) builder.addTag(tag.name, tag.description);

  const document = cleanupOpenApiDoc(SwaggerModule.createDocument(app, builder.build()));
  SwaggerModule.setup('v1/docs', app, document, {
    jsonDocumentUrl: 'v1/openapi.json',
    customSiteTitle: 'pagador.ao API',
    swaggerOptions: { persistAuthorization: true, withCredentials: true, tagsSorter: 'alpha', docExpansion: 'none' },
  });
}
