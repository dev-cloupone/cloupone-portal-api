import { eq, and, inArray } from 'drizzle-orm';
import { db } from '../db';
import { tickets, ticketComments, users, projects, clients, projectAllocations, projectNotificationSettings, projectNotificationEmails } from '../db/schema';
import * as notificationService from './notification.service';
import { getEmailProvider } from '../providers/email';
import { buildTicketCreatedEmail } from '../emails/ticket-created';
import { buildTicketAssignedEmail } from '../emails/ticket-assigned';
import { buildTicketStatusChangedEmail } from '../emails/ticket-status-changed';
import { buildTicketCommentEmail } from '../emails/ticket-comment';
import { buildTicketAttachmentEmail } from '../emails/ticket-attachment';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { toLocale, t } from '../emails/translations';

function getTicketUrl(ticketId: string): string {
  return `${env.FRONTEND_URL}/tickets/${ticketId}`;
}

async function getTicketData(ticketId: string) {
  const [ticket] = await db
    .select({
      id: tickets.id,
      code: tickets.code,
      title: tickets.title,
      type: tickets.type,
      status: tickets.status,
      isVisibleToClient: tickets.isVisibleToClient,
      ccEmails: tickets.ccEmails,
      projectId: tickets.projectId,
      projectName: projects.name,
      createdBy: tickets.createdBy,
      assignedTo: tickets.assignedTo,
      creatorLocale: users.locale,
    })
    .from(tickets)
    .innerJoin(projects, eq(tickets.projectId, projects.id))
    .innerJoin(users, eq(tickets.createdBy, users.id))
    .where(eq(tickets.id, ticketId))
    .limit(1);

  return ticket;
}

async function sendToCcRecipients(
  ticket: { ccEmails: string[] | null; isVisibleToClient: boolean },
  emailData: { subject: string; text: string; html: string },
  opts?: { skipIfInternal?: boolean },
) {
  if (!ticket.isVisibleToClient) return;
  if (opts?.skipIfInternal) return;
  if (!ticket.ccEmails || ticket.ccEmails.length === 0) return;

  const emailProvider = getEmailProvider();
  const ccList = ticket.ccEmails;
  await emailProvider.send({
    to: ccList[0],
    cc: ccList.length > 1 ? ccList.slice(1).join(', ') : undefined,
    subject: emailData.subject,
    text: emailData.text,
    html: emailData.html,
  });
}

async function getUserData(userId: string) {
  const [user] = await db
    .select({ id: users.id, name: users.name, email: users.email, role: users.role, locale: users.locale })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return user;
}

export async function notifyTicketCreated(ticketId: string) {
  try {
    const ticket = await getTicketData(ticketId);
    if (!ticket) return;

    const creator = await getUserData(ticket.createdBy);
    if (!creator) return;

    // 1. Consult project notification settings
    const settings = await db
      .select({
        userId: projectNotificationSettings.userId,
        channelEmail: projectNotificationSettings.channelEmail,
        channelInApp: projectNotificationSettings.channelInApp,
        userEmail: users.email,
        userName: users.name,
        userLocale: users.locale,
      })
      .from(projectNotificationSettings)
      .innerJoin(users, eq(projectNotificationSettings.userId, users.id))
      // Defesa em profundidade: um registro orfao (usuario desalocado) nao deve
      // disparar notificacao mesmo que a limpeza em removeAllocation falhe.
      .innerJoin(projectAllocations, and(
        eq(projectAllocations.userId, projectNotificationSettings.userId),
        eq(projectAllocations.projectId, projectNotificationSettings.projectId),
      ))
      .where(and(
        eq(projectNotificationSettings.projectId, ticket.projectId),
        eq(projectNotificationSettings.eventType, 'ticket_created'),
        eq(users.isActive, true),
      ));

    const emailProvider = getEmailProvider();
    const ticketUrl = getTicketUrl(ticket.id);

    for (const setting of settings) {
      // Don't notify the ticket creator
      if (setting.userId === ticket.createdBy) continue;

      // 2. In-App + SSE first: local, cheap and independent of an external provider.
      if (setting.channelInApp) {
        try {
          // O texto fica congelado no locale vigente na criacao: trocar de idioma
          // depois nao retraduz notificacoes antigas.
          const locale = toLocale(setting.userLocale);
          await notificationService.create({
            userId: setting.userId,
            type: 'ticket_created',
            title: t(locale, 'notification.ticketCreated.title'),
            body: t(locale, 'notification.ticketCreated.body', {
              code: ticket.code,
              title: ticket.title,
              createdBy: creator.name,
              projectName: ticket.projectName,
            }),
            link: `/tickets/${ticket.id}`,
            metadata: {
              ticketId: ticket.id,
              projectId: ticket.projectId,
              ticketCode: ticket.code,
              projectName: ticket.projectName,
              createdByName: creator.name,
              ticketTitle: ticket.title,
            },
          });
        } catch (err) {
          logger.error({ err, ticketId, userId: setting.userId }, 'Failed to create in-app notification');
        }
      }

      // 3. Email
      if (setting.channelEmail) {
        try {
          const emailData = buildTicketCreatedEmail({
            projectName: ticket.projectName,
            ticketCode: ticket.code,
            ticketTitle: ticket.title,
            ticketType: ticket.type,
            createdByName: creator.name,
            ticketUrl,
            locale: toLocale(setting.userLocale),
          });

          await emailProvider.send({
            to: setting.userEmail,
            subject: emailData.subject,
            text: emailData.text,
            html: emailData.html,
          });
        } catch (err) {
          logger.error({ err, ticketId, to: setting.userEmail }, 'Failed to send ticket created email');
        }
      }
    }

    // 4. External project emails
    const externalEmails = await db
      .select({ email: projectNotificationEmails.email })
      .from(projectNotificationEmails)
      .where(and(
        eq(projectNotificationEmails.projectId, ticket.projectId),
        eq(projectNotificationEmails.eventType, 'ticket_created'),
      ));

    for (const { email } of externalEmails) {
      try {
        const emailData = buildTicketCreatedEmail({
          projectName: ticket.projectName,
          ticketCode: ticket.code,
          ticketTitle: ticket.title,
          ticketType: ticket.type,
          createdByName: creator.name,
          ticketUrl,
          locale: 'pt-BR',
        });

        await emailProvider.send({
          to: email,
          subject: emailData.subject,
          text: emailData.text,
          html: emailData.html,
        });
      } catch (err) {
        logger.error({ err, ticketId, to: email }, 'Failed to send ticket created email to external address');
      }
    }

    // 5. Maintain CC email behavior (independent of settings)
    try {
      const ccEmailData = buildTicketCreatedEmail({
        projectName: ticket.projectName,
        ticketCode: ticket.code,
        ticketTitle: ticket.title,
        ticketType: ticket.type,
        createdByName: creator.name,
        ticketUrl,
        locale: toLocale(ticket.creatorLocale),
      });
      await sendToCcRecipients(ticket, ccEmailData);
    } catch (err) {
      logger.error({ err, ticketId }, 'Failed to send ticket created email to CC recipients');
    }

    logger.info({ ticketId }, 'Ticket created notifications sent');
  } catch (err) {
    logger.error({ err, ticketId }, 'Failed to send ticket created notifications');
  }
}

export async function notifyTicketAssigned(ticketId: string, assignedBy: string) {
  try {
    const ticket = await getTicketData(ticketId);
    if (!ticket || !ticket.assignedTo) return;
    if (ticket.assignedTo === assignedBy) return;

    const assignee = await getUserData(ticket.assignedTo);
    if (!assignee) return;

    const assigner = await getUserData(assignedBy);
    if (!assigner) return;

    const ticketUrl = getTicketUrl(ticket.id);

    const emailData = buildTicketAssignedEmail({
      consultantName: assignee.name,
      ticketCode: ticket.code,
      ticketTitle: ticket.title,
      projectName: ticket.projectName,
      assignedByName: assigner.name,
      ticketUrl,
      locale: toLocale(assignee.locale),
    });

    const emailProvider = getEmailProvider();
    await emailProvider.send({
      to: assignee.email,
      subject: emailData.subject,
      text: emailData.text,
      html: emailData.html,
    });

    // Send to CC recipients (without personal greeting, using ticket creator's locale)
    const ccEmailData = buildTicketAssignedEmail({
      ticketCode: ticket.code,
      ticketTitle: ticket.title,
      projectName: ticket.projectName,
      assignedByName: assigner.name,
      ticketUrl,
      locale: toLocale(ticket.creatorLocale),
    });
    await sendToCcRecipients(ticket, ccEmailData);

    logger.info({ ticketId, assignedTo: ticket.assignedTo }, 'Ticket assigned notification sent');
  } catch (err) {
    logger.error({ err, ticketId }, 'Failed to send ticket assigned notification');
  }
}

export async function notifyStatusChanged(ticketId: string, oldStatus: string, newStatus: string, changedBy: string) {
  try {
    const ticket = await getTicketData(ticketId);
    if (!ticket) return;

    const changer = await getUserData(changedBy);
    if (!changer) return;

    const recipientIds = new Set<string>();
    if (ticket.createdBy !== changedBy) recipientIds.add(ticket.createdBy);
    if (ticket.assignedTo && ticket.assignedTo !== changedBy) recipientIds.add(ticket.assignedTo);

    const emailProvider = getEmailProvider();
    const ticketUrl = getTicketUrl(ticket.id);

    if (recipientIds.size > 0) {
      const recipients = await db
        .select({ id: users.id, name: users.name, email: users.email, role: users.role, locale: users.locale })
        .from(users)
        .where(inArray(users.id, [...recipientIds]));

      for (const recipient of recipients) {
        // Don't send to clients if ticket is not visible
        if (recipient.role === 'client' && !ticket.isVisibleToClient) continue;

        const emailData = buildTicketStatusChangedEmail({
          recipientName: recipient.name,
          ticketCode: ticket.code,
          ticketTitle: ticket.title,
          oldStatus,
          newStatus,
          changedByName: changer.name,
          ticketUrl,
          locale: toLocale(recipient.locale),
        });

        await emailProvider.send({
          to: recipient.email,
          subject: emailData.subject,
          text: emailData.text,
          html: emailData.html,
        });
      }
    }

    // Send to CC recipients (using ticket creator's locale)
    const ccEmailData = buildTicketStatusChangedEmail({
      ticketCode: ticket.code,
      ticketTitle: ticket.title,
      oldStatus,
      newStatus,
      changedByName: changer.name,
      ticketUrl,
      locale: toLocale(ticket.creatorLocale),
    });
    await sendToCcRecipients(ticket, ccEmailData);

    logger.info({ ticketId, oldStatus, newStatus }, 'Status changed notifications sent');
  } catch (err) {
    logger.error({ err, ticketId }, 'Failed to send status changed notifications');
  }
}

export async function notifyNewComment(ticketId: string, commentId: string, isInternal: boolean) {
  try {
    const ticket = await getTicketData(ticketId);
    if (!ticket) return;

    const [comment] = await db
      .select({
        id: ticketComments.id,
        userId: ticketComments.userId,
        content: ticketComments.content,
      })
      .from(ticketComments)
      .where(eq(ticketComments.id, commentId))
      .limit(1);

    if (!comment) return;

    const author = await getUserData(comment.userId);
    if (!author) return;

    const recipientIds = new Set<string>();
    if (ticket.createdBy !== comment.userId) recipientIds.add(ticket.createdBy);
    if (ticket.assignedTo && ticket.assignedTo !== comment.userId) recipientIds.add(ticket.assignedTo);

    const emailProvider = getEmailProvider();
    const ticketUrl = getTicketUrl(ticket.id);
    const commentPreview = comment.content.length > 200 ? comment.content.substring(0, 200) + '...' : comment.content;

    if (recipientIds.size > 0) {
      const recipients = await db
        .select({ id: users.id, name: users.name, email: users.email, role: users.role, locale: users.locale })
        .from(users)
        .where(inArray(users.id, [...recipientIds]));

      for (const recipient of recipients) {
        // Internal comments: don't send to clients
        if (isInternal && recipient.role === 'client') continue;
        // Ticket not visible: don't send to clients
        if (recipient.role === 'client' && !ticket.isVisibleToClient) continue;

        const emailData = buildTicketCommentEmail({
          recipientName: recipient.name,
          ticketCode: ticket.code,
          ticketTitle: ticket.title,
          commentAuthorName: author.name,
          commentPreview,
          ticketUrl,
          locale: toLocale(recipient.locale),
        });

        await emailProvider.send({
          to: recipient.email,
          subject: emailData.subject,
          text: emailData.text,
          html: emailData.html,
        });
      }
    }

    // Send to CC recipients (skip if internal comment, using ticket creator's locale)
    const ccEmailData = buildTicketCommentEmail({
      ticketCode: ticket.code,
      ticketTitle: ticket.title,
      commentAuthorName: author.name,
      commentPreview,
      ticketUrl,
      locale: toLocale(ticket.creatorLocale),
    });
    await sendToCcRecipients(ticket, ccEmailData, { skipIfInternal: isInternal });

    logger.info({ ticketId, commentId, isInternal }, 'Comment notifications sent');
  } catch (err) {
    logger.error({ err, ticketId, commentId }, 'Failed to send comment notifications');
  }
}

export async function notifyNewAttachment(ticketId: string, uploadedBy: string, fileName: string) {
  try {
    const ticket = await getTicketData(ticketId);
    if (!ticket) return;

    const uploader = await getUserData(uploadedBy);
    if (!uploader) return;

    const recipientIds = new Set<string>();
    if (ticket.createdBy !== uploadedBy) recipientIds.add(ticket.createdBy);
    if (ticket.assignedTo && ticket.assignedTo !== uploadedBy) recipientIds.add(ticket.assignedTo);

    const emailProvider = getEmailProvider();
    const ticketUrl = getTicketUrl(ticket.id);

    if (recipientIds.size > 0) {
      const recipients = await db
        .select({ id: users.id, name: users.name, email: users.email, role: users.role, locale: users.locale })
        .from(users)
        .where(inArray(users.id, [...recipientIds]));

      for (const recipient of recipients) {
        // Don't send to clients if ticket is not visible
        if (recipient.role === 'client' && !ticket.isVisibleToClient) continue;

        const emailData = buildTicketAttachmentEmail({
          recipientName: recipient.name,
          ticketCode: ticket.code,
          ticketTitle: ticket.title,
          uploaderName: uploader.name,
          fileName,
          ticketUrl,
          locale: toLocale(recipient.locale),
        });

        await emailProvider.send({
          to: recipient.email,
          subject: emailData.subject,
          text: emailData.text,
          html: emailData.html,
        });
      }
    }

    // Send to CC recipients (using ticket creator's locale)
    const ccEmailData = buildTicketAttachmentEmail({
      ticketCode: ticket.code,
      ticketTitle: ticket.title,
      uploaderName: uploader.name,
      fileName,
      ticketUrl,
      locale: toLocale(ticket.creatorLocale),
    });
    await sendToCcRecipients(ticket, ccEmailData);

    logger.info({ ticketId, uploadedBy, fileName }, 'Attachment notifications sent');
  } catch (err) {
    logger.error({ err, ticketId }, 'Failed to send attachment notifications');
  }
}
