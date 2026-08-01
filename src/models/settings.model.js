import pool from "#services/pg_pool.js";

export class Settings {
    static async upsert(vendorId, data) {
        const { site_name, phone_one, phone_two, email, twitter, instagram, linkedIn, snapchat, terms_and_conditions, privacy_policy } = data;
        const queryText = `UPSERT vendor_settings WHERE vendor_id = ${vendorId} SET site_name, phone_one, phone_two, email, twitter, 
                        instagram, linkedIn, snapchat, terms_and_conditions, privacy_policy`;
        const result = await pool.query(queryText,[
            site_name,
            phone_one,
            phone_two,
            email,
            twitter,
            instagram,
            linkedIn,
            snapchat,
            terms_and_conditions,
            privacy_policy
        ]);
        return result;
    }

    static async generalUpsert(data) {
        const { site_name, phone_one, phone_two, email, twitter, instagram, linkedIn, snapchat, terms_and_conditions, privacy_policy } = data;
        const queryText = `UPSERT settings SET site_name, phone_one, phone_two, email, twitter, instagram, linkedIn, snapchat, terms_and_conditions, privacy_policy`;
        const result = await pool.query(queryText, [
            site_name,
            phone_one,
            phone_two,
            email,
            twitter,
            instagram,
            linkedIn,
            snapchat,
            terms_and_conditions,
            privacy_policy
        ]);
        return result;
    }


    static async fetch(vendorId) {
        const queryText = `SELECT * FROM vendor_settings WHERE verndor_id = $1 LIMIT 1`;
        const result = await pool.query(queryText,[vendorId]);
        return result;
    }
}

export default Settings;