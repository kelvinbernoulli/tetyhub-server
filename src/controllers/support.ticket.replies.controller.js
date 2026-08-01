import ERROR_CODES from "#utils/error.codes.js";
import { respondWithError } from "#utils/response.js";

export const createTicketReply = async (req, res) => {
    try {
        
    } catch (error) {
        console.error(error);
        return respondWithError(res, 500, error.messsge || error, ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
}

export const updateTicketReply = async (req, res) => {
    try {
        
    } catch (error) {
        console.error(error);
        return respondWithError(res, 500, error.messsge || error, ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
}

export const fetchTicketReplies = async (req, res) => {
    try {
        
    } catch (error) {
        console.error(error);
        return respondWithError(res, 500, error.messsge || error, ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
}

export const fetchTicketReply = async (req, res) => {
    try {
        
    } catch (error) {
        console.error(error);
        return respondWithError(res, 500, error.messsge || error, ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
}

export const deleteTicketReply = async (req, res) => {
    try {
        
    } catch (error) {
        console.error(error);
        return respondWithError(res, 500, error.messsge || error, ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
}

export default {
    createTicketReply,
    updateTicketReply,
    fetchTicketReplies,
    fetchTicketReply,
    deleteTicketReply
}