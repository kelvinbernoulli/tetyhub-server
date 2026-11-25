import Payout from '#models/payout.model.js';
import {
    payoutAccountSchema,
    payoutListSchema,
    payoutPreferencesSchema,
    payoutRequestSchema,
    taxDeductionSchema,
} from '#schemas/payout.schema.js';
import ERROR_CODES from '#utils/error.codes.js';
import { respondWithError, respondWithSuccess } from '#utils/response.js';
import { minorUnits } from '#utils/checkout.js';

const fail = (res, error) => {
    const status = error.status ?? error.response?.status ?? 500;
    const message = status >= 500
        ? 'Payout service is temporarily unavailable'
        : error.response?.data?.message ?? error.message;
    console.error('Payout request failed:', error.message);
    return respondWithError(
        res,
        status,
        message,
        status === 400 ? ERROR_CODES.VALIDATION_ERROR :
            status === 403 ? ERROR_CODES.FORBIDDEN :
                status === 404 ? ERROR_CODES.RESOURCE_NOT_FOUND :
                    status === 409 ? ERROR_CODES.RESOURCE_UPDATE_FAILED :
                        ERROR_CODES.INTERNAL_SERVER_ERROR
    );
};

const validated = (schema, input) => {
    const { error, value } = schema.validate(input, { abortEarly: false });
    if (error) throw Object.assign(new Error(error.details[0].message), { status: 400 });
    return value;
};

export const getDashboard = async (req, res) => {
    try {
        const vendorId = req.auth.vendorId;
        const [preferences, summary, payouts] = await Promise.all([
            Payout.preferences(vendorId),
            Payout.summary(vendorId),
            Payout.history(vendorId, { limit: 10, offset: 0 }),
        ]);
        return respondWithSuccess(res, 200, 'Payout dashboard fetched successfully', {
            preferences,
            summary,
            recent_payouts: payouts.items,
        });
    } catch (error) {
        return fail(res, error);
    }
};

export const getPreferences = async (req, res) => {
    try {
        const result = await Payout.preferences(req.auth.vendorId);
        return respondWithSuccess(res, 200, 'Payout preferences fetched successfully', result);
    } catch (error) {
        return fail(res, error);
    }
};

export const getBanks = async (_req, res) => {
    try {
        const banks = await Payout.banks();
        return respondWithSuccess(res, 200, 'Supported banks fetched successfully', banks);
    } catch (error) {
        return fail(res, error);
    }
};

export const verifyBankAccount = async (req, res) => {
    try {
        const { account_number, bank_code } = validated(payoutAccountSchema, req.body);
        const result = await Payout.verifyBankAccount({
            accountNumber: account_number,
            bankCode: bank_code,
        });
        return respondWithSuccess(res, 200, 'Bank account verified successfully', result);
    } catch (error) {
        return fail(res, error);
    }
};

export const updatePreferences = async (req, res) => {
    try {
        const payload = validated(payoutPreferencesSchema, req.body);
        const result = await Payout.updatePreferences(req.auth.vendorId, payload);
        return respondWithSuccess(res, 200, 'Payout preferences updated successfully', result);
    } catch (error) {
        return fail(res, error);
    }
};

export const setBankAccount = async (req, res) => {
    try {
        const { account_number, bank_code } = validated(payoutAccountSchema, req.body);
        const result = await Payout.setBankAccount(req.auth.vendorId, {
            accountNumber: account_number,
            bankCode: bank_code,
            email: req.auth.email,
        });
        return respondWithSuccess(res, 200, 'Payout bank account verified successfully', result);
    } catch (error) {
        return fail(res, error);
    }
};

export const requestPayout = async (req, res) => {
    try {
        const { amount } = validated(payoutRequestSchema, req.body ?? {});
        const payout = await Payout.createForVendor(req.auth.vendorId, {
            mode: 'manual',
            createdByUserId: req.auth.userId,
            amountMinor: amount == null ? null : minorUnits(amount),
        });
        if (!payout)
            return respondWithError(res, 409, 'Available balance is below the minimum payout amount', ERROR_CODES.RESOURCE_UPDATE_FAILED);
        return respondWithSuccess(res, 202, 'Payout request accepted', payout);
    } catch (error) {
        return fail(res, error);
    }
};

export const getLedger = async (req, res) => {
    try {
        const query = validated(payoutListSchema, req.query);
        const result = await Payout.ledger(req.auth.vendorId, query);
        return respondWithSuccess(res, 200, 'Vendor ledger fetched successfully',
            res.paginate(result.items, result.total));
    } catch (error) {
        return fail(res, error);
    }
};

export const getHistory = async (req, res) => {
    try {
        const query = validated(payoutListSchema, req.query);
        const result = await Payout.history(req.auth.vendorId, query);
        return respondWithSuccess(res, 200, 'Payout history fetched successfully',
            res.paginate(result.items, result.total));
    } catch (error) {
        return fail(res, error);
    }
};

export const adminList = async (req, res) => {
    try {
        const query = validated(payoutListSchema, req.query);
        const result = await Payout.adminList(query);
        return respondWithSuccess(res, 200, 'Payouts fetched successfully',
            res.paginate(result.items, result.total));
    } catch (error) {
        return fail(res, error);
    }
};

export const retry = async (req, res) => {
    try {
        const id = Number(req.params.payoutId);
        if (!Number.isSafeInteger(id) || id <= 0)
            throw Object.assign(new Error('Invalid payout ID'), { status: 400 });
        const payout = await Payout.retry(id, req.auth.userId);
        return respondWithSuccess(res, 202, 'Payout retry submitted', payout);
    } catch (error) {
        return fail(res, error);
    }
};

export const addTaxDeduction = async (req, res) => {
    try {
        const vendorId = Number(req.params.vendorId);
        if (!Number.isSafeInteger(vendorId) || vendorId <= 0)
            throw Object.assign(new Error('Invalid vendor ID'), { status: 400 });
        const { amount, note } = validated(taxDeductionSchema, req.body);
        const summary = await Payout.addTaxDeduction(
            vendorId,
            minorUnits(amount),
            note,
            req.auth.userId
        );
        return respondWithSuccess(res, 201, 'Vendor tax debit recorded', summary);
    } catch (error) {
        return fail(res, error);
    }
};