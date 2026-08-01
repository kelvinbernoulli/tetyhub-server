import * as AuthController from "#controllers/auth.controller.js";
import { authenticated } from "#middlewares/auth.middleware.js";
import { Router } from "express";
const router = Router();

router.post("/vendor/signup", AuthController.vendorSignup);
router.post("/customer/signup", AuthController.customerSignup);
router.get("/verify-email", AuthController.verifyEmail);
router.post('/resend-verification', AuthController.resendVerification);
router.post("/admin/login", AuthController.adminSignIn);
router.post("/login", AuthController.customerSignin);
router.post("/refresh-session", authenticated, AuthController.refreshSession);
router.get("/sessions", authenticated, AuthController.getAllSessions);
router.post("/sessions/revoke/:sessionId", authenticated, AuthController.revokeSession);
router.post("/logout", authenticated, AuthController.signOut);

router.post("/password-reset/request", AuthController.requestPasswordReset);
router.get("/password-reset/confirm", AuthController.confirmPasswordReset);

export default router;