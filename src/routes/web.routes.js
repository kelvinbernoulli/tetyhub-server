import * as SupportTicketController from "#controllers/support.ticket.controller.js";
import * as SettingsController from "#controllers/settings.controller.js";
import * as ProductController from "#controllers/product.controller.js";
import * as CartController from "#controllers/cart.controller.js";
import * as OrderController from "#controllers/order.controller.js";
import * as ShipmentController from "#controllers/shipment.controller.js";
import * as ReturnController from "#controllers/return.controller.js";
import * as WishlistController from "#controllers/wishlist.controller.js";
import * as UsersController from "#controllers/users.controller.js";
import * as CountriesController from "#controllers/countries.controller.js";
import * as CategoriesController from "#controllers/categories.controller.js";
import * as TransactionHistoryController from "#controllers/transaction.history.controller.js";
import * as NotificationController from "#controllers/notification.controller.js";
import * as CouponsController from "#controllers/coupon.controller.js";
import pagination from "#middlewares/pagination.middleware.js";
import { Router } from "express";
import { authenticated, isCustomer } from "#middlewares/auth.middleware.js";
import paystackWebhook from "#services/webhook.js";
const router = Router();

//support tickets
router.post("/support-tickets/create", isCustomer, SupportTicketController.createSupportTicket);
router.patch("/support-tickets/:ticketId/reply", isCustomer, SupportTicketController.replyToSupportTicket);

//settings
router.get("/settings", pagination, SettingsController.fetchGeneralSettings);

//countries
router.get("/countries", CountriesController.fetchCountries);

router.get("/categories", pagination, CategoriesController.fetchCategories);

//coupons
router.get("/coupons", pagination, CouponsController.fetchCoupons);

//products
router.get("/products", pagination, ProductController.fetchProducts);
router.get("/product/:productId", ProductController.fetchProductById);
router.get("/products/search", pagination, ProductController.searchProducts);
router.get("/products/filters", ProductController.getFilters);
router.get("/products/related/:productId", pagination, ProductController.getRelatedProducts);
router.get("/products/featured", pagination, ProductController.getFeaturedProducts);

//cart
router.post("/cart/items/add", authenticated, isCustomer, CartController.addToCart);
router.get("/cart/items", pagination, authenticated, isCustomer, CartController.cartItems);
router.patch("/cart/items/update", authenticated, isCustomer, CartController.upsertCart);
router.delete("/cart/items/remove/:itemId", authenticated, isCustomer, CartController.removeFromCart);

//checkout
router.get("/cart/preview-checkout", authenticated, isCustomer, CartController.previewCheckout);
router.post("/cart/validate-coupon", authenticated, isCustomer, CartController.validateCoupon);
router.post("/cart/checkout", authenticated, isCustomer, CartController.processCheckout);

//wishlist
router.post("/wishlist/items/add/:product_id", authenticated, isCustomer, WishlistController.addToWishList);
router.get("/wishlist/items", pagination, authenticated, isCustomer, WishlistController.wishListItems);
router.delete("/wishlist/items/:item_id/remove", authenticated, isCustomer, WishlistController.removeFromWishList);
router.post("/wishlist/items/:item_id/move-to-cart", authenticated, isCustomer, WishlistController.moveToCart);

//orders
router.post("/orders/place", authenticated, isCustomer, OrderController.placeOrder);
router.get("/orders", pagination, authenticated, isCustomer, OrderController.getCustomerOrders);
router.get("/orders/:orderId", pagination, authenticated, isCustomer, OrderController.getCustomerOrderById);
router.get("/orders/history", isCustomer, authenticated, OrderController.getOrderHistory);
router.patch("/orders/cancel/:orderId", authenticated, isCustomer, OrderController.cancelOrder);

//shipments
router.get("/orders/:orderId/shipment", isCustomer, ShipmentController.getShipmentByOrderId);
router.get("/shipments/:shipmentId/tracking", isCustomer, ShipmentController.getTrackingHistory);

//returns
router.post("/orders/:orderId/return", isCustomer, ReturnController.createReturnRequest);
router.get("/orders/:orderId/returns", isCustomer, ReturnController.getReturnsByOrderId);
router.get("/returns", pagination, isCustomer, ReturnController.getCustomerReturns);
router.get("/returns/:returnId", isCustomer, ReturnController.getReturnById);

//notifications
router.get("/notifications", pagination, isCustomer, NotificationController.getUserNotifications);
router.get("/notifications/:notificationId", isCustomer, NotificationController.getUserNotification);
router.patch("/notifications/:notificationId/read", isCustomer, NotificationController.markAsRead);
router.patch("/notifications/mark-all-read", isCustomer, NotificationController.markAllAsRead);
router.get("/notifications/unread-count", isCustomer, NotificationController.getUnreadCount);

//profile
router.get("/profile", authenticated, isCustomer, UsersController.getProfile);
router.patch("/profile/update", authenticated, isCustomer, UsersController.updateProfile);

//address
router.post("/address/create", authenticated, isCustomer, UsersController.addAddress);
router.patch("/address/update/:addressId", authenticated, isCustomer, UsersController.updateAddress);
router.delete("/address/delete/:addressId", authenticated, isCustomer, UsersController.deleteAddress);

//payment
router.post('/webhook/paystack', paystackWebhook);

// transaction history
router.get('/transactions', pagination, isCustomer, TransactionHistoryController.getTransactions);
router.get('/transactions/:id', isCustomer, TransactionHistoryController.getTransactionById);

export default router;