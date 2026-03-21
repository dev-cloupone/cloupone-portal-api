export interface JwtPayload {
  userId: string;
  role: 'super_admin' | 'gestor' | 'consultor' | 'user';
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
