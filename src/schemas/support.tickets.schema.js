import Joi from 'joi';

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_BASE64_SIZE = 7 * 1024 * 1024;

const attachment = Joi.string()
    .max(MAX_BASE64_SIZE)
    .pattern(
        /^data:(image\/(png|jpeg|jpg)|application\/pdf);base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
    )
    .custom((value, helpers) => {
        const [, base64] = value.split(',');

        if (!base64) {
            return helpers.error('any.invalid');
        }

        const file = Buffer.from(base64, 'base64');

        // Actual decoded file size
        if (!file.length || file.length > MAX_FILE_SIZE) {
            return helpers.error('any.invalid');
        }

        let valid = false;

        // PDF
        if (value.startsWith('data:application/pdf')) {
            valid =
                file.length >= 5 &&
                file.subarray(0, 5).toString() === '%PDF-';
        }

        // PNG
        else if (value.startsWith('data:image/png')) {
            valid =
                file.length >= 8 &&
                file.subarray(0, 8).equals(
                    Buffer.from([
                        137, 80, 78, 71,
                        13, 10, 26, 10
                    ])
                );
        }

        // JPEG
        else {
            valid =
                file.length >= 3 &&
                file.subarray(0, 3).equals(
                    Buffer.from([0xff, 0xd8, 0xff])
                );
        }

        return valid
            ? value
            : helpers.error('any.invalid');
    })
    .label('Attachment');


const priority = Joi.string()
    .valid('low', 'medium', 'high');

const status = Joi.string()
    .valid(
        'open',
        'in_progress',
        'waiting_on_user',
        'resolved'
    );

const category = Joi.string()
    .valid(
        'general',
        'account',
        'order',
        'booking',
        'payment',
        'technical'
    );


export const supportTicketSchema = Joi.object({
    subject: Joi.string()
        .trim()
        .min(3)
        .max(200)
        .required()
        .label('Subject'),

    category: category
        .default('general'),

    priority: priority
        .default('medium'),

    message: Joi.string()
        .trim()
        .min(1)
        .max(5000)
        .required()
        .label('Message'),

    attachment
}).unknown(false);


export const ticketReplySchema = Joi.object({
    message: Joi.string()
        .trim()
        .min(1)
        .max(5000)
        .label('Message'),

    attachment,

    is_internal: Joi.boolean()
        .strict()
})
.or('message', 'attachment');


export const ticketUpdateSchema = Joi.object({
    status,

    priority,

    assigned_to: Joi.number()
        .integer()
        .positive()
        .allow(null)
})
.min(1);


export const ticketFilterSchema = Joi.object({
    status,

    priority,

    category,

    assigned_to: Joi.number()
        .integer()
        .positive(),

    search: Joi.string()
        .trim()
        .max(200)
});


export const ticketMessagesSchema = Joi.object({
    after: Joi.number()
        .integer()
        .min(0)
        .default(0),

    limit: Joi.number()
        .integer()
        .min(1)
        .max(100)
        .default(50)
});