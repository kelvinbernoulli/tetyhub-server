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
import { authenticated, canCreate, canDelete, canRead, canUpdate, isAllAdmin, isSuperAdmin } from "#middlewares/auth.middleware.js";
const router = Router();

//currencies
router.post("/currencies/create", authenticated,  canCreate('currencies'), CurrenciesController.createCurrency);
router.get("/currencies", pagination, CurrenciesController.fetchCurrencies);
router.get("/currencies/view/:currencyId", CurrenciesController.fetchCurrencyById);
router.patch("/currencies/update/:currencyId", authenticated, canUpdate('currencies'), CurrenciesController.updateCurrency);
router.delete("/currencies/delete/:currencyId", authenticated, canDelete('currencies'), CurrenciesController.deleteCurrency);

//countries
router.post("/countries/create", authenticated, canCreate('countries'), CountriesController.createCountry);
router.get("/countries", pagination, CountriesController.fetchCountries);
router.get("/countries/view/:countryId", CountriesController.fetchCountryById);
router.patch("/countries/update/:countryId", authenticated, canUpdate('countries'), CountriesController.updateCountry);
router.delete("/countries/delete/:countryId", authenticated, canDelete('countries'), CountriesController.deleteCountry);

//categories
router.post("/category/create", authenticated, CategoriesController.createCategory);
router.get("/categories", authenticated, pagination, CategoriesController.fetchCategories);
router.get("/category/view/:categoryId", authenticated, CategoriesController.fetchCategoryById);
router.patch("/category/update/:categoryId", authenticated, CategoriesController.updateCategory);
router.delete("/category/delete/:categoryId", authenticated, CategoriesController.deleteCategory);

//subcategories
router.post("/subcategory/create", authenticated, SubcategoriesController.createSubcategory);
router.get("/subcategories", authenticated, pagination, SubcategoriesController.fetchSubcategories);
router.get("/subcategory/view/:subcategoryId", authenticated, SubcategoriesController.fetchSubcategoryById);
router.patch("/subcategory/update/:subcategoryId", authenticated, SubcategoriesController.updateSubcategory);
router.delete("/subcategory/delete/:subcategoryId", authenticated, SubcategoriesController.deleteSubcategory);

//child-subcategories
router.post("/child-subcategory/create", authenticated, ChildsubcategoriesController.createChildsubcategory);
router.get("/child-subcategories", authenticated, pagination, ChildsubcategoriesController.fetchChildsubcategories);
router.get("/child-subcategory/view/:childSubcategoryId", authenticated, ChildsubcategoriesController.fetchChildsubcategoryById);
router.patch("/child-subcategory/update/:childSubcategoryId", authenticated, ChildsubcategoriesController.updateChildsubcategory);
router.delete("/child-subcategory/delete/:childSubcategoryId", authenticated, ChildsubcategoriesController.deleteChildsubcategory);

//support tickets
router.post("/support-tickets/create", authenticated, canCreate('support'), supportTicketsController.createSupportTicket);
router.get("/support-tickets/:ticketId/reply", pagination, authenticated, canCreate('support'), supportTicketsController.replyToSupportTicket);
router.get("/support-tickets", pagination, supportTicketsController.fetchSupportTickets);
router.get("/support-tickets/view/:ticketId", supportTicketsController.getSupportTicket);
// router.delete("/support-tickets/:ticketId", authenticated, canDelete('support'), supportTicketsController.deleteGeneralSupportTicket);

//settings
router.get("/settings", pagination, settingsController.fetchGeneralSettings);
router.patch("/settings/upsert", authenticated, canUpdate('settings'), settingsController.upsertGeneralSettings);

//admin types
router.post("/admin-type/create", authenticated, AdminTypesController.createAdminTypes);
router.get("/admin-types", pagination, authenticated, AdminTypesController.fetchAdminTypes);
router.get("/admin-type/view/:id", authenticated, AdminTypesController.viewAdminType);
router.patch("/admin-type/update/:id", authenticated, AdminTypesController.updateAdminTypes);
router.delete("/admin-type/delete/:id", authenticated, AdminTypesController.deleteAdminType);

//admins
router.post("/admin/create", authenticated, AdminsController.createAdmin);
router.get("/admins", pagination, authenticated, AdminsController.fetchAdmins);
router.get("/admin/view/:id", authenticated, AdminsController.fetchAdminById);
router.patch("/admin/update/:id", authenticated, AdminsController.updateAdmin);
router.delete("/admin/delete/:id",authenticated, AdminsController.deleteAdmin);

// admin permissions
router.post("/admins/permissions/assign", authenticated, PermissionsController.assignAdminPermissions);
router.get("/admins/permissions/:adminId", authenticated, PermissionsController.fetchAdminPermissions);

//transactions
router.get("/transactions", pagination, isAllAdmin, authenticated, TransactionHistoryController.getAllTransactions);

//returns
router.get("/returns", pagination, canRead('returns'), authenticated, ReturnController.getAllReturns);
router.patch("/returns/:returnId", canUpdate('returns'), ReturnController.adminUpdateReturn);

export default router;