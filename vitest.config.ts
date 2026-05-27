import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    root: './src',
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      reportsDirectory: '../coverage',
      thresholds: {
        lines: 70,
        branches: 70,
        functions: 70,
      },
      include: [
        // Utils (8 testes)
        'utils/validate-cnpj.ts',
        'utils/business-days.ts',
        'utils/pagination.ts',
        'utils/sanitize.ts',
        'utils/escape-like.ts',
        'utils/escape-html.ts',
        'utils/project-access.ts',
        'utils/auth-cookies.ts',
        // Middlewares (4 testes)
        'middlewares/auth.ts',
        'middlewares/authorize.ts',
        'middlewares/rate-limit.ts',
        'middlewares/error-handler.ts',
        // Services (17 testes)
        'services/auth.service.ts',
        'services/password-reset.service.ts',
        'services/time-entry.service.ts',
        'services/monthly-timesheet.service.ts',
        'services/project.service.ts',
        'services/ticket.service.ts',
        'services/ticket-notification.service.ts',
        'services/phase.service.ts',
        'services/subphase.service.ts',
        'services/subphase-consultant.service.ts',
        'services/user.service.ts',
        'services/client.service.ts',
        'services/dashboard.service.ts',
        'services/report-management.service.ts',
        'services/platform-settings.service.ts',
        'services/company-info.service.ts',
        'services/bank-accounts.service.ts',
        // Controllers (4 testes)
        'controllers/auth.controller.ts',
        'controllers/time-entry.controller.ts',
        'controllers/project.controller.ts',
        'controllers/ticket.controller.ts',
      ],
      exclude: [
        '**/__tests__/**',
        '**/__mocks__/**',
        '**/expense**',
        '**/project-expense**',
        '**/expense-report**',
      ],
    },
  },
})
