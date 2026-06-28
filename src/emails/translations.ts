export type Locale = 'pt-BR' | 'en-US';

const translations: Record<Locale, Record<string, string>> = {
  'pt-BR': {
    // Layout
    'layout.support': 'Dúvidas? Entre em contato com o suporte.',
    'layout.copyright': 'Todos os direitos reservados.',

    // Welcome
    'welcome.subject': 'Cloup One | Bem-vindo(a)',
    'welcome.heading': 'Bem-vindo(a) ao {{appName}}!',
    'welcome.greeting': 'Olá, <strong>{{name}}</strong>! Sua conta foi criada com sucesso.',
    'welcome.greetingText': 'Olá, {{name}}!',
    'welcome.accountCreated': 'Sua conta no {{appName}} foi criada com sucesso.',
    'welcome.credentials': 'Suas credenciais de acesso:',
    'welcome.email': 'Email:',
    'welcome.tempPassword': 'Senha temporária:',
    'welcome.access': 'Acesse:',
    'welcome.button': 'Acessar Plataforma',
    'welcome.warning': 'Por segurança, você deverá <strong>alterar sua senha</strong> no primeiro acesso.',
    'welcome.warningText': 'Por segurança, você deverá alterar sua senha no primeiro acesso.',

    // Welcome Self Register
    'welcomeSelfRegister.subject': 'Cloup One | Bem-vindo(a)',
    'welcomeSelfRegister.heading': 'Bem-vindo(a) ao {{appName}}!',
    'welcomeSelfRegister.greeting': 'Olá, <strong>{{name}}</strong>! Seu cadastro foi realizado com sucesso.',
    'welcomeSelfRegister.greetingText': 'Seu cadastro no {{appName}} foi realizado com sucesso.',
    'welcomeSelfRegister.button': 'Fazer Login',

    // Password Reset
    'passwordReset.subject': 'Cloup One | Redefinição de senha',
    'passwordReset.heading': 'Redefinição de Senha',
    'passwordReset.greeting': 'Olá, <strong>{{name}}</strong>! Recebemos uma solicitação para redefinir sua senha.',
    'passwordReset.greetingText': 'Recebemos uma solicitação para redefinir sua senha.',
    'passwordReset.linkInstruction': 'Clique no link abaixo para criar uma nova senha:',
    'passwordReset.button': 'Redefinir Senha',
    'passwordReset.expiry': 'Este link expira em <strong>{{minutes}} minutos</strong>.',
    'passwordReset.expiryText': 'Este link expira em {{minutes}} minutos.',
    'passwordReset.ignore': 'Se você não solicitou esta redefinição, ignore este email.',

    // Password Changed
    'passwordChanged.subject': 'Cloup One | Senha alterada',
    'passwordChanged.heading': 'Senha Alterada',
    'passwordChanged.greeting': 'Olá, <strong>{{name}}</strong>! Sua senha no <strong>{{appName}}</strong> foi alterada com sucesso.',
    'passwordChanged.greetingText': 'Sua senha no {{appName}} foi alterada com sucesso em {{timestamp}}.',
    'passwordChanged.timestamp': 'Data/hora da alteração:',
    'passwordChanged.warning': 'Se você não realizou esta alteração, entre em contato com o suporte imediatamente.',

    // Ticket Created
    'ticketCreated.subject': 'Cloup One | [{{code}}] Novo ticket: {{title}}',
    'ticketCreated.heading': 'Novo Ticket Criado',
    'ticketCreated.description': 'Um novo ticket foi aberto no projeto <strong>{{projectName}}</strong>.',
    'ticketCreated.descriptionText': 'Novo ticket criado no projeto "{{projectName}}".',
    'ticketCreated.button': 'Ver Ticket',

    // Ticket Assigned
    'ticketAssigned.subjectPersonal': 'Cloup One | [{{code}}] Ticket atribuído a você: {{title}}',
    'ticketAssigned.subject': 'Cloup One | [{{code}}] Ticket atribuído: {{title}}',
    'ticketAssigned.headingPersonal': 'Ticket Atribuído a Você',
    'ticketAssigned.heading': 'Ticket Atribuído',
    'ticketAssigned.greetingPersonal': 'Olá, <strong>{{name}}</strong>! Um ticket foi atribuído a você.',
    'ticketAssigned.greetingGeneric': 'O ticket foi atribuído por <strong>{{assignedByName}}</strong>.',
    'ticketAssigned.descriptionPersonalText': 'O ticket {{code}} "{{title}}" do projeto "{{projectName}}" foi atribuído a você por {{assignedByName}}.',
    'ticketAssigned.descriptionText': 'O ticket {{code}} "{{title}}" do projeto "{{projectName}}" foi atribuído por {{assignedByName}}.',
    'ticketAssigned.button': 'Ver Ticket',

    // Ticket Status Changed
    'ticketStatus.subject': 'Cloup One | [{{code}}] Status alterado: {{oldStatus}} → {{newStatus}}',
    'ticketStatus.heading': 'Status do Ticket Alterado',
    'ticketStatus.greeting': 'O status do ticket foi atualizado.',
    'ticketStatus.descriptionText': 'O status do ticket {{code}} "{{title}}" foi alterado.',
    'ticketStatus.changedBy': 'Alterado por:',
    'ticketStatus.button': 'Ver Ticket',

    // Ticket Comment
    'ticketComment.subject': 'Cloup One | [{{code}}] Novo comentário: {{title}}',
    'ticketComment.heading': 'Novo Comentário',
    'ticketComment.descriptionPersonal': '<strong>{{authorName}}</strong> comentou no ticket.',
    'ticketComment.descriptionText': '{{authorName}} comentou no ticket {{code}} "{{title}}":',
    'ticketComment.button': 'Ver Comentário',

    // Ticket Attachment
    'ticketAttachment.subject': 'Cloup One | [{{code}}] Novo anexo: {{title}}',
    'ticketAttachment.heading': 'Novo Anexo',
    'ticketAttachment.descriptionPersonal': '<strong>{{uploaderName}}</strong> anexou um arquivo no ticket.',
    'ticketAttachment.descriptionText': '{{uploaderName}} anexou um arquivo no ticket {{code}} "{{title}}":',
    'ticketAttachment.file': 'Arquivo:',
    'ticketAttachment.button': 'Ver Anexo',

    // Common ticket field labels
    'ticket.code': 'Código:',
    'ticket.title': 'Título:',
    'ticket.type': 'Tipo:',
    'ticket.createdBy': 'Criado por:',
    'ticket.project': 'Projeto:',
    'ticket.assignedBy': 'Atribuído por:',
    'ticket.from': 'De:',
    'ticket.to': 'Para:',
    'ticket.by': 'Por:',
    'ticket.ticket': 'Ticket:',
    'ticket.accessTicket': 'Acesse o ticket:',

    // Ticket type labels
    'ticketType.system_error': 'Erro de sistema',
    'ticketType.question': 'Dúvida',
    'ticketType.improvement': 'Solicitação de melhoria',
    'ticketType.security': 'Segurança/Acesso',

    // Ticket status labels
    'ticketStatus.open': 'Aberto',
    'ticketStatus.in_analysis': 'Em Análise',
    'ticketStatus.awaiting_customer': 'Aguardando Retorno do Cliente',
    'ticketStatus.awaiting_third_party': 'Aguardando Terceiro',
    'ticketStatus.finished': 'Finalizado',

    // Common
    'common.hello': 'Olá, {{name}}!',
  },

  'en-US': {
    // Layout
    'layout.support': 'Questions? Contact support.',
    'layout.copyright': 'All rights reserved.',

    // Welcome
    'welcome.subject': 'Cloup One | Welcome',
    'welcome.heading': 'Welcome to {{appName}}!',
    'welcome.greeting': 'Hi <strong>{{name}}</strong>! Your account has been created successfully.',
    'welcome.greetingText': 'Hi {{name}}!',
    'welcome.accountCreated': 'Your account on {{appName}} has been created successfully.',
    'welcome.credentials': 'Your access credentials:',
    'welcome.email': 'Email:',
    'welcome.tempPassword': 'Temporary password:',
    'welcome.access': 'Access:',
    'welcome.button': 'Access Platform',
    'welcome.warning': 'For security, you must <strong>change your password</strong> on first login.',
    'welcome.warningText': 'For security, you must change your password on first login.',

    // Welcome Self Register
    'welcomeSelfRegister.subject': 'Cloup One | Welcome',
    'welcomeSelfRegister.heading': 'Welcome to {{appName}}!',
    'welcomeSelfRegister.greeting': 'Hi <strong>{{name}}</strong>! Your registration was completed successfully.',
    'welcomeSelfRegister.greetingText': 'Your registration on {{appName}} was completed successfully.',
    'welcomeSelfRegister.button': 'Log In',

    // Password Reset
    'passwordReset.subject': 'Cloup One | Password Reset',
    'passwordReset.heading': 'Password Reset',
    'passwordReset.greeting': 'Hi <strong>{{name}}</strong>! We received a request to reset your password.',
    'passwordReset.greetingText': 'We received a request to reset your password.',
    'passwordReset.linkInstruction': 'Click the link below to create a new password:',
    'passwordReset.button': 'Reset Password',
    'passwordReset.expiry': 'This link expires in <strong>{{minutes}} minutes</strong>.',
    'passwordReset.expiryText': 'This link expires in {{minutes}} minutes.',
    'passwordReset.ignore': 'If you did not request this reset, please ignore this email.',

    // Password Changed
    'passwordChanged.subject': 'Cloup One | Password Changed',
    'passwordChanged.heading': 'Password Changed',
    'passwordChanged.greeting': 'Hi <strong>{{name}}</strong>! Your password on <strong>{{appName}}</strong> has been changed successfully.',
    'passwordChanged.greetingText': 'Your password on {{appName}} was changed successfully at {{timestamp}}.',
    'passwordChanged.timestamp': 'Date/time of change:',
    'passwordChanged.warning': 'If you did not make this change, contact support immediately.',

    // Ticket Created
    'ticketCreated.subject': 'Cloup One | [{{code}}] New ticket: {{title}}',
    'ticketCreated.heading': 'New Ticket Created',
    'ticketCreated.description': 'A new ticket was opened in project <strong>{{projectName}}</strong>.',
    'ticketCreated.descriptionText': 'New ticket created in project "{{projectName}}".',
    'ticketCreated.button': 'View Ticket',

    // Ticket Assigned
    'ticketAssigned.subjectPersonal': 'Cloup One | [{{code}}] Ticket assigned to you: {{title}}',
    'ticketAssigned.subject': 'Cloup One | [{{code}}] Ticket assigned: {{title}}',
    'ticketAssigned.headingPersonal': 'Ticket Assigned to You',
    'ticketAssigned.heading': 'Ticket Assigned',
    'ticketAssigned.greetingPersonal': 'Hi <strong>{{name}}</strong>! A ticket has been assigned to you.',
    'ticketAssigned.greetingGeneric': 'The ticket was assigned by <strong>{{assignedByName}}</strong>.',
    'ticketAssigned.descriptionPersonalText': 'Ticket {{code}} "{{title}}" from project "{{projectName}}" was assigned to you by {{assignedByName}}.',
    'ticketAssigned.descriptionText': 'Ticket {{code}} "{{title}}" from project "{{projectName}}" was assigned by {{assignedByName}}.',
    'ticketAssigned.button': 'View Ticket',

    // Ticket Status Changed
    'ticketStatus.subject': 'Cloup One | [{{code}}] Status changed: {{oldStatus}} → {{newStatus}}',
    'ticketStatus.heading': 'Ticket Status Changed',
    'ticketStatus.greeting': 'The ticket status has been updated.',
    'ticketStatus.descriptionText': 'The status of ticket {{code}} "{{title}}" was changed.',
    'ticketStatus.changedBy': 'Changed by:',
    'ticketStatus.button': 'View Ticket',

    // Ticket Comment
    'ticketComment.subject': 'Cloup One | [{{code}}] New comment: {{title}}',
    'ticketComment.heading': 'New Comment',
    'ticketComment.descriptionPersonal': '<strong>{{authorName}}</strong> commented on the ticket.',
    'ticketComment.descriptionText': '{{authorName}} commented on ticket {{code}} "{{title}}":',
    'ticketComment.button': 'View Comment',

    // Ticket Attachment
    'ticketAttachment.subject': 'Cloup One | [{{code}}] New attachment: {{title}}',
    'ticketAttachment.heading': 'New Attachment',
    'ticketAttachment.descriptionPersonal': '<strong>{{uploaderName}}</strong> attached a file to the ticket.',
    'ticketAttachment.descriptionText': '{{uploaderName}} attached a file to ticket {{code}} "{{title}}":',
    'ticketAttachment.file': 'File:',
    'ticketAttachment.button': 'View Attachment',

    // Common ticket field labels
    'ticket.code': 'Code:',
    'ticket.title': 'Title:',
    'ticket.type': 'Type:',
    'ticket.createdBy': 'Created by:',
    'ticket.project': 'Project:',
    'ticket.assignedBy': 'Assigned by:',
    'ticket.from': 'From:',
    'ticket.to': 'To:',
    'ticket.by': 'By:',
    'ticket.ticket': 'Ticket:',
    'ticket.accessTicket': 'Access the ticket:',

    // Ticket type labels
    'ticketType.system_error': 'System Error',
    'ticketType.question': 'Question',
    'ticketType.improvement': 'Improvement Request',
    'ticketType.security': 'Security/Access',

    // Ticket status labels
    'ticketStatus.open': 'Open',
    'ticketStatus.in_analysis': 'In Analysis',
    'ticketStatus.awaiting_customer': 'Awaiting Customer Response',
    'ticketStatus.awaiting_third_party': 'Awaiting Third Party',
    'ticketStatus.finished': 'Finished',

    // Common
    'common.hello': 'Hi {{name}}!',
  },
};

export function t(locale: Locale, key: string, params?: Record<string, string | number>): string {
  let text = translations[locale]?.[key] ?? translations['pt-BR'][key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replaceAll(`{{${k}}}`, String(v));
    }
  }
  return text;
}

export function getStatusLabel(locale: Locale, status: string): string {
  const key = `ticketStatus.${status}`;
  return translations[locale]?.[key] ?? translations['pt-BR'][key] ?? status;
}

export function getTypeLabel(locale: Locale, type: string): string {
  const key = `ticketType.${type}`;
  return translations[locale]?.[key] ?? translations['pt-BR'][key] ?? type;
}

export function toLocale(value: string | null | undefined): Locale {
  return value === 'en-US' ? 'en-US' : 'pt-BR';
}
