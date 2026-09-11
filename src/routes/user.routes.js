import * as UsersController from "#controllers/users.controller.js";
import { authenticated, requireCsrfProtection } from "#middlewares/auth.middleware.js";
import { Router } from "express";
const router = Router();
// reads live on web.routes.js.
router.use(authenticated, requireCsrfProtection);

router.post("/shipping-address/add", UsersController.addAddress);
router.get("/shipping-addresses", UsersController.fetchAddresses);
router.patch("/shipping-address/update/:id", UsersController.updateAddress);
router.delete("/shipping-address/delete/:id", UsersController.deleteAddress);