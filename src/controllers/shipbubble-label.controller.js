import ShipbubbleLabel from '#models/shipbubble-label.model.js';
import ERROR_CODES from '#utils/error.codes.js';
import { respondWithError, respondWithSuccess } from '#utils/response.js';

export async function getLabelBookingIssues(req, res) {
    try {
        const { offset, limit } = req.pagination;
        const result = await ShipbubbleLabel.getBookingIssues({ offset, limit });
        return respondWithSuccess(
            res,
            200,
            'ShipBubble label booking issues fetched',
            {
                data: result.rows,
                total_count: result.total,
                offset,
                limit,
            }
        );
    } catch (error) {
        console.error('Error fetching ShipBubble label booking issues:', error);
        return respondWithError(
            res,
            500,
            'Unable to fetch ShipBubble label booking issues',
            ERROR_CODES.INTERNAL_SERVER_ERROR
        );
    }
}
