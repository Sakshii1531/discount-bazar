import express from 'express';
import { getFAQs, createFAQ, updateFAQ, deleteFAQ } from '../controller/faqController.js';
import { verifyToken, allowRoles } from '../middleware/authMiddleware.js';

const router = express.Router();

// This router is mounted at both /admin/faqs and /public/faqs, so every
// write must carry its own admin guard.
const adminOnly = [verifyToken, allowRoles('admin')];

// General Routes (accessible by all)
router.get('/', getFAQs);
router.get('/:id', getFAQs); // Generic get by id if needed

// Admin Routes
router.post('/', ...adminOnly, createFAQ);
router.put('/:id', ...adminOnly, updateFAQ);
router.delete('/:id', ...adminOnly, deleteFAQ);

export default router;
