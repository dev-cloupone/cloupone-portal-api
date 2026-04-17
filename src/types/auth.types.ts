export interface JwtPayload {
  userId: string;
  role: 'super_admin' | 'gestor' | 'consultor' | 'client';
  clientId?: string | null;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}
