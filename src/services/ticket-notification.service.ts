import { eq, and, or, inArray } from 'drizzle-orm';
import { db } from '../db';
import { tickets, ticketComments, users, projects, clients, projectAllocations } from '../db/schema';
import { getEmailProvider } from '../providers/email';
import { buildTicketCreatedEmail } from '../emails/ticket-created';
import { buildTicketAssignedEmail } from '../emails/ticket-assigned';
import { buildTicketStatusChangedEmail } from '../emails/ticket-status-changed';
import { buildTicketCommentEmail } from '../emails/ticket-comment';
import { buildTicketAttachmentEmail } from '../emails/ticket-attachment';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { toLocale } from '../emails/translations';

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
    })
    .from(tickets)
    .innerJoin(projects, eq(tickets.projectId, projects.id))
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

    // Only gestors allocated to the ticket's project receive notifications
    const managers = await db
      .select({ id: users.id, name: users.name, email: users.email, locale: users.locale })
      .from(users)
      .innerJoin(projectAllocations, and(
        eq(projectAllocations.userId, users.id),
        eq(projectAllocations.projectId, ticket.projectId),
      ))
      .where(and(eq(users.role, 'gestor'), eq(users.isActive, true)));

    const emailProvider = getEmailProvider();
    const ticketUrl = getTicketUrl(ticket.id);

    for (const manager of managers) {
      if (manager.id === ticket.createdBy) continue;

      const emailData = buildTicketCreatedEmail({
        projectName: ticket.projectName,
        ticketCode: ticket.code,
        ticketTitle: ticket.title,
        ticketType: ticket.type,
        createdByName: creator.name,
        ticketUrl,
        locale: toLocale(manager.locale),
      });

      await emailProvider.send({
        to: manager.email,
        subject: emailData.subject,
        text: emailData.text,
        html: emailData.html,
      });
    }

    // Send to CC recipients
    const ccEmailData = buildTicketCreatedEmail({
      projectName: ticket.projectName,
      ticketCode: ticket.code,
      ticketTitle: ticket.title,
      ticketType: ticket.type,
      createdByName: creator.name,
      ticketUrl,
    });
    await sendToCcRecipients(ticket, ccEmailData);

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

    // Send to CC recipients (without personal greeting)
    const ccEmailData = buildTicketAssignedEmail({
      ticketCode: ticket.code,
      ticketTitle: ticket.title,
      projectName: ticket.projectName,
      assignedByName: assigner.name,
      ticketUrl,
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

    // Send to CC recipients
    const ccEmailData = buildTicketStatusChangedEmail({
      ticketCode: ticket.code,
      ticketTitle: ticket.title,
      oldStatus,
      newStatus,
      changedByName: changer.name,
      ticketUrl,
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

    // Send to CC recipients (skip if internal comment)
    const ccEmailData = buildTicketCommentEmail({
      ticketCode: ticket.code,
      ticketTitle: ticket.title,
      commentAuthorName: author.name,
      commentPreview,
      ticketUrl,
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

    // Send to CC recipients
    const ccEmailData = buildTicketAttachmentEmail({
      ticketCode: ticket.code,
      ticketTitle: ticket.title,
      uploaderName: uploader.name,
      fileName,
      ticketUrl,
    });
    await sendToCcRecipients(ticket, ccEmailData);

    logger.info({ ticketId, uploadedBy, fileName }, 'Attachment notifications sent');
  } catch (err) {
    logger.error({ err, ticketId }, 'Failed to send attachment notifications');
  }
}
