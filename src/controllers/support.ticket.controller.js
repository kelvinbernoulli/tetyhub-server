import {
    supportTicketSchema,
    ticketReplySchema,
    ticketUpdateSchema,
    ticketFilterSchema,
    ticketMessagesSchema,
} from '#schemas/support.tickets.schema.js';
import { S3upload, S3delete } from '#services/s3bucket.js';
import {
    createTicketWithOpeningMessage,
    getTicketById,
    getTickets,
    replyToTicket,
    getTicketMessages,
    updateTicket,
    getSupportAgents,
    checkReplyAccess,
} from '#services/support.js';
import ERROR_CODES from '#utils/error.codes.js';
import { isPlatformActor } from '#utils/access-control.js';
import { respondWithError, respondWithSuccess } from '#utils/response.js';
import { randomUUID } from 'node:crypto';

const getActor = (req) => {
    if (!req.auth)
        throw Object.assign(new Error('Unauthorized: Login to continue'), {
            status: 401,
        });
    return {
        ...req.auth,
        supportStaff:
            req.supportStaff === true && isPlatformActor(req.auth.role),
    };
};
const validate = (schema, data) => {
    const { error, value } = schema.validate(data ?? {}, {
        abortEarly: false,
        stripUnknown: true,
    });
    if (error)
        throw Object.assign(new Error(error.details[0].message), {
            status: 400,
        });
    return value;
};
const getTicketId = (req) => {
    const id = Number(req.params.ticketId);
    if (!Number.isSafeInteger(id) || id <= 0)
        throw Object.assign(new Error('Invalid ticket ID'), { status: 400 });
    return id;
};
const handleError = (res, error) => {
    const status = error.status || 500;
    const codes = {
        400: ERROR_CODES.VALIDATION_ERROR,
        401: ERROR_CODES.UNAUTHORIZED,
        403: ERROR_CODES.FORBIDDEN,
        404: ERROR_CODES.RESOURCE_NOT_FOUND,
    };
    if (status === 500) console.error(error);
    return respondWithError(
        res,
        status,
        status === 500 ? 'Internal server error' : error.message,
        codes[status] || ERROR_CODES.INTERNAL_SERVER_ERROR
    );
};

// Clean up uploaded files when the database operation fails.
const withAttachment = async (data, work) => {
    let key;
    try {
        if (data.attachment) {
            key = `images/support/attachments/${randomUUID()}`;
            const result = await S3upload(data.attachment, key);
            if (result.error) throw new Error('Failed to upload attachment');
            data.attachment = result.url;
        }
        return await work(data);
    } catch (error) {
        if (key) {
            try {
                await S3delete(key);
            } catch (cleanupError) {
                console.error(cleanupError);
            }
        }
        throw error;
    }
};

export const createSupportTicket = async (req, res) => {
    try {
        const actor = getActor(req);
        const value = validate(supportTicketSchema, req.body);
        const ticket = await withAttachment(value, (data) =>
            createTicketWithOpeningMessage(actor, data)
        );
        return respondWithSuccess(
            res,
            201,
            'Support ticket created successfully',
            ticket
        );
    } catch (error) {
        return handleError(res, error);
    }
};

export const fetchSupportTickets = async (req, res) => {
    try {
        const actor = getActor(req);
        const filters = validate(ticketFilterSchema, req.query);
        const { offset = 0, limit = 20 } = req.pagination ?? {};
        const result = await getTickets(actor, offset, limit, filters);
        return respondWithSuccess(
            res,
            200,
            'Tickets fetched successfully',
            result
        );
    } catch (error) {
        return handleError(res, error);
    }
};

export const getSupportTicket = async (req, res) => {
    try {
        const actor = getActor(req);
        const ticketId = getTicketId(req);
        const ticket = await getTicketById(ticketId, actor);
        const messages = await getTicketMessages(
            ticketId,
            actor,
            validate(ticketMessagesSchema, req.query)
        );
        return respondWithSuccess(res, 200, 'Ticket fetched successfully', {
            ...ticket,
            replies: messages.rows,
            has_more: messages.has_more,
            next_cursor: messages.next_cursor,
        });
    } catch (error) {
        return handleError(res, error);
    }
};

export const replyToSupportTicket = async (req, res) => {
    try {
        const actor = getActor(req);
        const ticketId = getTicketId(req);
        const value = validate(ticketReplySchema, req.body);
        checkReplyAccess(actor, value);
        await getTicketById(ticketId, actor);
        const reply = await withAttachment(value, (data) =>
            replyToTicket(ticketId, actor, data)
        );
        return respondWithSuccess(res, 201, 'Reply sent successfully', reply);
    } catch (error) {
        return handleError(res, error);
    }
};

export const fetchTicketMessages = async (req, res) => {
    try {
        const actor = getActor(req);
        const result = await getTicketMessages(
            getTicketId(req),
            actor,
            validate(ticketMessagesSchema, req.query)
        );
        return respondWithSuccess(
            res,
            200,
            'Messages fetched successfully',
            result
        );
    } catch (error) {
        return handleError(res, error);
    }
};

export const updateSupportTicket = async (req, res) => {
    try {
        const actor = getActor(req);
        const ticket = await updateTicket(
            getTicketId(req),
            actor,
            validate(ticketUpdateSchema, req.body)
        );
        return respondWithSuccess(
            res,
            200,
            'Ticket updated successfully',
            ticket
        );
    } catch (error) {
        return handleError(res, error);
    }
};

export const fetchSupportAgents = async (req, res) => {
    try {
        if (!getActor(req).supportStaff)
            throw Object.assign(new Error('Forbidden'), { status: 403 });
        return respondWithSuccess(
            res,
            200,
            'Support agents fetched successfully',
            await getSupportAgents()
        );
    } catch (error) {
        return handleError(res, error);
    }
};
