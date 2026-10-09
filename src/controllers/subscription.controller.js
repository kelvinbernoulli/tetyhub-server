import SubscriptionService from '#services/subscription.service.js';
import {
    subscriptionCheckoutSchema,
    subscriptionDowngradeSchema,
} from '#schemas/subscription.schema.js';
import { respondWithError, respondWithSuccess } from '#utils/response.js';

function providerId(req) {
    return req.auth?.vendorId ?? req.session?.user?.vendor_id;
}

function reportError(res, error) {
    const status = Number.isInteger(error.status) ? error.status : 500;
    if (status >= 500)
        console.error('Subscription request failed:', error.message);
    return respondWithError(
        res,
        status,
        status < 500 ? error.message : 'Subscription service unavailable'
    );
}

export async function getMe(req, res) {
    try {
        const result = await SubscriptionService.getSubscription(providerId(req));
        return respondWithSuccess(
            res,
            200,
            'Subscription retrieved',
            result
        );
    } catch (error) {
        return reportError(res, error);
    }
}

export async function startTrial(req, res) {
    try {
        const result = await SubscriptionService.startTrial(providerId(req));
        return respondWithSuccess(res, 201, 'PRO trial started', result);
    } catch (error) {
        return reportError(res, error);
    }
}

export async function checkout(req, res) {
    const { error, value } = subscriptionCheckoutSchema.validate(req.body);
    if (error)
        return respondWithError(res, 400, error.details[0].message);
    try {
        const result = await SubscriptionService.startCheckout(
            providerId(req),
            value.plan,
            { renewalMode: value.renewalMode }
        );
        return respondWithSuccess(
            res,
            200,
            'Subscription checkout initialized',
            result
        );
    } catch (requestError) {
        return reportError(res, requestError);
    }
}

export async function downgrade(req, res) {
    const { error, value } = subscriptionDowngradeSchema.validate(req.body);
    if (error)
        return respondWithError(res, 400, error.details[0].message);
    try {
        const result = await SubscriptionService.scheduleDowngrade(
            providerId(req),
            value.plan
        );
        return respondWithSuccess(
            res,
            200,
            'Downgrade scheduled for the next renewal',
            result
        );
    } catch (requestError) {
        return reportError(res, requestError);
    }
}

export async function cancel(req, res) {
    try {
        const result = await SubscriptionService.cancelAtPeriodEnd(
            providerId(req)
        );
        return respondWithSuccess(
            res,
            200,
            'Subscription cancellation scheduled',
            result
        );
    } catch (error) {
        return reportError(res, error);
    }
}
