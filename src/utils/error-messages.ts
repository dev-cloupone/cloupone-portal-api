// AUTH
export const AUTH = {
  INVALID_CREDENTIALS: { message: 'Email ou senha incorretos.', code: 'AUTH_INVALID_CREDENTIALS' },
  TOKEN_REQUIRED: { message: 'Sessão expirada. Faça login novamente.', code: 'AUTH_TOKEN_REQUIRED' },
  TOKEN_INVALID: { message: 'Sessão inválida ou expirada. Faça login novamente.', code: 'AUTH_TOKEN_INVALID' },
  USER_INACTIVE: { message: 'Usuário não encontrado ou inativo.', code: 'AUTH_USER_INACTIVE' },
  REFRESH_TOKEN_REQUIRED: { message: 'Sessão expirada. Faça login novamente.', code: 'AUTH_REFRESH_TOKEN_REQUIRED' },
} as const;

// PASSWORD RESET
export const PASSWORD_RESET = {
  TOKEN_INVALID: { message: 'Token de redefinição de senha inválido.', code: 'PASSWORD_RESET_TOKEN_INVALID' },
  TOKEN_EXPIRED: { message: 'Token de redefinição de senha expirado. Solicite um novo.', code: 'PASSWORD_RESET_TOKEN_EXPIRED' },
  TOKEN_ALREADY_USED: { message: 'Este link de redefinição já foi utilizado.', code: 'PASSWORD_RESET_TOKEN_ALREADY_USED' },
  EMAIL_SENT: { message: 'Se o email estiver cadastrado, você receberá instruções para redefinir sua senha.', code: 'PASSWORD_RESET_EMAIL_SENT' },
  PASSWORD_CHANGED: { message: 'Senha alterada com sucesso. Faça login com sua nova senha.', code: 'PASSWORD_RESET_PASSWORD_CHANGED' },
  SAME_PASSWORD: { message: 'A nova senha deve ser diferente da senha atual.', code: 'PASSWORD_RESET_SAME_PASSWORD' },
} as const;

// USER
export const USER = {
  NOT_FOUND: { message: 'Usuário não encontrado.', code: 'USER_NOT_FOUND' },
  EMAIL_IN_USE: { message: 'Já existe um usuário com este email.', code: 'USER_EMAIL_IN_USE' },
  CANNOT_DEACTIVATE_SELF: { message: 'Não é possível desativar sua própria conta.', code: 'USER_CANNOT_DEACTIVATE_SELF' },
} as const;

// MIDDLEWARE
export const MIDDLEWARE = {
  AUTH_REQUIRED: { message: 'Autenticação necessária. Faça login.', code: 'MIDDLEWARE_AUTH_REQUIRED' },
  INSUFFICIENT_PERMISSIONS: { message: 'Você não tem permissão para esta ação.', code: 'MIDDLEWARE_INSUFFICIENT_PERMISSIONS' },
} as const;

// SUPER_ADMIN
export const SUPER_ADMIN = {
  CANNOT_DEACTIVATE_SELF: { message: 'Não é possível desativar sua própria conta.', code: 'SUPER_ADMIN_CANNOT_DEACTIVATE_SELF' },
} as const;

// RATE_LIMIT
export const RATE_LIMIT = {
  TOO_MANY_REQUESTS: { message: 'Muitas requisições. Tente novamente em instantes.', code: 'RATE_LIMIT_TOO_MANY_REQUESTS' },
  TOO_MANY_ATTEMPTS: { message: 'Muitas tentativas. Tente novamente em instantes.', code: 'RATE_LIMIT_TOO_MANY_ATTEMPTS' },
} as const;

// UPLOAD
export const UPLOAD = {
  TYPE_NOT_ALLOWED: { message: 'Tipo de arquivo não permitido', code: 'UPLOAD_TYPE_NOT_ALLOWED' },
} as const;

// GENERIC
export const GENERIC = {
  INTERNAL: { message: 'Erro interno do servidor. Tente novamente mais tarde.', code: 'GENERIC_INTERNAL' },
  VALIDATION: { message: 'Erro de validação.', code: 'GENERIC_VALIDATION' },
} as const;
