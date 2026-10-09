import {
    listPlanVersions,
    publishPlanVersion,
} from '#services/subscription-plans.service.js';
import { subscriptionPlanSchema } from '#schemas/subscription-plans.schema.js';
import { respondWithError, respondWithSuccess } from '#utils/response.js';

const PLAN_CODES = new Set(['FREE', 'PRO', 'BUSINESS']);

export async function list(req, res) {
    try {
        return respondWithSuccess(
            res,
            200,
            'Subscription plan versions retrieved',
            await listPlanVersions()
        );
    } catch (error) {
        console.error('Unable to list subscription plans:', error.message);
        return respondWithError(res, 500, 'Unable to retrieve subscription plans');
    }
}

export async function publish(req, res) {
    const planCode = String(req.params.plan || '').toUpperCase();
    if (!PLAN_CODES.has(planCode))
        return respondWithError(res, 400, 'Invalid subscription plan');
    const { error, value } = subscriptionPlanSchema.validate(req.body);
    if (error)
        return respondWithError(res, 400, error.details[0].message);
    try {
        const result = await publishPlanVersion(planCode, value);
        return respondWithSuccess(
            res,
            201,
            'Subscription plan version published',
            result
        );
    } catch (requestError) {
        console.error(
            'Unable to publish subscription plan:',
            requestError.message
        );
        return respondWithError(res, 500, 'Unable to publish subscription plan');
    }
}
