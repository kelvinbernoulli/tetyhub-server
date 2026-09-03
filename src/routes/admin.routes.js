import * as supportTicketsController from "#controllers/support.ticket.controller.js";
import * as settingsController from "#controllers/settings.controller.js";
import * as CountriesController from "#controllers/countries.controller.js";
import * as CurrenciesController from "#controllers/currency.controller.js";
import * as AdminTypesController from "#controllers/admin.type.controller.js";
import * as AdminsController from "#controllers/admin.controller.js";
import * as PermissionsController from "#controllers/permission.controller.js";
import * as TransactionHistoryController from "#controllers/transaction.history.controller.js";
import * as ReturnController from "#controllers/return.controller.js";
import * as CategoriesController from '#controllers/categories.controller.js'
import * as SubcategoriesController from '#controllers/subcategories.controller.js'
import * as ChildsubcategoriesController from '#controllers/childsubcategories.controller.js'
import pagination from "#middlewares/pagination.middleware.js";
import { Router } from "express";
import { authenticated, canCreate, canDelete, canRead, canUpdate, isAllAdmin, isSuperAdmin, requireCsrfProtection, requireRecentAuthentication } from "#middlewares/auth.middleware.js";
const router = Router();

// The entire platform-admin surface is deny-by-default. Public storefront
// reads live on web.routes.js.
router.use(authenticated, isAllAdmin, requireCsrfProtection);

//currencies
router.post("/currencies/create", canCreate('currencies'), CurrenciesController.createCurrency);
router.get("/currencies", canRead('currencies'), pagination, CurrenciesController.fetchCurrencies);
router.get("/currencies/view/:currencyId", canRead('currencies'), CurrenciesController.fetchCurrencyById);
router.patch("/currencies/update/:currencyId", canUpdate('currencies'), CurrenciesController.updateCurrency);
router.delete("/currencies/delete/:currencyId", canDelete('currencies'), CurrenciesController.deleteCurrency);

//countries
router.post("/countries/create", canCreate('countries'), CountriesController.createCountry);
router.get("/countries", canRead('countries'), pagination, CountriesController.fetchCountries);
router.get("/countries/view/:countryId", canRead('countries'), CountriesController.fetchCountryById);
router.patch("/countries/update/:countryId", canUpdate('countries'), CountriesController.updateCountry);
router.delete("/countries/delete/:countryId", canDelete('countries'), CountriesController.deleteCountry);

//categories
router.post("/category/create", canCreate('categories'), CategoriesController.createCategory);
router.get("/categories", canRead('categories'), pagination, CategoriesController.fetchCategories);
router.get("/category/view/:categoryId", canRead('categories'), CategoriesController.fetchCategoryById);
router.patch("/category/update/:categoryId", canUpdate('categories'), CategoriesController.updateCategory);
router.delete("/category/delete/:categoryId", canDelete('categories'), CategoriesController.deleteCategory);

//subcategories
router.post("/subcategory/create", canCreate('categories'), SubcategoriesController.createSubcategory);
router.get("/subcategories", canRead('categories'), pagination, SubcategoriesController.fetchSubcategories);
router.get("/subcategory/view/:subcategoryId", canRead('categories'), SubcategoriesController.fetchSubcategoryById);
router.patch("/subcategory/update/:subcategoryId", canUpdate('categories'), SubcategoriesController.updateSubcategory);
router.delete("/subcategory/delete/:subcategoryId", canDelete('categories'), SubcategoriesController.deleteSubcategory);

//child-subcategories
router.post("/child-subcategory/create", canCreate('categories'), ChildsubcategoriesController.createChildsubcategory);
router.get("/child-subcategories", canRead('categories'), pagination, ChildsubcategoriesController.fetchChildsubcategories);
router.get("/child-subcategory/view/:childSubcategoryId", canRead('categories'), ChildsubcategoriesController.fetchChildsubcategoryById);
router.patch("/child-subcategory/update/:childSubcategoryId", canUpdate('categories'), ChildsubcategoriesController.updateChildsubcategory);
router.delete("/child-subcategory/delete/:childSubcategoryId", canDelete('categories'), ChildsubcategoriesController.deleteChildsubcategory);

//support tickets
router.post("/support-tickets/create", canCreate('support'), supportTicketsController.createSupportTicket);
router.patch("/support-tickets/:ticketId/reply", canUpdate('support'), supportTicketsController.replyToSupportTicket);
router.get("/support-tickets", canRead('support'), pagination, supportTicketsController.fetchSupportTickets);
router.get("/support-tickets/view/:ticketId", canRead('support'), supportTicketsController.getSupportTicket);
// router.delete("/support-tickets/:ticketId", authenticated, canDelete('support'), supportTicketsController.deleteGeneralSupportTicket);

//settings
router.get("/settings", canRead('settings'), pagination, settingsController.fetchGeneralSettings);
router.patch("/settings/upsert", canUpdate('settings'), settingsController.upsertGeneralSettings);

//admin types
router.post("/admin-type/create", isSuperAdmin, requireRecentAuthentication(), AdminTypesController.createAdminTypes);
router.get("/admin-types", canRead('admins'), pagination, AdminTypesController.fetchAdminTypes);
router.get("/admin-type/view/:id", canRead('admins'), AdminTypesController.viewAdminType);
router.patch("/admin-type/update/:id", isSuperAdmin, requireRecentAuthentication(), AdminTypesController.updateAdminTypes);
router.delete("/admin-type/delete/:id", isSuperAdmin, requireRecentAuthentication(), AdminTypesController.deleteAdminType);

//admins
router.post("/admin/create", isSuperAdmin, requireRecentAuthentication(), AdminsController.createAdmin);
router.get("/admins", canRead('admins'), pagination, AdminsController.fetchAdmins);
router.get("/admin/view/:adminId", canRead('admins'), AdminsController.fetchAdminById);
router.patch("/admin/update/:adminId", canUpdate('admins'), requireRecentAuthentication(), AdminsController.updateAdmin);
router.delete("/admin/delete/:adminId", canDelete('admins'), requireRecentAuthentication(), AdminsController.deleteAdmin);
router.post("/admin/:adminId/invitation/resend", isSuperAdmin, requireRecentAuthentication(), AdminsController.resendAdminInvitation);

// admin permissions
router.put("/permissions/assign/:adminId", canUpdate('admins'), requireRecentAuthentication(), PermissionsController.replaceAdminPermissions);
router.get("/permissions/:adminId", canRead('admins'), PermissionsController.fetchAdminPermissions);

//transactions
router.get("/transactions", canRead('transactions'), pagination, TransactionHistoryController.getAllTransactions);

//returns
router.get("/returns", canRead('returns'), pagination, ReturnController.getAllReturns);
router.patch("/returns/:returnId", canUpdate('returns'), ReturnController.adminUpdateReturn);

export default router;
