import { describe, it, expect } from 'vitest';
import {
  computeWeekRange, formatBr, groupByUser, filterPendingRecipients,
} from '../weekly-timesheet-reminder';

describe('computeWeekRange', () => {
  it('retorna segunda a domingo da semana anterior quando executado numa segunda-feira', () => {
    expect(computeWeekRange('2026-09-28')).toEqual({ weekStart: '2026-09-21', weekEnd: '2026-09-27' });
  });

  it('retorna a mesma janela quando executado manualmente no meio da semana (workflow_dispatch)', () => {
    expect(computeWeekRange('2026-09-30')).toEqual({ weekStart: '2026-09-21', weekEnd: '2026-09-27' });
  });

  it('lida com virada de mês', () => {
    expect(computeWeekRange('2026-10-05')).toEqual({ weekStart: '2026-09-28', weekEnd: '2026-10-04' });
  });

  it('lida com virada de ano', () => {
    expect(computeWeekRange('2027-01-04')).toEqual({ weekStart: '2026-12-28', weekEnd: '2027-01-03' });
  });
});

describe('formatBr', () => {
  it('formata YYYY-MM-DD para DD/MM', () => {
    expect(formatBr('2026-09-21')).toBe('21/09');
  });
});

describe('groupByUser', () => {
  it('agrupa alocações por usuário, juntando os nomes de projeto sem duplicar', () => {
    const rows = [
      { userId: 'u1', name: 'Ana', email: 'ana@x.com', projectName: 'Projeto A' },
      { userId: 'u1', name: 'Ana', email: 'ana@x.com', projectName: 'Projeto B' },
      { userId: 'u2', name: 'Bruno', email: 'bruno@x.com', projectName: 'Projeto A' },
    ];
    expect(groupByUser(rows)).toEqual([
      { userId: 'u1', name: 'Ana', email: 'ana@x.com', projects: ['Projeto A', 'Projeto B'] },
      { userId: 'u2', name: 'Bruno', email: 'bruno@x.com', projects: ['Projeto A'] },
    ]);
  });
});

describe('filterPendingRecipients', () => {
  it('remove usuários que já apontaram horas na semana', () => {
    const recipients = [
      { userId: 'u1', name: 'Ana', email: 'ana@x.com', projects: ['A'] },
      { userId: 'u2', name: 'Bruno', email: 'bruno@x.com', projects: ['A'] },
    ];
    const usersWithEntries = new Set(['u1']);
    expect(filterPendingRecipients(recipients, usersWithEntries)).toEqual([
      { userId: 'u2', name: 'Bruno', email: 'bruno@x.com', projects: ['A'] },
    ]);
  });

  it('mantém todos quando ninguém apontou', () => {
    const recipients = [{ userId: 'u1', name: 'Ana', email: 'ana@x.com', projects: ['A'] }];
    expect(filterPendingRecipients(recipients, new Set())).toEqual(recipients);
  });
});
