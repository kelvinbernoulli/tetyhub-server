import * as AuthController from "#controllers/auth.controller.js";
import * as AdminController from "#controllers/admin.controller.js";
import { authenticated, isSuperAdmin, requireCsrfProtection, requireRecentAuthentication } from "#middlewares/auth.middleware.js";
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { createAuthRateLimiter } from '#middlewares/auth-rate-limit.middleware.js';
const router = Router();

const invitationLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: {
        success: false,
        message: 'Too many invitation attempts. Please try again later.',
        result: null,
        code: 3000,
    },
});

const reauthenticationLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: {
        success: false,
        message: 'Too many verification attempts. Please try again later.',
        result: null,
        code: 3000,
    },
});
const signInLimiter = createAuthRateLimiter({
    scope: 'signin',
    maxIp: 30,
    maxAccount: 10,
});
const emailActionLimiter = createAuthRateLimiter({
    scope: 'email-action',
    maxIp: 20,
    maxAccount: 5,
});
const resetConfirmLimiter = createAuthRateLimiter({
    scope: 'password-reset-confirm',
    maxIp: 30,
    maxAccount: 10,
});

router.post("/signup", emailActionLimiter, AuthController.userSignup);
router.get("/verify-email", emailActionLimiter, AuthController.verifyEmail);
router.post('/resend-verification', emailActionLimiter, AuthController.resendVerification);
router.post("/signin", signInLimiter, AuthController.userSignin);
router.post("/reauthenticate", authenticated, requireCsrfProtection, reauthenticationLimiter, AuthController.reauthenticate);
router.post("/refresh-session", authenticated, AuthController.refreshSession);
router.get("/csrf-token", authenticated, AuthController.getCsrfToken);
router.get("/sessions", authenticated, isSuperAdmin, requireRecentAuthentication(), AuthController.getAllSessions);
router.get("/user/sessions", authenticated, AuthController.getUserSessions);
router.delete("/sessions/:sessionId", authenticated, isSuperAdmin, requireRecentAuthentication(), requireCsrfProtection, AuthController.revokeSession);
router.delete("/user/sessions/:sessionId", authenticated, requireCsrfProtection, AuthController.revokeUserSession);
router.post("/signout", authenticated, AuthController.signOut);

router.post("/password-reset/request", emailActionLimiter, AuthController.requestPasswordReset);
router.post("/password-reset/confirm", resetConfirmLimiter, AuthController.confirmPasswordReset);
router.post("/admin-invitations/accept", invitationLimiter, AdminController.acceptAdminInvitation);
router.get('/google', AuthController.googleAuth);
router.get('/google/callback', AuthController.googleAuthCallback);

export default router;
