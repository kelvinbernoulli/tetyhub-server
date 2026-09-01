import Joi from "joi";

const base64ImagePattern = /^data:image\/(png|jpeg|jpg);base64,[A-Za-z0-9+/]+={0,2}$/;

export const createChildsubcategorySchema = Joi.object({
    name: Joi.string().trim().min(2).max(100).required().label('Name'),
    subcategory_id: Joi.number().integer().positive().required().label('Subcategory ID'),
    description: Joi.string().trim().max(500).optional().label('Description'),
    image: Joi.string().pattern(base64ImagePattern).optional().label('Image'),
});

export const updateChildsubcategorySchema = Joi.object({
    name: Joi.string().trim().min(2).max(100).label('Name'),
    subcategory_id: Joi.number().integer().positive().optional().label('Subcategory ID'),
    description: Joi.string().trim().max(500).allow('', null).label('Description'),
    image: Joi.string().pattern(base64ImagePattern).allow('', null).label('Image'),
    status: Joi.boolean().valid(true, false).label('Status'),
}).min(1);

export default {
    createChildsubcategorySchema,
    updateChildsubcategorySchema,
};