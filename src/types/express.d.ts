declare namespace Express {
  interface Request {
    userId?: string;
    userRole?: 'super_admin' | 'administrative' | 'gestor' | 'consultor' | 'client';
    userClientId?: string | null;
  }
}
