import { createPayoutBatch, createTransferRecipient, finalizeTransfer as finalizePayoutTransfer, getPayout, listAllPayouts, listPayouts as listVendorPayoutRecords, payoutSummary, retryFailedPayout, updatePayoutPreferences as savePayoutPreferences, updateVendorTaxRate as saveVendorTaxRate } from '#services/vendor-payout.service.js';
import ERROR_CODES from '#utils/error.codes.js';
import { respondWithError, respondWithSuccess } from '#utils/response.js';

const vendorId = (req) => {
    const id = Number(req.auth?.vendorId ?? req.session?.user?.vendor_id);
    if (!Number.isInteger(id) || id < 1) {
        const error = new Error('Vendor authentication required.');
        error.status = 403;
        throw error;
    }
    return id;
};

const handleError = (res, error) => {
    const status = error.status ?? 500;
    return respondWithError(res, status, status < 500 ? error.message : 'Internal server error',
        status < 500 ? ERROR_CODES.VALIDATION_ERROR : ERROR_CODES.INTERNAL_SERVER_ERROR);
};

export const listPayouts = async (req, res) => {
    try {
        return respondWithSuccess(res, 200, 'Payouts fetched successfully',
            await listVendorPayoutRecords(vendorId(req), req.query));
    } catch (error) { return handleError(res, error); }
};

export const getSummary = async (req, res) => {
    try {
        return respondWithSuccess(res, 200, 'Payout summary fetched successfully',
            await payoutSummary(vendorId(req)));
    } catch (error) { return handleError(res, error); }
};

export const createRecipient = async (req, res) => {
    try {
        const { account_name, account_number, bank_code, currency = 'NGN' } = req.body ?? {};
        if (![account_name, account_number, bank_code].every((value) => typeof value === 'string' && value.trim()))
            return respondWithError(res, 400, 'Account name, account number, and bank code are required.', ERROR_CODES.VALIDATION_ERROR);
        const recipient = await createTransferRecipient(vendorId(req), {
            name: account_name.trim(), accountNumber: account_number.trim(),
            bankCode: bank_code.trim(), currency: String(currency).toUpperCase(),
        });
        return respondWithSuccess(res, 201, 'Payout recipient saved successfully', recipient);
    } catch (error) { return handleError(res, error); }
};

export const requestPayout = async (req, res) => {
    try {
        const payouts = await createPayoutBatch(vendorId(req), { onDemand: true });
        return respondWithSuccess(res, 202, 'Payout request queued', payouts);
    } catch (error) { return handleError(res, error); }
};

export const getPayoutById = async (req, res) => {
    try {
        const safeId=Number(req.params.payoutId);
        if(!Number.isSafeInteger(safeId)||safeId<1) return respondWithError(res,404,'Payout not found.',ERROR_CODES.RESOURCE_NOT_FOUND);
        const payout = await getPayout(vendorId(req), safeId);
        if (!payout) return respondWithError(res, 404, 'Payout not found.', ERROR_CODES.RESOURCE_NOT_FOUND);
        return respondWithSuccess(res, 200, 'Payout fetched successfully', payout);
    } catch (error) { return handleError(res, error); }
};



export const updatePreferences = async (req,res) => {
    try {
        const mode=req.body?.payout_mode;
        const cadence=req.body?.payout_cadence;
        const minimum=req.body?.minimum_payout_minor;
        if(mode===undefined&&cadence===undefined&&minimum===undefined) return respondWithError(res,400,'Provide payout_mode, payout_cadence, or minimum_payout_minor.',ERROR_CODES.VALIDATION_ERROR);
        if(minimum!==undefined&&!Number.isSafeInteger(minimum)) return respondWithError(res,400,'minimum_payout_minor must be an integer.',ERROR_CODES.VALIDATION_ERROR);
        const result=await savePayoutPreferences(vendorId(req),{payoutMode:mode,payoutCadence:cadence,minimumPayoutMinor:minimum});
        return respondWithSuccess(res,200,'Payout preferences updated',result);
    } catch(error) { return handleError(res,error); }
};



export const finalizePayout = async (req,res) => {
    try {
        const id=Number(req.params.payoutId);const otp=req.body?.otp;
        if(!Number.isSafeInteger(id)||id<1||typeof otp!=='string'||!/^\d{4,10}$/.test(otp))
            return respondWithError(res,400,'A valid payout ID and transfer OTP are required.',ERROR_CODES.VALIDATION_ERROR);
        return respondWithSuccess(res,202,'Paystack transfer authorization submitted',await finalizePayoutTransfer(id,otp));
    } catch(error) { return handleError(res,error); }
};

export const retryPayout = async (req,res) => {
    try {
        const id=Number(req.params.payoutId);
        if(!Number.isSafeInteger(id)||id<1)return respondWithError(res,400,'Invalid payout ID.',ERROR_CODES.VALIDATION_ERROR);
        return respondWithSuccess(res,202,'Payout retry queued',await retryFailedPayout(id));
    } catch(error) { return handleError(res,error); }
};

export const listAdminPayouts = async (req,res) => {
    try { return respondWithSuccess(res,200,'Payouts fetched successfully',await listAllPayouts(req.query)); }
    catch(error) { return handleError(res,error); }
};

export const updateVendorTaxRate = async (req,res) => {
    try {
        const vendorId=Number(req.params.vendorId);const taxRateBps=Number(req.body?.tax_rate_bps);
        if(!Number.isInteger(vendorId)||vendorId<1) return respondWithError(res,400,'Invalid vendor ID.',ERROR_CODES.VALIDATION_ERROR);
        return respondWithSuccess(res,200,'Vendor payout tax rate updated',await saveVendorTaxRate(vendorId,taxRateBps));
    } catch(error) { return handleError(res,error); }
};

export default { listPayouts, getPayoutById, getSummary, createRecipient, requestPayout, updatePreferences, listAdminPayouts, updateVendorTaxRate, retryPayout, finalizePayout };
