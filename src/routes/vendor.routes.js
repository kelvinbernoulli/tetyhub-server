import * as CategoriesController from "#controllers/categories.controller.js";
import * as SubcategoriesController from "#controllers/subcategories.controller.js";
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
import { authenticated, isVendor, isVendorAdmin, isVendorAndVendorAdmin } from "#middlewares/auth.middleware.js";
const router = Router();

//categories
router.post("/category/create", authenticated, CategoriesController.createCategory);
router.get("/categories", pagination, authenticated, CategoriesController.fetchVendorCategories);
router.get("/category/:categoryId", authenticated, CategoriesController.fetchCategoryById);
router.patch("/category/update/:categoryId", authenticated, CategoriesController.updateCategory);
router.delete("/category/delete/:categoryId", authenticated, CategoriesController.deleteCategory);

//subcategories
router.post("/subcategory/create", authenticated, SubcategoriesController.createSubcategory);
router.get("/subcategories", pagination, authenticated, SubcategoriesController.fetchVendorSubcategories);
router.get("/subcategory/:subcategoryId", authenticated, SubcategoriesController.fetchSubcategoryById);
router.patch("/subcategory/update/:subcategoryId", authenticated, SubcategoriesController.updateSubcategory);
router.delete("/subcategory/delete/:subcategoryId", authenticated, SubcategoriesController.deleteSubcategory);

//settings
router.get("/settings", pagination, authenticated, SettingsController.fetchSettings);
router.patch("/settings/update", authenticated, SettingsController.upsertSettings);

//support tickets
router.post("/support-tickets/create", authenticated, SupportTicketController.createSupportTicket);
router.get("/support-tickets", pagination, authenticated, SupportTicketController.fetchSupportTickets);
router.get("/support-tickets/:ticketId", authenticated, SupportTicketController.getSupportTicket);
router.patch("/support-tickets/:ticketId/reply", authenticated, SupportTicketController.replyToSupportTicket);

//products
router.post("/product/create", isVendorAndVendorAdmin, ProductController.createProduct);
router.get("/products", authenticated, isVendorAndVendorAdmin, pagination, ProductController.fetchProducts);
router.get("/product/:id", authenticated, isVendorAndVendorAdmin, ProductController.fetchProductById);
router.patch("/product/update/:id", authenticated, isVendorAndVendorAdmin, ProductController.updateProduct);

//orders
router.get("/orders", authenticated, pagination, isVendorAndVendorAdmin, VendorController.getVendorOrders);
router.get("/orders/:orderId", authenticated, pagination, isVendorAndVendorAdmin, VendorController.getVendorOrderById);
router.get("/customer-orders", authenticated, pagination, isVendorAndVendorAdmin, VendorController.getCustomerOrders);
router.patch("/order/:orderId/update-status", authenticated, isVendorAndVendorAdmin, VendorController.updateOrderStatus);
router.patch("/order/:orderId/cancel", authenticated, isVendorAndVendorAdmin, VendorController.cancelOrder);
router.get("/order/history/:customerId", authenticated, pagination, isVendorAndVendorAdmin, VendorController.getOrderHistory);

//shipments
router.post("/orders/:orderId/shipments", authenticated, isVendorAndVendorAdmin, ShipmentController.createShipment);
router.patch("/shipments/:shipmentId", authenticated, isVendorAndVendorAdmin, ShipmentController.updateShipment);
router.get("/shipments/:shipmentId", authenticated, isVendorAndVendorAdmin, ShipmentController.getShipmentById);
router.get("/shipments/:shipmentId/tracking", authenticated, isVendorAndVendorAdmin, ShipmentController.getTrackingHistory);
router.post("/shipments/:shipmentId/tracking", authenticated, isVendorAndVendorAdmin, ShipmentController.addTrackingUpdate);

//returns
router.get("/returns", authenticated, pagination, isVendorAndVendorAdmin, ReturnController.getVendorReturns);
router.get("/returns/:returnId", authenticated, isVendorAndVendorAdmin, ReturnController.getReturnById);
router.patch("/returns/:returnId/status", authenticated, isVendorAndVendorAdmin, ReturnController.updateReturnStatus);

//refunds
router.post("/refunds", authenticated, isVendorAndVendorAdmin, PaymentController.refund);

//payments
router.get('/payment/verify/:reference', authenticated, PaymentController.verifyPayment);

//transactions
router.get('/transactions', pagination, authenticated, TransactionHistoryController.getVendorTransactions);

//dashboard
router.get("/dashboard/overview", authenticated, VendorController.getDashboard);
router.get("/dashboard/revenue-chart", authenticated, VendorController.getRevenueChart);
router.get("/dashboard/low-stock", authenticated, VendorController.getLowStockProducts);

//admins
router.post("/admins/create", authenticated, AdminsController.createAdmin);
router.get("/admins", pagination, authenticated, AdminsController.fetchAdmins);
router.get("/admins/:id", authenticated, AdminsController.fetchAdminById);
router.patch("/admins/update/:id", authenticated, AdminsController.updateAdmin);
router.delete("/admins/delete/:id", authenticated, AdminsController.deleteAdmin);

//admin types
router.post("/admin-types/create", isVendorAndVendorAdmin, AdminTypesController.createAdminTypes);
router.get("/admin-types", pagination, isVendorAndVendorAdmin, authenticated, AdminTypesController.fetchAdminTypes);
router.get("/admin-types/view/:id", isVendorAndVendorAdmin, authenticated, AdminTypesController.fetchAdminType);
router.patch("/admin-types/update/:id", isVendorAndVendorAdmin, AdminTypesController.updateAdminTypes);
router.delete("/admin-types/delete/:id", isVendorAndVendorAdmin, AdminTypesController.deleteAdminType);

//vendor admin permissions
router.post("/admins/permissions/assign", isVendor, PermissionsController.assignAdminPermissions);
router.get("/admins/permissions/:adminId", isVendor, PermissionsController.fetchAdminPermissions);

//coupons
router.post("/coupons/create", authenticated, CouponsController.createCoupon);
router.get("/coupons", pagination, authenticated, CouponsController.fetchCoupons);
router.get("/coupons/view/:couponId", authenticated, CouponsController.fetchCouponById);
router.patch("/coupons/update/:couponId", authenticated, CouponsController.updateCoupon);
router.delete("/coupons/delete/:couponId", authenticated, CouponsController.deleteCoupon);

export default router;