export const VALID_SECTORS = [
  'accounting', 'retail', 'health', 'education', 'technology',
  'food', 'services', 'legal', 'construction', 'other',
] as const;

export type Sector = typeof VALID_SECTORS[number];

export const SECTOR_LABELS: Record<Sector, string> = {
  accounting: 'Contabilidade',
  retail: 'Comércio / Varejo',
  health: 'Saúde',
  education: 'Educação',
  technology: 'Tecnologia',
  food: 'Alimentação',
  services: 'Serviços',
  legal: 'Jurídico',
  construction: 'Construção',
  other: 'Outro',
};
