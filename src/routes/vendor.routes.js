import * as SettingsController from "#controllers/settings.controller.js";
import * as SupportTicketController from "#controllers/support.ticket.controller.js";
import * as ProductController from "#controllers/product.controller.js";
import * as VendorController from "#controllers/vendor.controller.js";
import * as ShipmentController from "#controllers/shipment.controller.js";
import * as ReturnController from "#controllers/return.controller.js";
import * as PermissionsController from "#controllers/permission.controller.js";
import * as PaymentController from "#controllers/payment.controller.js";
import * as AdminsController from "#controllers/admin.controller.js";
import * as TransactionHistoryController from "#controllers/transaction.history.controller.js";
import * as AdminTypesController from "#controllers/admin.type.controller.js";
import * as CouponsController from "#controllers/coupon.controller.js";
import pagination from "#middlewares/pagination.middleware.js";
import { Router } from "express";
import {
    authenticated,
    canCreate,
    canDelete,
    canRead,
    canUpdate,
    isVendorAndVendorAdmin,
    requireCsrfProtection,
    requireRecentAuthentication,
} from "#middlewares/auth.middleware.js";
const router = Router();

// Resolve the vendor from the authenticated database principal for every route.
router.use(authenticated, isVendorAndVendorAdmin, requireCsrfProtection);

//settings
router.get("/settings", canRead('settings'), pagination, SettingsController.fetchSettings);
router.patch("/settings/update", canUpdate('settings'), SettingsController.upsertSettings);

//support tickets
router.post("/support-tickets/create", canCreate('support'), SupportTicketController.createSupportTicket);
router.get("/support-tickets", canRead('support'), pagination, SupportTicketController.fetchSupportTickets);
router.get("/support-tickets/:ticketId", canRead('support'), SupportTicketController.getSupportTicket);
router.patch("/support-tickets/:ticketId/reply", canUpdate('support'), SupportTicketController.replyToSupportTicket);

//products
router.post("/product/create", canCreate('products'), ProductController.createProduct);
router.get("/products", canRead('products'), pagination, ProductController.fetchProducts);
router.get("/product/:id", canRead('products'), ProductController.fetchProductById);
router.patch("/product/update/:id", canUpdate('products'), ProductController.updateProduct);

//orders
router.get("/orders", canRead('orders'), pagination, VendorController.getVendorOrders);
router.get("/orders/:orderId", canRead('orders'), pagination, VendorController.getVendorOrderById);
router.get("/customer-orders", canRead('orders'), pagination, VendorController.getCustomerOrders);
router.patch("/order/:orderId/update-status", canUpdate('orders'), VendorController.updateOrderStatus);
router.patch("/order/:orderId/cancel", canUpdate('orders'), VendorController.cancelOrder);
router.get("/order/history/:customerId", canRead('orders'), pagination, VendorController.getOrderHistory);

//shipments
router.post("/orders/:orderId/shipments", canCreate('shipments'), ShipmentController.createShipment);
router.patch("/shipments/:shipmentId", canUpdate('shipments'), ShipmentController.updateShipment);
router.get("/shipments/:shipmentId", canRead('shipments'), ShipmentController.getShipmentById);
router.get("/shipments/:shipmentId/tracking", canRead('shipments'), ShipmentController.getTrackingHistory);
router.post("/shipments/:shipmentId/tracking", canUpdate('shipments'), ShipmentController.addTrackingUpdate);

//returns
router.get("/returns", canRead('returns'), pagination, ReturnController.getVendorReturns);
router.get("/returns/:returnId", canRead('returns'), ReturnController.getReturnById);
router.patch("/returns/:returnId/status", canUpdate('returns'), ReturnController.updateReturnStatus);

//refunds
router.post("/refunds", canCreate('refunds'), PaymentController.refund);

//payments
router.get('/payment/verify/:reference', canRead('payments'), PaymentController.verifyPayment);

//transactions
router.get('/transactions', canRead('transactions'), pagination, TransactionHistoryController.getVendorTransactions);

//dashboard
router.get("/dashboard/overview", canRead('dashboard'), VendorController.getDashboard);
router.get("/dashboard/revenue-chart", canRead('dashboard'), VendorController.getRevenueChart);
router.get("/dashboard/low-stock", canRead('dashboard'), VendorController.getLowStockProducts);

//admins
router.post("/admins/create", canCreate('admins'), requireRecentAuthentication(), AdminsController.createAdmin);
router.get("/admins", canRead('admins'), pagination, AdminsController.fetchAdmins);
router.get("/admins/:adminId", canRead('admins'), AdminsController.fetchAdminById);
router.patch("/admins/update/:adminId", canUpdate('admins'), requireRecentAuthentication(), AdminsController.updateAdmin);
router.delete("/admins/delete/:adminId", canDelete('admins'), requireRecentAuthentication(), AdminsController.deleteAdmin);
router.post("/admins/:adminId/invitation/resend", canCreate('admins'), requireRecentAuthentication(), AdminsController.resendAdminInvitation);

//admin types
router.get("/admin-types", canRead('admins'), pagination, AdminTypesController.fetchAdminTypes);
router.get("/admin-types/view/:id", canRead('admins'), AdminTypesController.viewAdminType);

//vendor admin permissions
router.put("/admins/:adminId/permissions", canUpdate('admins'), requireRecentAuthentication(), PermissionsController.replaceAdminPermissions);
router.get("/admins/:adminId/permissions", canRead('admins'), PermissionsController.fetchAdminPermissions);

//coupons
router.post("/coupons/create", canCreate('coupons'), CouponsController.createCoupon);
router.get("/coupons", canRead('coupons'), pagination, CouponsController.fetchCoupons);
router.get("/coupons/view/:couponId", canRead('coupons'), CouponsController.fetchCouponById);
router.patch("/coupons/update/:couponId", canUpdate('coupons'), CouponsController.updateCoupon);
router.delete("/coupons/delete/:couponId", canDelete('coupons'), CouponsController.deleteCoupon);

export default router;
