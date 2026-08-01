export const pagination = (req, res, next) => {
    let { offset = 0, limit = 20 } = req.query;

    offset = parseInt(offset, 10);
    limit = parseInt(limit, 10);

    // Safety checks
    if (Number.isNaN(offset) || offset < 0) offset = 0;
    if (Number.isNaN(limit) || limit < 1) limit = 20;
    if (limit > 100) limit = 100;

    req.pagination = {
        offset,
        limit
    };

    res.paginate = (data, total) => ({
        data,
        pagination: {
            offset,
            limit,
            total
        }
    });

    next();
};

export default pagination;