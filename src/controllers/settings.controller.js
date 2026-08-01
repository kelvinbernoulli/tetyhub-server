import queryModel from "#models/query.model.js";
import Settings from "#models/settings.model.js";
import settingsSchema from "#schemas/settings.schema.js";
import { getBase64Extension, S3delete, S3upload } from "#services/s3bucket.js";
import ERROR_CODES from "#utils/error.codes.js";
import { respondWithError, respondWithSuccess } from "#utils/response.js";

export const upsertSettings = async (req, res) => {
    try {
        const { body, session } = req;
        const user = session?.user;
        const vendorId = user.role === ROLES.VENDOR ? user.id : user.vendor_id;
        const { error } = settingsSchema.validate(body);
        if (error) {
            return respondWithError(res, 400, error.details[0].message, ERROR_CODES.VALIDATION_ERROR);
        }

        const { site_name, logo } = body;

        if (logo) {
            const existingSettings = await Settings.fetch(vendorId);
            const filename = `images/logo/${site_name}.${getBase64Extension(logo)}`;

            await S3upload(req, res, filename, logo);

            if (existingSettings.rowCount > 0 && existingSettings.rows[0].logo) {
                await S3delete(existingSettings.rows[0].logo);
            }

            body.logo = filename;
        }

        const result = await Settings.upsert(vendorId, body);
        if (result.rowCount === 0) {
            return respondWithError(res, 400, 'Settings update Failed', ERROR_CODES.RESOURCE_UPDATE_FAILED);
        }
        return respondWithSuccess(res, 200, 'Settings updated successfully', result.rows[0]);
    } catch (error) {
        console.error(error);
        return respondWithError(res, 500, error.message || error, ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
}

export const fetchSettings = async (req, res) => {
    try {
        const { session } = req;
        const user = session?.user;
        const vendorId = await getVendorId(user);
        const result = await Settings.fetch(vendorId);
        return respondWithSuccess(res, 200, 'Settings fetched successfully', result.rows[0]);
    } catch (error) {
        console.error(error);
        return respondWithError(res, 500, error.message || error, ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
}

export const upsertGeneralSettings = async (req, res) => {
    try {
        const { body, session } = req;
        const user = session?.user;
        const { error } = settingsSchema.validate(body);
        if (error) {
            return respondWithError(res, 400, error.details[0].message, ERROR_CODES.VALIDATION_ERROR);
        }

        const { site_name, logo } = body;

        if (logo) {
            const existingSettings = await queryModel.fetch_all('settings');
            const filename = `images/logo/${site_name}.${getBase64Extension(logo)}`;

            await S3upload(req, res, filename, logo);

            if (existingSettings.rowCount > 0 && existingSettings.rows[0].logo) {
                await S3delete(existingSettings.rows[0].logo);
            }

            body.logo = filename;
        }
        const result = await Settings.generalUpsert(body);
        if (result.rowCount === 0) {
            return respondWithError(res, 400, 'Settings update Failed', ERROR_CODES.RESOURCE_UPDATE_FAILED);
        }
        return respondWithSuccess(res, 200, 'Settings updated successfully', result.rows[0]);
    } catch (error) {
        console.error(error);
        return respondWithError(res, 500, error.message || error, ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
}

export const fetchGeneralSettings = async (req, res) => {
    try {
        const result = await queryModel.fetch_all('settings');
        return respondWithSuccess(res, 200, 'Settings fetched successfully', result.rows[0]);
    } catch (error) {
        console.error(error);
        return respondWithError(res, 500, error.message || error, ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
}

export default {
    upsertSettings,
    fetchSettings,
    upsertGeneralSettings,
    fetchGeneralSettings,
}