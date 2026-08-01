import SupportTicket from "#models/support.tickets.model.js";
import { supportTicketSchema, ticketReplySchema } from "#schemas/support.tickets.schema.js";
import { S3upload } from "#services/s3bucket.js";
import { createTicketWithOpeningMessage, getTicketById, getTickets, replyToTicket } from "#services/support.js";
import ERROR_CODES from "#utils/error.codes.js";
import { generateTicketNumber, ROLES } from "#utils/helpers.js";
import { respondWithError, respondWithSuccess } from "#utils/response.js";

export const createSupportTicket = async (req, res) => {
    try {
        const user = req.session?.user;
        if (!user) {
            return respondWithError(res, 401, 'Unauthorized: Login to continue', ERROR_CODES.UNAUTHORIZED);
        }

        const { error, value } = supportTicketSchema.validate(req.body, { abortEarly: false, stripUnknown: true });
        if (error) return respondWithError(res, 400, error.details[0].message, ERROR_CODES.VALIDATION_ERROR);

        let vendorId = null;
        let category = 'internal';
        if (user.role === ROLES.CUSTOMER) {
            vendorId = user.vendor_id;
            category = 'external';
        }

        const { attachment } = value;

        let attachmentUrl;
        if (attachment) {
            const filename = `images/support/attachments/${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            const result = await S3upload(attachment, filename);

            if (result.error) {
                throw new Error(`Failed to upload attachment: ${result.message}`);
            }

            attachmentUrl = result.url;
        }

        value.attachment = attachmentUrl;
        value.category = category;

        const ticket = await createTicketWithOpeningMessage(vendorId, user.id, value);

        return respondWithSuccess(res, 201, 'Support ticket created successfully', ticket);

    } catch (error) {
        console.error(error);
        return respondWithError(res, 500, 'Internal server error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const fetchSupportTickets = async (req, res) => {
    try {
        const user = req.session?.user;
        if (!user) {
            return respondWithError(res, 401, 'Unauthorized: Login to continue', ERROR_CODES.UNAUTHORIZED);
        }

        const { offset, limit } = req.pagination;

        const { status, priority, search } = req.query;

        let vendorId = null;
        if (user.role === ROLES.VENDOR) {
            vendorId = user.id;
        } else if (user.role === ROLES.VENDOR_ADMIN) {
            vendorId = user.vendor_id;
        } else if (user.role === ROLES.CUSTOMER) {
            vendorId = user.vendor_id;
        }

        const result = await getTickets(vendorId, offset, limit, { status, priority, search });

        return respondWithSuccess(res, 200, 'Tickets fetched successfully', result);

    } catch (error) {
        console.error(error);
        return respondWithError(res, 500, 'Internal server error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const getSupportTicket = async (req, res) => {
    try {
        const user = req.session?.user;
        if (!user) {
            return respondWithError(res, 401, 'Unauthorized: Login to continue', ERROR_CODES.UNAUTHORIZED);
        }

        const ticketId = parseInt(req.params.id);

        let vendorId = null;
        if (user.role === ROLES.VENDOR) {
            vendorId = user.id;
        } else if (user.role === ROLES.VENDOR_ADMIN) {
            vendorId = user.vendor_id;
        } else if (user.role === ROLES.CUSTOMER) {
            vendorId = user.vendor_id;
        }

        const ticket = await getTicketById(ticketId, vendorId);

        return respondWithSuccess(res, 200, 'Ticket fetched successfully', ticket);

    } catch (error) {
        console.error(error);
        return respondWithError(res, 500, 'Internal server error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const replyToSupportTicket = async (req, res) => {
    try {
        const user = req.session?.user;
        if (!user) {
            return respondWithError(res, 401, 'Unauthorized: Login to continue', ERROR_CODES.UNAUTHORIZED);
        }

        const ticketId = parseInt(req.params.ticketId);

        const { error, value } = ticketReplySchema.validate(req.body, { abortEarly: false, stripUnknown: true });
        if (error) return respondWithError(res, 400, error.details[0].message, ERROR_CODES.VALIDATION_ERROR);

        let vendorId = null;
        if (user.role === ROLES.VENDOR) {
            vendorId = user.id;
        } else if (user.role === ROLES.VENDOR_ADMIN) {
            vendorId = user.vendor_id;
        } else if (user.role === ROLES.CUSTOMER) {
            vendorId = user.vendor_id;
        }

        const { attachment } = value;

        let attachmentUrl;
        if (attachment) {
            const filename = `images/support/attachments/${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            const result = await uploadFileToS3(attachment, filename);

            if (result.error) {
                throw new Error(`Failed to upload attachment: ${result.message}`);
            }

            attachmentUrl = result.url;
        }

        value.attachment = attachmentUrl;
        
        const reply = await replyToTicket(ticketId, user.id, value.message, value.attachment);

        return respondWithSuccess(res, 201, 'Reply sent successfully', reply);

    } catch (error) {
        console.error(error);
        return respondWithError(res, 500, 'Internal server error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};