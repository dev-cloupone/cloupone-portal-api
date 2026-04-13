declare namespace Express {
  interface Request {
    userId?: string;
    userRole?: 'super_admin' | 'gestor' | 'consultor' | 'client';
    userClientId?: string | null;
  }
}
