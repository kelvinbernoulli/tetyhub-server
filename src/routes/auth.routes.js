import * as AuthController from "#controllers/auth.controller.js";
import { authenticated } from "#middlewares/auth.middleware.js";
import { Router } from "express";
const router = Router();

router.post("/signup", AuthController.userSignup);
router.get("/verify-email", AuthController.verifyEmail);
router.post('/resend-verification', AuthController.resendVerification);
router.post("/signin", AuthController.userSignin);
router.post("/refresh-session", authenticated, AuthController.refreshSession);
router.get("/sessions", authenticated, AuthController.getAllSessions);
router.post("/sessions/revoke/:sessionId", authenticated, AuthController.revokeSession);
router.post("/signout", authenticated, AuthController.signOut);

router.post("/password-reset/request", AuthController.requestPasswordReset);
router.get("/password-reset/confirm", AuthController.confirmPasswordReset);
router.get('/google', AuthController.googleAuth);
router.get('/google/callback', AuthController.googleAuthCallback);

export default router;