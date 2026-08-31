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

//sub-subcategories
router.post("/sub-subcategory/create", authenticated, SubcategoriesController.createSubcategory);
router.get("/sub-subcategories", authenticated, pagination, SubcategoriesController.fetchSubcategories);
router.get("/sub-subcategory/view/:subSubcategoryId", authenticated, SubcategoriesController.fetchSubcategoryById);
router.patch("/sub-subcategory/update/:subSubcategoryId", authenticated, SubcategoriesController.updateSubcategory);
router.delete("/sub-subcategory/delete/:subSubcategoryId", authenticated, SubcategoriesController.deleteSubcategory);

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
router.post("/admin-types/create", canCreate('admin_types'), AdminTypesController.createAdminTypes);
router.get("/admin-types", pagination, isAllAdmin, authenticated, AdminTypesController.fetchAdminTypes);
router.get("/admin-types/view/:id", isAllAdmin, authenticated, AdminTypesController.viewAdminType);
router.patch("/admin-types/update/:id", canUpdate('admin_types'), AdminTypesController.updateAdminTypes);
router.delete("/admin-types/delete/:id", canDelete('admin_types'), AdminTypesController.deleteAdminType);

//admins
router.post("/admins/create", canCreate('admins'), AdminsController.createAdmin);
router.get("/admins", pagination, isAllAdmin, authenticated, AdminsController.fetchAdmins);
router.get("/admins/:id", isAllAdmin, authenticated, AdminsController.fetchAdminById);
router.patch("/admins/update/:id", canUpdate('admins'), AdminsController.updateAdmin);
router.delete("/admins/delete/:id", canDelete('admins'), AdminsController.deleteAdmin);

// admin permissions
router.post("/admins/permissions/assign", canCreate('admin_permissions'), PermissionsController.assignAdminPermissions);
router.get("/admins/permissions/:adminId", canRead('admin_permissions'), PermissionsController.fetchAdminPermissions);

//transactions
router.get("/transactions", pagination, isAllAdmin, authenticated, TransactionHistoryController.getAllTransactions);

//returns
router.get("/returns", pagination, canRead('returns'), authenticated, ReturnController.getAllReturns);
router.patch("/returns/:returnId", canUpdate('returns'), ReturnController.adminUpdateReturn);

export default router;