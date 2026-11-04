import Joi from "joi";

const ACCEPTED_ID_DOCUMENTS = ["PP", "NIN", "BVN"];
const ACCEPTED_ID_COUNTRIES = ["NG"];
const ACCEPTED_KYC_STATUS = ["approved", "declined"];
const ACCEPTED_KYC_UPDATE_TYPES = ["nin", "bvn", "pp", "business", "address"];

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

const image = Joi.string()
    .max(Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 64)
    .pattern(/^data:image\/(?:png|jpeg|jpg);base64,[A-Za-z0-9+/]+={0,2}$/)
    .custom((value, helpers) => {
        const encoded = value.slice(value.indexOf(',') + 1);
        const bytes = Buffer.from(encoded, 'base64');
        if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) return helpers.error('any.invalid');
        if (bytes.toString('base64') !== encoded) return helpers.error('any.invalid'); // malformed base64
        const looksLikeImage =
            bytes.subarray(0, 4).equals(PNG_MAGIC) || bytes.subarray(0, 3).equals(JPEG_MAGIC);
        return looksLikeImage ? value : helpers.error('any.invalid');
    })
    .messages({
        'string.pattern.base': '{{#label}} must be a PNG or JPEG data URL',
        'any.invalid': '{{#label}} must be a PNG or JPEG image of at most 10 MB',
    });

export const identitySchema = Joi.object({
    id_type: Joi.string().valid(...ACCEPTED_ID_DOCUMENTS).required().label('ID type'),
    id_number: Joi.string().trim().uppercase().required()
        .when('id_type', {
            switch: [
                { is: 'NIN', then: Joi.string().pattern(/^\d{11}$/) },
                { is: 'BVN', then: Joi.string().pattern(/^\d{11}$/) },
                { is: 'PP', then: Joi.string().pattern(/^[A-Z0-9]{6,12}$/) },
            ],
        })
        .messages({ 'string.pattern.base': '{{#label}} has an invalid format' })
        .label('ID number'),
    document_number: Joi.string().trim().uppercase().max(50).optional().label('document number'),
    id_document: Joi.when('id_type', {
        is: 'PP',
        then: image.required(),
        otherwise: Joi.forbidden(),
    }).label('ID document'),
    selfie_image: image.required().label('selfie'),
    country: Joi.string().valid(...ACCEPTED_ID_COUNTRIES).required().label('country document'),
});

export const businessSchema = Joi.object({
    business_name: Joi.string().trim().min(2).max(255).required().label('business name'),
    registration_number: Joi.string().trim().uppercase().pattern(/^[A-Z0-9/-]{3,20}$/).required()
        .messages({ 'string.pattern.base': '{{#label}} has an invalid format' })
        .label('registration number'),
    company_type: Joi.string().valid('BN', 'RC', 'IT', 'LP', 'LLP').default('RC').label('company type'),
    business_document: image.required().label('business document'),
    business_address: Joi.string().trim().min(5).max(500).required().label('business address'),
});

export const addressSchema = Joi.object({
    address: Joi.string().trim().min(8).max(500).required().label('address'),
    house_number: Joi.string().trim().max(30).required().label('house number'),
    landmark: Joi.string().trim().max(255).allow('', null).optional().label('landmark'),
    city: Joi.string().trim().min(2).max(100).required().label('city'),
    state: Joi.string().trim().min(2).max(100).required().label('state'),
    lga: Joi.string().trim().min(2).max(100).required().label('LGA'),
    street: Joi.string().trim().min(2).max(255).required().label('street'),
    address_verification_due_date: Joi.date().iso().optional().label('address verification due date'),
});

export const kycUpdateSchema = Joi.object({
    kyc_type: Joi.string().valid(...ACCEPTED_KYC_UPDATE_TYPES).required().label('KYC type'),
    user_id: Joi.number().integer().positive().required().label('user ID'),
    status: Joi.string().valid(...ACCEPTED_KYC_STATUS).required().label('status'),
    reason: Joi.string().trim().min(3).max(500)
        .when('status', { is: 'declined', then: Joi.required(), otherwise: Joi.optional() })
        .label('reason'),
});
