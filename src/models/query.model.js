import pool from "#services/pg_pool.js";

export const insert = async (tb_name, columns, column_values) => {
    try {
        if (columns.length === 0 || column_values.length === 0) {
            throw new Error("Columns and values must not be empty");
        }

        if (columns.length !== column_values.length) {
            throw new Error("Columns and values length mismatch");
        }

        const queryText = `INSERT INTO ${tb_name} (${columns.join(', ')}) VALUES (${column_values.map((_, index) => `$${index + 1}`).join(', ')}) RETURNING *`;

        return await pool.query(queryText, column_values);
    } catch (error) {
        console.error('Error inserting data:', error);
        return Promise.reject(error);
    }
};

export const update_by_id = async (tb_name, row_id, data) => {
    try {
        const keys = Object.keys(data);
        const values = Object.values(data);

        const setClause = keys.map((key, index) => `${key} = $${index + 1}`).join(', ');

        const queryText = `UPDATE ${tb_name} SET ${setClause} WHERE id = $${keys.length + 1} RETURNING *`;

        values.push(row_id);

        return await pool.query(queryText, values);
    } catch (error) {
        console.error('Error updating row:', error);
        return Promise.reject(error);
    }
};

export const update_status = async (tb_name, id, status) => {
    try {
        const setClause = `status = $1`;

        const queryText = `UPDATE ${tb_name} SET ${setClause} WHERE id = $2`;

        const result = await pool.query(queryText, [status, id]);

        return result;
    } catch (error) {
        console.error('Error updating user status:', error);
        return Promise.reject(error);
    }
};

export const check_country_detail = async (tb_name, columnName, value) => {
    try {
        const query = `SELECT 1 FROM ${tb_name} WHERE ${columnName} = $1 LIMIT 1`;
        return await pool.query(query, [value]);
    } catch (error) {
        console.error('Error executing query', error);
        return Promise.reject(error);
    }
};

export const search = async (tb_name, fields, searchTerm) => {
    const conditions = fields.map(field => `${field} ILIKE $1`).join(' OR ');
    const query = `SELECT * FROM ${tb_name} WHERE ${conditions}`;
    const values = [`%${searchTerm}%`];
    try {
        return await pool.query(query, values);
    } catch (error) {
        console.error('Error executing search query', error);
        throw error;
    }
};

export const fetch_one_by_key = async (tb_name, condition_key, condition_value) => {
    try {
        const queryText = `SELECT * FROM ${tb_name} WHERE ${condition_key} = $1 LIMIT 1`;

        return await pool.query(queryText, [condition_value]);
    } catch (error) {
        console.error('Error selecting column by key:', error);
        return Promise.reject(error);
    }
};

export const fetch_all_by_key = async (tb_name, condition_key, condition_value, offset = 0, limit = 20) => {
    try {
        const queryText = `SELECT * FROM ${tb_name} WHERE ${condition_key} = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`;

        return await pool.query(queryText, [condition_value, limit, offset]);
    } catch (error) {
        console.error('Error selecting column by key:', error);
        return Promise.reject(error);
    }
};

export const fetch_all_by_keys = async (tb_name, conditions, offset = 0, limit = 40) => {
    try {
        if (!Array.isArray(conditions) || conditions.length === 0) {
            return Promise.reject(new Error('conditions must be a non-empty array'));
        }

        let paramIndex = 1;
        const queryConditions = conditions.map((condition) => {
            if (condition.value === null) {
                return `${condition.key} IS NULL`;
            }
            return `${condition.key} = $${paramIndex++}`;
        });

        const queryValues = conditions
            .filter(c => c.value !== null)
            .map(c => c.value);

        const queryText = `
            SELECT * FROM ${tb_name} 
            WHERE ${queryConditions.join(' AND ')} 
            LIMIT $${paramIndex} 
            OFFSET $${paramIndex + 1}
        `;

        queryValues.push(limit, offset);

        return await pool.query(queryText, queryValues);
    } catch (error) {
        console.error('Error selecting column by key:', error);
        return Promise.reject(error);
    }
};

export const fetch_by_roles = async (tb_name, offset = 0, limit = 40) => {
    try {
        const queryText = `SELECT * FROM ${tb_name} WHERE role IN ($1, $2) ORDER BY id DESC OFFSET $3 FETCH NEXT $4 ROWS ONLY`;

        return await pool.query(queryText, ['3', '4', offset, limit]);
    } catch (error) {
        console.error('Error fetching data:', error);
        return Promise.reject(error);
    }
};


export const fetch_all = async (tb_name, offset = 0, limit = 40) => {
    try {
        const queryText = `SELECT * FROM ${tb_name} ORDER BY id DESC OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`;

        return await pool.query(queryText);
    } catch (error) {
        console.error('Error fetching data:', error);
        return Promise.reject(error);
    }
};

export const fetch_joined = async (tb1_name, tb2_name, tb1_column, tb2_column, offset = 0, limit = 40) => {
    try {
        const queryText = `
            SELECT *
            FROM ${tb1_name}
            JOIN ${tb2_name} ON ${tb1_name}.${tb1_column} = ${tb2_name}.${tb2_column}
            ORDER BY ${tb1_name}.${tb1_column} DESC
            OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY
        `;

        return await pool.query(queryText);
    } catch (error) {
        console.error('Error fetching data:', error);
        return Promise.reject(error);
    }
};

export const countSubRole = async (offset = 0, limit = 40) => {
    try {
        const queryText = `
            SELECT at.admin_type, COUNT(*) AS count
            FROM admin_types at
            JOIN users u ON at.id = ANY(u.sub_role)
            GROUP BY at.admin_type
            ORDER BY count DESC
            OFFSET $1 LIMIT $2;
        `;

        const result = await pool.query(queryText, [offset, limit]);
        return result.rows;
    } catch (error) {
        console.error('Error fetching data:', error);
        throw error;
    }
};

export const fetch_all_by_columns = async (tb_name, columns) => {
    try {
        const queryText = `SELECT ${columns.join(', ')} FROM ${tb_name}`;

        const { rows } = await pool.query(queryText);

        return rows;
    } catch (error) {
        console.error('Error fetching data:', error);
        return Promise.reject(error);
    }
}

export const select_all_by_key = async (tb_name, condition_key, condition_value) => {
    try {
        const queryText = `SELECT * FROM ${tb_name} WHERE ${condition_key} = $1;`;

        const result = await pool.query(queryText, [condition_value])
        return result.rows[0];
    } catch (error) {
        console.error('Error selecting column by key:', error);
        return Promise.reject(error);
    }
};

export const select_column_by_key = async (tb_name, column, condition_key, condition_value) => {
    try {
        const queryText = `SELECT ${column} FROM ${tb_name} WHERE ${condition_key} = $1;`;

        return await pool.query(queryText, [condition_value]);
    } catch (error) {
        console.error('Error selecting column by key:', error);
        return Promise.reject(error);
    }
};

export const select_columns_by_key = async (tb_name, columns, condition_key, condition_value) => {
    try {
        const queryText = `SELECT ${columns.join(', ')} FROM ${tb_name} WHERE ${condition_key} = $1`;

        return await pool.query(queryText, [condition_value]);
    } catch (error) {
        console.error('Error selecting columns by key:', error);
        return Promise.reject(error);
    }
};

export const select_column_by_keys = async (column, tb_name, conditions) => {
    try {
        const conditionKeys = Object.keys(conditions);
        const conditionValues = Object.values(conditions);

        const whereClause = conditionKeys.map((key, index) => `${key} = $${index + 1}`).join(' AND ');

        const queryText = `SELECT ${column} FROM ${tb_name} WHERE ${whereClause}`;

        return await pool.query(queryText, conditionValues);
    } catch (error) {
        console.error('Error selecting data by key:', error);
        return Promise.reject(error);
    }
};

export const select_by_keys = async (tb_name, conditions) => {
    try {
        const conditionKeys = Object.keys(conditions);
        const conditionValues = Object.values(conditions);

        const whereClause = conditionKeys.map((key, index) => `${key} = $${index + 1}`).join(' AND ');

        const queryText = `SELECT * FROM ${tb_name} WHERE ${whereClause}`;

        return await pool.query(queryText, conditionValues);
    } catch (error) {
        console.error('Error selecting data by keys:', error);
        throw error;
    }
};

export const delete_by_keys = async (table, conditions) => {
    try {
        if (!table || !conditions || Object.keys(conditions).length === 0) {
            throw new Error("Table name and at least one condition are required.");
        }

        const keys = Object.keys(conditions);
        const values = Object.values(conditions);

        const whereClause = keys.map((key, index) => `${key} = $${index + 1}`).join(" AND ");
        const query = `DELETE FROM ${table} WHERE ${whereClause} RETURNING *`;

        const result = await pool.query(query, values);
        return result;
    } catch (error) {
        console.error(`Error deleting from ${table}:`, error);
        throw error;
    }
};

//blogs with category & post author
export const fetch_all_by_multi_columns = async (tb_name) => {
    try {
        const queryText = `
    SELECT ${tb_name}.*, users.*, categories.name AS category_name
    FROM ${tb_name}
    JOIN users ON ${tb_name}.post_author = users.id
    JOIN categories ON ${tb_name}.category_id = categories.id
  `;

        const { rows } = await pool.query(queryText);

        return rows;
    } catch (error) {
        console.error('Error fetching data:', error);
        return Promise.reject(error);
    }
};

export const delete_by_column = async (tb_name, column, value) => {
    try {
        const queryText = `DELETE FROM ${tb_name} WHERE ${column} = $1`;
        return await pool.query(queryText, [value]);
    } catch (error) {
        console.error('Error deleting data:', error);
        return Promise.reject(error);
    }
};

export const get_table_count = async (tb_name, conditionColumn, conditionValue) => {
    try {
        const countQuery = {
            text: `SELECT COUNT(*) AS total FROM ${tb_name} WHERE ${conditionColumn} = $1`,
            values: [conditionValue],
        };
        const { rows } = await pool.query(countQuery);
        return rows[0].total;
    } catch (error) {
        console.error('Error getting count:', error);
        throw error;
    }
};

export const duplicate_check_by_columns = async (tableName, columns, values) => {
    if (columns.length === 0) {
        throw new Error('duplicate_check_by_columns: at least one column is required');
    }

    if (columns.length !== values.length) {
        throw new Error('duplicate_check_by_columns: columns and values arrays must be the same length');
    }

    const conditions = columns.map((col, i) => `${col} = $${i + 1}`);

    const { rows } = await pool.query(
        `SELECT id FROM ${tableName}
     WHERE ${conditions.join(' OR ')}
     LIMIT 1`,
        values
    );

    return rows;
};

export default {
    insert,
    select_all_by_key,
    update_by_id,
    update_status,
    check_country_detail,
    search, fetch_all,
    fetch_joined,
    countSubRole,
    fetch_all_by_columns,
    fetch_all_by_key,
    fetch_all_by_keys,
    fetch_by_roles,
    fetch_one_by_key,
    select_column_by_key,
    select_column_by_keys,
    select_columns_by_key,
    select_by_keys,
    delete_by_keys,
    delete_by_column,
    get_table_count,
    duplicate_check_by_columns,
};
