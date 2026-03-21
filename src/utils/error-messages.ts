// AUTH
export const AUTH = {
  INVALID_CREDENTIALS: 'Email ou senha incorretos.',
  TOKEN_REQUIRED: 'Sessão expirada. Faça login novamente.',
  TOKEN_INVALID: 'Sessão inválida ou expirada. Faça login novamente.',
  USER_INACTIVE: 'Usuário não encontrado ou inativo.',
  REFRESH_TOKEN_REQUIRED: 'Sessão expirada. Faça login novamente.',
} as const;

// PASSWORD RESET
export const PASSWORD_RESET = {
  TOKEN_INVALID: 'Token de redefinição de senha inválido.',
  TOKEN_EXPIRED: 'Token de redefinição de senha expirado. Solicite um novo.',
  TOKEN_ALREADY_USED: 'Este link de redefinição já foi utilizado.',
  EMAIL_SENT: 'Se o email estiver cadastrado, você receberá instruções para redefinir sua senha.',
  PASSWORD_CHANGED: 'Senha alterada com sucesso. Faça login com sua nova senha.',
  SAME_PASSWORD: 'A nova senha deve ser diferente da senha atual.',
} as const;

// USER
export const USER = {
  NOT_FOUND: 'Usuário não encontrado.',
  EMAIL_IN_USE: 'Já existe um usuário com este email.',
  CANNOT_DEACTIVATE_SELF: 'Não é possível desativar sua própria conta.',
} as const;

// MIDDLEWARE
export const MIDDLEWARE = {
  AUTH_REQUIRED: 'Autenticação necessária. Faça login.',
  INSUFFICIENT_PERMISSIONS: 'Você não tem permissão para esta ação.',
} as const;

// SUPER_ADMIN
export const SUPER_ADMIN = {
  CANNOT_DEACTIVATE_SELF: 'Não é possível desativar sua própria conta.',
} as const;

// RATE_LIMIT
export const RATE_LIMIT = {
  TOO_MANY_REQUESTS: 'Muitas requisições. Tente novamente em instantes.',
  TOO_MANY_ATTEMPTS: 'Muitas tentativas. Tente novamente em instantes.',
} as const;

// UPLOAD
export const UPLOAD = {
  TYPE_NOT_ALLOWED: 'Tipo de arquivo não permitido',
} as const;

// GENERIC
export const GENERIC = {
  INTERNAL: 'Erro interno do servidor. Tente novamente mais tarde.',
  VALIDATION: 'Erro de validação.',
} as const;
