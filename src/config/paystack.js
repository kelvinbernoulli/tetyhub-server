import axios from 'axios';

export const paystack = axios.create({
    baseURL: process.env.PAYSTACK_BASE_URL,
    headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json'
    }
});

export default paystack;